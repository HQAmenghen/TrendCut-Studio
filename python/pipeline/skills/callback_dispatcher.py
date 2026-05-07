"""
QC callback dispatcher skill.
"""

from typing import Any, Dict, List

from .base import BaseSkill, SkillResult


class CallbackDispatcherSkill(BaseSkill):
    name = "callback_dispatcher"

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        qc_callback = payload.get("qc_callback") or {}
        qc_report = payload.get("qc_report") or {}

        next_action = str(qc_callback.get("next_action") or "manual_review").strip()
        passed = bool(qc_callback.get("passed"))
        executed_actions: List[Dict[str, Any]] = []
        pending_actions: List[Dict[str, Any]] = []

        if passed or next_action == "publish":
            executed_actions.append({
                "type": "mark_ready_for_publish",
                "status": "completed",
            })
        elif next_action == "regenerate_title":
            alt_titles = (
                qc_report.get("title_analysis", {}) or {}
            ).get("alternative_titles", []) or []
            executed_actions.append({
                "type": "prepare_title_suggestion",
                "status": "completed",
                "suggested_title": alt_titles[0] if alt_titles else None,
            })
        elif next_action == "regenerate_subtitles":
            executed_actions.append({
                "type": "rerun_asr_with_aggressive_split",
                "status": "pending_execution",
            })
        elif next_action == "re_edit":
            pending_actions.append({
                "type": "re_edit",
                "status": "manual_or_followup",
                "reason": "Editing/content issues need another planning/render pass.",
            })
        else:
            pending_actions.append({
                "type": "manual_review",
                "status": "manual_or_followup",
            })

        return SkillResult(
            skill=self.name,
            version=self.version,
            output={
                "next_action": next_action,
                "executed_actions": executed_actions,
                "pending_actions": pending_actions,
            },
            meta={
                "status": "ready",
                "message": "Dispatch plan generated from qc callback.",
            },
        )
