"""
统一的 LLM 客户端接口
支持 Gemini、Qwen 和 Vertex AI 三种后端
Vertex AI 模式复用 gemini_client（google-genai SDK 原生支持 vertexai=True）
"""
import os
import sys
from typing import Literal

# 支持的 LLM 提供商
LLMProvider = Literal["gemini", "qwen", "vertex", "deepseek"]
SUPPORTED_LLM_PROVIDERS = {"gemini", "qwen", "vertex", "deepseek"}


def _normalize_provider(value: str | None, *, fallback: LLMProvider) -> LLMProvider:
    provider = str(value or "").strip().lower()
    if not provider:
        return fallback
    if provider not in SUPPORTED_LLM_PROVIDERS:
        print(f"警告: 不支持的 LLM provider '{provider}'，使用默认值 '{fallback}'", file=sys.stderr)
        return fallback
    return provider  # type: ignore[return-value]


def get_llm_provider() -> LLMProvider:
    """获取当前配置的 LLM 提供商"""
    return _normalize_provider(os.getenv("LLM_PROVIDER", "gemini"), fallback="gemini")


def get_text_llm_provider() -> LLMProvider:
    """获取文本处理专用 LLM 提供商。

    TEXT_LLM_PROVIDER 控制标题、文案、翻译、口播改写等纯文本任务。
    SCRIPT_LLM_PROVIDER 作为旧配置兼容项保留；未配置时回退全局 LLM_PROVIDER。
    """
    return _normalize_provider(
        os.getenv("TEXT_LLM_PROVIDER") or os.getenv("SCRIPT_LLM_PROVIDER"),
        fallback=get_llm_provider(),
    )


def _is_gemini_backend(provider: str | None = None) -> bool:
    """gemini 和 vertex 都走 gemini_client"""
    p = provider or get_llm_provider()
    return p in ("gemini", "vertex")


def create_llm_client(provider: str | None = None):
    """创建 LLM 客户端。provider 可覆盖全局 LLM_PROVIDER。"""
    p = provider or get_llm_provider()

    if p in ("gemini", "vertex"):
        from gemini_client import create_gemini_client
        return create_gemini_client(vertex_mode=(p == "vertex"))
    elif p == "qwen":
        from qwen_client import create_qwen_client
        return create_qwen_client()
    elif p == "deepseek":
        from deepseek_client import create_deepseek_client
        return create_deepseek_client()
    else:
        raise ValueError(f"不支持的 LLM 提供商: {p}")


def _detect_backend(client, provider: str | None = None) -> str:
    """根据 provider 参数或 client 类型自动判断后端"""
    if provider:
        return "gemini" if provider in ("gemini", "vertex") else provider
    # 按 client 类型自动检测：genai.Client / GeminiPool → gemini，DeepSeekClient → deepseek，否则 qwen
    type_name = type(client).__name__
    if type_name in ("Client", "GeminiPool"):
        return "gemini"
    elif type_name == "DeepSeekClient":
        return "deepseek"
    return get_llm_provider()


def generate_content(
    client,
    *,
    model: str,
    contents,
    response_mime_type: str | None = None,
    retries: int = 5,
    request_timeout: int | None = None,
    provider: str | None = None,
):
    """生成内容（统一接口）。自动根据 client 类型或 provider 参数路由。"""
    backend = _detect_backend(client, provider)
    if backend in ("gemini", "vertex"):
        from gemini_client import generate_content as gemini_generate
        return gemini_generate(client, model=model, contents=contents,
                             response_mime_type=response_mime_type, retries=retries)
    elif backend == "deepseek":
        from deepseek_client import generate_content as deepseek_generate
        return deepseek_generate(client, model=model, contents=contents,
                               response_mime_type=response_mime_type, retries=retries,
                               request_timeout=request_timeout)
    else:
        from qwen_client import generate_content as qwen_generate
        return qwen_generate(client, model=model, contents=contents,
                           response_mime_type=response_mime_type, retries=retries,
                           request_timeout=request_timeout)


def upload_file(client, file_path: str, retries: int = 3):
    """上传文件（Gemini/Vertex 支持，Qwen 使用本地文件）"""
    if _is_gemini_backend():
        from gemini_client import upload_file as gemini_upload
        return gemini_upload(client, file_path, retries)
    else:
        return None


def wait_for_file_ready(client, file_ref, *, poll_seconds: int = 3, timeout_seconds: int = 180):
    """等待文件处理完成（仅 Gemini/Vertex 需要）"""
    if _is_gemini_backend():
        from gemini_client import wait_for_file_ready as gemini_wait
        return gemini_wait(client, file_ref, poll_seconds=poll_seconds, timeout_seconds=timeout_seconds)
    else:
        return file_ref


def delete_file(client, file_name: str) -> None:
    """删除文件（仅 Gemini/Vertex 需要）"""
    if _is_gemini_backend():
        from gemini_client import delete_file as gemini_delete
        gemini_delete(client, file_name)
