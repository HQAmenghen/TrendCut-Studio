"""
Structured script builder skill.
"""

import re
from typing import Any, Dict, List

from .base import BaseSkill, SkillResult


class ScriptBuilderSkill(BaseSkill):
    name = "script_builder"

    def _sanitize_script_text(self, text: str) -> str:
        cleaned = " ".join(str(text or "").split()).strip()
        noise_patterns = [
            r"^好吧各位[，,。！!\s]*",
            r"^好了各位[，,。！!\s]*",
            r"^来试一试[，,。！!\s]*",
            r"^看看会发生什么[，,。！!\s]*",
            r"^这到底意味着什么[？?！!\s]*",
            r"^这背后到底意味着什么[？?！!\s]*",
            r"^好久没做俯卧撑了?[，,。！!\s]*",
        ]
        for pattern in noise_patterns:
            cleaned = re.sub(pattern, "", cleaned)
        cleaned = cleaned.replace("这到底意味着什么？", "")
        cleaned = cleaned.replace("这背后到底意味着什么？", "")
        cleaned = cleaned.strip("，。； ")
        return cleaned

    def _is_unstable_narration(self, narration: Dict[str, Any], outline: Dict[str, Any]) -> bool:
        sections = narration.get("script_sections") or []
        full_text = str(narration.get("full_text") or "").strip()
        if not sections or not full_text:
            return True
        if len(sections) >= 6:
            return True

        bad_signals = ["这。这", "。。", "先说结果。先说结果", "意味着什么？些", "守着他们的。双手多年", "这才是潜力。"]
        if any(token in full_text for token in bad_signals):
            return True

        outline_segments = outline.get("segments") or []
        if outline_segments and len(sections) > max(4, len(outline_segments)):
            return True

        short_count = sum(1 for item in sections if len(str(item.get("text") or "").strip()) <= 10)
        if short_count >= max(2, len(sections) // 2):
            return True
        return False

    def _get_target_unit_count(self, payload: Dict[str, Any]) -> int:
        content_type = str(
            payload.get("content_type")
            or payload.get("route", {}).get("content_type")
            or "fast_news"
        ).strip()
        mapping = {
            "fast_news": 4,
            "strong_conflict": 4,
            "deep_explainer": 5,
        }
        return mapping.get(content_type, 4)

    def _group_short_texts(self, texts: List[str], target_count: int) -> List[str]:
        cleaned = [
            self._sanitize_script_text(text)
            for text in texts
            if self._sanitize_script_text(text)
        ]
        if not cleaned:
            return []
        if len(cleaned) <= target_count:
            return cleaned

        groups: List[str] = []
        current_parts: List[str] = []
        remaining_items = len(cleaned)
        remaining_groups = max(1, target_count)

        for text in cleaned:
            current_parts.append(text)
            remaining_items -= 1
            desired_size = max(1, round((remaining_items + len(current_parts)) / remaining_groups))
            current_length = sum(len(part) for part in current_parts)
            should_flush = False

            if len(current_parts) >= desired_size:
                should_flush = True
            if current_length >= 26:
                should_flush = True
            if remaining_items < remaining_groups - 1:
                should_flush = True

            if should_flush:
                merged = "".join(current_parts)
                groups.append(merged)
                current_parts = []
                remaining_groups = max(1, remaining_groups - 1)

        if current_parts:
            groups.append("".join(current_parts))

        return groups

    def _apply_copywriting_guidance(
        self,
        script_units: List[Dict[str, Any]],
        guidance: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not guidance:
            return script_units

        hook_prefix = str(guidance.get("hook_prefix") or "").strip()
        explain_prefix = str(guidance.get("explain_prefix") or "").strip()
        ending_suffix = str(guidance.get("ending_suffix") or "").strip()
        voice_style = str(guidance.get("voice_style") or "").strip()
        sentence_max_chars = guidance.get("sentence_max_chars")
        avoid = list(guidance.get("avoid") or [])

        enhanced: List[Dict[str, Any]] = []
        for index, unit in enumerate(script_units):
            role = str(unit.get("role") or "explain").strip().lower()
            text = str(unit.get("text") or "").strip()
            if not text:
                continue
            if role == "hook" and hook_prefix and not text.startswith(hook_prefix):
                text = f"{hook_prefix}{text}"
            elif role == "explain" and index == 1 and explain_prefix and not text.startswith(explain_prefix):
                text = f"{explain_prefix}{text}"
            elif role == "ending" and ending_suffix and ending_suffix not in text:
                text = f"{text}{ending_suffix}"

            enhanced.append({
                **unit,
                "text": text,
                "copywriting_style": voice_style or unit.get("copywriting_style"),
                "sentence_max_chars": sentence_max_chars or unit.get("sentence_max_chars"),
                "copy_avoid": avoid or unit.get("copy_avoid") or [],
            })
        return enhanced

    def _build_from_narration(self, narration: Dict[str, Any]) -> List[Dict[str, Any]]:
        sections = narration.get("script_sections") or []
        grouped_texts = self._group_short_texts(
            [section.get("text") for section in sections],
            target_count=4,
        )
        units: List[Dict[str, Any]] = []
        total = len(grouped_texts)
        for index, text in enumerate(grouped_texts, start=1):
            role = "explain"
            if index == 1:
                role = "hook"
            elif index == total:
                role = "ending"

            units.append({
                "id": f"script_{index:03d}",
                "role": role,
                "text": self._sanitize_script_text(text),
                "audio_mode": "voiceover",
                "subtitle_mode": "follow_global",
            })
        return [unit for unit in units if unit["text"]]

    def _build_from_outline(self, outline: Dict[str, Any], target_count: int) -> List[Dict[str, Any]]:
        segments = outline.get("segments") or []
        grouped_texts = self._group_short_texts(
            [segment.get("summary") or segment.get("goal") for segment in segments],
            target_count=target_count,
        )
        units: List[Dict[str, Any]] = []
        total = len(grouped_texts)
        for index, summary in enumerate(grouped_texts, start=1):
            if not summary:
                continue
            role = "explain"
            if index == 1:
                role = "hook"
            elif index == total:
                role = "ending"
            units.append({
                "id": f"script_{index:03d}",
                "role": role,
                "text": self._sanitize_script_text(summary),
                "audio_mode": "voiceover",
                "subtitle_mode": "follow_global",
            })
        return units

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        narration = payload.get("narration") or {}
        outline = payload.get("outline") or {}
        copywriting = payload.get("copywriting") or {}
        target_count = self._get_target_unit_count(payload)
        prefer_outline = self._is_unstable_narration(narration, outline)

        script_units = []
        source = "outline" if prefer_outline else "narration"
        if not prefer_outline:
            script_units = self._build_from_narration(narration)
        if not script_units:
            script_units = self._build_from_outline(outline, target_count=target_count)
            source = "outline"
        elif len(script_units) > target_count:
            grouped_texts = self._group_short_texts(
                [unit.get("text") for unit in script_units],
                target_count=target_count,
            )
            regrouped_units: List[Dict[str, Any]] = []
            total = len(grouped_texts)
            for index, text in enumerate(grouped_texts, start=1):
                role = "explain"
                if index == 1:
                    role = "hook"
                elif index == total:
                    role = "ending"
                regrouped_units.append({
                    "id": f"script_{index:03d}",
                    "role": role,
                    "text": self._sanitize_script_text(text),
                    "audio_mode": "voiceover",
                    "subtitle_mode": "follow_global",
                })
            script_units = regrouped_units
        script_units = self._apply_copywriting_guidance(script_units, copywriting)

        return SkillResult(
            skill=self.name,
            version=self.version,
            output={
                "script_units": script_units,
            },
            meta={
                "status": "ready",
                "source": source,
                "message": "Structured script units generated.",
            },
        )
