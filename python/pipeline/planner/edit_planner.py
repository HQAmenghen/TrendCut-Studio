"""
Edit plan builder.

Turns upstream skill outputs into a normalized structured edit plan.
"""

from typing import Any, Dict, List

from .schemas import append_blocks, create_block, create_edit_plan


def _estimate_unit_duration(unit: Dict[str, Any], default_duration: float = 4.0) -> float:
    """Estimate a script unit duration from known fields."""
    if unit.get("duration") is not None:
        return float(unit["duration"])
    if unit.get("estimated_duration") is not None:
        return float(unit["estimated_duration"])
    text = (unit.get("text") or "").strip()
    if not text:
        return default_duration
    # A simple first-pass estimate for Mandarin short-video narration.
    return max(default_duration, round(len(text) / 6.0, 1))


def _default_block_type(role: str) -> str:
    """Map script roles to default block types."""
    role = (role or "").strip().lower()
    if role in {"evidence", "proof"}:
        return "evidence_clip"
    if role in {"headline", "title"}:
        return "headline_card"
    if role in {"comment", "commentary"}:
        return "comment_card"
    return "avatar_talk"


def _build_blocks_from_script_units(
    script_units: List[Dict[str, Any]],
    avatar_segments_map: Dict[str, Dict[str, Any]] = None,
    avatar_video_ref: str = None,
    editing_style: Dict[str, Any] = None,
    clip_match_map: Dict[str, Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Create a conservative first-pass timeline from script units."""
    blocks: List[Dict[str, Any]] = []
    avatar_segments_map = avatar_segments_map or {}
    editing_style = editing_style or {}
    clip_match_map = clip_match_map or {}
    role_block_types = editing_style.get("role_block_types") or {}
    role_layouts = editing_style.get("role_layouts") or {}
    constraints = editing_style.get("constraints") or {}
    max_single_clip_sec = float(
        constraints.get("max_single_clip_sec")
        or editing_style.get("max_single_clip_sec")
        or 6.0
    )
    min_single_clip_sec = float(
        constraints.get("min_single_clip_sec")
        or editing_style.get("min_single_clip_sec")
        or 4.0
    )
    min_hook_clip_sec = float(
        constraints.get("min_hook_clip_sec")
        or editing_style.get("min_hook_clip_sec")
        or max(4.5, min_single_clip_sec)
    )
    min_explain_clip_sec = float(
        constraints.get("min_explain_clip_sec")
        or editing_style.get("min_explain_clip_sec")
        or max(6.0, min_single_clip_sec)
    )
    for index, unit in enumerate(script_units, start=1):
        role = unit.get("role")
        script_ref = unit.get("id") or f"script_{index:03d}"
        clip_match = clip_match_map.get(script_ref, {})
        use_cutaway = bool(clip_match.get("use_cutaway"))
        if use_cutaway:
            block_type = "evidence_clip"
        elif clip_match:
            block_type = unit.get("preferred_block_type") or "avatar_talk"
        else:
            default_block_type = role_block_types.get(role) or _default_block_type(role)
            if default_block_type == "evidence_clip":
                default_block_type = "avatar_talk"
            block_type = unit.get("preferred_block_type") or default_block_type
        avatar_segment = avatar_segments_map.get(script_ref, {})
        duration = avatar_segment.get("duration") or _estimate_unit_duration(unit)
        source_ref = unit.get("source_ref")
        if block_type == "avatar_talk" and avatar_video_ref:
            source_ref = avatar_video_ref
        elif block_type == "evidence_clip":
            source_ref = clip_match.get("source_ref") or source_ref
            recommended_duration = float(clip_match.get("recommended_duration") or 0.0)
            if role == "hook":
                min_cutaway_duration = min_hook_clip_sec
            elif role == "explain":
                min_cutaway_duration = min_explain_clip_sec
            else:
                min_cutaway_duration = min_single_clip_sec
            duration = recommended_duration or min(duration, max_single_clip_sec)
            duration = max(min_cutaway_duration, min(float(duration), max_single_clip_sec))
        blocks.append(
            create_block(
                block_id=f"block_{index:03d}",
                block_type=block_type,
                duration=duration,
                source_ref=source_ref,
                script_ref=script_ref,
                visual_layout=(
                    "cutaway_silent"
                    if use_cutaway
                    else (unit.get("visual_layout") or role_layouts.get(role) or "full_frame")
                ),
                audio_mode=unit.get("audio_mode", "voiceover"),
                subtitle_mode=unit.get("subtitle_mode", "follow_global"),
                extras={
                    "role": role,
                    "text": unit.get("text"),
                    "avatar_segment_ref": avatar_segment.get("id"),
                    "avatar_cut_start": avatar_segment.get("start"),
                    "avatar_cut_end": avatar_segment.get("end"),
                    "clip_match_ref": clip_match.get("segment_id"),
                    "use_cutaway": use_cutaway,
                    "match_score": (clip_match.get("scores") or {}).get("final_score"),
                    "evidence_ref": clip_match.get("matched_evidence") or {},
                },
            )
        )
    return blocks


def build_edit_plan(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build an edit plan from upstream task and skill outputs.
    """
    task = payload.get("task", {})
    route = payload.get("route", {})
    script = payload.get("script", {})
    assets = payload.get("assets", {})
    music = payload.get("music", {})
    avatar_segments = payload.get("avatar_segments", {})
    editing_style = payload.get("editing_style", {})
    clip_matches = payload.get("clip_matches", {})

    script_units = script.get("script_units") or payload.get("script_units") or []
    avatar_video_ref = assets.get("avatar_video_ref")
    avatar_segments_list = avatar_segments.get("segments") or []
    clip_matches_list = clip_matches.get("clip_matches") or []
    avatar_segments_map = {
        str(item.get("script_ref")): item
        for item in avatar_segments_list
        if item.get("script_ref")
    }
    clip_match_map = {
        str(item.get("script_ref")): item
        for item in clip_matches_list
        if item.get("script_ref")
    }

    plan = create_edit_plan(
        task_id=task.get("task_id") or task.get("id"),
        content_type=route.get("content_type") or payload.get("content_type"),
        template_id=route.get("template_id") or payload.get("template_id"),
        duration_target=route.get("duration_target") or payload.get("duration_target"),
        platform=task.get("platform") or payload.get("platform"),
        aspect_ratio=task.get("aspect_ratio") or payload.get("aspect_ratio", "9:16"),
    )

    if assets.get("avatar_video_ref"):
        plan["artifacts"]["avatar_video_ref"] = assets["avatar_video_ref"]
        plan["audio"]["voiceover_ref"] = assets["avatar_video_ref"]
    if assets.get("avatar_segments_ref"):
        plan["artifacts"]["avatar_segments_ref"] = assets["avatar_segments_ref"]
        plan["audio"]["voiceover_segments_ref"] = assets["avatar_segments_ref"]
    if assets.get("script_units_ref"):
        plan["artifacts"]["script_units_ref"] = assets["script_units_ref"]
    if assets.get("narration_ref"):
        plan["artifacts"]["narration_ref"] = assets["narration_ref"]
    if assets.get("source_video_refs"):
        plan["artifacts"]["source_video_refs"] = list(assets["source_video_refs"])
    if assets.get("subtitle_ref"):
        plan["subtitle"]["source_ref"] = assets["subtitle_ref"]

    if music:
        plan["audio"]["music_ref"] = music.get("music_id") or music.get("music_ref")
        if music.get("volume") is not None:
            plan["audio"]["music_volume"] = music["volume"]
    if editing_style.get("subtitle_style_id"):
        plan["subtitle"]["style_id"] = editing_style["subtitle_style_id"]
    if editing_style.get("constraints"):
        plan["constraints"].update(editing_style["constraints"])
    if editing_style.get("style_id"):
        plan["meta"]["style_id"] = editing_style["style_id"]

    blocks = _build_blocks_from_script_units(
        script_units,
        avatar_segments_map=avatar_segments_map,
        avatar_video_ref=avatar_video_ref,
        editing_style=editing_style,
        clip_match_map=clip_match_map,
    )
    append_blocks(plan, blocks)

    plan["meta"]["status"] = "ready"
    plan["meta"]["block_count"] = len(plan["blocks"])
    plan["meta"]["message"] = "Edit plan generated from available upstream inputs."
    return plan
