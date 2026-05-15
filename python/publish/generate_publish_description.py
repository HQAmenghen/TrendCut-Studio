import argparse
import os
import re
import sys

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_text_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded
from pipeline.skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_QWEN_MODEL = "qwen3.6-plus"

def get_publish_model(provider=None):
    """获取发布描述生成模型"""
    provider = provider or get_text_llm_provider()
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    elif provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv(
            "PUBLISH_DESCRIPTION_GEMINI_MODEL",
            os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        )

GEMINI_MODEL = get_publish_model()
PUBLISH_PROMPT_TEMPLATE = load_prompt_text("publish_description_skill.md")
NO_TAGS_INSTRUCTION = load_prompt_text("publish_description_skill.md", "No Tags Instruction")
WITH_TAGS_INSTRUCTION = load_prompt_text("publish_description_skill.md", "With Tags Instruction")
def normalize_output(text: str, strip_tags: bool = True) -> str:
    cleaned = str(text or "").strip()
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\"“”‘’]", "", cleaned)
    if strip_tags:
        cleaned = re.sub(r"\s*#[^\s#]+", "", cleaned)
    cleaned = re.sub(r"\n+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate short publish description for WeChat Channels.")
    parser.add_argument("--source-text", required=True, help="Subtitle summary or source transcript snippet.")
    parser.add_argument("--title", default="", help="Preferred publish title or topic anchor.")
    parser.add_argument("--include-tags", action="store_true", help="Append tightly relevant hashtags to the generated description.")
    args = parser.parse_args()

    emit_stage("publish_description", "正在生成发布描述")
    source_text = normalize_output(args.source_text)
    title = normalize_output(args.title)
    if not source_text:
        emit_result("源文本为空，返回空描述", description="")
        print("")
        return

    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    tag_instruction = NO_TAGS_INSTRUCTION
    if args.include_tags:
        tag_instruction = WITH_TAGS_INSTRUCTION

    prompt = PUBLISH_PROMPT_TEMPLATE.format(
        tag_instruction=tag_instruction,
        title=title or "（未提供）",
        source_text=source_text,
    )
    response = generate_content(
        client,
        model=get_publish_model(provider),
        contents=prompt,
        provider=provider,
    )
    description = normalize_output(response.text, strip_tags=not args.include_tags)
    emit_result("发布描述生成完成", description=description)
    print(description)


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="PUBLISH_DESCRIPTION_FAILED",
        error_message="发布描述生成失败",
        error_stage="publish.description",
        hint="请检查 Gemini Key、模型配置和输入摘要文本",
    ))
