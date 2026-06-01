"""Small state helpers for the material-driven pipeline."""

import hashlib
import json


def pick_string(*values) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def compute_script_signature(script_units: list) -> str:
    payload = [
        {
            "id": item.get("id"),
            "role": item.get("role"),
            "text": item.get("text"),
        }
        for item in (script_units or [])
    ]
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def get_narration_text(script_units: list | None = None, narration: dict | None = None) -> str:
    lines = [
        str(item.get("text") or "").strip()
        for item in (script_units or [])
        if str(item.get("text") or "").strip()
    ]
    if lines:
        return "\n".join(lines).strip()
    full_text = str((narration or {}).get("full_text") or (narration or {}).get("text") or "").strip()
    if full_text:
        return full_text
    return ""


def compute_narration_signature(script_units: list | None = None, narration: dict | None = None) -> str:
    full_text = get_narration_text(script_units, narration)
    return hashlib.sha1(full_text.encode("utf-8")).hexdigest() if full_text else ""


def normalize_source_post(payload) -> dict:
    if not isinstance(payload, dict):
        return {}
    source_meta = (
        payload.get("sourceMeta")
        if isinstance(payload.get("sourceMeta"), dict)
        else payload.get("source_meta")
        if isinstance(payload.get("source_meta"), dict)
        else {}
    )
    partition = payload.get("partition") if isinstance(payload.get("partition"), dict) else {}

    rank_raw = pick_string(
        payload.get("sourceRank"),
        payload.get("source_rank"),
        source_meta.get("sourceRank"),
        source_meta.get("source_rank"),
    )
    try:
        source_rank = int(float(rank_raw)) if rank_raw else 0
    except Exception:
        source_rank = 0

    source_partition_id = pick_string(
        payload.get("sourcePartitionId"),
        payload.get("source_partition_id"),
        source_meta.get("sourcePartitionId"),
        source_meta.get("source_partition_id"),
        payload.get("partitionId"),
        payload.get("partition_id"),
        partition.get("id"),
    )
    source_partition_label = pick_string(
        payload.get("sourcePartitionLabel"),
        payload.get("source_partition_label"),
        source_meta.get("sourcePartitionLabel"),
        source_meta.get("source_partition_label"),
        payload.get("partitionLabel"),
        payload.get("partition_label"),
        partition.get("label"),
    )
    return {
        "title": str(payload.get("title") or "").strip(),
        "body": str(payload.get("body") or "").strip(),
        "author": pick_string(payload.get("author"), payload.get("sourceAuthor")),
        "postId": pick_string(payload.get("postId"), payload.get("post_id"), payload.get("sourcePostId")),
        "postUrl": str(payload.get("postUrl") or "").strip(),
        "materialUrl": str(payload.get("materialUrl") or "").strip(),
        "sourcePartitionId": source_partition_id,
        "sourcePartitionLabel": source_partition_label,
        "sourceRank": source_rank,
        "sourceMeta": {
            "sourcePartitionId": source_partition_id,
            "sourcePartitionLabel": source_partition_label,
            "sourceRank": source_rank,
        },
    }
