"""
DeepSeek 客户端实现，使用 OpenAI SDK 兼容调用。
"""
import itertools
import os
import sys
import threading
import time
from typing import Any

from openai import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    InternalServerError,
    OpenAI,
    PermissionDeniedError,
    RateLimitError,
)

RETRYABLE_ERRORS = (APIConnectionError, InternalServerError, RateLimitError)
RETRYABLE_ERROR_MARKERS = (
    "server disconnected without sending a response",
    "connection reset",
    "connection aborted",
    "remote end closed connection without response",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "502",
    "503",
    "504",
)
KEY_FAILOVER_ERRORS = (
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
)
DEFAULT_KEY_FAILURE_COOLDOWN_SECONDS = 15 * 60
DEFAULT_GENERATE_RETRIES = 5
KEY_FAILOVER_ERROR_MARKERS = (
    "401",
    "402",
    "403",
    "429",
    "access denied",
    "api key",
    "apikey",
    "balance",
    "billing",
    "exceeded your current quota",
    "forbidden",
    "insufficient",
    "insufficient_quota",
    "invalid api key",
    "payment required",
    "quota",
    "rate limit",
    "rate_limit",
    "unauthorized",
    "余额不足",
    "欠费",
)


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


class DeepSeekClient:
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


def get_deepseek_api_keys() -> list[str]:
    """获取 DeepSeek API Key 列表，支持逗号或分号分隔"""
    raw_key = os.getenv("DEEPSEEK_API_KEY")
    if not raw_key:
        raise RuntimeError(
            "Missing DeepSeek API key. Set DEEPSEEK_API_KEY in your environment or .env file."
        )

    if ";" in raw_key:
        keys = [k.strip() for k in raw_key.split(";") if k.strip()]
    elif "," in raw_key:
        keys = [k.strip() for k in raw_key.split(",") if k.strip()]
    else:
        keys = [raw_key.strip()]

    return keys


def get_deepseek_base_url() -> str:
    """获取 DeepSeek API Base URL"""
    return os.getenv("DEEPSEEK_API_BASE_URL") or "https://api.deepseek.com/v1"


def create_deepseek_client() -> DeepSeekClient:
    """创建一个带有 Key 轮询能力的 DeepSeek 客户端包装器"""
    keys = get_deepseek_api_keys()
    base_url = get_deepseek_base_url()
    return DeepSeekClient(api_keys=keys, base_url=base_url)


def mask_api_key(api_key: str) -> str:
    key = str(api_key or "").strip()
    if len(key) >= 4:
        return f"****{key[-4:]}"
    return "****"


def _key_failure_cooldown_seconds() -> int:
    value = str(os.getenv("DEEPSEEK_KEY_FAILOVER_COOLDOWN_SECONDS") or "").strip()
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
    status_code = getattr(exc, "status_code", None)
    if status_code:
        parts.append(str(status_code))
    body = getattr(exc, "body", None)
    if body:
        parts.append(str(body))
    response = getattr(exc, "response", None)
    if response is not None:
        status = getattr(response, "status_code", None)
        if status:
            parts.append(str(status))
        text = getattr(response, "text", None)
        if text:
            parts.append(str(text))
    return " ".join(part for part in parts if part).lower()


def _is_key_failover_error(exc: Exception) -> bool:
    if isinstance(exc, KEY_FAILOVER_ERRORS):
        return True
    message = _error_text(exc)
    return any(marker in message for marker in KEY_FAILOVER_ERROR_MARKERS)


def _is_retryable_error(exc: Exception) -> bool:
    message = _error_text(exc)
    return (
        isinstance(exc, RETRYABLE_ERRORS)
        or _is_key_failover_error(exc)
        or any(marker in message for marker in RETRYABLE_ERROR_MARKERS)
    )


def _resolve_attempts(retries: int | None, client: DeepSeekClient) -> int:
    try:
        requested = int(retries or 1)
    except (TypeError, ValueError):
        requested = 1
    minimum = _env_int("DEEPSEEK_GENERATE_MIN_RETRIES", DEFAULT_GENERATE_RETRIES)
    return max(1, requested, minimum, getattr(client, "key_count", 1))


def generate_content(
    client: DeepSeekClient,
    *,
    model: str,
    contents: Any,
    response_mime_type: str | None = None,
    retries: int = DEFAULT_GENERATE_RETRIES,
    request_timeout: int | None = None,
) -> Any:
    """
    通过 OpenAI SDK 调用 DeepSeek 的 Chat Completion 接口。
    """
    # 构造请求参数
    messages = []
    
    # 转换 contents 为 OpenAI 兼容格式
    # contents 通常是字符串，或者是 [{"role": "user", "parts": [{"text": "..."}]}] 格式
    if isinstance(contents, str):
        messages.append({"role": "user", "content": contents})
    elif isinstance(contents, list):
        for msg in contents:
            if isinstance(msg, dict):
                role = msg.get("role", "user")
                if role == "model":
                    role = "assistant"
                parts = msg.get("parts", [])
                text_content = ""
                for part in parts:
                    if isinstance(part, str):
                        text_content += part
                    elif isinstance(part, dict) and "text" in part:
                        text_content += part["text"]
                messages.append({"role": role, "content": text_content})
            else:
                messages.append({"role": "user", "content": str(msg)})
    else:
        messages.append({"role": "user", "content": str(contents)})

    kwargs = {
        "model": model,
        "messages": messages,
    }

    if request_timeout:
        kwargs["timeout"] = request_timeout

    if response_mime_type == "application/json":
        kwargs["response_format"] = {"type": "json_object"}

    # 包装返回结果，兼容 gemini/qwen 的接口
    class DummyResponse:
        def __init__(self, text: str):
            self.text = text

    last_error = None
    attempts = _resolve_attempts(retries, client)
    for attempt in range(1, attempts + 1):
        api_key = client.api_key
        openai_client = OpenAI(
            api_key=api_key,
            base_url=client.base_url,
        )
        
        try:
            response = openai_client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content
            return DummyResponse(content)
        except Exception as e:
            last_error = e
            key_failover = _is_key_failover_error(e)
            if key_failover:
                client.mark_key_unavailable(api_key)
            should_retry = attempt < attempts and _is_retryable_error(e)
            if not should_retry:
                if isinstance(e, APIError):
                    print(f"[deepseek_client] Non-retryable API Error: {e}", file=sys.stderr)
                else:
                    print(f"[deepseek_client] Unexpected Error: {e}", file=sys.stderr)
                raise e
            wait_seconds = 0 if key_failover and client.key_count > 1 else min(8, 2 ** (attempt - 1))
            if key_failover and client.key_count > 1:
                retry_label = "retrying with next configured key"
            else:
                retry_label = f"retrying in {wait_seconds}s"
            print(
                f"[deepseek_client] Request failed (attempt {attempt}/{attempts}, "
                f"key={mask_api_key(api_key)}); {retry_label}: {e}",
                file=sys.stderr,
            )
            if wait_seconds > 0:
                time.sleep(wait_seconds)

    if last_error:
        raise last_error
    raise RuntimeError("Unexpected end of retry loop without returning or raising.")
