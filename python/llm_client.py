"""
统一的 LLM 客户端接口
支持 Gemini 和 Qwen 两种后端
"""
import os
import sys
from typing import Literal

# 支持的 LLM 提供商
LLMProvider = Literal["gemini", "qwen"]


def get_llm_provider() -> LLMProvider:
    """获取当前配置的 LLM 提供商"""
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    if provider not in ["gemini", "qwen"]:
        print(f"警告: 不支持的 LLM_PROVIDER '{provider}'，使用默认值 'gemini'", file=sys.stderr)
        return "gemini"
    return provider


def create_llm_client():
    """创建 LLM 客户端（根据配置自动选择）"""
    provider = get_llm_provider()

    if provider == "gemini":
        from gemini_client import create_gemini_client
        return create_gemini_client()
    elif provider == "qwen":
        from qwen_client import create_qwen_client
        return create_qwen_client()
    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")


def generate_content(client, *, model: str, contents, response_mime_type: str | None = None, retries: int = 3):
    """生成内容（统一接口）"""
    provider = get_llm_provider()

    if provider == "gemini":
        from gemini_client import generate_content as gemini_generate
        return gemini_generate(client, model=model, contents=contents,
                             response_mime_type=response_mime_type, retries=retries)
    elif provider == "qwen":
        from qwen_client import generate_content as qwen_generate
        return qwen_generate(client, model=model, contents=contents,
                           response_mime_type=response_mime_type, retries=retries)
    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")


def upload_file(client, file_path: str, retries: int = 3):
    """上传文件（仅 Gemini 支持，Qwen 使用 base64）"""
    provider = get_llm_provider()

    if provider == "gemini":
        from gemini_client import upload_file as gemini_upload
        return gemini_upload(client, file_path, retries)
    elif provider == "qwen":
        # Qwen 不需要上传，返回 None
        return None
    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")


def wait_for_file_ready(client, file_ref, *, poll_seconds: int = 3, timeout_seconds: int = 180):
    """等待文件处理完成（仅 Gemini 需要）"""
    provider = get_llm_provider()

    if provider == "gemini":
        from gemini_client import wait_for_file_ready as gemini_wait
        return gemini_wait(client, file_ref, poll_seconds=poll_seconds, timeout_seconds=timeout_seconds)
    elif provider == "qwen":
        # Qwen 不需要等待
        return file_ref
    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")


def delete_file(client, file_name: str) -> None:
    """删除文件（仅 Gemini 需要）"""
    provider = get_llm_provider()

    if provider == "gemini":
        from gemini_client import delete_file as gemini_delete
        gemini_delete(client, file_name)
    elif provider == "qwen":
        # Qwen 不需要删除
        pass
    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")
