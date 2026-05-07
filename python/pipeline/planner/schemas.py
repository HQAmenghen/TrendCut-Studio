"""
Shared edit plan schema helpers.
"""

from copy import deepcopy
from typing import Any, Dict, List, Optional

EDIT_PLAN_VERSION = "v1"

DEFAULT_CONSTRAINTS = {
    "max_source_ratio": 0.35,
    "max_single_clip_sec": 3.5,
    "min_explain_clip_sec": 6.0,
    "min_avatar_ratio": 0.55,
    "min_cut_interval_sec": 2.0,
    "max_cut_interval_sec": 8.0,
}

DEFAULT_AUDIO = {
    "voiceover_ref": None,
    "voiceover_segments_ref": None,
    "music_ref": None,
    "music_volume": 0.18,
    "keep_original_audio": True,
    "target_lufs": -16.0,
}

DEFAULT_SUBTITLE = {
    "enabled": True,
    "source_ref": None,
    "style_id": "default",
    "burn_in": True,
}

DEFAULT_QC = {
    "check_black_frames": True,
    "check_empty_audio": True,
    "check_subtitle_overflow": True,
    "check_source_ratio": True,
    "check_pacing": True,
}


def create_block(
    block_id: str,
    block_type: str,
    duration: Optional[float] = None,
    source_ref: Optional[str] = None,
    script_ref: Optional[str] = None,
    visual_layout: str = "full_frame",
    audio_mode: str = "voiceover",
    subtitle_mode: str = "follow_global",
    extras: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a normalized timeline block."""
    block = {
        "id": block_id,
        "type": block_type,
        "duration": duration,
        "source_ref": source_ref,
        "script_ref": script_ref,
        "visual_layout": visual_layout,
        "audio_mode": audio_mode,
        "subtitle_mode": subtitle_mode,
    }
    if extras:
        block.update(extras)
    return block


def create_edit_plan(
    task_id: Optional[str] = None,
    content_type: Optional[str] = None,
    template_id: Optional[str] = None,
    duration_target: Optional[float] = None,
    platform: Optional[str] = None,
    aspect_ratio: str = "9:16",
) -> Dict[str, Any]:
    """Create a default edit plan skeleton."""
    return {
        "version": EDIT_PLAN_VERSION,
        "meta": {
            "task_id": task_id,
            "content_type": content_type,
            "template_id": template_id,
            "status": "draft",
        },
        "targets": {
            "platform": platform,
            "duration_target": duration_target,
            "aspect_ratio": aspect_ratio,
        },
        "blocks": [],
        "audio": deepcopy(DEFAULT_AUDIO),
        "subtitle": deepcopy(DEFAULT_SUBTITLE),
        "constraints": deepcopy(DEFAULT_CONSTRAINTS),
        "artifacts": {
            "script_units_ref": None,
            "narration_ref": None,
            "avatar_video_ref": None,
            "avatar_segments_ref": None,
            "source_video_refs": [],
            "output_video_ref": None,
        },
        "qc": deepcopy(DEFAULT_QC),
    }


def append_blocks(plan: Dict[str, Any], blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Append blocks to the plan and return the same plan object."""
    plan.setdefault("blocks", []).extend(blocks)
    return plan
