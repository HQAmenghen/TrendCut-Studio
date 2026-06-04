"""
千问（Qwen）原生客户端
使用 DashScope 官方 SDK 调用千问模型，不再依赖 OpenAI 兼容层。
"""
import os
import time
import sys
import json
from pathlib import Path
from urllib.parse import urlparse

import dashscope
from dashscope import MultiModalConversation, MultiModalEmbedding, Generation, TextEmbedding, TextReRank
import threading
import itertools

PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from pipeline.skills.prompt_skill_loader import load_prompt_text


DEFAULT_GENERATE_RETRIES = 8
DEFAULT_QWEN_TEXT_REQUEST_TIMEOUT_SECONDS = int(
    os.getenv("QWEN_TEXT_REQUEST_TIMEOUT_SECONDS", "120") or 120
)
DEFAULT_QWEN_MULTIMODAL_REQUEST_TIMEOUT_SECONDS = int(
    os.getenv("QWEN_MULTIMODAL_REQUEST_TIMEOUT_SECONDS", "180") or 180
)
DEFAULT_QWEN_EMBEDDING_MODEL = "text-embedding-v4"
DEFAULT_QWEN_MULTIMODAL_EMBEDDING_MODEL = "tongyi-embedding-vision-flash-2026-03-06"
DEFAULT_QWEN_RERANK_MODEL = "gte-rerank-v2"
DEFAULT_KEY_FAILURE_COOLDOWN_SECONDS = 15 * 60
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
    "there are no suitable clusters",
    "internalerror.algo",
    "balanceerror",
    "proxyerror",
    "unable to connect to proxy",
    "remote end closed connection without response",
    "max retries exceeded",
    "connection aborted",
)
KEY_FAILOVER_ERROR_MARKERS = (
    "401",
    "402",
    "403",
    "429",
    "access denied",
    "accessdenied",
    "api key",
    "apikey",
    "arrear",
    "arrearage",
    "balance not enough",
    "balanceerror",
    "balancenotenough",
    "billing",
    "exceeded your current quota",
    "forbidden",
    "insufficient balance",
    "insufficient quota",
    "insufficient_balance",
    "insufficient_quota",
    "invalid api key",
    "invalidapikey",
    "payment required",
    "prepaidbalancenotenough",
    "quota exceeded",
    "quotaexceeded",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "throttling",
    "unauthorized",
    "欠费",
    "余额不足",
)
QWEN_ASR_SYSTEM_PROMPT = load_prompt_text("qwen_client_skill.md", "ASR System Prompt")


class KeyRotator:
    """线程安全的 Key 轮询器"""
    def __init__(self, keys: list[str]):
        self.keys = [k.strip() for k in keys if k.strip()]
        if not self.keys:
            raise ValueError("API Key 列表不能为空")
        self.cycle = itertools.cycle(self.keys)
        self.disabled_until = {}
        self.lock = threading.Lock()
        self.count = len(self.keys)

    def next(self) -> str:
        with self.lock:
            now = time.time()
            for _ in range(self.count):
                key = next(self.cycle)
                if self.disabled_until.get(key, 0) <= now:
                    return key
            self.disabled_until.clear()
            return next(self.cycle)

    def mark_unavailable(self, key: str, *, cooldown_seconds: int) -> None:
        if self.count <= 1 or not key:
            return
        with self.lock:
            self.disabled_until[key] = time.time() + max(1, int(cooldown_seconds or 1))


class QwenClient:
    def __init__(self, api_keys: list[str], base_url: str):
        self.api_keys = api_keys
        self.base_url = base_url
        self.rotator = KeyRotator(api_keys)

    @property
    def api_key(self) -> str:
        """动态获取下一个 API Key"""
        return self.rotator.next()

    @property
    def key_count(self) -> int:
        return self.rotator.count

    def mark_key_unavailable(self, api_key: str) -> None:
        self.rotator.mark_unavailable(api_key, cooldown_seconds=_key_failure_cooldown_seconds())


