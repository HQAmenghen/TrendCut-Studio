import sys
import io
import json
import os
import argparse
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.5-plus"


def get_text_model():
    provider = get_llm_provider()
    if provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def load_json(path_str, default):
    path = Path(path_str)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def estimate_max_chars(duration_sec):
    # 中文短视频解说按每秒约 4.2 到 4.8 个字更稳，这里取保守值。
    return max(60, int(float(duration_sec or 0) * 4.5))


def estimate_min_chars(duration_sec):
    # 低于这个字数基本会明显短于目标时长
    return max(40, int(float(duration_sec or 0) * 3.8))


def compact_sentence(text, limit):
    cleaned = " ".join(str(text or "").split()).strip().strip("，。；")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: max(0, limit - 1)].rstrip("，。；,.;") + "。"


def trim_broken_tail(text):
    cleaned = " ".join(str(text or "").split()).strip()
    if not cleaned:
        return ""
    broken_suffixes = [
        "我们会在秋", "在过去几个月里取", "在过去几个月里去", "这是第一次 我们制定了",
        "能够融入其中", "重要的是我们要", "我们要完成这项工作，特别是关于"
    ]
    for suffix in broken_suffixes:
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)].rstrip("，。；, ")
            break
    if cleaned and cleaned[-1] not in "。！？":
        cleaned += "。"
    return cleaned


def sanitize_narration_text(text):
    cleaned = " ".join(str(text or "").split()).strip()
    cleaned = re.sub(r"^(?:(?:口播|原声|素材原声)\s*[：:]\s*)+", "", cleaned)
    cleaned = re.sub(r"^(?:(?:数字人简述|数字人补充|播放素材原声|继续播放素材原声|保留素材原声|保留素材原话|保留原话)\s*[，：:]?\s*)+", "", cleaned)
    replacements = ["保留记者提问，", "保留记者关于"]
    for item in replacements:
        cleaned = cleaned.replace(item, "")
    cleaned = cleaned.replace("这背后到底意味着什么？", "这到底意味着什么？")
    cleaned = cleaned.strip("，。； ")
    return trim_broken_tail(cleaned)


def looks_unstable_narration(text):
    candidate = str(text or "").strip()
    if not candidate:
        return True
    signals = [
        "我认为", "我确实认为", "当然，", "没错。", "事实上，", "我们会在", "而这正是",
        "能够融入", "重要的是我们要", "在我们解决许多这些问题的过程中"
    ]
    if any(token in candidate for token in signals):
        return True
    if candidate.count("……") >= 1 or candidate.count("...") >= 1:
        return True
    return False


