"""Text helpers for material-driven script and timeline planning."""
import math
import re


def clean_text_for_match(text: str) -> str:
    """Strip punctuation and spacing used only for fuzzy sentence matching."""
    return re.sub(r'[，。！？；：、""'',.!?;:()\[\]{}\"\'…·\-\s]', '', str(text or ""))


def normalize_sentence_text(text: str) -> str:
    """Normalize narration sentence text before timeline estimation."""
    cleaned = " ".join(str(text or "").split()).strip()
    cleaned = cleaned.replace("这 些", "这些")
    cleaned = cleaned.replace("这 。", "。")
    cleaned = cleaned.replace("这。。", "。")
    cleaned = cleaned.replace("。。", "。")
    cleaned = cleaned.replace("，。", "。")
    cleaned = cleaned.replace("。.", "。")
    cleaned = cleaned.strip("，。； ")
    if cleaned and cleaned[-1] not in "。！？":
        cleaned += "。"
    return cleaned


def estimate_duration_from_text(text: str, min_duration: float = 1.8) -> float:
    """Estimate narration duration from visible text length."""
    cleaned = clean_text_for_match(text)
    if not cleaned:
        return min_duration
    return max(min_duration, round(len(cleaned) / 4.2, 2))


def split_text_into_semantic_groups(text: str, target_groups: int = 4) -> list[str]:
    """Split long narration text into stable sentence-ish groups."""
    normalized = normalize_sentence_text(text)
    if not normalized:
        return []

    raw_parts = [
        normalize_sentence_text(part)
        for part in re.split(r'(?<=[。！？!?])', normalized)
        if normalize_sentence_text(part)
    ]
    if not raw_parts:
        raw_parts = [normalized]

    if len(raw_parts) <= target_groups:
        return raw_parts

    total_chars = sum(len(part) for part in raw_parts)
    group_target_chars = max(18, math.ceil(total_chars / max(1, target_groups)))

    groups = []
    current = []
    current_chars = 0
    remaining_parts = len(raw_parts)
    remaining_groups = target_groups

    for part in raw_parts:
        current.append(part)
        current_chars += len(part)
        remaining_parts -= 1

        should_flush = False
        if current_chars >= group_target_chars:
            should_flush = True
        if len(current) >= 2 and current_chars >= 14:
            should_flush = True
        if remaining_parts < max(0, remaining_groups - 1):
            should_flush = True

        if should_flush:
            groups.append("".join(current))
            current = []
            current_chars = 0
            remaining_groups = max(1, remaining_groups - 1)

    if current:
        groups.append("".join(current))

    return [normalize_sentence_text(item) for item in groups if normalize_sentence_text(item)]
