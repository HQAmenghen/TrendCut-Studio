"""Build a motion-source video from avatar action video templates."""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from script_protocol import emit_result, emit_stage, run_guarded  # noqa: E402


DEFAULT_FPS = 25
DEFAULT_VIDEO_WIDTH = 1280
DEFAULT_VIDEO_HEIGHT = 720
DEFAULT_FIT_MODE = "cover"


def read_json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_file(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def hash_payload(payload: dict) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha1(encoded).hexdigest()


def load_video_templates(action_dir: Path) -> dict:
    templates = {}
    if not action_dir.exists():
        raise FileNotFoundError(f"动作库目录不存在: {action_dir}")

    for child in sorted(action_dir.iterdir()):
        if not child.is_dir():
            continue
        meta_path = child / "action.json"
        if not meta_path.exists():
            continue
        meta = read_json_file(meta_path)
        action_id = str(meta.get("id") or child.name).strip()
        source_video_name = str(meta.get("sourceVideo") or "").strip()
        source_video_path = child / source_video_name
        if not action_id or not source_video_name or not source_video_path.exists():
            continue
        templates[action_id] = {
            "meta": meta,
            "source_video": source_video_path,
        }

    if not templates:
        raise ValueError("动作库没有可用 source.mp4 视频模板")
    return templates


def require_ffmpeg() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg，无法拼接动作视频")
    return ffmpeg


def run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or proc.stdout or "").splitlines()[-12:])
        raise RuntimeError(f"ffmpeg 执行失败: {tail}")


def normalize_duration(value, fallback: float = 1.0) -> float:
    try:
        duration = float(value)
    except (TypeError, ValueError):
        duration = fallback
    return max(0.2, duration)


def duration_to_frame_count(duration: float, fps: int) -> int:
    return max(1, int(round(normalize_duration(duration) * max(1, int(fps or DEFAULT_FPS)))))


def build_video_fit_filter(*, fps: int, width: int, height: int, mode: str = DEFAULT_FIT_MODE) -> str:
    if mode == "contain":
        return (
            f"fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
        )
    return (
        f"fps={fps},scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},setsar=1"
    )


def build_idle_segment(
    *,
    ffmpeg: str,
    idle_image: Path,
    duration: float,
    output_path: Path,
    fps: int,
    width: int,
    height: int,
    fit_mode: str = DEFAULT_FIT_MODE,
) -> dict:
    if not idle_image.exists():
        raise FileNotFoundError(f"缺少 idle 静态图: {idle_image}")
    vf = build_video_fit_filter(fps=fps, width=width, height=height, mode=fit_mode)
    run_ffmpeg([
        ffmpeg,
        "-y",
        "-loop",
        "1",
        "-framerate",
        str(fps),
        "-i",
        str(idle_image),
        "-an",
        "-vf",
        vf,
        "-frames:v",
        str(duration_to_frame_count(duration, fps)),
        "-r",
        str(fps),
        "-pix_fmt",
        "yuv420p",
        str(output_path),
    ])
    return {
        "kind": "idle_image",
        "source": str(idle_image),
        "duration": round(duration, 3),
    }


def build_action_segment(
    *,
    ffmpeg: str,
    template: dict,
    duration: float,
    output_path: Path,
    fps: int,
    width: int,
    height: int,
    fit_mode: str = DEFAULT_FIT_MODE,
) -> dict:
    meta = template.get("meta") or {}
    source_video = template["source_video"]
    source_duration = normalize_duration(meta.get("sourceDuration"), duration)
    source_start = 0.0
    available_duration = max(0.2, source_duration)
    output_duration = max(duration, available_duration)
    trim_duration = available_duration
    filters = [
        f"trim=start={source_start}:duration={trim_duration}",
        "setpts=PTS-STARTPTS",
        build_video_fit_filter(fps=fps, width=width, height=height, mode=fit_mode),
    ]
    hold_duration = max(0, output_duration - trim_duration)
    if hold_duration > 0.001:
        filters.append(f"tpad=stop_mode=clone:stop_duration={hold_duration}")
    vf = ",".join(filters)
    run_ffmpeg([
        ffmpeg,
        "-y",
        "-i",
        str(source_video),
        "-an",
        "-vf",
        vf,
        "-r",
        str(fps),
        "-pix_fmt",
        "yuv420p",
        "-t",
        f"{output_duration:.3f}",
        str(output_path),
    ])
    return {
        "kind": "template_video",
        "source": str(source_video),
        "sourceStart": round(source_start, 3),
        "sourceDuration": round(source_duration, 3),
        "plannedDuration": round(duration, 3),
        "duration": round(output_duration, 3),
    }