def use_multimodal_text_api(model: str) -> bool:
    normalized = str(model or "").strip().lower()
    if not normalized:
        return False
    return (
        normalized.startswith("qwen3.")
        or normalized.startswith("qwen-3.")
    )


def get_qwen_api_keys() -> list[str]:
    """获取千问 API Key 列表，支持分号分隔"""
    raw_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if not raw_key:
        raise RuntimeError(
            "Missing Qwen API key. Set QWEN_API_KEY or DASHSCOPE_API_KEY in your environment or .env file."
        )
    
    # 支持分号或逗号分隔
    if ";" in raw_key:
        keys = [k.strip() for k in raw_key.split(";") if k.strip()]
    elif "," in raw_key:
        keys = [k.strip() for k in raw_key.split(",") if k.strip()]
    else:
        keys = [raw_key.strip()]
        
    return keys


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


def _should_use_sdk_default_base_url(base_url: str) -> bool:
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized:
        return True
    return normalized.startswith("https://dashscope.aliyuncs.com")


def _ensure_no_proxy_for_dashscope(base_url: str) -> None:
    host = urlparse((base_url or "").strip() or "https://dashscope.aliyuncs.com/api/v1").hostname
    if not host:
        return
    for key in ("NO_PROXY", "no_proxy"):
        existing = str(os.getenv(key) or "").strip()
        items = [item.strip() for item in existing.split(",") if item.strip()]
        lowered = {item.lower() for item in items}
        if host.lower() not in lowered:
            items.append(host)
            os.environ[key] = ",".join(items)


def _retry_wait_seconds(exc: Exception, attempt: int) -> int:
    message = str(exc or "").lower()
    if _is_key_failover_error(exc):
        return 0
    if "there are no suitable clusters" in message or "internalerror.algo" in message:
        return min(20, 8 * attempt)
    if "timed out" in message or "timeout" in message:
        return min(15, 3 * attempt + 2)
    if "proxyerror" in message or "unable to connect to proxy" in message or "remote end closed connection without response" in message:
        return min(10, 3 * attempt)
    return min(8, attempt * 2)


def create_qwen_client() -> QwenClient:
    """创建千问原生客户端"""
    configured_base_url = get_qwen_base_url()
    base_url = _normalize_native_base_url(configured_base_url)
    api_keys = get_qwen_api_keys()
    _ensure_no_proxy_for_dashscope(base_url)
    if _should_use_sdk_default_base_url(configured_base_url):
        client_base_url = "sdk_default"
    else:
        dashscope.base_http_api_url = base_url
        client_base_url = base_url
    return QwenClient(
        api_keys=api_keys,
        base_url=client_base_url,
    )


def describe_qwen_runtime(client: QwenClient) -> str:
    """返回脱敏后的运行时信息，便于排查环境变量污染"""
    return f"QWEN_RUNTIME|base_url={client.base_url}|key_suffix={mask_api_key(client.api_keys[0] if client.api_keys else '')}"


def mask_api_key(api_key: str) -> str:
    key = str(api_key or "").strip()
    if len(key) >= 4:
        return f"****{key[-4:]}"
    return "****"


def _key_failure_cooldown_seconds() -> int:
    value = str(os.getenv("QWEN_KEY_FAILOVER_COOLDOWN_SECONDS") or "").strip()
    if not value:
        return DEFAULT_KEY_FAILURE_COOLDOWN_SECONDS
    try:
        parsed = int(float(value))
    except ValueError:
        return DEFAULT_KEY_FAILURE_COOLDOWN_SECONDS
    return parsed if parsed > 0 else DEFAULT_KEY_FAILURE_COOLDOWN_SECONDS


