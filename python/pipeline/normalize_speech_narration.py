#!/usr/bin/env python3
"""Generate TTS-safe narration text with DeepSeek."""
import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)


def get_deepseek_speech_model() -> str:
    return (
        os.getenv("DEEPSEEK_SPEECH_MODEL")
        or os.getenv("DEEPSEEK_TEXT_MODEL")
        or "deepseek-v4-flash"
    ).strip()


def extract_json(text: str) -> dict:
    raw = str(text or "").strip()
    if not raw:
        raise ValueError("DeepSeek returned an empty response")
    try:
        return json.loads(raw)
    except Exception:
        pass

    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if match:
        return json.loads(match.group(1))

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        return json.loads(match.group(0))

    raise ValueError("DeepSeek response did not contain a JSON object")


def normalize_changes(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    changes = []
    for item in value:
        if not isinstance(item, dict):
            continue
        raw = str(item.get("raw") or "").strip()
        reading = str(item.get("reading") or "").strip()
        if not raw or not reading or raw == reading:
            continue
        changes.append({
            "raw": raw,
            "reading": reading,
            "reason": str(item.get("reason") or "").strip(),
        })
    return changes


def validate_speech_text(source_text: str, speech_text: str) -> str:
    cleaned = str(speech_text or "").strip()
    if not cleaned:
        raise ValueError("DeepSeek did not return speechText")
    source_len = max(1, len(str(source_text or "").strip()))
    ratio = len(cleaned) / source_len
    if ratio < 0.55 or ratio > 1.65:
        raise ValueError(f"DeepSeek speechText length ratio looks unsafe: {ratio:.2f}")
    return cleaned


def build_prompt(source_text: str, fallback_text: str) -> str:
    return f"""
你是中文数字人口播稿的“读法转换器”，不是改稿助手。

任务：
把【原始口播稿】转换成只给 TTS / 数字人朗读使用的【口播专用稿】。

严格规则：
1. 只改容易被数字人误读的数字、金额、百分比、日期、范围、带单位数量和编号读法。
2. 不改观点、不润色、不扩写、不删句子、不新增信息。
3. 保留原有句子顺序、语气、英文人名、品牌名、币种名和专业术语。
4. 字幕仍使用原始稿，所以口播专用稿可以把数字写成中文读法。
5. 对金额和市场口语缩写要按中文自然读法处理。

重点示例：
- 60,000美元 / 60.000美元 -> 六万美元
- 12万5 -> 十二万五千
- 6万底部 / 6万附近 -> 六万底部 / 六万附近
- 150万枚比特币 -> 一百五十万枚比特币
- 3.5万亿美元 -> 三点五万亿美元
- 7% -> 百分之七
- 3%到7% -> 百分之三到百分之七
- 2026年5月22日 -> 二零二六年五月二十二日
- 法案、型号、账号、订单号等编号不要当普通金额读；例如 HR 3000,633 -> H R 三零零零，六三三

返回 JSON，不能有 Markdown：
{{
  "speechText": "转换后的完整口播专用稿",
  "changes": [
    {{"raw": "原片段", "reading": "读法片段", "reason": "为什么要改"}}
  ]
}}

【规则兜底稿，可参考但不要被它限制】
{fallback_text}

【原始口播稿】
{source_text}
""".strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize narration text for TTS speech.")
    parser.add_argument("--source-text", required=True)
    parser.add_argument("--fallback-text", default="")
    args = parser.parse_args()

    source_text = str(args.source_text or "").strip()
    fallback_text = str(args.fallback_text or "").strip()
    if not source_text:
        raise ValueError("source text is empty")

    provider = "deepseek"
    model = get_deepseek_speech_model()
    emit_stage("speech_narration", f"正在使用 DeepSeek 生成口播专用稿: {model}")

    client = create_llm_client(provider=provider)
    response = generate_content(
        client,
        model=model,
        contents=build_prompt(source_text, fallback_text),
        response_mime_type="application/json",
        provider=provider,
        request_timeout=int(os.getenv("SPEECH_NARRATION_LLM_TIMEOUT_SECONDS", "90")),
        retries=int(os.getenv("SPEECH_NARRATION_LLM_RETRIES", "3")),
    )
    payload = extract_json(response.text)
    speech_text = validate_speech_text(source_text, str(payload.get("speechText") or ""))
    changes = normalize_changes(payload.get("changes"))

    emit_result(
        "口播专用稿生成完成",
        provider=provider,
        model=model,
        speechText=speech_text,
        changes=changes,
    )
    print(speech_text)


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SPEECH_NARRATION_NORMALIZE_FAILED",
        error_message="口播专用稿生成失败",
        error_stage="speech_narration.normalize",
        hint="请检查 DEEPSEEK_API_KEY、DEEPSEEK_TEXT_MODEL/DEEPSEEK_SPEECH_MODEL 和网络连接",
    ))