def build_fallback_narration(outline):
    sections = []
    target_duration_sec = outline.get("target_duration_sec", 45)
    total_char_budget = estimate_max_chars(target_duration_sec)
    segment_count = max(1, len(outline.get("segments", []) or []))
    segment_char_budget = max(18, total_char_budget // segment_count)
    for index, segment in enumerate(outline.get("segments", []) or []):
        text = compact_sentence(segment.get("summary") or segment.get("goal") or "", segment_char_budget)
        supporting_context = compact_sentence(segment.get("supporting_context") or "", max(12, segment_char_budget // 2))
        if supporting_context:
            text = compact_sentence(f"{text} {supporting_context}", segment_char_budget)
        text = sanitize_narration_text(text)
        if not text:
            continue
        if index == 0 and not text.endswith("？"):
            text = text.rstrip("。") + "，这背后到底意味着什么？"
        sections.append({
            "segment_id": str(segment.get("id") or f"segment_{index+1}"),
            "text": text
        })
    full_text = "\n".join(item["text"] for item in sections).strip()
    return {
        "target_duration_sec": outline.get("target_duration_sec", 45),
        "speaking_style": "短视频财经解说",
        "tone": "直接、紧凑、信息密度高",
        "script_sections": sections,
        "full_text": full_text
    }


def build_expanded_fallback_narration(outline):
    """
    当模型输出明显偏短时，用更完整的素材主线 + 原帖补充重建一版更接近目标时长的口播。
    """
    sections = []
    target_duration_sec = outline.get("target_duration_sec", 45)
    total_char_budget = estimate_max_chars(target_duration_sec)
    segment_count = max(1, len(outline.get("segments", []) or []))
    segment_char_budget = max(22, total_char_budget // segment_count)

    for index, segment in enumerate(outline.get("segments", []) or []):
        summary = sanitize_narration_text(segment.get("summary") or "")
        goal = sanitize_narration_text(segment.get("goal") or "")
        support = sanitize_narration_text(segment.get("supporting_context") or "")
        pieces = []
        if summary:
            pieces.append(summary)
        if support and support not in summary:
            pieces.append(support)
        elif goal and goal not in summary:
            pieces.append(goal)
        text = compact_sentence(" ".join(pieces).strip(), segment_char_budget)
        text = sanitize_narration_text(text)
        if not text:
            continue
        if index == 0 and not text.endswith("？"):
            text = text.rstrip("。") + "，这到底意味着什么？"
        sections.append({
            "segment_id": str(segment.get("id") or f"segment_{index + 1}"),
            "text": text
        })

    full_text = "\n".join(item["text"] for item in sections).strip()
    return {
        "target_duration_sec": target_duration_sec,
        "speaking_style": "短视频财经解说",
        "tone": "直接、紧凑、信息密度高",
        "script_sections": sections,
        "full_text": full_text
    }


def main():
    parser = argparse.ArgumentParser(description="Generate narration from content outline.")
    parser.add_argument("--outline", default="content_outline.json")
    parser.add_argument("--output", default="narration_plan.json")
    parser.add_argument("--text-output", default="narration.txt")
    args = parser.parse_args()

    emit_stage("narration", "正在根据内容大纲生成口播文案")
    outline = load_json(args.outline, {})
    if not outline:
        raise RuntimeError("找不到有效的大纲文件")

    client = create_llm_client()
    target_duration_sec = int(outline.get("target_duration_sec", 45) or 45)
    source_duration_sec = float(outline.get("source_duration_sec", 0) or 0)
    max_chars = estimate_max_chars(target_duration_sec)
    min_chars = estimate_min_chars(target_duration_sec)
    prompt = f"""
你是一名“素材优先”的短视频口播编辑。你的任务不是重新评论整件事，而是把现有素材里的信息整理成少量、克制、可直接配合素材的视频口播。

【总目标】
- 让素材视频承担主体表达，数字人口播只做提炼、串联、补一句必要背景、最后收一下。
- 整体方向：素材 70%，数字人 30%。
- 口播要像“压缩后的说明句”，不是长评论、不是主持人口播、不是新闻社论。

【硬性要求】
1. 输出必须是可以直接拿去配音的自然中文。
2. 不要出现“数字人”“原片”“原视频”“先看视频”“深度拆解”“更多内容请看视频”等字眼。
3. 不要写镜头说明、流程说明、制作指令。
4. 每个 section 的 text 要贴合对应大纲 summary，并优先顺着素材已经出现的信息来写。
5. 语言要紧凑、直接、信息密度高，适合热点/财经/新闻快评。
6. 严格输出 JSON，不要 markdown。

【时长与字数】
1. 目标口播时长约为 {target_duration_sec} 秒，素材原始时长约为 {source_duration_sec or '未知'} 秒。
2. 整体口播总字数尽量控制在 {max_chars} 字以内。
3. 每个 section 只说最必要的信息，不要扩写成长句群。

【内容边界】
1. 口播内容只能基于当前素材视频已经出现的信息进行提炼。
2. 不要补充素材视频之外的新事实、新背景、新图表说明，也不要假设会使用额外素材。
3. 如果某个 segment 带有 supporting_context，说明这部分信息来自原帖文字补充；你最多补一小句，而且只能辅助素材主线，不能盖过素材本身。
4. 每个 segment 应优先复述素材里已经出现的事实、问题、表态、数字、原话，再决定是否补一小句原帖信息。
5. 绝对不要把原帖补充扩写成新的主线。
6. 不要牵强附会，不要做素材里没有明确出现的推断和升华。

【表达风格】
1. 口播要尽量“轻解释、重复述、少判断”。
2. 如果素材里已经有强信息量原话，口播要尽量短，给后续导演保留素材原生原话和原生节奏的空间。
3. 开头可以抛题，但不要标题党；结尾可以收束，但不要拔高。
4. 少用夸张修辞，比如“震动”“炸锅”“彻底失控”“全面升级”等。

【绝对禁止】
1. 不要写“数字人简述”“数字人补充”“播放素材原声”“继续播放素材原声”“保留原话”“保留提问”等制作指令。
2. 不要在 text 前面加“口播：”“原声：”“素材原声：”之类标签。
3. 不要把素材里已经表达清楚的话再完整重复一遍。

【自检标准】
在输出前，请默默检查每个 section：
- 这句话是不是观众真正会听到的口播，而不是说明文字？
- 这句话是不是主要来自素材，而不是我自己脑补？
- 这句话是不是足够短，能给素材原声留空间？

输入大纲：
{json.dumps(outline, ensure_ascii=False)}
"""

    narration = None
    try:
        response = generate_content(
            client,
            model=get_text_model(),
            contents=prompt,
            response_mime_type="application/json",
        )
        narration = json.loads(response.text)
    except Exception:
        narration = None

    if not isinstance(narration, dict) or not isinstance(narration.get("script_sections"), list) or not narration.get("script_sections"):
        narration = build_fallback_narration(outline)

    full_text = str(narration.get("full_text") or "").strip()
    if not full_text:
        full_text = "\n".join(
            str(item.get("text") or "").strip()
            for item in narration.get("script_sections", [])
            if str(item.get("text") or "").strip()
        ).strip()
        narration["full_text"] = full_text

    if len(full_text) > max_chars + 20:
        narration = build_fallback_narration(outline)
        full_text = str(narration.get("full_text") or "").strip()

    for item in narration.get("script_sections", []) or []:
        item["text"] = sanitize_narration_text(item.get("text", ""))

    if any(looks_unstable_narration(item.get("text", "")) for item in narration.get("script_sections", []) or []):
        narration = build_expanded_fallback_narration(outline)

    narration["full_text"] = "\n".join(
        item["text"] for item in narration.get("script_sections", []) if str(item.get("text") or "").strip()
    ).strip()
    full_text = narration["full_text"]

    if len(full_text) < min_chars:
        narration = build_expanded_fallback_narration(outline)
        narration["full_text"] = "\n".join(
            item["text"] for item in narration.get("script_sections", []) if str(item.get("text") or "").strip()
        ).strip()
        full_text = narration["full_text"]

    Path(args.output).write_text(json.dumps(narration, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(args.text_output).write_text(full_text, encoding="utf-8")
    print(json.dumps(narration, ensure_ascii=False, indent=2))
    emit_result(
        "口播文案生成完成",
        narration_json=args.output,
        narration_text=args.text_output,
        segment_count=len(narration.get("script_sections", []) or []),
    )


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="NARRATION_GENERATE_FAILED",
        error_message="口播文案生成失败",
        error_stage="narration",
        hint="请检查内容大纲文件和模型配置",
    ))
