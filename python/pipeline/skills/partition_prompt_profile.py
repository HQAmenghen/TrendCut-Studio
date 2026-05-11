"""
Partition-aware prompt profile selection for narration skills.
"""

from __future__ import annotations

import re
from typing import Any, Dict

from .prompt_skill_loader import load_prompt_text


ADDENDA_FILE = "partition_script_prompt_addenda.md"

PROFILE_SECTIONS = {
    "crypto": "Crypto Addendum",
    "finance": "Finance Addendum",
    "tech": "Tech Addendum",
    "ai": "AI Addendum",
    "custom": "Custom Addendum",
}

PROFILE_LABELS = {
    "crypto": "加密",
    "finance": "金融",
    "tech": "科技",
    "ai": "AI",
    "custom": "自定义分区",
    "default": "",
}

KNOWN_LABEL_PROFILE_MAP = {
    "加密": "crypto",
    "金融": "finance",
    "科技": "tech",
    "ai": "ai",
    "AI": "ai",
}


def normalize_partition_id(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9_-]+", "-", normalized)
    normalized = re.sub(r"^-+|-+$", "", normalized)
    return normalized[:40]


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _pick_string(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _match_profile_key(partition_id: str, partition_label: str) -> str:
    if partition_id in PROFILE_SECTIONS and partition_id != "custom":
        return partition_id

    if not partition_id and not partition_label:
        return "default"

    if not partition_id and partition_label in KNOWN_LABEL_PROFILE_MAP:
        return KNOWN_LABEL_PROFILE_MAP[partition_label]

    return "custom"


def resolve_partition_prompt_profile(source_post: Dict[str, Any] | None) -> Dict[str, Any]:
    payload = _as_dict(source_post)
    source_meta = _as_dict(payload.get("sourceMeta") or payload.get("source_meta"))
    partition = _as_dict(payload.get("partition"))

    partition_id = normalize_partition_id(_pick_string(
        payload.get("sourcePartitionId"),
        payload.get("source_partition_id"),
        payload.get("partitionId"),
        payload.get("partition_id"),
        source_meta.get("sourcePartitionId"),
        source_meta.get("source_partition_id"),
        source_meta.get("partitionId"),
        source_meta.get("partition_id"),
        partition.get("id"),
    ))
    partition_label = _pick_string(
        payload.get("sourcePartitionLabel"),
        payload.get("source_partition_label"),
        payload.get("partitionLabel"),
        payload.get("partition_label"),
        source_meta.get("sourcePartitionLabel"),
        source_meta.get("source_partition_label"),
        source_meta.get("partitionLabel"),
        source_meta.get("partition_label"),
        partition.get("label"),
        partition_id,
    )

    profile_key = _match_profile_key(partition_id, partition_label)
    prompt_section = PROFILE_SECTIONS.get(profile_key, "")
    if profile_key == "default":
        partition_label = ""
    elif not partition_label:
        partition_label = PROFILE_LABELS.get(profile_key) or partition_id or PROFILE_LABELS["custom"]

    return {
        "partition_id": partition_id,
        "partition_label": partition_label,
        "profile_key": profile_key,
        "profile_label": PROFILE_LABELS.get(profile_key, partition_label),
        "prompt_section": prompt_section,
        "is_custom": profile_key == "custom",
    }


def format_partition_addendum(profile: Dict[str, Any] | None) -> str:
    source = _as_dict(profile)
    section = str(source.get("prompt_section") or "").strip()
    if not section:
        return ""

    template = load_prompt_text(ADDENDA_FILE, section)
    if source.get("profile_key") != "custom":
        return template.strip()

    partition_label = _pick_string(
        source.get("partition_label"),
        source.get("partition_id"),
        PROFILE_LABELS["custom"],
    )
    return template.format(
        partition_label=partition_label,
        partition_id=_pick_string(source.get("partition_id"), partition_label),
    ).strip()


def prepend_partition_prompt(prompt: str, profile: Dict[str, Any] | None) -> str:
    addendum = format_partition_addendum(profile)
    if not addendum:
        return prompt
    return f"【分区附加提示】\n{addendum}\n\n{prompt}"
