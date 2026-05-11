"""Material cutaway selector skill."""

import json
import math
import os
import re
from typing import Any, Dict, List, Set

from llm_client import create_llm_client, generate_content, get_llm_provider

from .base import BaseSkill, SkillResult
from .prompt_skill_loader import load_prompt_text
from .vector_retriever import StructuredVectorRetriever


DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.6-plus"
DEFAULT_QWEN_CLIP_SELECTOR_MODEL = "qwen3.6-plus"

EVENT_TYPE_COMPATIBILITY = {
    "speaker_commentary": {"speaker_commentary", "macro_commentary", "market_reaction", "institutional_adoption", "allocation_signal"},
    "policy_passed": {"policy_passed", "speaker_commentary", "institutional_adoption", "regulation_signal"},
    "allocation_signal": {"allocation_signal", "macro_commentary", "speaker_commentary", "market_reaction"},
    "institutional_adoption": {"institutional_adoption", "speaker_commentary", "macro_commentary", "market_reaction"},
    "market_reaction": {"market_reaction", "speaker_commentary", "macro_commentary", "allocation_signal"},
    "macro_commentary": {"macro_commentary", "speaker_commentary", "market_reaction", "allocation_signal", "institutional_adoption"},
}

EVENT_TYPE_ALIASES = {
    "公开演讲": {"公开演讲", "speaker_commentary"},
    "政策表态": {"政策表态", "speaker_commentary", "policy_passed"},
    "市场研判": {"市场研判", "macro_commentary", "market_reaction", "speaker_commentary"},
    "前景展望": {"前景展望", "macro_commentary", "speaker_commentary", "market_reaction"},
    "机构表态": {"机构表态", "institutional_adoption", "speaker_commentary"},
}

EVENT_TAG_ALIASES = {
    "institutional_adoption": {"institutional_adoption", "adoption_phase", "bank_adoption", "banking_adoption", "institutional_endorsement"},
    "adoption_phase": {"adoption_phase", "institutional_adoption", "bank_adoption", "banking_adoption"},
    "bank_adoption": {"bank_adoption", "banking_adoption", "institutional_adoption", "adoption_phase"},
    "banking_adoption": {"banking_adoption", "bank_adoption", "institutional_adoption", "adoption_phase"},
    "bullish_forecast": {"bullish_forecast", "price_target", "sentiment_change"},
    "price_target": {"price_target", "bullish_forecast", "sentiment_change"},
    "sentiment_change": {"sentiment_change", "bullish_forecast", "price_target"},
    "buying_pressure": {"buying_pressure", "fomo", "market_reaction"},
    "fomo": {"fomo", "buying_pressure", "market_reaction"},
    "institutional_endorsement": {"institutional_endorsement", "brand_endorsement"},
    "brand_endorsement": {"brand_endorsement", "institutional_endorsement"},
    "asset_allocation": {"asset_allocation", "capital_flow", "aum_mention"},
    "capital_flow": {"capital_flow", "asset_allocation", "aum_mention"},
    "aum_mention": {"aum_mention", "capital_flow", "asset_allocation"},
    "user_acquisition": {"user_acquisition", "client_acquisition", "crypto_integration"},
    "client_acquisition": {"client_acquisition", "user_acquisition", "crypto_integration"},
    "loss_leader": {"loss_leader", "pricing_strategy", "market_share"},
    "pricing_strategy": {"pricing_strategy", "loss_leader", "price_war", "market_share"},
    "price_war": {"price_war", "pricing_strategy", "loss_leader", "market_share"},
    "market_share": {"market_share", "pricing_strategy", "client_acquisition"},
}

VISUAL_TYPE_COMPATIBILITY = {
    "speaker_quote": {"speaker_quote", "interview", "stage_speech"},
    "interview": {"interview", "speaker_quote", "stage_speech"},
    "news_lower_third": {"news_lower_third", "interview", "stage_speech", "market_screen"},
    "chart_data": {"chart_data", "market_screen", "news_lower_third"},
    "market_screen": {"market_screen", "chart_data", "news_lower_third"},
}

PERSON_ALIAS_GROUPS = (
    {"donald trump", "trump", "唐纳德特朗普", "唐纳德·特朗普", "特朗普", "川普"},
    {"elon musk", "musk", "elon", "埃隆马斯克", "埃隆·马斯克", "马斯克"},
    {"tom lee", "汤姆李", "汤姆·李", "tomlee"},
    {"michael saylor", "saylor", "迈克尔塞勒", "迈克尔·塞勒", "塞勒"},
    {"jerome powell", "powell", "杰罗姆鲍威尔", "杰罗姆·鲍威尔", "鲍威尔"},
)


