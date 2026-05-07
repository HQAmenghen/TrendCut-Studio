import sys
import io
import argparse
import os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_text_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded
from pipeline.skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.6-plus"
FORBIDDEN_TERMS = [
    "数字人",
    "原片",
    "原视频",
    "深度拆解",
    "带你拆解",
    "先看视频",
    "先看原片",
    "更多内容请看视频",
    "综上所述",
    "总而言之",
    "值得深思",
    "应该注意的是",
    "值得注意的是",
    "需要指出的是",
    "毫无疑问",
    "一般来说",
    "不可否认",
    "众所周知",
]
BASE_PROMPT_TEMPLATE = load_prompt_text("optimize_text_skill.md", "Base Prompt")
RETRY_ADDENDUM_TEMPLATE = load_prompt_text("optimize_text_skill.md", "Retry Addendum")

def get_text_model(provider=None):
    """获取文本生成模型"""
    provider = provider or get_text_llm_provider()
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    elif provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)

def contains_forbidden_terms(text):
    normalized = str(text or "")
    return [term for term in FORBIDDEN_TERMS if term in normalized]

def optimize_text(text):
    emit_stage("optimize_text", "正在优化口播文案")
    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    base_prompt = BASE_PROMPT_TEMPLATE.format(text=text)
    prompt = base_prompt
    optimized = ""
    for attempt in range(2):
        response = generate_content(
            client,
            model=get_text_model(provider),
            contents=prompt,
            provider=provider,
        )
        optimized = response.text.strip()
        matched = contains_forbidden_terms(optimized)
        if not matched:
            break
        if attempt == 0:
            prompt = base_prompt + RETRY_ADDENDUM_TEMPLATE.format(matched_terms=", ".join(matched))
    emit_result("文案优化完成", text=optimized)
    print(optimized)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", type=str, required=True, help="原始口播文案")
    args = parser.parse_args()
    sys.exit(run_guarded(
        lambda: optimize_text(args.text),
        error_code="OPTIMIZE_TEXT_FAILED",
        error_message="文案优化失败",
        error_stage="optimize_text",
        hint="请检查 Gemini Key、模型配置和输入文案",
    ))
