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


def compact_text(value, limit=220):
    text = " ".join(str(value or "").split()).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def split_summary_clauses(text):
    normalized = compact_text(text, 200)
    if not normalized:
        return []
    parts = [part.strip() for part in re.split(r"[。！？；;?!]\s*", normalized) if part.strip()]
    return parts


def should_attach_post_context(material_text, clause):
    if not clause:
        return False
    material = normalize_compare_text(material_text)
    candidate = normalize_compare_text(clause)
    if not candidate:
        return False
    return candidate not in material


def normalize_compare_text(text):
    return re.sub(r"\s+", "", str(text or "").strip())


def extract_source_duration(audio_data, subtitles, result_data):
    duration = 0.0

    for item in audio_data or []:
        duration = max(duration, float(item.get("end") or 0))

    for item in subtitles or []:
        time_range = item.get("time") or []
        if isinstance(time_range, list) and len(time_range) >= 2:
            duration = max(duration, float(time_range[1] or 0))

    if isinstance(result_data, dict):
        for key in ("duration", "video_duration", "total_duration"):
            try:
                duration = max(duration, float(result_data.get(key) or 0))
            except Exception:
                pass

    return round(duration, 2)


def compute_effective_target_duration(requested_duration_sec, source_duration_sec):
    requested = max(20, min(180, int(requested_duration_sec or 45)))
    if source_duration_sec <= 0:
        return requested

    # 目标时长优先，素材时长只作为软上限保护。
    # 对 20 秒以上的素材，允许策划保持在 40-45 秒附近；
    # 只有特别短的素材，才适度收紧，避免口播明显过长。
    if source_duration_sec < 12:
        upper_bound = max(24, min(36, int(round(source_duration_sec * 2.2))))
    elif source_duration_sec < 20:
        upper_bound = max(32, min(45, int(round(source_duration_sec * 2.0))))
    else:
        upper_bound = max(45, min(180, int(round(source_duration_sec * 1.5))))

    return max(20, min(requested, upper_bound))


def rebalance_segment_durations(segments, target_duration_sec):
    if not segments:
        return segments

    positive_segments = [seg for seg in segments if isinstance(seg, dict)]
    if not positive_segments:
        return segments

    total_estimated = sum(max(1, int(seg.get("estimated_sec") or 1)) for seg in positive_segments)
    if total_estimated <= 0:
        return segments

    scaled = []
    for seg in positive_segments:
        current = max(1, int(seg.get("estimated_sec") or 1))
        next_value = max(4, round(current * target_duration_sec / total_estimated))
        scaled.append(next_value)

    diff = target_duration_sec - sum(scaled)
    index = 0
    while diff != 0 and scaled:
        step = 1 if diff > 0 else -1
        candidate = scaled[index % len(scaled)] + step
        if candidate >= 4:
            scaled[index % len(scaled)] = candidate
            diff -= step
        index += 1
        if index > 500:
            break

    for seg, next_value in zip(positive_segments, scaled):
        seg["estimated_sec"] = int(next_value)

    return segments


def collect_material_lines(subtitles, audio_data):
    lines = []

    for item in subtitles or []:
        text = compact_text(item.get("zh") or item.get("text") or "", 80)
        time_range = item.get("time") or []
        if not text or not isinstance(time_range, list) or len(time_range) < 2:
            continue
        lines.append({
            "start": float(time_range[0] or 0),
            "end": float(time_range[1] or 0),
            "text": text,
        })

    if lines:
        return lines

    for item in audio_data or []:
        text = compact_text(item.get("text") or item.get("zh") or "", 80)
        if not text:
            continue
        lines.append({
            "start": float(item.get("start") or 0),
            "end": float(item.get("end") or 0),
            "text": text,
        })

    return lines


def choose_segment_count(target_duration_sec, lines):
    if len(lines) <= 3:
        return len(lines) or 3
    if target_duration_sec <= 32:
        return 3
    return 4


