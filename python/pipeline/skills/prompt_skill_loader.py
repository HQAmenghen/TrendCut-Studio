"""
Markdown prompt skill loader.

Loads prompt templates and JSON resources from markdown files so prompt
maintenance can happen in .md instead of inline Python strings.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path


PROMPT_SKILL_DIR = Path(__file__).resolve().parents[1] / "prompt_skills"


@lru_cache(maxsize=64)
def _read_prompt_skill(file_name: str) -> str:
    path = PROMPT_SKILL_DIR / file_name
    return path.read_text(encoding="utf-8")


def _extract_fenced_block(markdown: str, section: str) -> str:
    pattern = re.compile(
        rf"^##\s+{re.escape(section)}\s*$([\s\S]*?)(?=^##\s+|\Z)",
        re.MULTILINE,
    )
    match = pattern.search(markdown)
    if not match:
        raise ValueError(f"Markdown skill section not found: {section}")
    body = match.group(1)
    fence = re.search(r"```[a-zA-Z0-9_-]*\s*([\s\S]*?)```", body)
    if not fence:
        raise ValueError(f"Markdown skill section has no fenced block: {section}")
    return fence.group(1).strip()


def load_prompt_text(file_name: str, section: str = "Prompt Template") -> str:
    markdown = _read_prompt_skill(file_name)
    return _extract_fenced_block(markdown, section)


def load_json_resource(file_name: str, section: str) -> dict:
    markdown = _read_prompt_skill(file_name)
    raw = _extract_fenced_block(markdown, section)
    return json.loads(raw)
