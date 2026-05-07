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
    InternalServerError,
    OpenAI,
    RateLimitError,
)

RETRYABLE_ERRORS = (APIConnectionError, InternalServerError, RateLimitError)


class KeyRotator:
    """线程安全的 Key 轮询器"""

    def __init__(self, keys: list[str]):
        self.keys = [k.strip() for k in keys if k.strip()]
        if not self.keys:
            raise ValueError("API Key 列表不能为空")
        self.cycle = itertools.cycle(self.keys)
        self.lock = threading.Lock()
        self.count = len(self.keys)

    def next(self) -> str:
        with self.lock:
            return next(self.cycle)


class DeepSeekClient:
    def __init__(self, api_keys: list[str], base_url: str):
        self.api_keys = api_keys
        self.base_url = base_url
        self.rotator = KeyRotator(api_keys)

    @property
    def api_key(self) -> str:
        """动态获取下一个 API Key"""
        return self.rotator.next()


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


def generate_content(
    client: DeepSeekClient,
    *,
    model: str,
    contents: Any,
    response_mime_type: str | None = None,
    retries: int = 3,
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
    for attempt in range(max(1, retries)):
        api_key = client.api_key
        openai_client = OpenAI(
            api_key=api_key,
            base_url=client.base_url,
        )
        
        try:
            response = openai_client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content
            return DummyResponse(content)
        except RETRYABLE_ERRORS as e:
            last_error = e
            print(f"[deepseek_client] Request failed (attempt {attempt+1}/{retries}): {e}", file=sys.stderr)
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
        except APIError as e:
            # Non-retryable API Error
            print(f"[deepseek_client] Non-retryable API Error: {e}", file=sys.stderr)
            raise e
        except Exception as e:
            print(f"[deepseek_client] Unexpected Error: {e}", file=sys.stderr)
            raise e

    if last_error:
        raise last_error
    raise RuntimeError("Unexpected end of retry loop without returning or raising.")