def get_text_model() -> str:
    provider = get_llm_provider()
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    if provider == "qwen":
        return (
            os.getenv("QWEN_CLIP_SELECTOR_MODEL")
            or os.getenv("QWEN_SCORING_MODEL")
            or os.getenv("QWEN_TEXT_MODEL")
            or DEFAULT_QWEN_CLIP_SELECTOR_MODEL
            or DEFAULT_QWEN_MODEL
        )
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


class ClipSelectorSkill(BaseSkill):
    name = "clip_selector"

    CUTAWAY_PROMPT = load_prompt_text("clip_selector_skill.md")

    def _normalize_alias_key(self, value: Any) -> str:
        text = str(value or "").strip().lower()
        return re.sub(r"[\s\-_.·•,，:：'\"()]+", "", text)

    def _expand_person_aliases(self, values: Set[str]) -> Set[str]:
        expanded: Set[str] = set()
        normalized_values = {self._normalize_alias_key(item) for item in values if str(item or "").strip()}
        for item in values:
            text = str(item or "").strip().lower()
            if text:
                expanded.add(text)
                expanded.add(self._normalize_alias_key(text))
        for group in PERSON_ALIAS_GROUPS:
            normalized_group = {self._normalize_alias_key(item) for item in group}
            if normalized_values & normalized_group:
                expanded.update(item.lower() for item in group)
                expanded.update(normalized_group)
        return {item for item in expanded if item}

    def _expand_event_type_aliases(self, values: List[str]) -> Set[str]:
        expanded: Set[str] = set()
        for item in values:
            key = str(item or "").strip().lower()
            if not key:
                continue
            expanded.add(key)
            expanded.update(value.lower() for value in EVENT_TYPE_ALIASES.get(key, {key}))
        return expanded

    def _normalize_segments(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        for key in ("material_segments", "scored_segments", "segments"):
            if key in payload:
                value = payload.get(key) or []
                if isinstance(value, dict):
                    return list(value.get("segments") or [])
                if isinstance(value, list):
                    return value
        selected_segments = payload.get("selected_segments") or []
        if isinstance(selected_segments, dict):
            return list(selected_segments.get("segments") or [])
        if isinstance(selected_segments, list):
            return selected_segments
        return []

    def _normalize_string_list(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            return []
        normalized: List[str] = []
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

    def _entity_names(self, payload: Any) -> Set[str]:
        names: Set[str] = set()
        if not isinstance(payload, list):
            return names
        for item in payload:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip().lower()
                if name:
                    names.add(name)
                for alias in item.get("alias") or []:
                    alias_name = str(alias or "").strip().lower()
                    if alias_name:
                        names.add(alias_name)
            else:
                text = str(item or "").strip().lower()
                if text:
                    names.add(text)
        return names

    def _segment_entities(self, segment: Dict[str, Any]) -> Dict[str, Set[str]]:
        entities = segment.get("entities") or {}
        speaker = segment.get("speaker") if isinstance(segment.get("speaker"), dict) else {}
        person_names = self._entity_names(entities.get("persons"))
        speaker_name = str(speaker.get("speaker_name") or "").strip().lower()
        if speaker_name:
            person_names.add(speaker_name)
        return {
            "persons": self._expand_person_aliases(person_names),
            "orgs": self._entity_names(entities.get("orgs")) | self._entity_names(entities.get("institutions")),
            "assets": self._entity_names(entities.get("assets")),
        }

    def _segment_search_text(self, segment: Dict[str, Any]) -> str:
        content = segment.get("content") if isinstance(segment.get("content"), dict) else {}
        entities = segment.get("entities") if isinstance(segment.get("entities"), dict) else {}
        event = segment.get("event") if isinstance(segment.get("event"), dict) else {}
        parts = [
            str(segment.get("text") or "").strip(),
            str(segment.get("source_audio_text") or "").strip(),
            str(content.get("semantic_text") or "").strip(),
            str(content.get("asr_text") or "").strip(),
            str(content.get("ocr_text") or "").strip(),
            str(content.get("visual_summary") or segment.get("visual_summary") or "").strip(),
            str(event.get("event_type") or "").strip(),
            str(event.get("polarity") or "").strip(),
        ]
        for key in ("persons", "orgs", "institutions", "assets", "topics"):
            value = entities.get(key)
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        parts.append(str(item.get("name") or "").strip())
                        for alias in item.get("alias") or []:
                            parts.append(str(alias or "").strip())
                    else:
                        parts.append(str(item or "").strip())
        for tag in event.get("event_tags") or []:
            parts.append(str(tag or "").strip())
        return " ".join(part.lower() for part in parts if part)

    def _canonical_event_tags(self, values: Any) -> Set[str]:
        canonical: Set[str] = set()
        for item in self._normalize_string_list(values):
            key = item.strip().lower()
            if not key:
                continue
            canonical.add(key)
            canonical.update(EVENT_TAG_ALIASES.get(key, {key}))
        return canonical

    def _visual_type_score(self, expected_types: Set[str], actual_type: str) -> float:
        if not expected_types:
            return 0.8
        actual_type = str(actual_type or "").strip().lower()
        if not actual_type:
            return 0.35
        if actual_type in expected_types:
            return 1.0
        for expected in expected_types:
            if actual_type in VISUAL_TYPE_COMPATIBILITY.get(expected, {expected}):
                return 0.85
        return 0.35

    def _event_type_score(
        self,
        expected_types: List[str],
        actual_type: str,
        cosine_similarity: float,
        evidence_type: str = "",
    ) -> tuple[float, bool]:
        normalized_expected = [item.strip().lower() for item in expected_types if str(item or "").strip()]
        actual_type = str(actual_type or "").strip().lower()
        evidence_type = str(evidence_type or "").strip().lower()
        expanded_expected = self._expand_event_type_aliases(normalized_expected)
        expanded_actual = self._expand_event_type_aliases([actual_type]) if actual_type else set()
        expanded_evidence = self._expand_event_type_aliases([evidence_type]) if evidence_type else set()
        if not expanded_expected:
            return (0.65 if actual_type or evidence_type else 0.4), False
        if expanded_actual & expanded_expected:
            return 1.0, False
        if expanded_evidence & expanded_expected:
            return 0.92, False
        for expected in expanded_expected:
            if actual_type in EVENT_TYPE_COMPATIBILITY.get(expected, {expected}) or expanded_actual & EVENT_TYPE_COMPATIBILITY.get(expected, {expected}):
                return 0.8, False
        if actual_type and cosine_similarity >= 0.74:
            return 0.55, False
        return 0.0, True

    def _speaker_visual_score(self, preferred: Dict[str, Any], visual: Dict[str, Any], speaker: Dict[str, Any]) -> tuple[float, bool]:
        if not preferred.get("speaker_on_screen"):
            return 1.0, False

        if bool(speaker.get("speaker_on_screen")):
            return 1.0, False

        visual_type = str(visual.get("visual_type") or "").strip().lower()
        speaker_name = str(speaker.get("speaker_name") or "").strip()
        subtitle_present = bool(visual.get("subtitle_bar_present"))
        speaker_matchable = bool(speaker.get("speaker_matchable"))
        interview_like = visual_type in {"interview", "speaker_quote", "stage_speech"}

        # 当前打分链有一批采访镜头被误标成 speaker_on_screen=false。
        # 对采访/发言类画面，用人物名、字幕条和可匹配性兜底，避免整批证据镜头被误杀。
        if interview_like and (speaker_name or subtitle_present or speaker_matchable):
            return 0.82, False

        return 0.2, True

    def _priority_value(self, value: str) -> float:
        return {
            "high": 1.0,
            "medium": 0.75,
            "low": 0.45,
            "none": 0.0,
        }.get(str(value or "").strip().lower(), 0.5)

    def _position_key(self, role: str) -> str:
        role = str(role or "").strip().lower()
        if role == "hook":
            return "opening"
        if role == "ending":
            return "closing"
        return "main"

    def _compute_rule_match(self, unit: Dict[str, Any], segment: Dict[str, Any], cosine_similarity: float) -> Dict[str, Any]:
        evidence = unit.get("evidence") or {}
        must_match = evidence.get("must_match") or {}
        preferred = evidence.get("preferred_match") or {}
        negative = evidence.get("negative_constraints") or {}
        segment_evidence = segment.get("evidence") if isinstance(segment.get("evidence"), dict) else {}
        segment_entities = self._segment_entities(segment)
        segment_search_text = self._segment_search_text(segment)
        event = segment.get("event") if isinstance(segment.get("event"), dict) else {}
        visual = segment.get("visual") if isinstance(segment.get("visual"), dict) else {}
        speaker = segment.get("speaker") if isinstance(segment.get("speaker"), dict) else {}
        scores = segment.get("scores") or {}
        reject_reasons: List[str] = []

        def overlap_score(expected: List[str], actual: Set[str], label: str, hard: bool = True) -> float:
            expected_set = {item.strip().lower() for item in expected if str(item or "").strip()}
            actual_set = set(actual)
            if label == "person":
                expected_set = self._expand_person_aliases(expected_set)
                actual_set = self._expand_person_aliases(actual_set)
            if not expected_set:
                return 0.65
            if actual_set & expected_set:
                return 1.0
            if any(item in segment_search_text for item in expected_set):
                return 0.75 if hard else 0.7
            expected_tokens: Set[str] = set()
            for item in expected_set:
                expected_tokens.update(self._tokenize(item))
            actual_tokens: Set[str] = set(actual_set)
            for item in actual_set:
                actual_tokens.update(self._tokenize(item))
            search_tokens = self._tokenize(segment_search_text)
            if expected_tokens & (actual_tokens | search_tokens):
                return 0.7 if hard else 0.66
            if hard and label == "person":
                visual_type = str(visual.get("visual_type") or "").strip().lower()
                speaker_visible = bool(speaker.get("speaker_on_screen") or speaker.get("speaker_matchable"))
                if not actual and visual_type in {"interview", "speaker_quote", "stage_speech"} and speaker_visible and cosine_similarity >= 0.6:
                    return 0.55
            if hard:
                reject_reasons.append(f"{label}_mismatch")
            return 0.0

        persons_score = overlap_score(self._normalize_string_list(must_match.get("persons")), segment_entities["persons"], "person")
        orgs_score = overlap_score(self._normalize_string_list(must_match.get("orgs")), segment_entities["orgs"], "org")
        assets_score = overlap_score(self._normalize_string_list(must_match.get("assets")), segment_entities["assets"], "asset", hard=False)

        expected_event_types = self._normalize_string_list(must_match.get("event_types"))
        event_type = str(event.get("event_type") or "").strip()
        event_type_score, event_type_reject = self._event_type_score(
            expected_event_types,
            event_type,
            cosine_similarity,
            str(segment_evidence.get("evidence_type") or ""),
        )
        if event_type_reject:
            reject_reasons.append("event_type_mismatch")

        expected_tags = self._canonical_event_tags(must_match.get("event_tags"))
        actual_tags = self._canonical_event_tags(event.get("event_tags") or [])
        if expected_tags:
            overlap = len(expected_tags & actual_tags)
            event_tag_score = min(1.0, overlap / max(1, len(expected_tags)))
            if overlap == 0:
                if cosine_similarity >= 0.72 and actual_tags:
                    event_tag_score = 0.45
                else:
                    reject_reasons.append("event_tag_mismatch")
        else:
            event_tag_score = 0.6 if actual_tags else 0.4

        required_polarity = str(must_match.get("polarity") or "na").strip().lower()
        actual_polarity = str(event.get("polarity") or "na").strip().lower()
        if required_polarity in {"bullish", "bearish"}:
            if actual_polarity in {required_polarity, "mixed"}:
                polarity_score = 1.0 if actual_polarity == required_polarity else 0.7
            elif actual_polarity == "na":
                interview_like = str(visual.get("visual_type") or "").strip().lower() in {"interview", "speaker_quote", "stage_speech"}
                speaker_visible = bool(speaker.get("speaker_on_screen") or speaker.get("speaker_matchable"))
                if cosine_similarity >= 0.3 and (interview_like or speaker_visible):
                    polarity_score = 0.55
                else:
                    polarity_score = 0.0
                    reject_reasons.append("polarity_conflict")
            else:
                polarity_score = 0.0
                reject_reasons.append("polarity_conflict")
        else:
            polarity_score = 0.7 if actual_polarity != "na" else 0.5

        preferred_visual_types = {item.strip().lower() for item in self._normalize_string_list(preferred.get("visual_types"))}
        visual_type = str(visual.get("visual_type") or "").strip().lower()
        visual_type_score = self._visual_type_score(preferred_visual_types, visual_type)
        speaker_score, speaker_reject = self._speaker_visual_score(preferred, visual, speaker)
        if speaker_reject:
            reject_reasons.append("speaker_not_on_screen")

        forbidden_persons = {item.strip().lower() for item in self._normalize_string_list(negative.get("forbid_persons"))}
        if forbidden_persons and segment_entities["persons"] & forbidden_persons:
            reject_reasons.append("forbidden_person")
        forbidden_visual_types = {item.strip().lower() for item in self._normalize_string_list(negative.get("forbid_visual_types"))}
        generic_broll_penalty = 0.0
        if forbidden_visual_types and visual_type in forbidden_visual_types:
            reject_reasons.append("forbidden_visual_type")
            # 访谈/发言类素材被分类为 generic_broll 时，说话人画面本身就是有价值的证据。
            # 如果说话人可见或画面有字幕条，大幅降低惩罚。
            speaker_on = bool(speaker.get("speaker_on_screen") or speaker.get("speaker_matchable"))
            subtitle_present = bool(visual.get("subtitle_bar_present"))
            if speaker_on or subtitle_present:
                generic_broll_penalty += 0.06
            else:
                generic_broll_penalty += 0.25
        forbidden_polarity = {item.strip().lower() for item in self._normalize_string_list(negative.get("forbid_polarity"))}
        if forbidden_polarity and actual_polarity in forbidden_polarity:
            reject_reasons.append("forbidden_polarity")

        evidence_strength_score = min(1.0, max(0.0, float((segment.get("evidence") or {}).get("evidence_strength", 0.0) or 0.0) / 10.0))
        visual_usability_score = min(1.0, max(0.0, float(visual.get("visual_usability", scores.get("visual_usability", 0.0)) or 0.0) / 10.0))
        position_fit_score = min(1.0, max(0.0, float((scores.get("position_suitability") or {}).get(self._position_key(unit.get("role")), 0.0) or 0.0) / 10.0))
        generic_broll_penalty += max(0.0, float(visual.get("generic_broll_risk", 0.0) or 0.0)) * 0.15

        final_score = (
            0.40 * max(0.0, cosine_similarity)
            + 0.10 * persons_score
            + 0.08 * orgs_score
            + 0.10 * assets_score
            + 0.08 * event_type_score
            + 0.07 * event_tag_score
            + 0.07 * polarity_score
            + 0.04 * visual_type_score
            + 0.03 * speaker_score
            + 0.08 * evidence_strength_score
            + 0.03 * visual_usability_score
            + 0.02 * position_fit_score
            - generic_broll_penalty
        )
        if reject_reasons:
            final_score -= min(0.55, 0.12 * len(reject_reasons))
        final_score = max(0.0, min(1.0, final_score))
        return {
            "reject_reasons": reject_reasons,
            "scores": {
                "cosine_similarity": round(float(cosine_similarity), 4),
                "entity_match_score": round((persons_score + orgs_score + assets_score) / 3.0, 4),
                "event_match_score": round((event_type_score + event_tag_score) / 2.0, 4),
                "polarity_match_score": round(polarity_score, 4),
                "visual_type_match_score": round(visual_type_score, 4),
                "speaker_match_score": round(speaker_score, 4),
                "evidence_strength_score": round(evidence_strength_score, 4),
                "visual_usability_score": round(visual_usability_score, 4),
                "position_fit_score": round(position_fit_score, 4),
                "repetition_penalty": 0.0,
                "generic_broll_penalty": round(generic_broll_penalty, 4),
                "final_score": round(final_score, 4),
            },
        }

    def _recommended_duration(self, unit: Dict[str, Any], segment: Dict[str, Any]) -> float:
        evidence = unit.get("evidence") or {}
        duration_hint = evidence.get("duration_hint") or {}
        recommendation = segment.get("recommendation") or {}
        if not isinstance(recommendation, dict):
            recommendation = {}
        recommended = recommendation.get("recommended_duration_sec") or {}
        seg_duration = float(segment.get("duration_sec") or (
            float(segment.get("end", segment.get("end_time", 0.0)) or 0.0)
            - float(segment.get("start", segment.get("start_time", 0.0)) or 0.0)
        ) or 0.0)

        # 素材优先：短视频需要持续视觉刺激。访谈/发言类素材本身承载信息，
        # 可以比普通 B-roll 停留更久。
        visual = segment.get("visual") if isinstance(segment.get("visual"), dict) else {}
        visual_type = str(visual.get("visual_type") or "").strip().lower()
        speaker = segment.get("speaker") if isinstance(segment.get("speaker"), dict) else {}
        interview_like = visual_type in {"interview", "speaker_quote", "stage_speech"}
        speaker_visible = bool(speaker.get("speaker_on_screen") or speaker.get("speaker_matchable"))
        if interview_like or speaker_visible:
            default_lower = 5.0
            default_ideal = 7.0
            default_upper = 8.0
        else:
            default_lower = 4.0
            default_ideal = 5.5
            default_upper = 6.5

        raw_ideal = float(duration_hint.get("ideal", recommended.get("ideal", default_ideal)) or default_ideal)
        raw_lower = float(duration_hint.get("min", recommended.get("min", default_lower)) or default_lower)
        raw_upper = float(duration_hint.get("max", recommended.get("max", default_upper)) or default_upper)
        lower = max(default_lower, raw_lower)
        ideal = max(default_ideal, raw_ideal)
        upper = max(default_upper, raw_upper, lower)
        target = max(lower, min(upper, ideal))
        if seg_duration > 0:
            target = min(seg_duration, target)
        return round(max(0.5, target), 2)

    def _tokenize(self, text: str) -> Set[str]:
        cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", " ", str(text or "").lower())
        parts = [item.strip() for item in cleaned.split() if item.strip()]
        tokens: Set[str] = set()
        for part in parts:
            if len(part) > 1:
                tokens.add(part)
                for chunk in re.findall(r"[a-z]+", part):
                    if len(chunk) > 1:
                        tokens.add(chunk)
            if re.search(r"[\u4e00-\u9fff]", part):
                tokens.update(ch for ch in part if re.search(r"[\u4e00-\u9fff]", ch))
        return tokens

    def _score_match(self, unit: Dict[str, Any], segment: Dict[str, Any]) -> float:
        unit_text = str(unit.get("text") or "").strip()
        seg_text = " ".join([
            str(segment.get("text") or "").strip(),
            str(segment.get("summary") or "").strip(),
            str(segment.get("reason") or "").strip(),
        ]).strip()

        unit_tokens = self._tokenize(unit_text)
        seg_tokens = self._tokenize(seg_text)
        overlap = len(unit_tokens & seg_tokens)

        base_score = float(segment.get("total_score", 0) or 0)
        role = str(unit.get("role") or "").strip().lower()
        segment_role = str(segment.get("role") or "").strip().lower()
        exact_bonus = 2.0 if unit_text and unit_text[:8] and unit_text[:8] in seg_text else 0.0
        role_bonus = 0.0
        if role == "hook" and "opening" in segment_role:
            role_bonus += 2.0
        if role == "ending" and "closing" in segment_role:
            role_bonus += 2.0
        if role == "explain" and "main" in segment_role:
            role_bonus += 1.5

        return base_score + overlap * 2.5 + exact_bonus + role_bonus

    def _extract_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except Exception:
            pass
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise ValueError("无法从 LLM 响应中提取 JSON")

    def _llm_cutaway_decisions(
        self,
        script_units: List[Dict[str, Any]],
        segments: List[Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        client = create_llm_client()
        model = get_text_model()

        script_payload = [
            {
                "script_ref": item.get("id"),
                "role": item.get("role"),
                "text": item.get("text"),
            }
            for item in script_units
        ]
        segment_payload = [
            {
                "segment_id": item.get("id"),
                "text": item.get("text"),
                "summary": item.get("summary"),
                "reason": item.get("reason"),
                "duration_sec": item.get("duration_sec"),
                "total_score": item.get("total_score"),
                "role": item.get("role"),
            }
            for item in segments
        ]
        prompt = self.CUTAWAY_PROMPT.format(
            script_units_json=json.dumps(script_payload, ensure_ascii=False, indent=2),
            segments_json=json.dumps(segment_payload, ensure_ascii=False, indent=2),
        )
        response = generate_content(
            client,
            model=model,
            contents=prompt,
            response_mime_type="application/json",
            retries=2,
            request_timeout=90,
        )
        data = self._extract_json(response.text)
        decisions = {}
        for item in data.get("decisions") or []:
            script_ref = str(item.get("script_ref") or "").strip()
            if script_ref:
                decisions[script_ref] = item
        return decisions

    def _estimate_cutaway_score(
        self,
        unit: Dict[str, Any],
        best_segment: Dict[str, Any] | None,
        match_score: float,
    ) -> float:
        role = str(unit.get("role") or "").strip().lower()
        text = str(unit.get("text") or "").strip()
        score = 0.0

        if role == "hook":
            score += 3.2
        elif role == "explain":
            score += 1.4
        elif role == "ending":
            score -= 1.0

        if len(text) <= 24:
            score += 1.0
        elif len(text) >= 60:
            score -= 0.8

        emphasis_signals = ["关键", "重点", "信号", "结果", "画面", "动作", "现场", "瞬间", "变化", "反应"]
        score += sum(0.35 for token in emphasis_signals if token in text)

        if best_segment:
            duration = float(
                best_segment.get("duration_sec")
                or (
                    float(best_segment.get("end", best_segment.get("end_time", 0.0)) or 0.0)
                    - float(best_segment.get("start", best_segment.get("start_time", 0.0)) or 0.0)
                )
                or 0.0
            )
            if duration >= 1.0:
                score += 0.8
            if duration >= 2.0:
                score += 0.4
            score += min(3.0, match_score / 8.0)

        return round(score, 2)

    def _cutaway_limit(self, script_units: List[Dict[str, Any]], route: Dict[str, Any], editing_style: Dict[str, Any]) -> int:
        explicit = editing_style.get("constraints", {}).get("max_cutaway_count")
        if explicit is not None:
            return max(1, int(explicit))
        content_type = str(route.get("content_type") or "fast_news").strip()
        base = {
            "fast_news": 8,
            "strong_conflict": 9,
            "deep_explainer": 6,
        }.get(content_type, 8)
        return max(1, min(base, len(script_units)))

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        script_units = list((payload.get("script_units") or []))
        segments = self._normalize_segments(payload)
        route = payload.get("route") or {}
        editing_style = payload.get("editing_style") or {}
        llm_error = None
        cutaway_limit = self._cutaway_limit(script_units, route, editing_style)
        retrieval_candidates = []
        matches: List[Dict[str, Any]] = []

        if not script_units or not segments:
            return SkillResult(
                skill=self.name,
                version=self.version,
                output={
                    "clip_matches": [],
                    "retrieval_candidates": [],
                    "cutaway_limit": cutaway_limit,
                    "decision_meta": {
                        "provider": "qwen" if get_llm_provider() == "qwen" else get_llm_provider(),
                        "model": get_text_model(),
                        "llm_error": None,
                        "decision_mode": "vector+rules",
                    },
                },
                meta={
                    "status": "ready",
                    "message": "No script units or material segments available for cutaway matching.",
                    "decision_mode": "vector+rules",
                },
            )

        retriever = StructuredVectorRetriever(top_k=int(os.getenv("SMART_CLIP_VECTOR_TOP_K", "5") or 5))
        retrieval_result = retriever.retrieve(script_units, segments)
        segment_map = {str(item.get("id") or ""): item for item in segments if item.get("id")}
        retrieval_candidates = retrieval_result.get("retrievals") or []

        ranked_units: List[Dict[str, Any]] = []
        for unit in script_units:
            script_ref = str(unit.get("id") or "")
            priority = self._priority_value((unit.get("evidence") or {}).get("insert_priority"))
            candidates = []
            for candidate in retrieval_result.get("by_script", {}).get(script_ref, []):
                segment = segment_map.get(str(candidate.get("segment_id") or ""))
                if not segment:
                    continue
                rule_result = self._compute_rule_match(unit, segment, float(candidate.get("cosine_similarity") or 0.0))
                candidates.append({
                    "segment": segment,
                    "segment_id": segment.get("id"),
                    "rule_result": rule_result,
                    "cosine_similarity": float(candidate.get("cosine_similarity") or 0.0),
                    "vector_rank": int(candidate.get("vector_rank") or 0),
                })
            candidates.sort(
                key=lambda item: (
                    float(item["rule_result"]["scores"].get("final_score") or 0.0),
                    float(item.get("cosine_similarity") or 0.0),
                ),
                reverse=True,
            )
            best_candidate = candidates[0] if candidates else None
            ranked_units.append({
                "script_ref": script_ref,
                "role": unit.get("role"),
                "unit": unit,
                "priority": priority,
                "candidates": candidates,
                "best_score": float((best_candidate or {}).get("rule_result", {}).get("scores", {}).get("final_score") or 0.0),
            })

        ranked_units.sort(
            key=lambda item: (
                float(item.get("priority") or 0.0),
                float(item.get("best_score") or 0.0),
            ),
            reverse=True,
        )

        assigned_segments: Set[str] = set()
        assignment_map: Dict[str, Dict[str, Any]] = {}
        for item in ranked_units:
            chosen = None
            for candidate in item.get("candidates") or []:
                segment_id = str(candidate.get("segment_id") or "")
                if segment_id and segment_id not in assigned_segments:
                    chosen = candidate
                    break
            if chosen is None and item.get("candidates"):
                chosen = item["candidates"][0]
            if chosen is not None:
                segment_id = str(chosen.get("segment_id") or "")
                if segment_id:
                    assigned_segments.add(segment_id)
                assignment_map[str(item.get("script_ref") or "")] = chosen

        selected_script_refs: Set[str] = set()
        for item in ranked_units:
            script_ref = str(item.get("script_ref") or "")
            chosen = assignment_map.get(script_ref)
            if not chosen:
                continue
            role = str(item.get("role") or "").strip().lower()
            priority = float(item.get("priority") or 0.0)
            final_score = float(chosen["rule_result"]["scores"].get("final_score") or 0.0)
            if priority <= 0.0:
                continue
            if len(selected_script_refs) >= cutaway_limit:
                break

            # 核心逻辑：素材是口播稿的证据，insert_priority > 0 且有匹配段时默认插入。
            # 只有以下情况排除：
            #  - ending 段且分数极低（< 0.30）
            #  - 存在无法忽略的硬性拒绝理由（forbidden_person / forbidden_polarity 等）
            # forbidden_visual_type / speaker_not_on_screen / event_tag_mismatch 均可忽略：
            #   访谈类视频的说话人画面本身就是有价值的证据内容，不应因为被分类为
            #   generic_broll 而被拒绝。
            if role == "ending" and len(script_units) > 2 and final_score < 0.30:
                continue
            ignorable_rejects = {
                "speaker_not_on_screen",
                "event_tag_mismatch",
                "forbidden_visual_type",
                "person_mismatch",
                "org_mismatch",
            }
            hard_rejects = {
                reason
                for reason in (chosen["rule_result"]["reject_reasons"] or [])
                if reason not in ignorable_rejects
            }
            if hard_rejects and final_score < 0.60:
                continue
            selected_script_refs.add(script_ref)

        for item in ranked_units:
            script_ref = str(item.get("script_ref") or "")
            unit = item.get("unit") or {}
            chosen = assignment_map.get(script_ref)
            segment = chosen.get("segment") if chosen else None
            rule_result = chosen.get("rule_result") if chosen else {"scores": {}, "reject_reasons": []}
            final_score = float((rule_result.get("scores") or {}).get("final_score") or 0.0)
            use_cutaway = script_ref in selected_script_refs and segment is not None
            segment_id = segment.get("id") if segment else None
            segment_event = segment.get("event") if isinstance(segment, dict) and isinstance(segment.get("event"), dict) else {}
            segment_visual = segment.get("visual") if isinstance(segment, dict) and isinstance(segment.get("visual"), dict) else {}
            segment_speaker = segment.get("speaker") if isinstance(segment, dict) and isinstance(segment.get("speaker"), dict) else {}
            match_payload = {
                "script_ref": script_ref,
                "role": unit.get("role"),
                "segment_id": segment_id,
                "score": round(float((chosen or {}).get("cosine_similarity") or 0.0), 4),
                "cutaway_score": round(final_score * 10.0, 2),
                "source_ref": "material.mp4" if segment else None,
                "material_cut_start": segment.get("start") if segment else None,
                "material_cut_end": segment.get("end") if segment else None,
                "recommended_duration": self._recommended_duration(unit, segment) if segment else 0.0,
                "use_cutaway": use_cutaway,
                "decision_reason": (
                    "selected_for_cutaway" if use_cutaway else (";".join(rule_result.get("reject_reasons") or []) or "keep_avatar_full")
                ),
                "text": segment.get("text") if segment else None,
                "decision_source": "vector+rules",
                "scores": rule_result.get("scores") or {},
                "matched_evidence": {
                    "speaker_name": segment_speaker.get("speaker_name") if segment_speaker else None,
                    "visual_type": segment_visual.get("visual_type") if segment_visual else None,
                    "event_tags": (segment_event or {}).get("event_tags") or [],
                    "polarity": (segment_event or {}).get("polarity"),
                    "evidence_type": (segment.get("evidence") or {}).get("evidence_type") if segment else None,
                },
                "reject_reasons": rule_result.get("reject_reasons") or [],
            }
            matches.append(match_payload)

        return SkillResult(
            skill=self.name,
            version=self.version,
            output={
                "clip_matches": matches,
                "retrieval_candidates": retrieval_candidates,
                "cutaway_limit": cutaway_limit,
                "decision_meta": {
                    "provider": "qwen" if retrieval_result.get("decision_meta", {}).get("retrieval_method") == "qwen_embedding" else "local",
                    "model": retrieval_result.get("decision_meta", {}).get("embedding_model") or get_text_model(),
                    "llm_error": retrieval_result.get("decision_meta", {}).get("retrieval_error") or llm_error,
                    "decision_mode": "vector+rules",
                },
            },
            meta={
                "status": "ready",
                "message": "Structured vector retrieval and rule reranking completed.",
                "llm_error": retrieval_result.get("decision_meta", {}).get("retrieval_error") or llm_error,
                "decision_mode": "vector+rules",
            },
        )
