"""
Background music selector skill.
"""

from typing import Any, Dict

from .base import BaseSkill, SkillResult
from .prompt_skill_loader import load_prompt_text


class MusicSelectorSkill(BaseSkill):
    name = "music_selector"
    PROMPT_TEMPLATE = load_prompt_text("music_selector_skill.md")

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        return SkillResult(
            skill=self.name,
            version=self.version,
            output={
                "music_id": None,
                "volume": None,
                "fade_in": None,
                "fade_out": None,
            },
            meta={
                "status": "prompt_managed",
                "message": "Music selector prompt is managed in prompt_skills/music_selector_skill.md.",
            },
        )
