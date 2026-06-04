#!/usr/bin/env python3
"""
素材打分脚本
以静音插片可用性为主评估素材候选片段。
"""
import sys
import io
import json
import os
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
else:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', write_through=True)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content
from script_protocol import emit_result, emit_stage, run_guarded
from skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

DEFAULT_QWEN_MODEL = "qwen3.6-plus"
DEFAULT_QWEN_SCORING_MODEL = "qwen3.6-plus"
SCORING_LLM_PROVIDER = "qwen"


def require_llm_scoring() -> bool:
    value = str(os.getenv("MATERIAL_REQUIRE_LLM_SCORING", "1") or "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def get_scoring_llm_provider():
    """素材评分多批次并发固定使用 Qwen 多 Key 运行时。"""
    return SCORING_LLM_PROVIDER


def create_scoring_llm_client():
    return create_llm_client(provider=get_scoring_llm_provider())


def get_text_model():
    """获取素材评分模型。"""
    return (
        os.getenv("QWEN_SCORING_MODEL")
        or os.getenv("QWEN_TEXT_MODEL")
        or DEFAULT_QWEN_SCORING_MODEL
        or DEFAULT_QWEN_MODEL
    )


def get_batch_retry_count() -> int:
    value = str(os.getenv("MATERIAL_SCORING_BATCH_RETRIES", "5") or "5").strip()
    try:
        parsed = int(value)
    except ValueError:
        return 5
    return max(0, parsed)


def load_json(path_str, default=None):
    """加载 JSON 文件"""
    path = Path(path_str)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ 读取 {path_str} 失败: {e}")
        return default


def write_json(path_str, data):
    """写入 JSON 文件"""
    try:
        Path(path_str).write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        return True
    except Exception as e:
        print(f"❌ 写入 {path_str} 失败: {e}")
        return False


def extract_json_from_response(text):
    """从 LLM 响应中提取 JSON"""
    import re
    try:
        return json.loads(text)
    except:
        pass

    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except:
            pass

    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except:
            pass

    raise ValueError("无法从响应中提取有效的 JSON")


def save_invalid_llm_response(batch_index, attempt, response_text, error):
    """Persist malformed LLM output so strict-mode failures can be diagnosed."""
    try:
        path = Path(f"material_scoring_invalid_response_batch_{batch_index}_attempt_{attempt}.txt")
        path.write_text(
            "\n".join([
                f"batch_index={batch_index}",
                f"attempt={attempt}",
                f"error={error}",
                "",
                str(response_text or ""),
            ]),
            encoding="utf-8",
        )
        print(f"   ⚠️ 已保存异常 LLM 原始响应: {path.name}")
    except Exception as write_error:
        print(f"   ⚠️ 保存异常 LLM 原始响应失败: {write_error}")


SCORING_PROMPT = load_prompt_text("score_material_segments_skill.md")


def normalize_string_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    normalized = []
    seen = set()
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def normalize_named_entities(value, with_alias=False):
    if value is None:
        return []
    if not isinstance(value, list):
        value = [value]
    normalized = []
    seen = set()
    for item in value:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            entity = {
                "name": name,
                "confidence": round(float(item.get("confidence", 0.8) or 0.8), 2),
                "source": normalize_string_list(item.get("source") or ["llm_derived"]),
            }
            if with_alias:
                entity["alias"] = normalize_string_list(item.get("alias"))
        else:
            name = str(item or "").strip()
            if not name:
                continue
            entity = {
                "name": name,
                "confidence": 0.8,
                "source": ["llm_derived"],
            }
            if with_alias:
                entity["alias"] = []
        key = entity["name"].lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(entity)
    return normalized


def guess_visual_type(seg):
    summary = " ".join([
        str(seg.get("visual_summary") or ""),
        str(seg.get("text") or ""),
        str(seg.get("ocr_text") or ""),
    ]).lower()
    human_subject_tokens = [
        "man", "woman", "person", "people", "individual", "individuals",
        "host", "guest", "speaker", "interviewer", "anchor", "analyst",
        "嘉宾", "主持人", "采访者", "受访者", "人物", "两人", "双方",
    ]
    human_scene_tokens = [
        "interview", "podcast", "studio", "desk", "seated", "sitting",
        "close-up", "close up", "closeup", "gesturing", "speaking",
        "listening", "talking", "conversation", "panel", "across from",
        "对谈", "采访", "讲话", "发言", "坐在", "镜头前", "面对面", "听着",
    ]
    stage_tokens = ["podium", "conference", "会场", "论坛", "hearing", "stage", "panel discussion", "summit"]
    chart_tokens = ["chart", "图表", "价格图", "k线", "curve", "table", "数据"]
    market_screen_tokens = ["screen", "terminal", "order book", "盘口", "屏幕", "ticker", "dashboard"]

    has_human_subject = any(token in summary for token in human_subject_tokens)
    has_human_scene = any(token in summary for token in human_scene_tokens)

    if any(token in summary for token in stage_tokens):
        return "stage_speech"
    if has_human_subject and has_human_scene:
        return "interview"
    if any(token in summary for token in ["interview", "采访", "podcast", "speaker_quote", "speaks", "讲话", "发言"]):
        return "interview"
    if any(token in summary for token in ["headline", "title", "字幕条", "lower third", "news"]):
        return "news_lower_third"
    if any(token in summary for token in chart_tokens):
        return "chart_data"
    if any(token in summary for token in market_screen_tokens):
        return "market_screen"
    if any(token in summary for token in ["meeting", "roundtable", "圆桌", "会议室"]):
        return "meeting_scene"
    return "generic_broll"


def guess_event_type(seg):
    text = " ".join([
        str(seg.get("text") or ""),
        str(seg.get("source_audio_text") or ""),
        str(seg.get("visual_summary") or ""),
    ]).lower()
    if any(token in text for token in ["forecast", "target", "price target", "预测", "目标价", "25万美元"]):
        return "price_forecast"
    if any(token in text for token in ["pass", "approved", "法案通过", "通过法案"]):
        return "policy_passed"
    if any(token in text for token in ["blocked", "reject", "否决", "阻止"]):
        return "policy_blocked"
    if any(token in text for token in ["allocation", "buy", "purchase", "增持", "买入", "储备"]):
        return "allocation_signal"
    if any(token in text for token in ["reaction", "selloff", "rally", "上涨", "下跌", "反弹", "承压"]):
        return "market_reaction"
    if any(token in text for token in ["sec", "监管", "regulation", "legislation", "vote", "法案"]):
        return "regulation_signal"
    return "speaker_commentary"


def guess_polarity(text):
    lowered = str(text or "").lower()
    bullish_tokens = ["看多", "上涨", "利好", "增持", "突破", "走强", "bullish", "upside", "target", "buy"]
    bearish_tokens = ["看空", "下跌", "利空", "减持", "承压", "走弱", "bearish", "downside", "selloff"]
    bullish = sum(1 for token in bullish_tokens if token in lowered)
    bearish = sum(1 for token in bearish_tokens if token in lowered)
    if bullish > bearish and bullish > 0:
        return "bullish"
    if bearish > bullish and bearish > 0:
        return "bearish"
    return "na"


def build_semantic_text(seg, structured, context=None):
    context = context or {}
    content = structured.get("content") or {}
    entities = structured.get("entities") or {}
    event = structured.get("event") or {}
    visual = structured.get("visual") or {}
    parts = []
    parts.extend(entity.get("name") for entity in entities.get("persons") or [])
    parts.extend(entity.get("name") for entity in entities.get("orgs") or [])
    parts.extend(entity.get("name") for entity in entities.get("assets") or [])
    parts.extend(normalize_string_list(event.get("event_tags")))
    for field in ("asr_text", "ocr_text", "visual_summary"):
        value = str(content.get(field) or "").strip()
        if value:
            parts.append(value)
    if event.get("event_type"):
        parts.append(str(event["event_type"]))
    if event.get("polarity") and str(event.get("polarity")) != "na":
        parts.append(str(event["polarity"]))
    if visual.get("visual_type"):
        parts.append(str(visual["visual_type"]))
    for hint in context.get("semantic_hints") or []:
        text = str(hint or "").strip()
        if text:
            parts.append(text)
    compact = " ".join(part for part in parts if part)
    compact = re.sub(r"\s+", " ", compact).strip()
    return compact[:500]


def normalize_priority(value):
    value = str(value or "").strip().lower()
    return value if value in {"high", "medium", "low"} else "medium"


def normalize_recommended_duration(value):
    default = {"min": 1.8, "ideal": 2.8, "max": 4.0}
    if not isinstance(value, dict):
        return default
    try:
        min_value = float(value.get("min", default["min"]) or default["min"])
        ideal_value = float(value.get("ideal", default["ideal"]) or default["ideal"])
        max_value = float(value.get("max", default["max"]) or default["max"])
    except Exception:
        return default
    ideal_value = max(min_value, ideal_value)
    max_value = max(ideal_value, max_value)
    return {"min": round(min_value, 2), "ideal": round(ideal_value, 2), "max": round(max_value, 2)}


def extract_source_handle(source_post):
    for key in ("postUrl", "materialUrl"):
        url = str((source_post or {}).get(key) or "").strip()
        if not url:
            continue
        match = re.search(r"(?:x|twitter)\.com/([^/?#]+)/", url, re.IGNORECASE)
        if match:
            handle = re.sub(r"[^A-Za-z0-9_]+", "", match.group(1) or "").strip("_")
            if handle:
                return handle
    return ""


def is_source_handle_entity(entity, speaker_handle):
    handle = str(speaker_handle or "").strip().lower()
    if not handle or not isinstance(entity, dict):
        return False
    name = str(entity.get("name") or "").strip().lower()
    sources = {str(item or "").strip().lower() for item in normalize_string_list(entity.get("source"))}
    return name == handle and sources == {"source_post"}


def build_scoring_context():
    source_post = load_json("source_post.json", {}) or {}
    speaker_scene = load_json("speaker_scene.json", {}) or {}
    result = load_json("result.json", {}) or {}
    speaker_handle = extract_source_handle(source_post)
    semantic_hints = []
    for value in [
        str(source_post.get("title") or "").strip(),
        str(source_post.get("body") or "").strip(),
        str(speaker_handle or "").strip(),
        str(result.get("summary") or "").strip(),
    ]:
        if value and value not in semantic_hints:
            semantic_hints.append(value)
    participants = speaker_scene.get("participants") or []
    for item in participants[:2]:
        for key in ("label", "role"):
            value = str((item or {}).get(key) or "").strip()
            if value and value not in semantic_hints:
                semantic_hints.append(value)
    return {
        "source_post": source_post,
        "speaker_handle": speaker_handle,
        "semantic_hints": semantic_hints[:6],
    }


def guess_event_tags(seg):
    text = " ".join([
        str(seg.get("text") or ""),
        str(seg.get("source_audio_text") or ""),
        str(seg.get("visual_summary") or ""),
        str(seg.get("ocr_text") or ""),
    ]).lower()
    tags = []
    keyword_map = {
        "systemic_warning": ["warning", "警告", "陷阱", "矩阵", "误区", "骗局"],
        "education_gap": ["教育", "education", "learn", "teaching"],
        "government_control": ["大政府", "government", "监管", "束缚", "control", "体制"],
        "freedom_demand": ["自由", "掌控", "决定", "autonomy", "free"],
        "autonomy": ["自主", "掌控", "自己的决定", "responsibility"],
        "price_target": ["目标价", "forecast", "price target", "25万美元", "250,000"],
        "bullish_forecast": ["看多", "bullish", "上涨", "target"],
        "policy_watch": ["后续", "观察", "政策", "watch", "future"],
    }
    for tag, tokens in keyword_map.items():
        if any(token in text for token in tokens):
            tags.append(tag)
    return normalize_string_list(tags or [guess_event_type(seg)])


def _clamp_score(value, lower=0.0, upper=10.0):
    return round(max(lower, min(upper, float(value))), 2)


def _looks_like_speaker_on_screen(seg, visual_type):
    summary = " ".join([
        str(seg.get("visual_summary") or ""),
    ]).lower()
    if str(seg.get("speaker") or "").strip().lower() not in {"", "unknown"}:
        return True
    if visual_type in {"interview", "speaker_quote", "stage_speech"}:
        return True
    return any(
        token in summary
        for token in [
            "speaks", "talks", "发言", "讲话", "对镜头", "interview",
            "close-up", "close up", "gesturing", "listening", "seated",
            "person", "individuals", "host", "guest", "desk", "studio",
            "主持人", "嘉宾", "坐在", "面对面",
        ]
    )


def build_rule_based_scored_payload(seg, index=0, total_segments=1, context=None):
    context = context or {}
    text = str(seg.get("text") or "").strip()
    source_audio_text = str(seg.get("source_audio_text") or "").strip()
    visual_summary = str(seg.get("visual_summary") or "").strip()
    ocr_text = str(seg.get("ocr_text") or "").strip()
    combined = " ".join([text, source_audio_text, visual_summary, ocr_text]).lower()
    visual_type = guess_visual_type(seg)
    event_type = guess_event_type(seg)
    event_tags = guess_event_tags(seg)
    polarity = guess_polarity(combined)
    duration_sec = float(seg.get("duration_sec") or 0.0)
    has_numbers = bool(re.search(r"\d", combined))
    is_sentence = bool(seg.get("is_complete_sentence"))
    visual_priority = bool(seg.get("visual_priority"))
    speaker_on_screen = _looks_like_speaker_on_screen(seg, visual_type)
    speaker_handle = str(context.get("speaker_handle") or "").strip()

    information_density = 4.8
    information_density += min(2.2, len(text) / 22.0)
    information_density += 0.8 if has_numbers else 0.0
    information_density += 0.9 if any(token in combined for token in ["警告", "自由", "教育", "比特币", "监管", "政府", "风险"]) else 0.0

    sentence_completeness = 6.0 if is_sentence else 4.2
    sentence_completeness += 0.8 if len(text) >= 14 else 0.0
    sentence_completeness -= 0.6 if text.endswith(("但是", "因为", "所以")) else 0.0

    visual_usability = 6.2
    visual_usability += 1.2 if visual_priority else 0.0
    visual_usability += 1.0 if speaker_on_screen else 0.0
    visual_usability += 0.8 if visual_type in {"interview", "speaker_quote", "stage_speech", "news_lower_third"} else 0.0
    visual_usability -= 0.8 if duration_sec > 7.5 else 0.0

    evidence_strength = 5.8
    evidence_strength += 1.4 if speaker_on_screen else 0.0
    evidence_strength += 0.9 if has_numbers else 0.0
    evidence_strength += 0.9 if any(tag in event_tags for tag in ["systemic_warning", "education_gap", "government_control", "freedom_demand", "autonomy", "price_target"]) else 0.0
    evidence_strength += 0.6 if visual_type in {"interview", "speaker_quote", "stage_speech"} else 0.0

    entity_clarity = 5.6
    entity_clarity += 0.8 if speaker_handle else 0.0
    entity_clarity += 0.7 if has_numbers else 0.0
    entity_clarity += 0.7 if any(token in combined for token in ["比特币", "btc", "bitcoin"]) else 0.0

    opening = 5.0 + (2.2 if index <= 1 else 0.0)
    opening += 1.1 if any(tag in event_tags for tag in ["systemic_warning", "price_target", "bullish_forecast"]) else 0.0
    main = 6.2 + (1.0 if speaker_on_screen else 0.0) + (0.8 if 2.0 <= duration_sec <= 6.5 else 0.0)
    closing = 4.2 + (2.0 if index >= max(0, total_segments - 3) else 0.0)
    closing += 1.0 if any(token in combined for token in ["后续", "观察", "总结", "因此", "所以"]) else 0.0

    total_score = information_density + sentence_completeness + visual_usability + evidence_strength
    priority = "high" if total_score >= 28.0 else ("medium" if total_score >= 23.0 else "low")
    recommended_roles = []
    if opening >= 7.0:
        recommended_roles.append("hook_evidence")
    if main >= 7.0:
        recommended_roles.append("main_evidence")
    if closing >= 7.0:
        recommended_roles.append("closing_evidence")
    if not recommended_roles:
        recommended_roles.append("main_evidence")

    evidence_type = "speaker_quote" if visual_type in {"interview", "speaker_quote", "stage_speech"} else (
        "news_lower_third" if visual_type == "news_lower_third" else "generic_broll"
    )

    reason_parts = []
    if speaker_on_screen:
        reason_parts.append("人物主讲画面清晰")
    if has_numbers:
        reason_parts.append("包含可引用的数字信息")
    if any(tag in event_tags for tag in ["systemic_warning", "government_control", "freedom_demand", "autonomy"]):
        reason_parts.append("观点表达直接，适合做证据插片")
    if not reason_parts:
        reason_parts.append("规则评分兜底生成")

    structured = {
        "content": {
            "asr_text": text,
            "ocr_text": ocr_text,
            "visual_summary": visual_summary,
            "semantic_text": "",
        },
        "entities": {
            "persons": ([{
                "name": speaker_handle,
                "confidence": 0.55,
                "source": ["source_post"],
            }] if speaker_handle else []),
            "orgs": [],
            "assets": ([{
                "name": "BTC",
                "alias": ["比特币", "Bitcoin"],
                "confidence": 0.72,
                "source": ["llm_derived"],
            }] if any(token in combined for token in ["比特币", "btc", "bitcoin"]) else []),
            "countries": [],
            "institutions": [],
            "topics": [],
        },
        "event": {
            "event_type": event_type,
            "event_tags": event_tags,
            "market_phase": "commentary" if event_type == "speaker_commentary" else "na",
            "polarity": polarity,
            "confidence": 0.6,
        },
        "evidence": {
            "evidence_type": evidence_type,
            "evidence_strength": _clamp_score(evidence_strength),
            "quote_directness": "direct" if speaker_on_screen else "na",
            "proof_targets": event_tags[:3],
            "is_primary_evidence": True,
        },
        "visual": {
            "visual_type": visual_type,
            "visual_usability": _clamp_score(visual_usability),
            "motion_level": "medium",
            "camera_stability": "stable",
            "subtitle_bar_present": bool(ocr_text),
            "chart_present": visual_type == "chart_data",
            "meeting_scene": visual_type == "meeting_scene",
            "market_screen_present": visual_type == "market_screen",
            "generic_broll_risk": 0.05 if speaker_on_screen else 0.28,
        },
        "speaker": {
            "speaker_name": speaker_handle,
            "speaker_role": "",
            "speaker_on_screen": speaker_on_screen,
            "speaker_matchable": speaker_on_screen or bool(speaker_handle),
        },
        "scores": {
            "information_density": _clamp_score(information_density),
            "sentence_completeness": _clamp_score(sentence_completeness),
            "visual_usability": _clamp_score(visual_usability),
            "evidence_strength": _clamp_score(evidence_strength),
            "entity_clarity": _clamp_score(entity_clarity),
            "position_suitability": {
                "opening": _clamp_score(opening),
                "main": _clamp_score(main),
                "closing": _clamp_score(closing),
            },
        },
        "recommendation": {
            "priority": priority,
            "recommended_roles": recommended_roles,
            "recommended_duration_sec": normalize_recommended_duration({
                "min": 1.8,
                "ideal": min(max(duration_sec, 2.4), 3.4),
                "max": min(max(duration_sec, 2.8), 4.2),
            }),
        },
        "reason": "；".join(reason_parts),
        "total_score": round(total_score, 2),
    }
    return structured


def merge_structured_segment(seg, scored, context=None):
    context = context or {}
    content = scored.get("content") if isinstance(scored.get("content"), dict) else {}
    entities = scored.get("entities") if isinstance(scored.get("entities"), dict) else {}
    event = scored.get("event") if isinstance(scored.get("event"), dict) else {}
    evidence = scored.get("evidence") if isinstance(scored.get("evidence"), dict) else {}
    visual = scored.get("visual") if isinstance(scored.get("visual"), dict) else {}
    speaker = scored.get("speaker") if isinstance(scored.get("speaker"), dict) else {}
    recommendation = scored.get("recommendation") if isinstance(scored.get("recommendation"), dict) else {}
    scores = scored.get("scores") if isinstance(scored.get("scores"), dict) else {}

    default_visual_type = str(visual.get("visual_type") or guess_visual_type(seg)).strip()
    visual_summary_text = str(content.get("visual_summary") or seg.get("visual_summary") or "").strip()
    raw_speaker_name = str(speaker.get("speaker_name") or seg.get("speaker") or "").strip()
    if raw_speaker_name.lower() in {"", "unknown", "未知"}:
        raw_speaker_name = ""
    speaker_name = raw_speaker_name or str(context.get("speaker_handle") or "").strip()
    speaker_visible_by_summary = _looks_like_speaker_on_screen(seg, default_visual_type.lower())
    if default_visual_type.lower() == "market_screen" and speaker_visible_by_summary:
        default_visual_type = "interview"
    persons = normalize_named_entities(entities.get("persons"))
    speaker_handle = str(context.get("speaker_handle") or "").strip()
    if persons and speaker_handle and speaker_visible_by_summary:
        visible_persons = [
            item
            for item in persons
            if not is_source_handle_entity(item, speaker_handle)
        ]
        if visible_persons:
            persons = visible_persons
    if not persons and speaker_handle and not speaker_visible_by_summary:
        persons = normalize_named_entities([{
            "name": speaker_handle,
            "confidence": 0.55,
            "source": ["source_post"],
        }])

    structured = {
        "content": {
            "asr_text": str(content.get("asr_text") or seg.get("text") or "").strip(),
            "ocr_text": str(content.get("ocr_text") or seg.get("ocr_text") or "").strip(),
            "visual_summary": visual_summary_text,
            "semantic_text": "",
        },
        "entities": {
            "persons": persons,
            "orgs": normalize_named_entities(entities.get("orgs")),
            "assets": normalize_named_entities(entities.get("assets"), with_alias=True),
            "countries": normalize_named_entities(entities.get("countries")),
            "institutions": normalize_named_entities(entities.get("institutions")),
            "topics": normalize_named_entities(entities.get("topics")),
        },
        "event": {
            "event_type": str(event.get("event_type") or guess_event_type(seg)).strip(),
            "event_tags": normalize_string_list(event.get("event_tags")),
            "market_phase": str(event.get("market_phase") or "na").strip().lower() or "na",
            "polarity": str(event.get("polarity") or guess_polarity(seg.get("text"))).strip().lower() or "na",
            "confidence": round(float(event.get("confidence", 0.75) or 0.75), 2),
        },
        "evidence": {
            "evidence_type": str(
                evidence.get("evidence_type")
                or ("speaker_quote" if default_visual_type.lower() in {"interview", "speaker_quote", "stage_speech"} else "generic_broll")
            ).strip(),
            "evidence_strength": round(float(evidence.get("evidence_strength", 6.5) or 6.5), 2),
            "quote_directness": str(evidence.get("quote_directness") or "na").strip().lower() or "na",
            "proof_targets": normalize_string_list(evidence.get("proof_targets")),
            "is_primary_evidence": bool(evidence.get("is_primary_evidence", True)),
        },
        "visual": {
            "visual_type": default_visual_type,
            "visual_usability": round(float(visual.get("visual_usability", scores.get("visual_usability", 6.5)) or 6.5), 2),
            "motion_level": str(visual.get("motion_level") or "medium").strip().lower() or "medium",
            "camera_stability": str(visual.get("camera_stability") or "mixed").strip().lower() or "mixed",
            "subtitle_bar_present": bool(visual.get("subtitle_bar_present", False)),
            "chart_present": bool(visual.get("chart_present", False)),
            "meeting_scene": bool(visual.get("meeting_scene", False)),
            "market_screen_present": bool(visual.get("market_screen_present", False)),
            "generic_broll_risk": round(float(visual.get("generic_broll_risk", 0.2) or 0.2), 2),
        },
        "speaker": {
            "speaker_name": speaker_name,
            "speaker_role": str(speaker.get("speaker_role") or "").strip(),
            "speaker_on_screen": bool(speaker.get("speaker_on_screen", speaker_visible_by_summary or speaker_name.lower() not in {"", "unknown"})),
            "speaker_matchable": bool(speaker.get("speaker_matchable", speaker_visible_by_summary or speaker_name.lower() not in {"", "unknown"})),
        },
        "scores": {
            "information_density": round(float(scores.get("information_density", 0) or 0), 2),
            "sentence_completeness": round(float(scores.get("sentence_completeness", 0) or 0), 2),
            "visual_usability": round(float(scores.get("visual_usability", 0) or 0), 2),
            "evidence_strength": round(float(scores.get("evidence_strength", evidence.get("evidence_strength", 0)) or 0), 2),
            "entity_clarity": round(float(scores.get("entity_clarity", 6.0) or 6.0), 2),
            "position_suitability": {
                "opening": round(float((scores.get("position_suitability") or {}).get("opening", 0) or 0), 2),
                "main": round(float((scores.get("position_suitability") or {}).get("main", 0) or 0), 2),
                "closing": round(float((scores.get("position_suitability") or {}).get("closing", 0) or 0), 2),
            },
        },
        "recommendation": {
            "priority": normalize_priority(recommendation.get("priority") or scored.get("recommendation")),
            "recommended_roles": normalize_string_list(recommendation.get("recommended_roles")),
            "recommended_duration_sec": normalize_recommended_duration(recommendation.get("recommended_duration_sec")),
        },
        "reason": str(scored.get("reason") or "").strip(),
    }
    structured["content"]["semantic_text"] = (
        str(content.get("semantic_text") or "").strip() or build_semantic_text(seg, structured, context)
    )
    return structured


def score_segments_with_llm(segments, client, model, allow_rule_fallback=True):
    """使用 LLM 对片段打分（支持多线程并行）"""
    key_count = 1
    if hasattr(client, "api_keys"):
        key_count = len(getattr(client, "api_keys", [""]))
    elif hasattr(client, "key_count"): # QwenClient
        key_count = getattr(client, "key_count")
    elif hasattr(client, "rotator"): # GeminiPool
        key_count = getattr(client.rotator, "count", 1)

    batch_size = max(1, int(os.getenv("MATERIAL_SCORING_LLM_BATCH_SIZE", "3") or 3))
    
    # 自动提升并发数：默认每个 Key 开启 2 个并行任务
    default_max_workers = 2 * key_count
    max_workers = max(1, int(os.getenv("MATERIAL_SCORING_MAX_WORKERS", str(default_max_workers)) or default_max_workers))
    request_timeout = max(60, int(os.getenv("MATERIAL_SCORING_REQUEST_TIMEOUT", "360") or 360))
    
    all_scored_segments = []
    batch_errors = []

    # 准备批次
    batches = []
    for offset in range(0, len(segments), batch_size):
        batches.append(segments[offset:offset + batch_size])

    print(f"   ℹ️ 准备并行评估: {len(segments)} 个片段, {len(batches)} 个批次, 并发数={max_workers}")

    batch_retries = get_batch_retry_count()

    def process_batch(batch, batch_index):
        segments_for_llm = []
        for seg in batch:
            segments_for_llm.append({
                "id": seg["id"],
                "duration_sec": seg["duration_sec"],
                "text": seg["text"],
                "source_audio_text": seg.get("source_audio_text", ""),
                "ocr_text": seg.get("ocr_text", ""),
                "visual_summary": seg.get("visual_summary", ""),
                "speaker": seg.get("speaker", ""),
                "has_strong_source_audio": seg.get("has_strong_source_audio", False)
            })

        prompt = SCORING_PROMPT.format(
            segments_json=json.dumps(segments_for_llm, ensure_ascii=False, indent=2)
        )

        last_error = ""
        for attempt in range(batch_retries + 1):
            try:
                response = generate_content(
                    client,
                    model=model,
                    contents=prompt,
                    response_mime_type="application/json",
                    retries=2,
                    request_timeout=request_timeout,
                    provider=get_scoring_llm_provider(),
                )
                response_text = response.text
                parsed = extract_json_from_response(response_text)
                batch_scored = parsed.get("segments", []) if isinstance(parsed, dict) else []
                if len(batch_scored) < len(batch):
                    raise ValueError(f"LLM returned {len(batch_scored)}/{len(batch)} scored segments")
                if attempt > 0:
                    print(f"   ✓ LLM 批次 {batch_index} 第 {attempt + 1} 次尝试成功")
                return {"status": "success", "index": batch_index, "scored": batch_scored, "count": len(batch)}
            except Exception as e:
                last_error = str(e)
                if "无法从响应中提取有效的 JSON" in last_error:
                    save_invalid_llm_response(batch_index, attempt + 1, locals().get("response_text", ""), last_error)
                if attempt < batch_retries:
                    print(f"   ⚠️ LLM 批次 {batch_index} 第 {attempt + 1} 次尝试失败，准备重试: {last_error}")

        return {"status": "error", "index": batch_index, "error": last_error, "offset": (batch_index-1)*batch_size}

    # 执行并行请求
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_batch = {
            executor.submit(process_batch, batch, i): i 
            for i, batch in enumerate(batches, start=1)
        }
        
        for future in as_completed(future_to_batch):
            batch_index = future_to_batch[future]
            try:
                result = future.result()
                if result["status"] == "success":
                    print(f"   ✓ LLM 批次 {result['index']} 完成: {len(result['scored'])}/{result['count']} 个片段")
                    all_scored_segments.extend(result["scored"])
                else:
                    if allow_rule_fallback:
                        print(f"   ⚠️ LLM 批次 {result['index']} 失败，将对该批次回退规则评分: {result['error']}")
                    else:
                        print(f"   ⚠️ LLM 批次 {result['index']} 失败，严格模式禁止回退: {result['error']}")
                    batch_errors.append({
                        "batch_index": result["index"],
                        "offset": result["offset"],
                        "error": result["error"],
                    })
            except Exception as e:
                print(f"   ❌ 线程执行异常 (批次 {batch_index}): {e}")
                batch_errors.append({
                    "batch_index": batch_index,
                    "offset": (batch_index-1)*batch_size,
                    "error": f"Thread exception: {e}",
                })

    return {
        "segments": all_scored_segments,
        "batch_errors": batch_errors,
    }


def main():
    """主函数"""
    emit_stage("score_material", "正在评估素材片段")
    strict_llm = require_llm_scoring()

    print("1. 正在读取素材片段...")

    segments_data = load_json("material_segments.json", {})
    if not segments_data:
        print("❌ 找不到 material_segments.json，请先运行 segment_material.py")
        return 1

    segments = segments_data.get("segments", [])
    if not segments:
        print("❌ 没有找到素材片段")
        return 1

    print(f"   ✓ 加载了 {len(segments)} 个片段")
    context = build_scoring_context()

    print("\n2. 正在调用 LLM 评估片段...")
    if strict_llm:
        print("   ✓ 当前模式: LLM 严格模式（禁止规则评分回退）")
    else:
        print("   ✓ 当前模式: 允许规则评分回退")

    client = create_scoring_llm_client()
    model = get_text_model()
    provider = get_scoring_llm_provider()
    print(f"   ✓ LLM provider: {provider}, model: {model}")

    scoring_meta = {
        "provider": provider,
        "model": model,
        "strict_llm": strict_llm,
        "llm_attempted": True,
        "llm_used": False,
        "fully_llm_scored": False,
        "fallback_used": False,
        "fallback_type": None,
        "decision_mode": "unknown",
        "batch_size": max(1, int(os.getenv("MATERIAL_SCORING_LLM_BATCH_SIZE", "1") or 1)),
        "request_timeout_sec": max(30, int(os.getenv("MATERIAL_SCORING_REQUEST_TIMEOUT", "240") or 240)),
        "batch_error_count": 0,
        "batch_errors": [],
        "llm_segment_ids": [],
        "fallback_segment_ids": [],
    }

    try:
        scored_result = score_segments_with_llm(
            segments,
            client,
            model,
            allow_rule_fallback=not strict_llm,
        )
        scored_segments = scored_result.get("segments", [])
        batch_errors = scored_result.get("batch_errors", [])
        scoring_meta["batch_error_count"] = len(batch_errors)
        scoring_meta["batch_errors"] = batch_errors

        print(f"   ✓ 评估完成: {len(scored_segments)} 个片段")
        if batch_errors and strict_llm:
            raise RuntimeError(f"LLM 批次失败 {len(batch_errors)} 次，严格模式禁止回退规则评分")
        if batch_errors:
            print(f"   ⚠️ 有 {len(batch_errors)} 个批次回退到规则评分")

        # 合并评分到原始片段
        scored_map = {s["id"]: s for s in scored_segments}
        total_segments = len(segments)
        missing_segment_ids = [seg["id"] for seg in segments if seg["id"] not in scored_map]
        if missing_segment_ids and strict_llm:
            raise RuntimeError(
                "LLM 未覆盖全部素材片段，严格模式禁止用规则评分补齐: "
                + ", ".join(missing_segment_ids[:8])
            )
        for index, seg in enumerate(segments):
            seg_id = seg["id"]
            if seg_id in scored_map:
                merged = merge_structured_segment(seg, scored_map[seg_id], context=context)
                seg.update(merged)
                seg["score_source"] = "llm"
                seg["scores"] = merged.get("scores", {})
                seg["total_score"] = round(
                    float(
                        scored_map[seg_id].get(
                            "total_score",
                            (
                                merged["scores"].get("information_density", 0)
                                + merged["scores"].get("sentence_completeness", 0)
                                + merged["scores"].get("visual_usability", 0)
                                + merged["scores"].get("evidence_strength", 0)
                            )
                        ) or 0
                    ),
                    2
                )
                seg["recommendation"] = merged.get("recommendation", {})
                seg["reason"] = merged.get("reason", "")
                scoring_meta["llm_segment_ids"].append(seg_id)
            else:
                if strict_llm:
                    raise RuntimeError(f"LLM 未返回片段 {seg_id} 的评分结果")
                fallback_payload = build_rule_based_scored_payload(
                    seg,
                    index=index,
                    total_segments=total_segments,
                    context=context,
                )
                merged = merge_structured_segment(seg, fallback_payload, context=context)
                seg.update(merged)
                seg["score_source"] = "rule_fallback"
                seg["scores"] = merged.get("scores", {})
                seg["total_score"] = round(float(fallback_payload.get("total_score", 0.0) or 0.0), 2)
                seg["recommendation"] = merged.get("recommendation", {})
                seg["reason"] = merged.get("reason", "") or "规则评分兜底"
                scoring_meta["fallback_segment_ids"].append(seg_id)

        scoring_meta["llm_used"] = bool(scoring_meta["llm_segment_ids"])
        scoring_meta["fallback_used"] = bool(scoring_meta["fallback_segment_ids"]) or bool(batch_errors)
        scoring_meta["fallback_type"] = "rule_scoring" if scoring_meta["fallback_used"] else None
        scoring_meta["fully_llm_scored"] = (
            len(scoring_meta["llm_segment_ids"]) == len(segments)
            and not scoring_meta["fallback_used"]
        )
        scoring_meta["decision_mode"] = (
            "llm_only"
            if scoring_meta["fully_llm_scored"]
            else "llm_with_rule_fallback"
        )

        # 按总分排序
        segments.sort(key=lambda x: x.get("total_score", 0), reverse=True)

        # 显示前5个高分片段
        print("\n   高分片段:")
        for seg in segments[:5]:
            score = seg.get("total_score", 0)
            recommendation = seg.get("recommendation", {})
            rec = recommendation.get("priority", "") if isinstance(recommendation, dict) else str(recommendation or "")
            print(f"      [{seg['id']}] 总分: {score}, 推荐: {rec}")
            print(f"          {seg['text'][:50]}...")

    except Exception as e:
        if strict_llm:
            print(f"❌ LLM 评估失败，严格模式已中止: {e}")
            return 1
        print(f"⚠️ LLM 评估整体失败，全部回退为规则评分: {e}")
        scoring_meta["batch_error_count"] = max(scoring_meta["batch_error_count"], 1)
        if not scoring_meta["batch_errors"]:
            scoring_meta["batch_errors"] = [{"batch_index": "all", "offset": 0, "error": str(e)}]
        total_segments = len(segments)
        for index, seg in enumerate(segments):
            fallback_payload = build_rule_based_scored_payload(
                seg,
                index=index,
                total_segments=total_segments,
                context=context,
            )
            merged = merge_structured_segment(seg, fallback_payload, context=context)
            seg.update(merged)
            seg["score_source"] = "rule_fallback"
            seg["scores"] = merged.get("scores", {})
            seg["total_score"] = round(float(fallback_payload.get("total_score", 0.0) or 0.0), 2)
            seg["recommendation"] = merged.get("recommendation", {})
            seg["reason"] = merged.get("reason", "") or "规则评分兜底"
            scoring_meta["fallback_segment_ids"].append(seg.get("id"))
        segments.sort(key=lambda x: x.get("total_score", 0), reverse=True)
        scoring_meta["llm_used"] = False
        scoring_meta["fully_llm_scored"] = False
        scoring_meta["fallback_used"] = True
        scoring_meta["fallback_type"] = "rule_scoring"
        scoring_meta["decision_mode"] = "rule_only_fallback"

    print("\n3. 正在保存结果...")

    output = {
        "total_segments": len(segments),
        "meta": scoring_meta,
        "segments": segments
    }

    if write_json("material_segments_scored.json", output):
        print("   ✓ 已保存: material_segments_scored.json")
        emit_result(
            "素材打分完成",
            scored_file="material_segments_scored.json",
            segments_count=len(segments)
        )
    else:
        print("❌ 保存失败")
        return 1

    print("\n✅ 素材打分完成")
    return 0


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SCORE_MATERIAL_FAILED",
        error_message="素材打分失败",
        error_stage="score_material",
        hint="请检查 material_segments.json 是否存在，以及 LLM 配置"
    ))