def _env_int(name: str, default: int) -> int:
    value = str(os.getenv(name) or "").strip()
    if not value:
        return default
    try:
        parsed = int(float(value))
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _error_text(exc: Exception) -> str:
    parts = [str(exc or "")]
    response = getattr(exc, "response", None)
    if response is not None:
        status_code = getattr(response, "status_code", None)
        if status_code:
            parts.append(str(status_code))
        text = getattr(response, "text", None)
        if text:
            parts.append(str(text))
        try:
            payload = response.json()
            if payload:
                parts.append(json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass
    return " ".join(part for part in parts if part).lower()


def _is_retryable_error(exc: Exception) -> bool:
    """判断是否为可重试的错误"""
    message = _error_text(exc)
    return any(marker in message for marker in RETRYABLE_ERROR_MARKERS) or _is_key_failover_error(exc)


def _is_key_failover_error(exc: Exception) -> bool:
    """判断是否适合切换到备用 Key。"""
    message = _error_text(exc)
    return any(marker in message for marker in KEY_FAILOVER_ERROR_MARKERS)


def is_retryable_error(exc: Exception) -> bool:
    return _is_retryable_error(exc)


def is_key_failover_error(exc: Exception) -> bool:
    return _is_key_failover_error(exc)


def _resolve_attempts(retries: int | None, client: QwenClient) -> int:
    try:
        requested = int(retries or 1)
    except (TypeError, ValueError):
        requested = 1
    minimum = _env_int("QWEN_GENERATE_MIN_RETRIES", DEFAULT_GENERATE_RETRIES)
    return max(1, requested, minimum, getattr(client, "key_count", 1))


def _call_with_failover(
    client: QwenClient,
    *,
    operation: str,
    call,
    retries: int | None = DEFAULT_GENERATE_RETRIES,
    request_timeout: int | None = None,
):
    attempts = _resolve_attempts(retries, client)
    last_error = None
    for attempt in range(1, attempts + 1):
        api_key = client.api_key
        try:
            return call(api_key)
        except Exception as exc:
            last_error = exc
            key_failover = _is_key_failover_error(exc)
            if key_failover:
                client.mark_key_unavailable(api_key)
            should_retry = attempt < attempts and _is_retryable_error(exc)
            if not should_retry:
                raise
            wait_seconds = _retry_wait_seconds(exc, attempt)
            timeout_label = f", timeout={request_timeout}s" if request_timeout else ""
            if key_failover and client.key_count > 1:
                retry_label = "retrying with next configured key"
            else:
                retry_label = f"retrying in {wait_seconds}s"
            print(
                f"[qwen_client] {operation} attempt {attempt}/{attempts} failed "
                f"(key={mask_api_key(api_key)}{timeout_label}); {retry_label}: {exc}",
                file=sys.stderr,
                flush=True,
            )
            if wait_seconds > 0:
                time.sleep(wait_seconds)
    if last_error:
        raise last_error


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


def _contents_are_text_only(contents) -> bool:
    if isinstance(contents, str):
        return True
    if isinstance(contents, dict):
        return "text" in contents and len(contents.keys()) == 1
    if not isinstance(contents, list):
        return True
    for item in contents:
        if isinstance(item, str):
            continue
        if not isinstance(item, dict):
            continue
        if "text" in item and len(item.keys()) == 1:
            continue
        return False
    return True


def _convert_contents_to_text_prompt(contents) -> str:
    if isinstance(contents, str):
        return contents
    if isinstance(contents, dict):
        if "text" in contents:
            return str(contents.get("text") or "")
        return json.dumps(contents, ensure_ascii=False)
    if not isinstance(contents, list):
        return str(contents)
    parts = []
    for item in contents:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict) and "text" in item:
            parts.append(str(item.get("text") or ""))
        else:
            parts.append(json.dumps(item, ensure_ascii=False))
    return "\n".join(part for part in parts if part)


def _resolve_request_timeout(contents, request_timeout: int | None) -> int:
    if request_timeout is not None:
        try:
            resolved = int(request_timeout)
            if resolved > 0:
                return resolved
        except Exception:
            pass
    if _contents_are_text_only(contents):
        return DEFAULT_QWEN_TEXT_REQUEST_TIMEOUT_SECONDS
    return DEFAULT_QWEN_MULTIMODAL_REQUEST_TIMEOUT_SECONDS


