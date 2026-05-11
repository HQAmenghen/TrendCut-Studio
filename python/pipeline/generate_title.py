import sys
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import argparse
import json
import os
import re
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_text_llm_provider
from script_protocol import emit_error, emit_result, emit_stage, run_guarded
from pipeline.skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.6-plus"

def get_text_model(provider=None):
    """获取文本生成模型"""
    provider = provider or get_text_llm_provider()
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    elif provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)

GEMINI_MODEL = get_text_model()
TITLE_PROMPT = load_prompt_text("generate_title_skill.md")

def visible_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def clamp_line(text: str, limit: int) -> str:
    compact = re.sub(r"\s+", "", text).strip()
    if visible_len(compact) <= limit:
        return compact
    return compact[:limit]


def normalize_title(title: str) -> str:
    cleaned = title.replace("\\n", "\n").replace("\r\n", "\n").replace("\r", "\n").strip()
    cleaned = re.sub(r"[\"“”‘’]", "", cleaned)
    lines = [line.strip("：:，,。.！？!? ") for line in cleaned.split("\n") if line.strip()]
    used_explicit_breaks = len(lines) >= 2

    if not lines:
        return "万事达卡出手\n支付格局要变？"

    merged = "".join(lines)
    merged = re.sub(r"\s+", "", merged)
    merged = re.sub(r"[。；;]+$", "", merged)

    if used_explicit_breaks:
        first = re.sub(r"\s+", "", lines[0]).strip()
        second = re.sub(r"\s+", "", "".join(lines[1:])).strip()
    else:
        split_at = min(max(4, len(merged) // 3), 7)
        first = merged[:split_at]
        second = merged[split_at:]

    if not second:
        second = "支付格局要变？"

    if not used_explicit_breaks:
        first = clamp_line(first, 8)
        second = clamp_line(second, 12)

    if not used_explicit_breaks and len(second) <= len(first):
        pool = (first + second).replace("\n", "")
        split_at = min(max(4, len(pool) // 3), 7)
        first = clamp_line(pool[:split_at], 7)
        second = clamp_line(pool[split_at:], 10)

    if not used_explicit_breaks and len(second) <= len(first) and len(first) > 4:
        move_count = min(2, len(first) - 4)
        second = first[-move_count:] + second
        first = first[:-move_count]

    if not used_explicit_breaks and len(second) <= 2 and len(first) >= 2:
        spill = first[-2:]
        first = first[:-2]
        second = spill + second

    if not re.search(r"[？?！!]$", second):
        second += "？"

    return first + "\n" + second


def main():
    parser = argparse.ArgumentParser(description="Generate a short catchy video title from subtitles.")
    parser.add_argument("--subtitles", default="subtitles.json", help="Subtitle JSON path.")
    parser.add_argument("--context", help="Optional original post title/body for better context.")
    parser.add_argument("--script", help="Optional digital human narration script.")
    args = parser.parse_args()

    emit_stage("titling", "正在读取字幕并生成标题")
    
    # 获取主要口播内容 (优先使用手动提供的 script，否则使用 subtitles)
    transcript = ""
    if args.script and os.path.exists(args.script):
        try:
            with open(args.script, "r", encoding="utf-8") as f:
                script_data = json.load(f)
                if isinstance(script_data, dict) and "full_text" in script_data:
                    transcript = script_data["full_text"]
                elif isinstance(script_data, str):
                    transcript = script_data
        except:
            pass
            
    if not transcript:
        with open(args.subtitles, "r", encoding="utf-8") as f:
            subtitles = json.load(f)

        transcript_lines = []
        for item in subtitles:
            text = str(item.get("zh") or item.get("text") or "").strip()
            if text:
                transcript_lines.append(text)
        transcript = "\n".join(transcript_lines[:40]).strip()

    if not transcript:
        emit_result("使用默认标题", title="这条消息可能正在改变支付格局")
        print("这条消息可能正在改变支付格局")
        return

    # 获取辅助上下文 (原帖信息)
    context_text = ""
    if args.context and os.path.exists(args.context):
        try:
            with open(args.context, "r", encoding="utf-8") as f:
                context_data = json.load(f)
                if isinstance(context_data, dict):
                    context_text = f"原标题: {context_data.get('title', '')}\n原正文: {context_data.get('body', '')}"
                elif isinstance(context_data, str):
                    context_text = context_data
        except:
            pass

    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    
    # 构造增强 Prompt
    prompt_body = TITLE_PROMPT.format(transcript=transcript)
    if context_text:
        prompt_body += f"\n\n背景参考信息（原帖内容）：\n{context_text}\n\n请在生成标题时，重点参考上述背景信息，确保标题不仅涵盖口播核心，还与原帖主题紧密关联。"

    response = generate_content(
        client,
        model=get_text_model(provider),
        contents=prompt_body,
        provider=provider,
    )
    title = normalize_title(response.text)
    emit_result("标题生成完成", title=title or "这条消息可能正在改变支付格局")
    print(title or "这条消息可能正在改变支付格局")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="TITLE_GENERATION_FAILED",
        error_message="自动标题生成失败",
        error_stage="titling",
        hint="请检查 Gemini Key、字幕文件和标题生成脚本输出",
    ))
