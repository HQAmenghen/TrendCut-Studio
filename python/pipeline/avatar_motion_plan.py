"""Build deterministic avatar gesture plans from narration text and speech audio."""

import argparse
from collections import Counter
import hashlib
import json
import math
import os
import re
import sys
import wave
from pathlib import Path


PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from load_env import load_project_env  # noqa: E402
from script_protocol import emit_result, emit_stage, run_guarded  # noqa: E402


DEFAULT_FPS = 25
DEFAULT_CHARS_PER_SECOND = 4.5
MIN_GESTURE_INTERVAL_SECONDS = 3.0
TARGET_GESTURE_INTERVAL_SECONDS = 6.0
MIN_GESTURE_SEGMENT_SECONDS = 0.8
MIN_VISIBLE_GESTURE_SECONDS = 0.8
SENTENCE_PATTERN = re.compile(r"[^。！？!?…\n]+[。！？!?…]?", re.UNICODE)
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]", re.UNICODE)
ANCHOR_TRIGGER_KEYWORDS = [
    "关键", "重点", "核心", "注意", "必须", "信号", "结论", "风险", "不要", "别",
    "不过", "但是", "然而", "为什么", "原因", "前两次", "这次", "第三次", "涨", "跌",
    "百分之", "唯一依据", "下单", "谨慎",
]


ACTION_SEMANTIC_PROFILES = {
    "right_hand_emphasis": {
        "label": "单手强调",
        "description": "关键点 数字 百分比 倍数 第一次 第二次 第三次 转折 对比 但是 不过 然而 风险 问题 结论 注意 信号 重要 观点",
        "keywords": ["关键", "重点", "核心", "必须", "信号", "第三次", "百分之", "涨", "不过", "但是", "风险", "问题", "结论", "注意"],
        "intensity": 0.68,
    },
    "right_hand_open": {
        "label": "单手展开说明",
        "description": "解释 概念 定义 所谓 结合 指标 计算 算出来 也就是 背景 补充 说明 参考 观察 展开",
        "keywords": ["所谓", "结合", "指标", "算出来", "也就是", "解释", "说明", "参考", "观察", "背景"],
        "intensity": 0.52,
    },
    "both_hand_open": {
        "label": "双手展开对比",
        "description": "原因 为什么 前两次 这次 一方面 另一方面 历史 周期 宏观 结构 对比 不一样 相似 剧本",
        "keywords": ["为什么", "原因", "前两次", "这次", "一方面", "另一方面", "历史", "周期", "宏观", "结构", "不一样", "相似"],
        "intensity": 0.58,
    },
    "both_hand_emphasis": {
        "label": "双手强强调",
        "description": "强提醒 强结论 不要 别 唯一依据 下单 重要提醒 必须 谨慎 大幅上涨 加速冲高 抛物线",
        "keywords": ["不要", "别", "唯一依据", "下单", "谨慎", "大幅上涨", "加速", "冲高", "抛物线", "必须"],
        "intensity": 0.78,
    },
}

