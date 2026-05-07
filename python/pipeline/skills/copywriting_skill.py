"""
Copywriting skill now acts as a lightweight metadata pass-through.

Narration wording is owned by ScriptRewriterSkill / LLM native output.
"""

from typing import Any, Dict, List

from .base import BaseSkill, SkillResult


class CopywritingSkill(BaseSkill):
    name = "copywriting_skill"

    def _annotate_units(self, payload: Dict[str, Any], script_units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        content_type = str(
            payload.get("content_type")
            or payload.get("route", {}).get("content_type")
            or "fast_news"
        ).strip()
        voice_style = {
            "fast_news": "direct",
            "strong_conflict": "tense",
            "deep_explainer": "calm",
        }.get(content_type, "direct")

        annotated: List[Dict[str, Any]] = []
        for unit in script_units:
            text = str(unit.get("text") or "").strip()
            if not text:
                continue
            annotated.append({
                **unit,
                "text": text,
                "copywriting_style": voice_style,
            })
        return annotated

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        script_units = list(payload.get("script_units") or [])
        enhanced_units = self._annotate_units(payload, script_units)

        return SkillResult(
            skill=self.name,
            version=self.version,
            output={
                "guidance": {
                    "mode": "llm_native_only",
                    "message": "CopywritingSkill no longer injects template wording.",
                },
                "script_units": enhanced_units or script_units,
            },
            meta={
                "status": "ready",
                "message": "CopywritingSkill kept LLM native wording unchanged.",
            },
        )
