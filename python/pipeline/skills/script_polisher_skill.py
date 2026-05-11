"""
Second-pass LLM narration polishing skill.
"""

import json
import os
import re
from typing import Any, Dict, List, Tuple

from llm_client import create_llm_client, generate_content, get_llm_provider

from .base import BaseSkill, SkillResult
from .partition_prompt_profile import prepend_partition_prompt, resolve_partition_prompt_profile
from .prompt_skill_loader import load_prompt_text
from .script_rewriter_skill import ScriptRewriterSkill, _get_script_provider


DEFAULT_GEMINI_SCRIPT_POLISH_MODEL = "gemini-2.5-pro"
DEFAULT_VERTEX_SCRIPT_POLISH_MODEL = "gemini-3-pro-preview"
DEFAULT_QWEN_SCRIPT_POLISH_MODEL = "qwen3.6-plus"
DEFAULT_DEEPSEEK_SCRIPT_POLISH_MODEL = "deepseek-v4-pro"
DEFAULT_SCRIPT_POLISH_MIN_CHARS = 220
DEFAULT_SCRIPT_POLISH_MAX_CHARS = 300
DEFAULT_SCRIPT_POLISH_MAX_ATTEMPTS = 12

BANNED_POLISH_TEMPLATE_PHRASES = [
    "不知道大家发现没",
    "翻译成人话就是",
    "底层逻辑是",
    "所以啊",
]


def _env_bool(name: str, default: bool = True) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() not in {"0", "false", "no", "off", "disabled"}


def get_polish_model(provider: str | None = None) -> str:
    provider = provider or _get_script_provider()
    if provider == "vertex":
        return (
            os.getenv("VERTEX_SCRIPT_MODEL")
            or os.getenv("GEMINI_MODEL")
            or DEFAULT_VERTEX_SCRIPT_POLISH_MODEL
        )
    if provider == "qwen":
        return (
            os.getenv("QWEN_SCRIPT_POLISH_MODEL")
            or os.getenv("QWEN_SCRIPT_TEXT_MODEL")
            or os.getenv("QWEN_TEXT_MODEL")
            or DEFAULT_QWEN_SCRIPT_POLISH_MODEL
        )
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", DEFAULT_DEEPSEEK_SCRIPT_POLISH_MODEL)
    return (
        os.getenv("GEMINI_SCRIPT_POLISH_MODEL")
        or os.getenv("GEMINI_MODEL")
        or DEFAULT_GEMINI_SCRIPT_POLISH_MODEL
    )


def _env_int(name: str, default: int) -> int:
    value = str(os.getenv(name) or "").strip()
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def resolve_polish_char_bounds() -> Tuple[int, int]:
    min_chars = _env_int("SCRIPT_POLISH_MIN_CHARS", DEFAULT_SCRIPT_POLISH_MIN_CHARS)
    max_chars = _env_int("SCRIPT_POLISH_MAX_CHARS", DEFAULT_SCRIPT_POLISH_MAX_CHARS)
    if max_chars < min_chars:
        max_chars = min_chars
    return min_chars, max_chars


def resolve_polish_max_attempts() -> int:
    return max(2, _env_int("SCRIPT_POLISH_MAX_ATTEMPTS", DEFAULT_SCRIPT_POLISH_MAX_ATTEMPTS))