class ResponseWrapper:
    def __init__(self, response):
        self._response = response

    @property
    def text(self):
        try:
            output = getattr(self._response, "output", None)
            if isinstance(output, dict):
                if "text" in output and output.get("text"):
                    return str(output.get("text"))
                if "choices" in output:
                    choices = output["choices"]
                    content = choices[0]["message"]["content"]
                    if isinstance(content, str):
                        return content
                    text_chunks = [part.get("text", "") for part in content if isinstance(part, dict) and part.get("text")]
                    return "\n".join(chunk for chunk in text_chunks if chunk)
        except Exception:
            pass
        try:
            if hasattr(self._response, "output") and hasattr(self._response.output, "text"):
                return str(self._response.output.text or "")
        except Exception:
            pass
        return ""

    @property
    def raw_response(self):
        return self._response


def normalize_qwen_text_model(model: str) -> str:
    return str(model or "").strip()


def get_qwen_embedding_model() -> str:
    return os.getenv("QWEN_EMBEDDING_MODEL", DEFAULT_QWEN_EMBEDDING_MODEL).strip() or DEFAULT_QWEN_EMBEDDING_MODEL


def get_qwen_multimodal_embedding_model() -> str:
    return os.getenv("QWEN_MULTIMODAL_EMBEDDING_MODEL", DEFAULT_QWEN_MULTIMODAL_EMBEDDING_MODEL).strip() or DEFAULT_QWEN_MULTIMODAL_EMBEDDING_MODEL


def get_qwen_rerank_model() -> str:
    return os.getenv("QWEN_RERANK_MODEL", DEFAULT_QWEN_RERANK_MODEL).strip() or DEFAULT_QWEN_RERANK_MODEL


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
    request_timeout: int | None = None,
):
    """
    使用 DashScope 原生多模态接口生成内容。
    文本、图像、视频、音频统一走原生 messages 协议。
    """
    messages = _convert_contents_to_messages(contents)
    resolved_timeout = _resolve_request_timeout(contents, request_timeout)
    response_format_kwargs = {}
    if response_mime_type == "application/json":
        response_format_kwargs["response_format"] = {"type": "json_object"}

    def call(api_key: str):
        if _contents_are_text_only(contents):
            normalized_model = normalize_qwen_text_model(model)
            if use_multimodal_text_api(normalized_model):
                return MultiModalConversation.call(
                    api_key=api_key,
                    model=normalized_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [{"text": _convert_contents_to_text_prompt(contents)}],
                        }
                    ],
                    request_timeout=resolved_timeout,
                    **response_format_kwargs,
                )
            return Generation.call(
                api_key=api_key,
                model=normalized_model,
                messages=[
                    {"role": "user", "content": _convert_contents_to_text_prompt(contents)}
                ],
                result_format="message",
                request_timeout=resolved_timeout,
                **response_format_kwargs,
            )
        return MultiModalConversation.call(
            api_key=api_key,
            model=model,
            messages=messages,
            request_timeout=resolved_timeout,
            **response_format_kwargs,
        )

    response = _call_qwen_response_with_failover(
        client,
        operation="native generate_content",
        retries=retries,
        request_timeout=resolved_timeout,
        call=call,
    )
    return ResponseWrapper(response)


def _call_qwen_response_with_failover(
    client: QwenClient,
    *,
    operation: str,
    call,
    retries: int | None = DEFAULT_GENERATE_RETRIES,
    request_timeout: int | None = None,
):
    def checked_call(api_key: str):
        response = call(api_key)
        _raise_for_response_error(response)
        return response

    return _call_with_failover(
        client,
        operation=operation,
        retries=retries,
        request_timeout=request_timeout,
        call=checked_call,
    )


def _extract_embedding_vectors(response) -> list:
    output = getattr(response, "output", None) or {}
    batch_embeddings = []
    if isinstance(output, dict):
        if isinstance(output.get("embeddings"), list):
            batch_embeddings = output.get("embeddings") or []
        elif isinstance(output.get("data"), list):
            batch_embeddings = output.get("data") or []
    if not batch_embeddings and isinstance(response, dict):
        batch_embeddings = response.get("output", {}).get("embeddings") or response.get("output", {}).get("data") or []
    vectors = []
    for item in batch_embeddings:
        if isinstance(item, dict):
            vector = item.get("embedding") or item.get("vector") or item.get("embeddings")
            if isinstance(vector, list):
                vectors.append(vector)
    return vectors