def slice_lines_by_timeline(lines, segment_count, source_duration_sec):
    if not lines:
        return []

    if segment_count <= 1:
        return [lines]

    groups = [[] for _ in range(segment_count)]
    duration = max(source_duration_sec, lines[-1]["end"], 1)
    window = duration / segment_count

    for line in lines:
        index = min(segment_count - 1, int(line["start"] // window))
        groups[index].append(line)

    compact_groups = [group for group in groups if group]
    return compact_groups or [lines]


def summarize_group(lines, limit=90):
    merged = " ".join(line["text"] for line in lines if line.get("text")).strip()
    return compact_text(merged, limit)


def build_material_driven_outline(title, summary, subtitles, audio_data, target_duration_sec, source_duration_sec):
    lines = collect_material_lines(subtitles, audio_data)
    if not lines:
        return build_fallback_outline(title, summary, subtitles, target_duration_sec)

    segment_count = choose_segment_count(target_duration_sec, lines)
    groups = slice_lines_by_timeline(lines, segment_count, source_duration_sec)
    role_ids = ["hook", "fact", "impact", "close"]
    goal_map = {
        "hook": "抛出素材里的核心问题或结论",
        "fact": "按素材顺序交代事实信息",
        "impact": "延续素材中的关键表态或冲突点",
        "close": "用素材现有信息自然收束",
    }
    post_clauses = split_summary_clauses(summary)

    segments = []
    for index, group in enumerate(groups):
        role = role_ids[min(index, len(role_ids) - 1)]
        summary_text = summarize_group(group, 88 if role != "hook" else 68)
        if role == "hook" and summary_text and not summary_text.endswith(("？", "?", "！", "!")):
            summary_text = compact_text(summary_text, 64)
        segment_duration = max(4, round(sum(max(0.5, line["end"] - line["start"]) for line in group)))
        supporting_context = ""
        if post_clauses:
            candidate = post_clauses[min(index, len(post_clauses) - 1)]
            if should_attach_post_context(summary_text, candidate):
                supporting_context = compact_text(candidate, 52)
        segments.append({
            "id": role if index < len(role_ids) else f"segment_{index + 1}",
            "goal": goal_map.get(role, "按素材顺序提炼信息"),
            "summary": summary_text,
            "estimated_sec": segment_duration,
            "source_start": round(group[0]["start"], 2),
            "source_end": round(group[-1]["end"], 2),
            "supporting_context": supporting_context,
            "info_source": "material_plus_post" if supporting_context else "material",
        })

    merged_lines = " ".join(line["text"] for line in lines)
    derived_angle = summary or compact_text(merged_lines, 90) or "围绕素材现有信息做顺序解读"
    outline = {
        "topic": title or compact_text(lines[0]["text"], 36) or "素材内容解读",
        "angle": compact_text(derived_angle, 90),
        "source_context_summary": compact_text(summary, 120),
        "target_duration_sec": target_duration_sec,
        "segments": segments,
    }
    return outline


def build_fallback_outline(title, summary, subtitles, target_duration_sec):
    merged = " ".join(
        str(item.get("zh") or item.get("text") or "").strip()
        for item in (subtitles or [])
        if str(item.get("zh") or item.get("text") or "").strip()
    )
    merged = compact_text(merged, 260)
    angle = summary or merged or "围绕素材关键信息做简洁解读"
    return {
        "topic": title or "热点视频解读",
        "angle": compact_text(angle, 90),
        "target_duration_sec": target_duration_sec,
        "segments": [
            {
                "id": "hook",
                "goal": "抛出问题和看点",
                "summary": compact_text(title or angle or "开场抛出核心问题", 60),
                "estimated_sec": max(8, round(target_duration_sec * 0.2))
            },
            {
                "id": "fact",
                "goal": "交代事实和背景",
                "summary": compact_text(merged or summary or "说明素材中的核心事实", 90),
                "estimated_sec": max(14, round(target_duration_sec * 0.45))
            },
            {
                "id": "impact",
                "goal": "解释影响和判断",
                "summary": compact_text(summary or "解释这件事为什么值得关注", 80),
                "estimated_sec": max(12, round(target_duration_sec * 0.35))
            }
        ]
    }


def main():
    parser = argparse.ArgumentParser(description="Build content outline from analyzed material.")
    parser.add_argument("--audio", default="audio.json")
    parser.add_argument("--result", default="result.json")
    parser.add_argument("--subtitles", default="subtitles.json")
    parser.add_argument("--title", default="")
    parser.add_argument("--summary", default="")
    parser.add_argument("--target-duration", type=int, default=45)
    parser.add_argument("--output", default="content_outline.json")
    args = parser.parse_args()

    emit_stage("outline", "正在根据素材分析结果生成内容大纲")

    audio_data = load_json(args.audio, [])
    result_data = load_json(args.result, {})
    subtitles = load_json(args.subtitles, [])
    title = str(args.title or "").strip()
    summary = compact_text(args.summary, 180)
    requested_duration_sec = max(20, min(180, int(args.target_duration or 45)))
    source_duration_sec = extract_source_duration(audio_data, subtitles, result_data)
    effective_target_duration_sec = compute_effective_target_duration(requested_duration_sec, source_duration_sec)

    outline = build_material_driven_outline(
        title,
        summary,
        subtitles,
        audio_data,
        effective_target_duration_sec,
        source_duration_sec,
    )

    outline["target_duration_sec"] = effective_target_duration_sec
    outline["source_duration_sec"] = source_duration_sec
    outline["segments"] = rebalance_segment_durations(outline.get("segments", []), effective_target_duration_sec)

    Path(args.output).write_text(json.dumps(outline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(outline, ensure_ascii=False, indent=2))
    emit_result(
        "内容大纲生成完成",
        outline_json=args.output,
        segment_count=len(outline.get("segments", []) or []),
        topic=outline.get("topic", ""),
    )


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="OUTLINE_BUILD_FAILED",
        error_message="内容大纲生成失败",
        error_stage="outline",
        hint="请检查 audio.json、result.json、subtitles.json 和模型配置",
    ))