class ScriptPolisherSkill(BaseSkill):
    name = "script_polisher_skill"

    PROMPT = load_prompt_text("script_polisher_skill.md", "Prompt Template")
    REPAIR_PROMPT = load_prompt_text("script_polisher_skill.md", "Repair Prompt Template")

    def __init__(self) -> None:
        self.rewriter = ScriptRewriterSkill()

    def _char_count(self, script_units: List[Dict[str, Any]]) -> int:
        text = "".join(str(item.get("text") or "") for item in script_units or [])
        return len(re.sub(r"\s+", "", text))

    def _extract_units(self, response_text: str) -> List[Dict[str, Any]]:
        data = self.rewriter._extract_json(response_text)
        raw_units = self.rewriter._extract_script_unit_items(data)
        text_units = self.rewriter._normalize_text_units(raw_units)
        if not text_units:
            return []
        return self.rewriter._merge_enrichment(text_units, raw_units)

    def _detect_banned_templates(self, script_units: List[Dict[str, Any]]) -> List[str]:
        full_text = " ".join(str(item.get("text") or "") for item in script_units or [])
        found: List[str] = []
        for phrase in BANNED_POLISH_TEMPLATE_PHRASES:
            if phrase in full_text and phrase not in found:
                found.append(phrase)
        return found

    def _validate_units(
        self,
        script_units: List[Dict[str, Any]],
        source_focus: Dict[str, Any],
        context_blob: str,
        min_chars: int,
        max_chars: int,
    ) -> Tuple[bool, List[str], Dict[str, Any]]:
        errors: List[str] = []
        unit_count = len(script_units or [])
        char_count = self._char_count(script_units)
        coverage = self.rewriter._script_source_coverage(script_units, source_focus)
        out_of_scope_terms = self.rewriter._detect_out_of_scope_phrases(script_units, context_blob)
        style_violations = (
            self.rewriter._detect_ai_transition_templates(script_units)
            + self.rewriter._detect_ai_cliche_phrases(script_units)
            + self._detect_banned_templates(script_units)
        )
        source_repair_required = self.rewriter._needs_source_repair(source_focus, coverage)

        if unit_count < 3 or unit_count > 4:
            errors.append(f"script_units 数量必须是 3-4 段，当前为 {unit_count} 段")
        if char_count < min_chars:
            errors.append(f"口播稿字数低于下限: 当前 {char_count} 字，最少 {min_chars} 字")
        if char_count > max_chars:
            errors.append(f"口播稿字数超过上限: 当前 {char_count} 字，最多 {max_chars} 字，必须压缩重写")
        if source_repair_required:
            missing_anchor = coverage.get("missing_facts") or coverage.get("missing_cues") or []
            errors.append(f"缺少原帖关键锚点: {missing_anchor}")
        if out_of_scope_terms:
            errors.append(f"出现输入材料外的疑似跑题词: {out_of_scope_terms}")
        if style_violations:
            errors.append(f"出现禁用模板或 AI 套话: {style_violations}")

        diagnostics = {
            "char_count": char_count,
            "unit_count": unit_count,
            "source_coverage": coverage,
            "source_repair_required": source_repair_required,
            "out_of_scope_terms": out_of_scope_terms,
            "style_violations": style_violations,
        }
        return not errors, errors, diagnostics

    def _build_prompt(
        self,
        source_post_info: Dict[str, Any],
        source_focus: Dict[str, Any],
        outline_items: List[Dict[str, Any]],
        audio_snippets: List[Dict[str, Any]],
        segment_items: List[Dict[str, Any]],
        draft_units: List[Dict[str, Any]],
        min_chars: int,
        max_chars: int,
    ) -> str:
        return self.PROMPT.format(
            min_chars=min_chars,
            max_chars=max_chars,
            source_post_json=json.dumps(source_post_info, ensure_ascii=False, indent=2),
            source_focus_json=json.dumps(source_focus, ensure_ascii=False, indent=2),
            outline_json=json.dumps(outline_items, ensure_ascii=False, indent=2),
            audio_json=json.dumps(audio_snippets, ensure_ascii=False, indent=2),
            segments_json=json.dumps(segment_items, ensure_ascii=False, indent=2),
            draft_script_units_json=json.dumps(draft_units, ensure_ascii=False, indent=2),
        )

    def _build_repair_prompt(
        self,
        base_prompt: str,
        validation_errors: List[str],
        current_units: List[Dict[str, Any]],
        min_chars: int,
        max_chars: int,
    ) -> str:
        return self.REPAIR_PROMPT.format(
            validation_errors_json=json.dumps(validation_errors, ensure_ascii=False, indent=2),
            current_script_units_json=json.dumps(current_units, ensure_ascii=False, indent=2),
            min_chars=min_chars,
            max_chars=max_chars,
            base_prompt=base_prompt,
        )

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        draft_units = list(payload.get("draft_script_units") or payload.get("script_units") or [])
        if not draft_units:
            return SkillResult(
                skill=self.name,
                version=self.version,
                output={"script_units": []},
                meta={
                    "status": "failed",
                    "message": "No draft script units for polishing.",
                    "decision_mode": "llm_polish_failed",
                },
            )

        min_chars, max_chars = resolve_polish_char_bounds()
        max_attempts = resolve_polish_max_attempts()
        source_post = payload.get("source_post") or {}
        source_post_info = self.rewriter._normalize_source_post(source_post)
        partition_profile = resolve_partition_prompt_profile(source_post_info)

        if not _env_bool("SCRIPT_POLISH_ENABLED", True):
            char_count = self._char_count(draft_units)
            if char_count <= max_chars:
                return SkillResult(
                    skill=self.name,
                    version=self.version,
                    output={"script_units": draft_units},
                    meta={
                        "status": "skipped",
                        "message": "Script polish disabled by SCRIPT_POLISH_ENABLED.",
                        "decision_mode": "polish_disabled",
                        "char_count": char_count,
                        "min_chars": min_chars,
                        "max_chars": max_chars,
                        "unit_count": len(draft_units),
                        "repair_applied": False,
                        "partition_prompt_profile": partition_profile,
                    },
                )

        outline = payload.get("outline") or {}
        audio_items = payload.get("audio") or payload.get("audio_items") or []
        selected_segments = payload.get("selected_segments") or []

        outline_items = self.rewriter._normalize_outline(outline)
        audio_snippets = self.rewriter._normalize_audio(audio_items)
        segment_items = self.rewriter._normalize_selected_segments(selected_segments)
        source_focus = payload.get("source_anchor") if isinstance(payload.get("source_anchor"), dict) else None
        if not source_focus or not source_focus.get("has_source_anchor"):
            source_focus = self.rewriter._extract_source_focus(source_post_info)
        context_blob = self.rewriter._build_context_blob(
            source_post_info=source_post_info,
            outline_items=outline_items,
            audio_snippets=audio_snippets,
            segment_items=segment_items,
        )

        provider = _get_script_provider()
        model = get_polish_model(provider)
        client = create_llm_client(provider=provider)
        base_prompt = prepend_partition_prompt(self._build_prompt(
            source_post_info=source_post_info,
            source_focus=source_focus,
            outline_items=outline_items,
            audio_snippets=audio_snippets,
            segment_items=segment_items,
            draft_units=draft_units,
            min_chars=min_chars,
            max_chars=max_chars,
        ), partition_profile)

        last_errors: List[str] = []
        last_diagnostics: Dict[str, Any] = {}
        last_units: List[Dict[str, Any]] = []

        for attempt in range(max_attempts):
            prompt = base_prompt if attempt == 0 else self._build_repair_prompt(
                base_prompt=base_prompt,
                validation_errors=last_errors,
                current_units=last_units,
                min_chars=min_chars,
                max_chars=max_chars,
            )
            try:
                response = generate_content(
                    client,
                    model=model,
                    contents=prompt,
                    response_mime_type="application/json",
                    retries=2 if attempt == 0 else 1,
                    request_timeout=180,
                )
                candidate_units = self._extract_units(response.text)
            except Exception as exc:
                candidate_units = []
                last_errors = [f"解析或调用优化模型失败: {exc}"]
                last_diagnostics = {
                    "char_count": 0,
                    "unit_count": 0,
                    "source_coverage": {},
                    "source_repair_required": True,
                    "out_of_scope_terms": [],
                    "style_violations": [],
                }
                last_units = []
                continue

            is_valid, errors, diagnostics = self._validate_units(
                script_units=candidate_units,
                source_focus=source_focus,
                context_blob=context_blob,
                min_chars=min_chars,
                max_chars=max_chars,
            )
            last_errors = errors
            last_diagnostics = diagnostics
            last_units = candidate_units
            if is_valid:
                repair_applied = attempt > 0
                decision_meta = {
                    "provider": provider,
                    "model": model,
                    "decision_mode": "llm_polish",
                    "llm_used": True,
                    "fallback_used": False,
                    "repair_applied": repair_applied,
                    "attempts": attempt + 1,
                    "max_attempts": max_attempts,
                    "source_anchor": source_focus,
                    "validation_errors": [],
                    "partition_prompt_profile": partition_profile,
                    **diagnostics,
                }
                return SkillResult(
                    skill=self.name,
                    version=self.version,
                    output={
                        "script_units": candidate_units,
                        "decision_meta": decision_meta,
                    },
                    meta={
                        "status": "ready",
                        "message": "LLM polished script units generated.",
                        **decision_meta,
                    },
                )

        failure_meta = {
            "status": "failed",
            "message": "Script polishing failed validation.",
            "provider": provider,
            "model": model,
            "decision_mode": "llm_polish_failed",
            "llm_used": True,
            "fallback_used": False,
            "repair_applied": True,
            "attempts": max_attempts,
            "max_attempts": max_attempts,
            "source_anchor": source_focus,
            "validation_errors": last_errors,
            "partition_prompt_profile": partition_profile,
            **last_diagnostics,
        }
        return SkillResult(
            skill=self.name,
            version=self.version,
            output={"script_units": [], "rejected_script_units": last_units},
            meta=failure_meta,
        )