ACTION_FALLBACK_ORDER = [
    "right_hand_emphasis",
    "right_hand_open",
    "both_hand_open",
    "both_hand_emphasis",
]
SUPPORTED_PLANNER_MODES = {"auto", "local", "llm"}
SUPPORTED_LLM_PROVIDERS = {"deepseek", "qwen", "gemini", "vertex"}


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def write_json_file(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def extract_json_object(text: str) -> dict:
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return json.loads(raw[start:end + 1])
    raise ValueError("LLM response did not contain a JSON object")


def hash_payload(payload: dict) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha1(encoded).hexdigest()


def read_wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as wav_file:
        frame_count = wav_file.getnframes()
        frame_rate = wav_file.getframerate()
        if frame_rate <= 0:
            return 0.0
        return frame_count / float(frame_rate)


def estimate_duration(text: str) -> float:
    weighted_chars = max(1, len(re.sub(r"\s+", "", text)))
    return max(1.0, weighted_chars / DEFAULT_CHARS_PER_SECOND)


def resolve_audio_duration(audio_path: Path, text: str, explicit_duration: float = 0.0) -> float:
    if explicit_duration > 0:
        return explicit_duration
    if audio_path.exists() and audio_path.suffix.lower() == ".wav":
        try:
            duration = read_wav_duration(audio_path)
            if duration > 0:
                return duration
        except (OSError, wave.Error):
            pass
    return estimate_duration(text)


def split_sentences(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if not normalized:
        return []
    sentences = [match.group(0).strip() for match in SENTENCE_PATTERN.finditer(normalized)]
    return [sentence for sentence in sentences if sentence] or [normalized]


def tokenize(text: str) -> list[str]:
    normalized = str(text or "").lower()
    tokens = TOKEN_PATTERN.findall(normalized)
    expanded = []
    cjk_chars = []
    for token in tokens:
        expanded.append(token)
        if re.match(r"[\u4e00-\u9fff]", token):
            cjk_chars.append(token)
    for size in (2, 3, 4):
        if len(cjk_chars) >= size:
            expanded.extend("".join(cjk_chars[idx:idx + size]) for idx in range(len(cjk_chars) - size + 1))
    return expanded


def sparse_cosine(left_text: str, right_text: str) -> float:
    left = Counter(tokenize(left_text))
    right = Counter(tokenize(right_text))
    if not left or not right:
        return 0.0
    dot = sum(weight * right.get(token, 0) for token, weight in left.items())
    left_norm = math.sqrt(sum(weight * weight for weight in left.values()))
    right_norm = math.sqrt(sum(weight * weight for weight in right.values()))
    if left_norm <= 0 or right_norm <= 0:
        return 0.0
    return dot / (left_norm * right_norm)


def keyword_score(text: str, keywords: list[str]) -> float:
    if not keywords:
        return 0.0
    hits = sum(1 for keyword in keywords if keyword and keyword in text)
    return min(1.0, hits / 2.0)


def load_action_profiles(action_dir: Path | None = None) -> dict:
    profiles = {}
    if action_dir and action_dir.exists():
        for child in sorted(action_dir.iterdir()):
            if not child.is_dir():
                continue
            meta_path = child / "action.json"
            if not meta_path.exists():
                continue
            try:
                meta = read_json_file(meta_path)
            except (OSError, json.JSONDecodeError):
                continue
            action_id = str(meta.get("id") or child.name).strip()
            if not action_id:
                continue
            base = ACTION_SEMANTIC_PROFILES.get(action_id, {})
            tags = [str(item or "").strip() for item in meta.get("tags") or [] if str(item or "").strip()]
            profile_text = " ".join([
                action_id.replace("_", " "),
                str(base.get("label") or ""),
                str(base.get("description") or ""),
                " ".join(tags),
            ]).strip()
            profiles[action_id] = {
                "id": action_id,
                "label": base.get("label") or action_id,
                "text": profile_text,
                "keywords": list(base.get("keywords") or []),
                "intensity": float(base.get("intensity") or 0.5),
                "tags": tags,
                "sourceDuration": float(meta.get("sourceDuration") or meta.get("duration") or 1.0),
                "activeStart": float(meta.get("activeStart") or 0.0),
                "activeEnd": float(meta.get("activeEnd") or meta.get("duration") or meta.get("sourceDuration") or 1.0),
                "neutralHoldStart": float(meta.get("neutralHoldStart") or meta.get("activeEnd") or 0.0),
                "cooldown": float(meta.get("cooldown") or TARGET_GESTURE_INTERVAL_SECONDS),
            }

    if not profiles:
        for action_id in ACTION_FALLBACK_ORDER:
            base = ACTION_SEMANTIC_PROFILES[action_id]
            profiles[action_id] = {
                "id": action_id,
                "label": base["label"],
                "text": f"{action_id.replace('_', ' ')} {base['label']} {base['description']}",
                "keywords": list(base["keywords"]),
                "intensity": float(base["intensity"]),
                "tags": [],
                "sourceDuration": 1.6,
                "activeStart": 0.4,
                "activeEnd": 1.2,
                "neutralHoldStart": 1.2,
                "cooldown": TARGET_GESTURE_INTERVAL_SECONDS,
            }
    return profiles


def score_action(text: str, profile: dict) -> float:
    semantic = sparse_cosine(text, profile.get("text", ""))
    keyword = keyword_score(text, profile.get("keywords") or [])
    number_bonus = 0.12 if re.search(r"(第[一二三四五六七八九十]+次|二零|百分之|\d+|涨|跌)", text) and "emphasis" in profile["id"] else 0.0
    return round((semantic * 0.55) + (keyword * 0.35) + number_bonus, 4)


def choose_action(text: str, profiles: dict, recent_actions: list[str]) -> tuple[str, str, float, dict]:
    candidates = []
    for action_id, profile in profiles.items():
        score = score_action(text, profile)
        if recent_actions and action_id == recent_actions[-1]:
            score -= 0.12
        if action_id in recent_actions[-2:]:
            score -= 0.08
        candidates.append({
            "action": action_id,
            "score": round(score, 4),
            "label": profile.get("label") or action_id,
            "intensity": profile.get("intensity", 0.5),
        })
    candidates.sort(key=lambda item: item["score"], reverse=True)
    best = candidates[0] if candidates else {"action": "idle_talking", "score": 0.0, "intensity": 0.3}
    if best["score"] < 0.12:
        return "idle_talking", "low_semantic_score", 0.3, {"candidates": candidates[:4]}
    return best["action"], "semantic_match", float(best["intensity"]), {"candidates": candidates[:4]}


def normalize_script_units(script_units: list | None) -> list[dict]:
    units = []
    for index, item in enumerate(script_units or [], start=1):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        units.append({
            "id": str(item.get("id") or f"script_{index:03d}"),
            "role": item.get("role"),
            "text": text,
        })
    return units


def load_script_units(path: Path | None) -> list[dict]:
    if not path or not path.exists():
        return []
    payload = read_json_file(path)
    if isinstance(payload, dict):
        return normalize_script_units(payload.get("script_units") or [])
    if isinstance(payload, list):
        return normalize_script_units(payload)
    return []


def load_speech_alignment(path: Path | None) -> dict:
    if not path or not path.exists():
        return {}
    payload = read_json_file(path)
    return payload if isinstance(payload, dict) else {}


def normalize_alignment_words(speech_alignment: dict | None = None) -> list[dict]:
    words = []
    if not isinstance(speech_alignment, dict):
        return words
    for index, item in enumerate(speech_alignment.get("words") or []):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("word") or "").strip()
        try:
            start = float(item.get("start"))
            end = float(item.get("end"))
        except (TypeError, ValueError):
            continue
        if not text or end <= start:
            continue
        words.append({
            "index": int(item.get("index") if item.get("index") is not None else index),
            "start": start,
            "end": end,
            "text": text,
        })
    return words


def normalize_alignment_segments(speech_alignment: dict | None = None) -> list[dict]:
    segments = []
    if not isinstance(speech_alignment, dict):
        return segments
    for index, item in enumerate(speech_alignment.get("segments") or []):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        try:
            start = float(item.get("start"))
            end = float(item.get("end"))
        except (TypeError, ValueError):
            continue
        if not text or end <= start:
            continue
        segments.append({
            "id": str(item.get("id") or f"speech_{index + 1:03d}"),
            "role": "speech_alignment",
            "text": text,
            "start": start,
            "end": end,
        })
    return segments


def is_numberish_text(text: str) -> bool:
    return bool(re.search(r"(第[一二三四五六七八九十]+次|二零|百分之|\d+|涨|跌)", str(text or "")))


def find_alignment_anchor_time(text: str, start: float, end: float, alignment_words: list[dict]) -> dict | None:
    if not alignment_words:
        return None
    sample = str(text or "").strip()
    if not sample:
        return None

    candidates = []
    for word in alignment_words:
        center = (float(word["start"]) + float(word["end"])) / 2.0
        if center < start - 0.08 or center > end + 0.08:
            continue
        token = str(word.get("text") or "").strip()
        compact_token = re.sub(r"\s+", "", token)
        score = 0.0
        if compact_token and compact_token in sample:
            score += 1.0
        if any(keyword in sample and keyword in compact_token for keyword in ANCHOR_TRIGGER_KEYWORDS):
            score += 2.0
        if any(keyword in compact_token for keyword in ANCHOR_TRIGGER_KEYWORDS):
            score += 1.0
        if is_numberish_text(compact_token):
            score += 0.8
        if score <= 0:
            continue
        candidates.append({
            "triggerTime": round(center, 3),
            "word": token,
            "score": round(score, 3),
            "wordStart": round(float(word["start"]), 3),
            "wordEnd": round(float(word["end"]), 3),
        })
    if not candidates:
        return None
    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates[0]


def collect_alignment_words_for_segment(start: float, end: float, alignment_words: list[dict], limit: int = 24) -> list[dict]:
    words = []
    for word in alignment_words:
        center = (float(word["start"]) + float(word["end"])) / 2.0
        if center < start - 0.08 or center > end + 0.08:
            continue
        words.append({
            "index": int(word["index"]),
            "start": round(float(word["start"]), 3),
            "end": round(float(word["end"]), 3),
            "text": str(word.get("text") or ""),
        })
    return words[:limit]


def extract_cutaway_windows(edit_plan: dict | None = None, clip_matches: dict | None = None) -> dict:
    windows = {}
    if isinstance(clip_matches, dict):
        for item in clip_matches.get("clip_matches") or []:
            if not isinstance(item, dict) or not item.get("use_cutaway"):
                continue
            script_ref = str(item.get("script_ref") or "").strip()
            if not script_ref:
                continue
            duration = float(item.get("recommended_duration") or 0.0)
            if duration <= 0:
                start = item.get("material_cut_start")
                end = item.get("material_cut_end")
                try:
                    duration = max(0.0, float(end) - float(start))
                except (TypeError, ValueError):
                    duration = 0.0
            if duration > 0:
                windows[script_ref] = {
                    "material_cutaway_start_offset": 0.0,
                    "material_cutaway_duration": round(duration, 3),
                    "source": "clip_matches",
                }

    if isinstance(edit_plan, dict):
        for block in edit_plan.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type") or "").strip().lower()
            layout = str(block.get("visual_layout") or "").strip().lower()
            use_cutaway = bool(block.get("use_cutaway")) or block_type == "evidence_clip" or layout in {"cutaway_silent", "evidence_first", "cutaway"}
            script_ref = str(block.get("script_ref") or "").strip()
            if not use_cutaway or not script_ref:
                continue
            duration = float(block.get("duration") or 0.0)
            if duration > 0:
                windows[script_ref] = {
                    "material_cutaway_start_offset": 0.0,
                    "material_cutaway_duration": round(duration, 3),
                    "source": "edit_plan",
                    "block_id": block.get("id"),
                }
    return windows


def annotate_visible_window(item: dict, cutaway: dict | None = None) -> dict:
    start = float(item.get("start") or 0.0)
    end = float(item.get("end") or start)
    duration = max(0.0, end - start)
    cutaway_duration = 0.0
    if cutaway:
        cutaway_duration = max(0.0, min(duration, float(cutaway.get("material_cutaway_duration") or 0.0)))
    visible_start = round(start + cutaway_duration, 3)
    visible_end = round(end, 3)
    visible_duration = round(max(0.0, visible_end - visible_start), 3)
    return {
        **item,
        "visibility": {
            "avatarVisibleStart": visible_start,
            "avatarVisibleEnd": visible_end,
            "avatarVisibleDuration": visible_duration,
            "materialCutawayStart": round(start, 3) if cutaway_duration > 0 else None,
            "materialCutawayEnd": round(start + cutaway_duration, 3) if cutaway_duration > 0 else None,
            "source": (cutaway or {}).get("source"),
        },
    }


def build_timeline_segments(
    narration_text: str,
    duration: float,
    script_units: list[dict] | None = None,
    cutaway_windows: dict | None = None,
    speech_alignment: dict | None = None,
    include_alignment_words: bool = False,
    attach_rule_anchors: bool = True,
) -> list[dict]:
    units = normalize_script_units(script_units)
    alignment_segments = normalize_alignment_segments(speech_alignment)
    alignment_words = normalize_alignment_words(speech_alignment)
    if units:
        source_items = units
    elif alignment_segments:
        source_items = alignment_segments
    else:
        sentences = split_sentences(narration_text)
        source_items = [
            {"id": f"motion_{index + 1:03d}", "role": None, "text": sentence}
            for index, sentence in enumerate(sentences)
        ]

    if not source_items:
        raise ValueError("缺少可用口播文本")

    cutaway_windows = cutaway_windows or {}
    weights = [max(1, len(re.sub(r"\s+", "", item.get("text") or ""))) for item in source_items]
    total_weight = sum(weights)
    cursor = 0.0
    timeline = []
    for index, item in enumerate(source_items):
        explicit_start = item.get("start")
        explicit_end = item.get("end")
        if explicit_start is not None and explicit_end is not None:
            start = max(0.0, min(duration, float(explicit_start)))
            end = max(start, min(duration, float(explicit_end)))
        elif index == len(source_items) - 1:
            end = duration
            start = cursor
        else:
            end = min(duration, cursor + duration * (weights[index] / total_weight))
            start = cursor
        segment_duration = max(0.0, end - start)
        segment = {
            "id": str(item.get("id") or f"motion_{index + 1:03d}"),
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(segment_duration, 3),
            "text": item.get("text") or "",
        }
        if item.get("role") is not None:
            segment["role"] = item.get("role")
        if include_alignment_words:
            segment["alignmentWords"] = collect_alignment_words_for_segment(segment["start"], segment["end"], alignment_words)
        if attach_rule_anchors:
            anchor = find_alignment_anchor_time(segment["text"], segment["start"], segment["end"], alignment_words)
            if anchor:
                segment["anchor"] = anchor
        timeline.append(annotate_visible_window(segment, cutaway_windows.get(segment["id"])))
        cursor = end
    return timeline


def classify_sentence(
    text: str,
    duration: float,
    last_gesture_start: float,
    start: float,
    profiles: dict,
    recent_actions: list[str],
) -> tuple[str, str, float, dict]:
    if duration < MIN_GESTURE_SEGMENT_SECONDS:
        return "idle_talking", "short_sentence", 0.25, {"candidates": []}

    action, reason, intensity, meta = choose_action(text, profiles, recent_actions)
    if action != "idle_talking" and start - last_gesture_start < MIN_GESTURE_INTERVAL_SECONDS:
        return "idle_talking", "cooldown_suppressed", 0.25, meta
    if action != "idle_talking" and start - last_gesture_start < TARGET_GESTURE_INTERVAL_SECONDS:
        if meta.get("candidates", [{}])[0].get("score", 0.0) < 0.35:
            return "idle_talking", "target_interval_suppressed", 0.25, meta
    return action, reason, intensity, meta


def visible_duration_for_segment(item: dict) -> float:
    visibility = item.get("visibility") if isinstance(item.get("visibility"), dict) else {}
    return float(visibility.get("avatarVisibleDuration") if visibility.get("avatarVisibleDuration") is not None else item.get("duration") or 0.0)


def active_midpoint(profile: dict) -> float:
    active_start = float(profile.get("activeStart") or 0.0)
    active_end = float(profile.get("activeEnd") or active_start)
    if active_end < active_start:
        active_end = active_start
    return (active_start + active_end) / 2.0


def compile_motion_segments(decision_segments: list[dict], profiles: dict, duration: float) -> list[dict]:
    compiled = []
    cursor = 0.0
    last_gesture_active_time = -999.0

    def append_idle(start: float, end: float, reason: str = "idle_fill") -> None:
        idle_duration = round(max(0.0, end - start), 3)
        if idle_duration < 0.02:
            return
        compiled.append({
            "id": f"motion_{len(compiled) + 1:03d}",
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": idle_duration,
            "text": "",
            "semantic": reason,
            "action": "idle_talking",
            "intensity": 0.25,
            "decision": {"planner": "timeline_compiler", "reason": reason},
        })

    for item in decision_segments:
        action = str(item.get("action") or "idle_talking")
        if action == "idle_talking" or action not in profiles:
            continue

        profile = profiles[action]
        source_duration = max(0.2, float(profile.get("sourceDuration") or item.get("duration") or 1.0))
        visibility = item.get("visibility") if isinstance(item.get("visibility"), dict) else {}
        visible_start = float(visibility.get("avatarVisibleStart") if visibility.get("avatarVisibleStart") is not None else item.get("start") or 0.0)
        visible_end = float(visibility.get("avatarVisibleEnd") if visibility.get("avatarVisibleEnd") is not None else item.get("end") or 0.0)
        visible_duration = max(0.0, visible_end - visible_start)
        if visible_duration < MIN_VISIBLE_GESTURE_SECONDS:
            continue

        anchor = item.get("anchor") if isinstance(item.get("anchor"), dict) else {}
        anchor_time = anchor.get("triggerTime")
        try:
            anchor_time = float(anchor_time)
        except (TypeError, ValueError):
            anchor_time = None
        if anchor_time is not None and visible_start - 0.05 <= anchor_time <= visible_end + 0.05:
            target_active_time = min(max(anchor_time, visible_start + 0.05), visible_end - 0.05)
            target_source = str(anchor.get("source") or "speech_alignment_anchor")
        else:
            target_active_time = visible_start + min(max(visible_duration * 0.45, 0.45), max(0.45, visible_duration - 0.15))
            target_source = "visible_window_ratio"
        action_start = max(float(item.get("start") or 0.0), target_active_time - active_midpoint(profile))
        action_start = min(action_start, max(0.0, duration - source_duration))
        if action_start < cursor:
            action_start = cursor
        action_end = action_start + source_duration
        active_start = action_start + float(profile.get("activeStart") or 0.0)
        active_end = action_start + float(profile.get("activeEnd") or profile.get("activeStart") or 0.0)

        if active_start < visible_start - 0.05 or active_end > visible_end + 0.25:
            shifted_start = visible_start - float(profile.get("activeStart") or 0.0)
            shifted_start = max(cursor, float(item.get("start") or 0.0), min(shifted_start, max(0.0, duration - source_duration)))
            shifted_active_start = shifted_start + float(profile.get("activeStart") or 0.0)
            shifted_active_end = shifted_start + float(profile.get("activeEnd") or profile.get("activeStart") or 0.0)
            if shifted_active_start >= visible_start - 0.05 and shifted_active_end <= visible_end + 0.25:
                action_start = shifted_start
                action_end = action_start + source_duration
                active_start = shifted_active_start
                active_end = shifted_active_end
            else:
                continue

        if active_start - last_gesture_active_time < MIN_GESTURE_INTERVAL_SECONDS:
            continue

        append_idle(cursor, action_start)
        compiled.append({
            "id": f"motion_{len(compiled) + 1:03d}",
            "sourceSegmentId": item.get("id"),
            "start": round(action_start, 3),
            "end": round(action_end, 3),
            "duration": round(source_duration, 3),
            "text": item.get("text") or "",
            "semantic": item.get("semantic"),
            "action": action,
            "intensity": item.get("intensity"),
            "visibility": visibility,
            "timing": {
                "sourceDuration": round(source_duration, 3),
                "activeStart": round(float(profile.get("activeStart") or 0.0), 3),
                "activeEnd": round(float(profile.get("activeEnd") or 0.0), 3),
                "activeTimelineStart": round(active_start, 3),
                "activeTimelineEnd": round(active_end, 3),
                "targetActiveTime": round(target_active_time, 3),
                "targetSource": target_source,
            },
            "decision": item.get("decision") or {},
        })
        cursor = action_end
        last_gesture_active_time = active_start

    append_idle(cursor, duration, reason="idle_tail")
    return compiled


def build_motion_plan(
    narration_text: str,
    duration: float,
    fps: int = DEFAULT_FPS,
    action_dir: Path | None = None,
    script_units: list[dict] | None = None,
    edit_plan: dict | None = None,
    clip_matches: dict | None = None,
    speech_alignment: dict | None = None,
) -> dict:
    profiles = load_action_profiles(action_dir)
    cutaway_windows = extract_cutaway_windows(edit_plan, clip_matches)
    timeline = build_timeline_segments(
        narration_text,
        duration,
        script_units=script_units,
        cutaway_windows=cutaway_windows,
        speech_alignment=speech_alignment,
        include_alignment_words=bool(speech_alignment),
        attach_rule_anchors=True,
    )
    last_gesture_start = -999.0
    recent_actions = []
    decisions = []

    for item in timeline:
        visible_duration = visible_duration_for_segment(item)
        action, reason, intensity, decision = classify_sentence(
            item["text"],
            visible_duration,
            last_gesture_start,
            float((item.get("visibility") or {}).get("avatarVisibleStart") or item["start"]),
            profiles,
            recent_actions,
        )
        if action != "idle_talking":
            last_gesture_start = float((item.get("visibility") or {}).get("avatarVisibleStart") or item["start"])
            recent_actions.append(action)
            recent_actions = recent_actions[-4:]
        decisions.append({
            **item,
            "semantic": reason,
            "action": action,
            "intensity": intensity,
            "decision": decision,
        })

    segments = compile_motion_segments(decisions, profiles, duration)
    payload = {
        "version": 1,
        "fps": int(fps or DEFAULT_FPS),
        "duration": round(duration, 3),
        "planner": {
            "method": "local_sparse_semantic",
            "availableActions": sorted(profiles.keys()),
            "minGestureIntervalSeconds": MIN_GESTURE_INTERVAL_SECONDS,
            "targetGestureIntervalSeconds": TARGET_GESTURE_INTERVAL_SECONDS,
            "usesScriptUnits": bool(script_units),
            "cutawayAware": bool(cutaway_windows),
            "usesSpeechAlignment": bool(speech_alignment),
        },
        "decisionSegments": decisions,
        "segments": segments,
    }
    payload["signature"] = hash_payload(payload)
    return payload


def get_text_model(provider: str) -> str:
    if provider == "deepseek":
        return os.getenv("AVATAR_MOTION_LLM_MODEL") or os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    if provider == "qwen":
        return os.getenv("AVATAR_MOTION_LLM_MODEL") or os.getenv("QWEN_TEXT_MODEL", "qwen3.6-plus")
    if provider == "vertex":
        return os.getenv("AVATAR_MOTION_LLM_MODEL") or os.getenv("VERTEX_SCRIPT_MODEL") or os.getenv("GEMINI_MODEL", "gemini-2.5-pro")
    return os.getenv("AVATAR_MOTION_LLM_MODEL") or os.getenv("GEMINI_MODEL", "gemini-2.5-pro")


def resolve_llm_provider(provider: str | None = None) -> str:
    requested = str(provider or os.getenv("AVATAR_MOTION_LLM_PROVIDER") or "").strip().lower()
    if requested:
        if requested not in SUPPORTED_LLM_PROVIDERS:
            raise ValueError(f"不支持的数字人动作 LLM provider: {requested}")
        return requested

    from llm_client import get_text_llm_provider

    resolved = get_text_llm_provider()
    if resolved not in SUPPORTED_LLM_PROVIDERS:
        raise ValueError(f"不支持的数字人动作 LLM provider: {resolved}")
    return resolved


def compact_edit_context(edit_plan: dict | None = None, clip_matches: dict | None = None, timeline: list[dict] | None = None) -> dict:
    blocks = []
    if isinstance(edit_plan, dict):
        for block in edit_plan.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            blocks.append({
                "id": block.get("id"),
                "type": block.get("type"),
                "script_ref": block.get("script_ref"),
                "duration": block.get("duration"),
                "visual_layout": block.get("visual_layout"),
                "use_cutaway": bool(block.get("use_cutaway")),
            })

    matches = []
    if isinstance(clip_matches, dict):
        for item in clip_matches.get("clip_matches") or []:
            if not isinstance(item, dict):
                continue
            matches.append({
                "script_ref": item.get("script_ref"),
                "use_cutaway": bool(item.get("use_cutaway")),
                "recommended_duration": item.get("recommended_duration"),
                "material_cut_start": item.get("material_cut_start"),
                "material_cut_end": item.get("material_cut_end"),
                "reason": item.get("reason") or item.get("decision"),
            })

    visible_windows = []
    for item in timeline or []:
        visibility = item.get("visibility") if isinstance(item.get("visibility"), dict) else {}
        visible_windows.append({
            "id": item.get("id"),
            "text": item.get("text"),
            "start": item.get("start"),
            "end": item.get("end"),
            "avatarVisibleStart": visibility.get("avatarVisibleStart"),
            "avatarVisibleEnd": visibility.get("avatarVisibleEnd"),
            "avatarVisibleDuration": visibility.get("avatarVisibleDuration"),
            "materialCutawayStart": visibility.get("materialCutawayStart"),
            "materialCutawayEnd": visibility.get("materialCutawayEnd"),
        })

    return {
        "edit_plan_blocks": blocks,
        "clip_matches": matches,
        "avatar_visibility_windows": visible_windows,
    }


def compact_timed_subtitles(speech_alignment: dict | None = None, max_words: int = 160) -> dict:
    segments = [
        {
            "id": item["id"],
            "start": round(float(item["start"]), 3),
            "end": round(float(item["end"]), 3),
            "text": item["text"],
        }
        for item in normalize_alignment_segments(speech_alignment)
    ]
    words = [
        {
            "index": int(item["index"]),
            "start": round(float(item["start"]), 3),
            "end": round(float(item["end"]), 3),
            "text": item["text"],
        }
        for item in normalize_alignment_words(speech_alignment)[:max_words]
    ]
    return {
        "segments": segments,
        "words": words,
    }


def build_llm_prompt(
    timeline: list[dict],
    profiles: dict,
    edit_plan: dict | None = None,
    clip_matches: dict | None = None,
    speech_alignment: dict | None = None,
) -> str:
    actions = []
    for action_id, profile in sorted(profiles.items()):
        actions.append({
            "id": action_id,
            "label": profile.get("label") or action_id,
            "tags": profile.get("tags") or [],
            "semantic": profile.get("text") or "",
            "intensity": profile.get("intensity", 0.5),
            "sourceDuration": profile.get("sourceDuration"),
            "activeStart": profile.get("activeStart"),
            "activeEnd": profile.get("activeEnd"),
        })

    payload = {
        "available_actions": actions,
        "timeline": timeline,
        "timed_subtitles": compact_timed_subtitles(speech_alignment),
        "edit_context": compact_edit_context(edit_plan, clip_matches, timeline),
        "constraints": {
            "allowed_actions": ["idle_talking", *sorted(profiles.keys())],
            "min_gesture_interval_seconds": MIN_GESTURE_INTERVAL_SECONDS,
            "target_gesture_interval_seconds": TARGET_GESTURE_INTERVAL_SECONDS,
            "min_avatar_visible_seconds_for_gesture": MIN_VISIBLE_GESTURE_SECONDS,
            "style": "动作要丰富但不要频繁重复；动作组件本身已包含默认态到动作再回默认态，不能要求裁掉组件开头或中段。",
        },
    }
    return (
        "你是数字人口播手势导演。请根据每句口播的语义选择动作组件。\n"
        "只输出 JSON，不要 Markdown，不要解释。\n"
        "JSON 格式必须是：{\"segments\":[{\"id\":\"motion_001\",\"action\":\"动作id或idle_talking\",\"reason\":\"简短中文原因\",\"intensity\":0.25到0.85,\"anchorWordIndex\":数字或null,\"anchorTime\":秒数或null}]}\n"
        "规则：\n"
        "1. 只能使用 allowed_actions 中的动作。\n"
        "2. 不要每句话都做动作，普通过渡句使用 idle_talking。\n"
        "3. 同一动作不要连续机械重复；需要强调数字、风险、结论时才增加动作。\n"
        "4. 不要修改 start/end/duration，时间轴由系统固定。\n"
        "5. 如果一句话很短或不值得动作，选 idle_talking。\n\n"
        "6. timeline.visibility 表示数字人真实可见窗口；如果素材插片覆盖了该句开头，手势只能在 avatarVisibleStart 到 avatarVisibleEnd 之间生效。\n"
        "7. 如果 avatarVisibleDuration 太短、或动作主动段无法落在数字人可见窗口内，必须选 idle_talking；不要把手势安排给素材画面覆盖的口播。\n\n"
        "8. timed_subtitles 是最终 TTS 后 ASR 的字幕/词级时间；edit_context 是已有剪辑方案和素材插片覆盖关系。\n"
        "9. 你要结合 timed_subtitles 和 edit_context 判断：哪些重点发生在数字人可见段，哪些重点被素材插片覆盖；只有数字人可见段才安排动作。\n"
        "10. timeline.alignmentWords 是该时间段附近可选锚词。选择动作时由你判断语义重点，并从 alignmentWords 中选一个最该对齐动作主动段的 anchorWordIndex；没有合适词就填 null。\n"
        "11. 不要根据固定关键词机械选择锚点；必须结合整句语义、剪辑上下文、可见窗口和动作含义。\n\n"
        f"输入数据：\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )


def normalize_llm_intensity(value, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return round(min(0.85, max(0.25, parsed)), 2)


def apply_pacing_to_llm_segments(segments: list[dict], profiles: dict) -> list[dict]:
    last_gesture_start = -999.0
    recent_actions = []
    normalized = []
    for segment in segments:
        requested_action = str(segment.get("action") or "idle_talking").strip()
        action = requested_action if requested_action in profiles or requested_action == "idle_talking" else "idle_talking"
        reason = str(segment.get("semantic") or segment.get("reason") or "llm_selected").strip() or "llm_selected"

        if action != "idle_talking" and segment["duration"] < MIN_GESTURE_SEGMENT_SECONDS:
            action = "idle_talking"
            reason = "llm_short_sentence_suppressed"
        elif action != "idle_talking" and segment["start"] - last_gesture_start < MIN_GESTURE_INTERVAL_SECONDS:
            action = "idle_talking"
            reason = "llm_cooldown_suppressed"
        elif action != "idle_talking" and action in recent_actions[-2:]:
            action = "idle_talking"
            reason = "llm_repeat_suppressed"

        if action != "idle_talking":
            last_gesture_start = segment["start"]
            recent_actions.append(action)
            recent_actions = recent_actions[-4:]
            fallback_intensity = float(profiles[action].get("intensity", 0.5))
        else:
            fallback_intensity = 0.25

        normalized.append({
            **segment,
            "semantic": reason,
            "action": action,
            "intensity": normalize_llm_intensity(segment.get("intensity"), fallback_intensity),
            "decision": {
                "planner": "llm",
                "requestedAction": requested_action,
                "reason": str(segment.get("reason") or reason),
            },
        })
    return normalized


def resolve_llm_anchor(assignment: dict, item: dict) -> dict | None:
    words = item.get("alignmentWords") if isinstance(item.get("alignmentWords"), list) else []
    word_by_index = {int(word.get("index")): word for word in words if word.get("index") is not None}
    anchor_word_index = assignment.get("anchorWordIndex")
    try:
        anchor_word_index = int(anchor_word_index)
    except (TypeError, ValueError):
        anchor_word_index = None

    if anchor_word_index is not None and anchor_word_index in word_by_index:
        word = word_by_index[anchor_word_index]
        trigger_time = (float(word["start"]) + float(word["end"])) / 2.0
        return {
            "triggerTime": round(trigger_time, 3),
            "word": str(word.get("text") or ""),
            "wordStart": round(float(word["start"]), 3),
            "wordEnd": round(float(word["end"]), 3),
            "source": "llm_speech_alignment_anchor",
        }

    try:
        anchor_time = float(assignment.get("anchorTime"))
    except (TypeError, ValueError):
        return None
    start = float(item.get("start") or 0.0)
    end = float(item.get("end") or start)
    if not (start - 0.08 <= anchor_time <= end + 0.08):
        return None
    return {
        "triggerTime": round(anchor_time, 3),
        "word": "",
        "source": "llm_speech_alignment_anchor",
    }


def parse_llm_assignments(response_text: str, timeline: list[dict], profiles: dict) -> list[dict]:
    payload = extract_json_object(response_text)
    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list):
        raise ValueError("LLM response missing segments list")

    assignments = {}
    for item in raw_segments:
        if not isinstance(item, dict):
            continue
        segment_id = str(item.get("id") or "").strip()
        if segment_id:
            assignments[segment_id] = item

    merged = []
    for item in timeline:
        assignment = assignments.get(item["id"], {})
        segment = {
            **item,
            "action": assignment.get("action", "idle_talking"),
            "reason": assignment.get("reason", "llm_selected"),
            "intensity": assignment.get("intensity"),
        }
        anchor = resolve_llm_anchor(assignment, item)
        if anchor:
            segment["anchor"] = anchor
        merged.append(segment)

    return apply_pacing_to_llm_segments(merged, profiles)


def build_motion_plan_with_llm(
    narration_text: str,
    duration: float,
    fps: int = DEFAULT_FPS,
    action_dir: Path | None = None,
    provider: str | None = None,
    model: str | None = None,
    script_units: list[dict] | None = None,
    edit_plan: dict | None = None,
    clip_matches: dict | None = None,
    speech_alignment: dict | None = None,
) -> dict:
    load_project_env(__file__)
    profiles = load_action_profiles(action_dir)
    cutaway_windows = extract_cutaway_windows(edit_plan, clip_matches)
    timeline = build_timeline_segments(
        narration_text,
        duration,
        script_units=script_units,
        cutaway_windows=cutaway_windows,
        speech_alignment=speech_alignment,
        include_alignment_words=bool(speech_alignment),
        attach_rule_anchors=False,
    )
    resolved_provider = resolve_llm_provider(provider)
    resolved_model = str(model or get_text_model(resolved_provider)).strip()
    if not resolved_model:
        raise ValueError("缺少数字人动作 LLM 模型配置")

    from llm_client import create_llm_client, generate_content

    client = create_llm_client(resolved_provider)
    prompt = build_llm_prompt(
        timeline,
        profiles,
        edit_plan=edit_plan,
        clip_matches=clip_matches,
        speech_alignment=speech_alignment,
    )
    response = generate_content(
        client,
        model=resolved_model,
        contents=prompt,
        response_mime_type="application/json",
        retries=2,
        request_timeout=int(os.getenv("AVATAR_MOTION_LLM_TIMEOUT_SECONDS", "90") or 90),
        provider=resolved_provider,
    )
    decisions = parse_llm_assignments(getattr(response, "text", ""), timeline, profiles)
    segments = compile_motion_segments(decisions, profiles, duration)
    payload = {
        "version": 1,
        "fps": int(fps or DEFAULT_FPS),
        "duration": round(duration, 3),
        "planner": {
            "method": "llm",
            "provider": resolved_provider,
            "model": resolved_model,
            "availableActions": sorted(profiles.keys()),
            "minGestureIntervalSeconds": MIN_GESTURE_INTERVAL_SECONDS,
            "targetGestureIntervalSeconds": TARGET_GESTURE_INTERVAL_SECONDS,
            "usesScriptUnits": bool(script_units),
            "cutawayAware": bool(cutaway_windows),
            "usesSpeechAlignment": bool(speech_alignment),
        },
        "decisionSegments": decisions,
        "segments": segments,
    }
    payload["signature"] = hash_payload(payload)
    return payload


def build_motion_plan_auto(
    narration_text: str,
    duration: float,
    fps: int = DEFAULT_FPS,
    action_dir: Path | None = None,
    planner_mode: str = "auto",
    llm_provider: str | None = None,
    llm_model: str | None = None,
    script_units: list[dict] | None = None,
    edit_plan: dict | None = None,
    clip_matches: dict | None = None,
    speech_alignment: dict | None = None,
) -> dict:
    mode = str(planner_mode or "auto").strip().lower()
    if mode not in SUPPORTED_PLANNER_MODES:
        raise ValueError(f"不支持的数字人动作 planner 模式: {planner_mode}")
    if mode == "local":
        return build_motion_plan(
            narration_text,
            duration,
            fps=fps,
            action_dir=action_dir,
            script_units=script_units,
            edit_plan=edit_plan,
            clip_matches=clip_matches,
            speech_alignment=speech_alignment,
        )

    try:
        return build_motion_plan_with_llm(
            narration_text,
            duration,
            fps=fps,
            action_dir=action_dir,
            provider=llm_provider,
            model=llm_model,
            script_units=script_units,
            edit_plan=edit_plan,
            clip_matches=clip_matches,
            speech_alignment=speech_alignment,
        )
    except Exception as exc:
        if mode == "llm":
            raise
        fallback = build_motion_plan(
            narration_text,
            duration,
            fps=fps,
            action_dir=action_dir,
            script_units=script_units,
            edit_plan=edit_plan,
            clip_matches=clip_matches,
            speech_alignment=speech_alignment,
        )
        fallback["planner"]["method"] = "local_sparse_semantic_fallback"
        fallback["planner"]["llmError"] = str(exc)
        fallback["signature"] = hash_payload(fallback)
        print(f"[avatar_motion_plan] LLM planner failed, fallback to local semantic: {exc}", file=sys.stderr)
        return fallback


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build avatar motion plan")
    parser.add_argument("--narration-text", required=True, help="Path to narration speech text")
    parser.add_argument("--audio", required=True, help="Path to synthesized speech audio")
    parser.add_argument("--output", required=True, help="Output motion plan JSON")
    parser.add_argument("--fps", type=int, default=DEFAULT_FPS)
    parser.add_argument("--duration", type=float, default=0.0, help="Optional explicit duration override")
    parser.add_argument("--action-dir", default="", help="Optional avatar action preset directory for semantic matching")
    parser.add_argument("--planner-mode", default=os.getenv("AVATAR_MOTION_PLANNER", "auto"), choices=sorted(SUPPORTED_PLANNER_MODES))
    parser.add_argument("--llm-provider", default=os.getenv("AVATAR_MOTION_LLM_PROVIDER", ""), help="Optional provider override: deepseek/qwen/gemini/vertex")
    parser.add_argument("--llm-model", default=os.getenv("AVATAR_MOTION_LLM_MODEL", ""), help="Optional model override")
    parser.add_argument("--script-units", default="", help="Optional script_units.json used to align gestures with edit script")
    parser.add_argument("--edit-plan", default="", help="Optional edit_plan.json used to avoid gestures under material cutaways")
    parser.add_argument("--clip-matches", default="", help="Optional clip_matches.json used to avoid gestures under material cutaways")
    parser.add_argument("--speech-alignment", default="", help="Optional speech_alignment.json used for word/phrase trigger timing")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    narration_path = Path(args.narration_text)
    audio_path = Path(args.audio)
    output_path = Path(args.output)

    emit_stage("avatar_motion_plan", "读取口播文本和音频时长")
    narration_text = read_text_file(narration_path)
    duration = resolve_audio_duration(audio_path, narration_text, args.duration)
    action_dir = Path(args.action_dir) if args.action_dir else None
    script_units = load_script_units(Path(args.script_units)) if args.script_units else []
    edit_plan = read_json_file(Path(args.edit_plan)) if args.edit_plan and Path(args.edit_plan).exists() else {}
    clip_matches = read_json_file(Path(args.clip_matches)) if args.clip_matches and Path(args.clip_matches).exists() else {}
    speech_alignment = load_speech_alignment(Path(args.speech_alignment)) if args.speech_alignment else {}
    plan = build_motion_plan_auto(
        narration_text,
        duration,
        args.fps,
        action_dir=action_dir,
        planner_mode=args.planner_mode,
        llm_provider=args.llm_provider,
        llm_model=args.llm_model,
        script_units=script_units,
        edit_plan=edit_plan,
        clip_matches=clip_matches,
        speech_alignment=speech_alignment,
    )
    write_json_file(output_path, plan)

    emit_result(
        "avatar motion plan generated",
        outputPath=str(output_path),
        signature=plan["signature"],
        segmentCount=len(plan["segments"]),
        duration=plan["duration"],
        planner=plan["planner"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run_guarded(
        main,
        error_code="AVATAR_MOTION_PLAN_FAILED",
        error_message="数字人动作计划生成失败",
        error_stage="avatar_motion_plan",
    ))
