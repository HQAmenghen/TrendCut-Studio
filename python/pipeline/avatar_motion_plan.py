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
SENTENCE_PATTERN = re.compile(r"[^。！？!?…\n]+[。！？!?…]?", re.UNICODE)
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]", re.UNICODE)


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


def build_timeline_segments(narration_text: str, duration: float) -> list[dict]:
    sentences = split_sentences(narration_text)
    if not sentences:
        raise ValueError("缺少可用口播文本")

    weights = [max(1, len(re.sub(r"\s+", "", sentence))) for sentence in sentences]
    total_weight = sum(weights)
    cursor = 0.0
    timeline = []
    for index, sentence in enumerate(sentences):
        if index == len(sentences) - 1:
            end = duration
        else:
            end = min(duration, cursor + duration * (weights[index] / total_weight))
        start = cursor
        segment_duration = max(0.0, end - start)
        timeline.append({
            "id": f"motion_{index + 1:03d}",
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(segment_duration, 3),
            "text": sentence,
        })
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


def build_motion_plan(narration_text: str, duration: float, fps: int = DEFAULT_FPS, action_dir: Path | None = None) -> dict:
    profiles = load_action_profiles(action_dir)
    timeline = build_timeline_segments(narration_text, duration)
    last_gesture_start = -999.0
    recent_actions = []
    segments = []

    for item in timeline:
        action, reason, intensity, decision = classify_sentence(
            item["text"],
            item["duration"],
            last_gesture_start,
            item["start"],
            profiles,
            recent_actions,
        )
        if action != "idle_talking":
            last_gesture_start = item["start"]
            recent_actions.append(action)
            recent_actions = recent_actions[-4:]
        segments.append({
            **item,
            "semantic": reason,
            "action": action,
            "intensity": intensity,
            "decision": decision,
        })

    payload = {
        "version": 1,
        "fps": int(fps or DEFAULT_FPS),
        "duration": round(duration, 3),
        "planner": {
            "method": "local_sparse_semantic",
            "availableActions": sorted(profiles.keys()),
            "minGestureIntervalSeconds": MIN_GESTURE_INTERVAL_SECONDS,
            "targetGestureIntervalSeconds": TARGET_GESTURE_INTERVAL_SECONDS,
        },
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


def build_llm_prompt(timeline: list[dict], profiles: dict) -> str:
    actions = []
    for action_id, profile in sorted(profiles.items()):
        actions.append({
            "id": action_id,
            "label": profile.get("label") or action_id,
            "tags": profile.get("tags") or [],
            "semantic": profile.get("text") or "",
            "intensity": profile.get("intensity", 0.5),
        })

    payload = {
        "available_actions": actions,
        "timeline": timeline,
        "constraints": {
            "allowed_actions": ["idle_talking", *sorted(profiles.keys())],
            "min_gesture_interval_seconds": MIN_GESTURE_INTERVAL_SECONDS,
            "target_gesture_interval_seconds": TARGET_GESTURE_INTERVAL_SECONDS,
            "style": "动作要丰富但不要频繁重复；动作组件本身已包含默认态到动作再回默认态，不能要求裁掉组件开头或中段。",
        },
    }
    return (
        "你是数字人口播手势导演。请根据每句口播的语义选择动作组件。\n"
        "只输出 JSON，不要 Markdown，不要解释。\n"
        "JSON 格式必须是：{\"segments\":[{\"id\":\"motion_001\",\"action\":\"动作id或idle_talking\",\"reason\":\"简短中文原因\",\"intensity\":0.25到0.85}]}\n"
        "规则：\n"
        "1. 只能使用 allowed_actions 中的动作。\n"
        "2. 不要每句话都做动作，普通过渡句使用 idle_talking。\n"
        "3. 同一动作不要连续机械重复；需要强调数字、风险、结论时才增加动作。\n"
        "4. 不要修改 start/end/duration，时间轴由系统固定。\n"
        "5. 如果一句话很短或不值得动作，选 idle_talking。\n\n"
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
        merged.append({
            **item,
            "action": assignment.get("action", "idle_talking"),
            "reason": assignment.get("reason", "llm_selected"),
            "intensity": assignment.get("intensity"),
        })

    return apply_pacing_to_llm_segments(merged, profiles)


def build_motion_plan_with_llm(
    narration_text: str,
    duration: float,
    fps: int = DEFAULT_FPS,
    action_dir: Path | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    load_project_env(__file__)
    profiles = load_action_profiles(action_dir)
    timeline = build_timeline_segments(narration_text, duration)
    resolved_provider = resolve_llm_provider(provider)
    resolved_model = str(model or get_text_model(resolved_provider)).strip()
    if not resolved_model:
        raise ValueError("缺少数字人动作 LLM 模型配置")

    from llm_client import create_llm_client, generate_content

    client = create_llm_client(resolved_provider)
    prompt = build_llm_prompt(timeline, profiles)
    response = generate_content(
        client,
        model=resolved_model,
        contents=prompt,
        response_mime_type="application/json",
        retries=2,
        request_timeout=int(os.getenv("AVATAR_MOTION_LLM_TIMEOUT_SECONDS", "90") or 90),
        provider=resolved_provider,
    )
    segments = parse_llm_assignments(getattr(response, "text", ""), timeline, profiles)
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
        },
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
) -> dict:
    mode = str(planner_mode or "auto").strip().lower()
    if mode not in SUPPORTED_PLANNER_MODES:
        raise ValueError(f"不支持的数字人动作 planner 模式: {planner_mode}")
    if mode == "local":
        return build_motion_plan(narration_text, duration, fps=fps, action_dir=action_dir)

    try:
        return build_motion_plan_with_llm(
            narration_text,
            duration,
            fps=fps,
            action_dir=action_dir,
            provider=llm_provider,
            model=llm_model,
        )
    except Exception as exc:
        if mode == "llm":
            raise
        fallback = build_motion_plan(narration_text, duration, fps=fps, action_dir=action_dir)
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
    plan = build_motion_plan_auto(
        narration_text,
        duration,
        args.fps,
        action_dir=action_dir,
        planner_mode=args.planner_mode,
        llm_provider=args.llm_provider,
        llm_model=args.llm_model,
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