def generate_embeddings(
    client: QwenClient,
    *,
    texts,
    model: str | None = None,
):
    embedding_model = str(model or get_qwen_embedding_model()).strip() or get_qwen_embedding_model()
    inputs = texts
    if isinstance(texts, tuple):
        inputs = list(texts)
    if isinstance(inputs, str):
        inputs = [inputs]
    if not isinstance(inputs, list):
        inputs = list(inputs or [])

    batch_size = max(1, min(10, int(os.getenv("QWEN_EMBEDDING_BATCH_SIZE", "10") or 10)))
    vectors = []
    for offset in range(0, len(inputs), batch_size):
        batch = inputs[offset:offset + batch_size]
        response = _call_qwen_response_with_failover(
            client,
            operation="generate_embeddings",
            call=lambda api_key, batch=batch: TextEmbedding.call(
                model=embedding_model,
                input=batch,
                api_key=api_key,
            ),
        )
        vectors.extend(_extract_embedding_vectors(response))
    return vectors


def generate_multimodal_embeddings(
    client: QwenClient,
    *,
    inputs: list,
    model: str | None = None,
):
    """
    使用多模态向量模型生成嵌入。
    inputs: [{"text": "..."}, {"image": "url_or_path"}, ...] 每个元素单独生成一个向量
    """
    embedding_model = str(model or get_qwen_multimodal_embedding_model()).strip() or get_qwen_multimodal_embedding_model()
    vectors = []
    for item in inputs:
        if isinstance(item, str):
            item = {"text": item}
        response = _call_qwen_response_with_failover(
            client,
            operation="generate_multimodal_embeddings",
            call=lambda api_key, item=item: MultiModalEmbedding.call(
                model=embedding_model,
                input=[item],
                api_key=api_key,
            ),
        )
        output = getattr(response, "output", None) or {}
        embedding = None
        if isinstance(output, dict):
            emb_list = output.get("embeddings") or output.get("data") or []
            if emb_list and isinstance(emb_list, list):
                first = emb_list[0]
                if isinstance(first, dict):
                    embedding = first.get("embedding") or first.get("vector")
                elif isinstance(first, list):
                    embedding = first
        if embedding and isinstance(embedding, list):
            vectors.append(embedding)
    return vectors


def rerank_documents(
    client: QwenClient,
    *,
    query: str,
    documents,
    model: str | None = None,
    top_n: int | None = None,
    return_documents: bool = True,
):
    rerank_model = str(model or get_qwen_rerank_model()).strip() or get_qwen_rerank_model()
    response = _call_qwen_response_with_failover(
        client,
        operation="rerank_documents",
        call=lambda api_key: TextReRank.call(
            model=rerank_model,
            query=query,
            documents=list(documents or []),
            top_n=top_n,
            return_documents=return_documents,
            api_key=api_key,
        ),
    )
    output = getattr(response, "output", None) or {}
    results = []
    if isinstance(output, dict):
        results = output.get("results") or output.get("data") or []
    if not results and isinstance(response, dict):
        results = response.get("output", {}).get("results") or response.get("output", {}).get("data") or []
    return results


def transcribe_audio(client: QwenClient, audio_path: str, model: str = "qwen3-asr-flash", language: str = "zh") -> str:
    """
    使用千问原生多模态接口进行语音识别。
    """
    system_prompt = QWEN_ASR_SYSTEM_PROMPT.format(language=language)
    response = _call_qwen_response_with_failover(
        client,
        operation="transcribe_audio",
        call=lambda api_key: MultiModalConversation.call(
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": [{"text": system_prompt}]},
                {"role": "user", "content": [{"audio": _to_file_uri(audio_path)}]},
            ],
        ),
    )
    return ResponseWrapper(response).text