def concat_segment_videos(ffmpeg: str, segment_paths: list[Path], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as list_file:
        list_path = Path(list_file.name)
        for segment_path in segment_paths:
            escaped = str(segment_path).replace("\\", "/").replace("'", "'\\''")
            list_file.write(f"file '{escaped}'\n")
    try:
        run_ffmpeg([
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-c",
            "copy",
            str(output_path),
        ])
    finally:
        try:
            list_path.unlink()
        except OSError:
            pass


def trim_video_duration(ffmpeg: str, input_path: Path, output_path: Path, duration: float) -> None:
    run_ffmpeg([
        ffmpeg,
        "-y",
        "-i",
        str(input_path),
        "-t",
        f"{duration:.3f}",
        "-c",
        "copy",
        str(output_path),
    ])


def build_motion_source_video(
    motion_plan: dict,
    templates: dict,
    *,
    idle_image: Path,
    output_video: Path,
    work_dir: Path,
    fps: int,
    width: int,
    height: int,
    fit_mode: str = DEFAULT_FIT_MODE,
    target_duration: float = 0.0,
) -> dict:
    ffmpeg = require_ffmpeg()
    work_dir.mkdir(parents=True, exist_ok=True)
    segment_paths = []
    segment_manifest = []

    for index, segment in enumerate(motion_plan.get("segments", []), start=1):
        action = str(segment.get("action") or "idle_talking")
        duration = normalize_duration(segment.get("duration"), 1.0)
        segment_path = work_dir / f"segment_{index:04d}_{action}.mp4"
        template = templates.get(action)
        if template:
            item = build_action_segment(
                ffmpeg=ffmpeg,
                template=template,
                duration=duration,
                output_path=segment_path,
                fps=fps,
                width=width,
                height=height,
                fit_mode=fit_mode,
            )
        else:
            item = build_idle_segment(
                ffmpeg=ffmpeg,
                idle_image=idle_image,
                duration=duration,
                output_path=segment_path,
                fps=fps,
                width=width,
                height=height,
                fit_mode=fit_mode,
            )
        item["action"] = action
        segment_manifest.append(item)
        segment_paths.append(segment_path)

    if not segment_paths:
        raise ValueError("动作计划没有可拼接片段")

    raw_duration = round(sum(item["duration"] for item in segment_manifest), 3)
    trim_duration = normalize_duration(target_duration, 0.0) if target_duration and target_duration > 0 else 0.0
    if trim_duration and raw_duration > trim_duration + 0.05:
        concat_path = output_video.with_name(f"{output_video.stem}_uncut{output_video.suffix}")
        concat_segment_videos(ffmpeg, segment_paths, concat_path)
        trim_video_duration(ffmpeg, concat_path, output_video, trim_duration)
    else:
        concat_segment_videos(ffmpeg, segment_paths, output_video)
        trim_duration = raw_duration
    payload = {
        "version": 1,
        "inputType": "motion_source_video",
        "fps": fps,
        "width": width,
        "height": height,
        "fitMode": fit_mode,
        "duration": round(trim_duration, 3),
        "rawDuration": raw_duration,
        "trimmedToTarget": raw_duration > trim_duration + 0.05,
        "poseInputPath": str(output_video),
        "segments": segment_manifest,
    }
    payload["signature"] = hash_payload(payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build avatar motion source video")
    parser.add_argument("--motion-plan", required=True, help="Motion plan JSON")
    parser.add_argument("--action-dir", required=True, help="Avatar action preset directory")
    parser.add_argument("--output-dir", required=True, help="Directory for intermediate segment videos")
    parser.add_argument("--manifest", required=True, help="Output motion manifest JSON")
    parser.add_argument("--video-output", required=True, help="Output motion source video path")
    parser.add_argument("--idle-image", required=True, help="Reference image used for idle still segments")
    parser.add_argument("--video-width", type=int, default=DEFAULT_VIDEO_WIDTH)
    parser.add_argument("--video-height", type=int, default=DEFAULT_VIDEO_HEIGHT)
    parser.add_argument("--fit-mode", choices=["cover", "contain"], default=DEFAULT_FIT_MODE)
    parser.add_argument("--target-duration", type=float, default=0.0, help="Optional final output duration trim")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    motion_plan_path = Path(args.motion_plan)
    output_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest)
    video_output_path = Path(args.video_output)

    emit_stage("avatar_motion_source_builder", "读取动作视频模板并拼接动作源视频")
    motion_plan = read_json_file(motion_plan_path)
    templates = load_video_templates(Path(args.action_dir))
    manifest = build_motion_source_video(
        motion_plan,
        templates,
        idle_image=Path(args.idle_image),
        output_video=video_output_path,
        work_dir=output_dir,
        fps=int(motion_plan.get("fps") or DEFAULT_FPS),
        width=int(args.video_width or DEFAULT_VIDEO_WIDTH),
        height=int(args.video_height or DEFAULT_VIDEO_HEIGHT),
        fit_mode=args.fit_mode,
        target_duration=float(args.target_duration or motion_plan.get("duration") or 0.0),
    )
    manifest["motionPlanPath"] = str(motion_plan_path)
    write_json_file(manifest_path, manifest)

    emit_result(
        "avatar motion source video generated",
        manifestPath=str(manifest_path),
        poseInputPath=str(video_output_path),
        signature=manifest["signature"],
        duration=manifest["duration"],
        segmentCount=len(manifest["segments"]),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run_guarded(
        main,
        error_code="AVATAR_MOTION_SOURCE_BUILD_FAILED",
        error_message="数字人动作源视频生成失败",
        error_stage="avatar_motion_source_builder",
    ))
