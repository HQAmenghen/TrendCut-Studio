"""
Editing style skill for timeline pacing and block strategy.
"""

from typing import Any, Dict

from .base import BaseSkill, SkillResult


STYLE_PRESETS = {
    "fast_news": {
        "style_id": "avatar_commentary_v1",
        "subtitle_style_id": "news_clean",
        "constraints": {
            "min_source_ratio": 0.35,
            "target_source_ratio": 0.44,
            "max_source_ratio": 0.52,
            "min_single_clip_sec": 4.0,
            "min_hook_clip_sec": 4.5,
            "min_explain_clip_sec": 6.0,
            "max_single_clip_sec": 8.0,
            "min_avatar_ratio": 0.42,
            "min_cut_interval_sec": 4.0,
            "max_cut_interval_sec": 8.0,
            "max_cutaway_count": 8,
        },
        "role_block_types": {
            "hook": "evidence_clip",
            "explain": "avatar_talk",
            "ending": "avatar_talk",
        },
        "role_layouts": {
            "hook": "cutaway_silent",
            "explain": "avatar_full",
            "ending": "avatar_full",
        },
        "audio_strategy": {
            "hook": "voiceover_only",
            "explain": "voiceover_only",
            "ending": "voiceover_only",
        },
    },
    "strong_conflict": {
        "style_id": "avatar_commentary_v1",
        "subtitle_style_id": "conflict_emphasis",
        "constraints": {
            "min_source_ratio": 0.38,
            "target_source_ratio": 0.46,
            "max_source_ratio": 0.55,
            "min_single_clip_sec": 4.0,
            "min_hook_clip_sec": 4.5,
            "min_explain_clip_sec": 6.0,
            "max_single_clip_sec": 8.0,
            "min_avatar_ratio": 0.38,
            "min_cut_interval_sec": 4.0,
            "max_cut_interval_sec": 8.0,
            "max_cutaway_count": 9,
        },
        "role_block_types": {
            "hook": "evidence_clip",
            "explain": "avatar_talk",
            "ending": "avatar_talk",
        },
        "role_layouts": {
            "hook": "cutaway_silent",
            "explain": "avatar_full",
            "ending": "avatar_full",
        },
        "audio_strategy": {
            "hook": "voiceover_only",
            "explain": "voiceover_only",
            "ending": "voiceover_only",
        },
    },
    "deep_explainer": {
        "style_id": "avatar_commentary_v1",
        "subtitle_style_id": "explainer_clean",
        "constraints": {
            "min_source_ratio": 0.30,
            "target_source_ratio": 0.38,
            "max_source_ratio": 0.48,
            "min_single_clip_sec": 4.0,
            "min_hook_clip_sec": 4.5,
            "min_explain_clip_sec": 6.0,
            "max_single_clip_sec": 7.0,
            "min_avatar_ratio": 0.48,
            "min_cut_interval_sec": 5.0,
            "max_cut_interval_sec": 9.0,
            "max_cutaway_count": 6,
        },
        "role_block_types": {
            "hook": "evidence_clip",
            "explain": "avatar_talk",
            "ending": "avatar_talk",
        },
        "role_layouts": {
            "hook": "cutaway_silent",
            "explain": "avatar_full",
            "ending": "avatar_full",
        },
        "audio_strategy": {
            "hook": "voiceover_only",
            "explain": "voiceover_only",
            "ending": "voiceover_only",
        },
    },
}


class EditingStyleSkill(BaseSkill):
    name = "editing_style_skill"

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        content_type = str(
            payload.get("content_type")
            or payload.get("route", {}).get("content_type")
            or "fast_news"
        ).strip()
        preset = STYLE_PRESETS.get(content_type, STYLE_PRESETS["fast_news"])
        return SkillResult(
            skill=self.name,
            version=self.version,
            output=preset,
            meta={
                "status": "ready",
                "message": "Editing style guidance generated.",
            },
        )
