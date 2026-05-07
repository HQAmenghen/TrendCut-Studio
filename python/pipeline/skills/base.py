"""
Shared skill interfaces and helpers.
"""

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class SkillResult:
    """Standard result returned by a skill."""

    skill: str
    version: str = "v1"
    output: Dict[str, Any] = field(default_factory=dict)
    meta: Dict[str, Any] = field(default_factory=dict)


class BaseSkill:
    """Lightweight base class for pipeline skills."""

    name = "base_skill"
    version = "v1"

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        raise NotImplementedError("Skill must implement run()")

