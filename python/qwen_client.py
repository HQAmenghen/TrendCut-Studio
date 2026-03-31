"""
千问（Qwen）原生客户端
使用 DashScope 官方 SDK 调用千问模型，不再依赖 OpenAI 兼容层。
"""
import os
import time
import sys
from dataclasses import dataclass
from pathlib import Path

import dashscope
from dashscope import MultiModalConversation


DEFAULT_GENERATE_RETRIES = 3
RETRYABLE_ERROR_MARKERS = (
    "server disconnected without sending a response",
    "connection reset",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "502",
    "503",
    "504",
    "throttling",
)


@dataclass
class QwenClient:
    api_key: str
    base_url: str


def get_qwen_api_key() -> str:
    """获取千问 API Key"""
    api_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing Qwen API key. Set QWEN_API_KEY or DASHSCOPE_API_KEY in your environment or .env file."
        )
    return api_key


def get_qwen_base_url() -> str:
    """获取千问 API Base URL"""
    return os.getenv("QWEN_API_BASE_URL") or "https://dashscope.aliyuncs.com/api/v1"


def _normalize_native_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip() or "https://dashscope.aliyuncs.com/api/v1"
    normalized = normalized.rstrip("/")
    if normalized.endswith("/compatible-mode/v1"):
      return normalized[:-len("/compatible-mode/v1")] + "/api/v1"
    if normalized.endswith("/compatible-mode"):
      return normalized[:-len("/compatible-mode")] + "/api/v1"
    if normalized.endswith("/v1") and not normalized.endswith("/api/v1"):
      return normalized[:-len("/v1")] + "/api/v1"
    return normalized


def create_qwen_client() -> QwenClient:
    """创建千问原生客户端"""
    base_url = _normalize_native_base_url(get_qwen_base_url())
    api_key = get_qwen_api_key()
    dashscope.base_http_api_url = base_url
    return QwenClient(
        api_key=api_key,
        base_url=base_url,
    )


def describe_qwen_runtime(client: QwenClient) -> str:
    """返回脱敏后的运行时信息，便于排查环境变量污染"""
    masked = "****"
    if client.api_key and len(client.api_key) >= 4:
        masked = client.api_key[-4:]
    return f"QWEN_RUNTIME|base_url={client.base_url}|key_suffix={masked}"


def _is_retryable_error(exc: Exception) -> bool:
    """判断是否为可重试的错误"""
    message = str(exc or "").lower()
    return any(marker in message for marker in RETRYABLE_ERROR_MARKERS)


def _mime_to_content_key(mime_type: str) -> str:
    mime_type = str(mime_type or "").lower()
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    return "text"


def _to_file_uri(file_path: str) -> str:
    return "file://" + Path(file_path).resolve().as_posix()


def _build_content_part(item):
    if isinstance(item, str):
        return {"text": item}

    if not isinstance(item, dict):
        return {"text": str(item)}

    if "text" in item:
        return {"text": item["text"]}

    if "inline_data" in item:
        inline_data = item["inline_data"] or {}
        mime_type = inline_data.get("mime_type", "")
        data = inline_data.get("data", "")
        content_key = _mime_to_content_key(mime_type)
        payload = {content_key: f"data:{mime_type};base64,{data}"}
        if "fps" in item:
            payload["fps"] = item["fps"]
        return payload

    local_path = item.get("local_path") or item.get("file_path") or item.get("path")
    if local_path:
        media_type = item.get("media_type") or _mime_to_content_key(item.get("mime_type", ""))
        if media_type not in {"image", "video", "audio"}:
            media_type = "video"
        payload = {media_type: _to_file_uri(local_path)}
        if "fps" in item:
            payload["fps"] = item["fps"]
        return payload

    for key in ("image", "video", "audio"):
        if key in item:
            payload = {key: item[key]}
            if "fps" in item:
                payload["fps"] = item["fps"]
            return payload

    return {"text": str(item)}


def _convert_contents_to_messages(contents):
    if isinstance(contents, list):
        parts = [_build_content_part(item) for item in contents]
        return [{"role": "user", "content": parts}]
    return [{"role": "user", "content": [_build_content_part(contents)]}]


class ResponseWrapper:
    def __init__(self, response):
        self._response = response

    @property
    def text(self):
        try:
            choices = self._response.output["choices"]
            content = choices[0]["message"]["content"]
            text_chunks = [part.get("text", "") for part in content if isinstance(part, dict) and part.get("text")]
            return "\n".join(chunk for chunk in text_chunks if chunk)
        except Exception:
            return ""

    @property
    def raw_response(self):
        return self._response


def _raise_for_response_error(response):
    status_code = getattr(response, "status_code", None)
    if status_code == 200:
        return
    code = getattr(response, "code", "") or "qwen_request_failed"
    message = getattr(response, "message", "") or str(response)
    request_id = getattr(response, "request_id", "")
    suffix = f" (request_id: {request_id})" if request_id else ""
    raise RuntimeError(f"{code}: {message}{suffix}")


def generate_content(
    client: QwenClient,
    *,
    model: str,
    contents,
    response_mime_type: str | None = None,
    retries: int = DEFAULT_GENERATE_RETRIES,
):
    """
    使用 DashScope 原生多模态接口生成内容。
    文本、图像、视频、音频统一走原生 messages 协议。
    """
    messages = _convert_contents_to_messages(contents)
    attempts = max(1, int(retries or 1))
    last_error = None

    for attempt in range(1, attempts + 1):
        try:
            response = MultiModalConversation.call(
                api_key=client.api_key,
                model=model,
                messages=messages,
            )
            _raise_for_response_error(response)
            return ResponseWrapper(response)
        except Exception as exc:
            last_error = exc
            should_retry = attempt < attempts and _is_retryable_error(exc)
            if not should_retry:
                raise
            wait_seconds = min(6, attempt * 2)
            print(
                f"[qwen_client] native generate_content attempt {attempt}/{attempts} failed, retrying in {wait_seconds}s: {exc}",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait_seconds)

    if last_error:
        raise last_error


def transcribe_audio(client: QwenClient, audio_path: str, model: str = "qwen3-asr-flash", language: str = "zh") -> str:
    """
    使用千问原生多模态接口进行语音识别。
    """
    system_prompt = f"请将音频转写为文字。语言: {language}"
    response = MultiModalConversation.call(
        api_key=client.api_key,
        model=model,
        messages=[
            {"role": "system", "content": [{"text": system_prompt}]},
            {"role": "user", "content": [{"audio": _to_file_uri(audio_path)}]},
        ],
    )
    _raise_for_response_error(response)
    return ResponseWrapper(response).text
