#!/usr/bin/env python3
"""
素材驱动的数字人视频制作主控脚本
完整流程：素材分析 → 规划 → 生成数字人 → 数字人解说渲染
"""
import sys

def _setup_utf8_stdio():
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

_setup_utf8_stdio()

import os
import json
import argparse
import subprocess
import re
import math
import hashlib
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from script_protocol import emit_result, emit_stage
from pipeline.planner.edit_planner import build_edit_plan
from pipeline.skills.copywriting_skill import CopywritingSkill
from pipeline.skills.clip_selector import ClipSelectorSkill
from pipeline.skills.content_router import ContentRouterSkill
from pipeline.skills.editing_style_skill import EditingStyleSkill
from pipeline.skills.script_polisher_skill import ScriptPolisherSkill
from pipeline.skills.script_rewriter_skill import ScriptRewriterSkill
from pipeline.skills.script_builder import ScriptBuilderSkill

try:
    from pipeline.smart_video_composer import SmartVideoComposer
except Exception:
    from smart_video_composer import SmartVideoComposer

load_project_env(__file__)


class MaterialDrivenPipeline:
    """素材驱动的视频制作流程"""

    def __init__(
        self,
        material_path: str,
        output_dir: str = "./",
        use_smart_clip: bool = True,
        use_cache: bool = False,
        require_llm: bool = True,
    ):
        self.material_path = Path(material_path)
        self.output_dir = Path(output_dir).resolve()
        self.use_smart_clip = use_smart_clip
        self.use_cache = use_cache
        self.require_llm = require_llm
        self.pipeline_dir = Path(__file__).parent

        # 确保输出目录存在
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 工作文件
        self.material_file = self.output_dir / "material.mp4"
        self.audio_json = self.output_dir / "audio.json"
        self.result_json = self.output_dir / "result.json"
        self.segments_json = self.output_dir / "segments.json"
        self.narration_json = self.output_dir / "narration.json"
        self.script_units_json = self.output_dir / "script_units.json"
        self.script_rewriter_skill_json = self.output_dir / "script_rewriter_skill.json"
        self.script_polisher_skill_json = self.output_dir / "script_polisher_skill.json"
        self.copywriting_skill_json = self.output_dir / "copywriting_skill.json"
        self.editing_style_skill_json = self.output_dir / "editing_style_skill.json"
        self.edit_plan_json = self.output_dir / "edit_plan.json"
        self.execution_plan_json = self.output_dir / "execution_plan.json"
        self.source_post_json = self.output_dir / "source_post.json"
        self.aiman_file = self.output_dir / "aiman.mp4"
        self.avatar_manifest_json = self.output_dir / "avatar_manifest.json"
        self.aiman_audio_json = self.output_dir / "aiman_audio.json"
        self.aiman_subtitles_json = self.output_dir / "aiman_subtitles.json"
        self.aiman_speaker_scene_json = self.output_dir / "aiman_speaker_scene.json"
        self.avatar_segments_json = self.output_dir / "avatar_segments.json"
        self.avatar_tail_trim_json = self.output_dir / "avatar_tail_trim.json"
        self.output_file = self.output_dir / "output_final.mp4"

    def log(self, message: str, level: str = "info"):
        """日志输出"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        prefix = {
            "info": "ℹ️",
            "success": "✅",
            "warning": "⚠️",
            "error": "❌",
            "step": "📍"
        }.get(level, "ℹ️")
        print(f"[{timestamp}] {prefix} {message}")

    def _compute_script_signature(self, script_units: list) -> str:
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

    def _get_current_narration_text(self, script_units: list | None = None) -> str:
        lines = [
            str(item.get("text") or "").strip()
            for item in (script_units or [])
            if str(item.get("text") or "").strip()
        ]
        if lines:
            return "\n".join(lines).strip()
        narration = self.load_json_file(self.narration_json, {})
        full_text = str(narration.get("full_text") or "").strip()
        if full_text:
            return full_text
        return ""

    def _compute_narration_signature(self, script_units: list | None = None) -> str:
        full_text = self._get_current_narration_text(script_units)
        return hashlib.sha1(full_text.encode("utf-8")).hexdigest() if full_text else ""

    def save_avatar_manifest(self, script_units: list) -> bool:
        payload = {
            "script_signature": self._compute_script_signature(script_units),
            "narration_signature": self._compute_narration_signature(script_units),
            "narration_text": self._get_current_narration_text(script_units),
            "script_count": len(script_units or []),
            "avatar_video_ref": str(self.aiman_file),
        }
        return self.save_json_file(self.avatar_manifest_json, payload)

    def load_source_post(self) -> dict:
        payload = self.load_json_file(self.source_post_json, {})
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

        def pick_string(*values) -> str:
            for value in values:
                text = str(value or "").strip()
                if text:
                    return text
            return ""

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

    def is_public_http_url(self, value: str) -> bool:
        parsed = urlparse(str(value or "").strip())
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    def is_avatar_cache_compatible(self, script_units: list) -> bool:
        if not self.aiman_file.exists():
            return False
        if not self.avatar_manifest_json.exists():
            return True
        manifest = self.load_json_file(self.avatar_manifest_json, {})
        expected_narration_signature = self._compute_narration_signature(script_units)
        manifest_narration_signature = str(manifest.get("narration_signature") or "").strip()
        if expected_narration_signature and manifest_narration_signature:
            return manifest_narration_signature == expected_narration_signature
        expected_signature = self._compute_script_signature(script_units)
        return str(manifest.get("script_signature") or "") == expected_signature

    def clear_stale_avatar_runtime_artifacts(self) -> None:
        """清理依赖当前 script_units 的数字人与执行计划产物，避免错配继续被复用。"""
        for stale_file in [self.avatar_segments_json, self.execution_plan_json]:
            try:
                if stale_file.exists():
                    stale_file.unlink()
            except Exception:
                pass

    def run_script(self, script_name: str, args: list = None, cwd: str = None) -> bool:
        """运行Python脚本"""
        script_path = self.pipeline_dir / script_name
        if not script_path.exists():
            self.log(f"脚本不存在: {script_name}", "error")
            return False

        cmd = [sys.executable, str(script_path)]
        if args:
            cmd.extend(args)

        self.log(f"执行: {script_name}", "step")

        try:
            env = os.environ.copy()
            env["MATERIAL_REQUIRE_LLM_SCORING"] = "1" if self.require_llm else "0"
            result = subprocess.run(
                cmd,
                cwd=cwd or str(self.output_dir),
                capture_output=False,
                text=True,
                env=env,
            )
            if result.returncode == 0:
                self.log(f"{script_name} 完成", "success")
                return True
            else:
                self.log(f"{script_name} 失败 (返回码: {result.returncode})", "error")
                return False
        except Exception as e:
            self.log(f"{script_name} 执行异常: {e}", "error")
            return False

    def check_file(self, file_path: Path, description: str) -> bool:
        """检查文件是否存在"""
        if file_path.exists():
            self.log(f"{description} 存在: {file_path.name}", "success")
            return True
        else:
            self.log(f"{description} 不存在: {file_path.name}", "warning")
            return False

    def has_cached_files(self, file_paths: list[Path]) -> bool:
        """检查一组缓存文件是否都存在。"""
        return all(Path(item).exists() for item in file_paths)

    def load_json_file(self, file_path: Path, default=None):
        """读取 JSON 文件，失败时返回默认值。"""
        if default is None:
            default = {}
        if not file_path.exists():
            return default
        try:
            return json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            return default

    def save_json_file(self, file_path: Path, data) -> bool:
        """写入 JSON 文件。"""
        try:
            file_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            return True
        except Exception:
            return False

    def clean_text_for_match(self, text: str) -> str:
        """清理文本，便于句子对齐。"""
        return re.sub(r'[，。！？；：、""'',.!?;:()\[\]{}\"\'…·\-\s]', '', str(text or ""))

    def normalize_sentence_text(self, text: str) -> str:
        """规范化句子，减少 ASR/翻译碎裂带来的脏文本。"""
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

    def estimate_duration_from_text(self, text: str, min_duration: float = 1.8) -> float:
        """根据文本长度估算口播时长。"""
        cleaned = self.clean_text_for_match(text)
        if not cleaned:
            return min_duration
        return max(min_duration, round(len(cleaned) / 4.2, 2))

    def split_text_into_semantic_groups(self, text: str, target_groups: int = 4) -> list:
        """把长文本按句子和长度切成较稳定的语义组。"""
        normalized = self.normalize_sentence_text(text)
        if not normalized:
            return []

        raw_parts = [
            self.normalize_sentence_text(part)
            for part in re.split(r'(?<=[。！？!?])', normalized)
            if self.normalize_sentence_text(part)
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

        return [self.normalize_sentence_text(item) for item in groups if self.normalize_sentence_text(item)]

    def get_video_duration(self, file_path: Path) -> float:
        """通过 ffprobe 获取视频时长。"""
        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    str(file_path),
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if result.returncode != 0:
                return 0.0
            return float((result.stdout or "").strip() or 0.0)
        except Exception:
            return 0.0

    def _avatar_tail_float_env(self, name: str, default: float) -> float:
        try:
            return float(os.getenv(name, str(default)))
        except Exception:
            return default

    def resolve_avatar_effective_duration_from_silence_log(
        self,
        media_duration: float,
        silence_log: str,
    ) -> dict:
        """根据 silencedetect 输出计算数字人口播的有效结束点。"""
        media_duration = max(0.0, float(media_duration or 0.0))
        min_tail_silence = max(
            0.0,
            self._avatar_tail_float_env("AVATAR_TAIL_SILENCE_MIN_SECONDS", 0.7),
        )
        tail_pad = max(
            0.0,
            self._avatar_tail_float_env("AVATAR_TAIL_SILENCE_PAD_SECONDS", 0.08),
        )
        terminal_tolerance = max(
            0.0,
            self._avatar_tail_float_env("AVATAR_TAIL_SILENCE_TERMINAL_TOLERANCE", 0.35),
        )

        intervals = []
        pending_start = None
        for line in str(silence_log or "").splitlines():
            start_match = re.search(r"silence_start:\s*([0-9.]+)", line)
            if start_match:
                try:
                    pending_start = float(start_match.group(1))
                except Exception:
                    pending_start = None
                continue

            end_match = re.search(r"silence_end:\s*([0-9.]+)", line)
            if end_match and pending_start is not None:
                try:
                    intervals.append((pending_start, float(end_match.group(1))))
                except Exception:
                    pass
                pending_start = None

        if pending_start is not None and media_duration > 0:
            intervals.append((pending_start, media_duration))

        meta = {
            "trimmed": False,
            "effective_duration": round(media_duration, 3),
            "original_duration": round(media_duration, 3),
            "tail_silence_seconds": 0.0,
            "silence_start": None,
            "silence_end": None,
            "min_tail_silence_seconds": min_tail_silence,
            "tail_pad_seconds": tail_pad,
        }
        if media_duration <= 0:
            return meta

        for silence_start, silence_end in reversed(intervals):
            silence_end = min(max(silence_end, silence_start), media_duration)
            is_terminal = silence_end >= media_duration - terminal_tolerance
            tail_silence = max(0.0, silence_end - silence_start)
            if not is_terminal:
                continue
            meta.update({
                "tail_silence_seconds": round(tail_silence, 3),
                "silence_start": round(silence_start, 3),
                "silence_end": round(silence_end, 3),
            })
            if tail_silence >= min_tail_silence:
                effective_duration = min(media_duration, max(0.1, silence_start + tail_pad))
                meta.update({
                    "trimmed": True,
                    "effective_duration": round(effective_duration, 3),
                })
            return meta

        return meta

    def detect_avatar_tail_silence(self) -> dict:
        """检测 aiman.mp4 尾部是否存在可裁剪静音。"""
        media_duration = self.get_video_duration(self.aiman_file)
        if media_duration <= 0:
            return self.resolve_avatar_effective_duration_from_silence_log(0.0, "")

        noise = os.getenv("AVATAR_TAIL_SILENCE_NOISE", "-35dB")
        detect_duration = self._avatar_tail_float_env("AVATAR_TAIL_SILENCE_DETECT_SECONDS", 0.2)
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-i", str(self.aiman_file),
                    "-af", f"silencedetect=noise={noise}:d={detect_duration}",
                    "-f", "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            log_text = f"{result.stdout or ''}\n{result.stderr or ''}"
        except Exception as exc:
            return {
                "trimmed": False,
                "effective_duration": round(media_duration, 3),
                "original_duration": round(media_duration, 3),
                "tail_silence_seconds": 0.0,
                "error": str(exc),
            }

        meta = self.resolve_avatar_effective_duration_from_silence_log(media_duration, log_text)
        meta["noise"] = noise
        meta["detect_duration_seconds"] = detect_duration
        return meta

    def trim_avatar_tail_silence_if_needed(self) -> dict:
        """裁掉数字人尾部长静音，避免无声嘴型进入后续时间轴。"""
        if not self.aiman_file.exists():
            return {"trimmed": False, "reason": "missing_aiman"}

        meta = self.detect_avatar_tail_silence()
        if not meta.get("trimmed"):
            if meta.get("tail_silence_seconds", 0) > 0:
                self.log(
                    f"数字人尾部静音 {meta.get('tail_silence_seconds'):.2f}s，低于裁剪阈值，保持原文件",
                    "info",
                )
            return meta

        effective_duration = float(meta.get("effective_duration") or 0.0)
        original_duration = float(meta.get("original_duration") or 0.0)
        if effective_duration <= 0 or effective_duration >= original_duration - 0.05:
            meta["trimmed"] = False
            return meta

        backup_path = self.output_dir / "aiman_uncut.mp4"
        temp_path = self.output_dir / "aiman.trim.tmp.mp4"
        source_path = self.aiman_file
        moved_to_backup = False

        try:
            if not backup_path.exists():
                self.aiman_file.replace(backup_path)
                source_path = backup_path
                moved_to_backup = True

            if temp_path.exists():
                temp_path.unlink()

            cmd = [
                "ffmpeg",
                "-y",
                "-i", str(source_path),
                "-t", f"{effective_duration:.3f}",
                "-map", "0",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "18",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                str(temp_path),
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,
            )
            if result.returncode != 0 or not temp_path.exists():
                if moved_to_backup and not self.aiman_file.exists():
                    backup_path.replace(self.aiman_file)
                meta.update({
                    "trimmed": False,
                    "error": (result.stderr or result.stdout or "ffmpeg trim failed")[-1000:],
                })
                return meta

            temp_path.replace(self.aiman_file)
            meta["backup_path"] = str(backup_path)
            self.save_json_file(self.avatar_tail_trim_json, meta)
            self.log(
                f"检测到数字人尾部静音 {meta.get('tail_silence_seconds'):.2f}s，已裁剪到 {effective_duration:.2f}s",
                "info",
            )
            return meta
        except Exception as exc:
            try:
                if moved_to_backup and backup_path.exists() and not self.aiman_file.exists():
                    backup_path.replace(self.aiman_file)
            except Exception:
                pass
            meta.update({
                "trimmed": False,
                "error": str(exc),
            })
            return meta

    def write_canonical_narration_from_script_units(self, script_units: list) -> bool:
        """用 script_units 回写口播稿，切断旧 narration 对后续数字人的污染。"""
        texts = [
            str(item.get("text") or "").strip()
            for item in script_units or []
            if str(item.get("text") or "").strip()
        ]
        if not texts:
            return False

        full_text = "\n".join(texts)
        target_duration = round(sum(self.estimate_duration_from_text(text) for text in texts), 2)
        payload = {
            "target_duration_sec": target_duration,
            "speaking_style": "短视频解说",
            "tone": "直接、清楚、镜头友好",
            "script_sections": [
                {
                    "segment_id": item.get("id") or f"segment_{index + 1}",
                    "text": text,
                }
                for index, (item, text) in enumerate(
                    [
                        (unit, str(unit.get("text") or "").strip())
                        for unit in script_units
                        if str(unit.get("text") or "").strip()
                    ]
                )
            ],
            "full_text": full_text,
            "source": "script_units",
        }
        ok_json = self.save_json_file(self.narration_json, payload)
        ok_txt = False
        try:
            (self.output_dir / "narration.txt").write_text(full_text, encoding="utf-8")
            ok_txt = True
        except Exception:
            ok_txt = False
        return ok_json and ok_txt

    def _estimate_avatar_segment_durations(self, script_units: list) -> list:
        """按脚本文本长度估算每段口播时长。"""
        estimates = []
        for item in script_units or []:
            text = str(item.get("text") or "").strip()
            estimates.append({
                "id": item.get("id"),
                "text": text,
                "estimated_duration": self.estimate_duration_from_text(text, min_duration=1.0),
            })
        return estimates

    def _scale_avatar_timeline(self, estimates: list, avatar_duration: float) -> list:
        """把估算时长缩放到数字人真实总时长内。"""
        if not estimates:
            return []

        total_estimated = sum(float(item.get("estimated_duration") or 0.0) for item in estimates)
        if total_estimated <= 0:
            total_estimated = float(len(estimates))

        usable_duration = float(avatar_duration or 0.0)
        if usable_duration <= 0:
            usable_duration = total_estimated

        scale = usable_duration / total_estimated if total_estimated > 0 else 1.0
        cursor = 0.0
        scaled = []

        for index, item in enumerate(estimates, start=1):
            duration = max(0.6, round(float(item.get("estimated_duration") or 0.0) * scale, 2))
            start_time = round(cursor, 2)
            end_time = round(start_time + duration, 2)
            scaled.append({
                "id": f"avatar_segment_{index:03d}",
                "script_ref": item.get("id") or f"script_{index:03d}",
                "text": item.get("text") or "",
                "start": start_time,
                "end": end_time,
                "duration": round(end_time - start_time, 2),
            })
            cursor = end_time

        if usable_duration > 0 and scaled:
            overflow = round(float(scaled[-1]["end"]) - usable_duration, 2)
            if overflow > 0:
                scaled[-1]["end"] = round(max(float(scaled[-1]["start"]) + 0.6, usable_duration), 2)
                scaled[-1]["duration"] = round(float(scaled[-1]["end"]) - float(scaled[-1]["start"]), 2)

        return scaled

    def generate_avatar_segments(self, script_units: list) -> bool:
        """根据 script_units 和数字人总时长生成轻量级片段映射。"""
        if not self.aiman_file.exists():
            self.log("数字人视频不存在，跳过 avatar_segments 生成", "warning")
            return False

        for stale_file in [
            self.aiman_audio_json,
            self.aiman_subtitles_json,
            self.aiman_speaker_scene_json,
        ]:
            try:
                if stale_file.exists():
                    stale_file.unlink()
            except Exception:
                pass

        trim_meta = self.trim_avatar_tail_silence_if_needed()
        avatar_duration = self.get_video_duration(self.aiman_file)
        if avatar_duration > 0:
            self.log(f"数字人实际时长: {avatar_duration:.2f}s", "info")
        else:
            self.log("未能读取数字人时长，将按脚本估时生成片段映射", "warning")

        self.log("数字人切段模式: estimated_scaled（不再执行二次完整 ASR）", "info")

        estimates = self._estimate_avatar_segment_durations(script_units)
        segments = self._scale_avatar_timeline(estimates, avatar_duration)

        if not segments:
            self.log("未生成任何数字人片段映射", "error")
            return False

        payload = {
            "avatar_video_ref": str(self.aiman_file),
            "audio_ref": None,
            "segments": segments,
            "timing_mode": "estimated_scaled",
            "tail_silence_trim": trim_meta,
        }
        if self.save_json_file(self.avatar_segments_json, payload):
            self.save_avatar_manifest(script_units)
            self.log(f"已生成数字人片段映射: {self.avatar_segments_json.name}", "success")
            return True

        self.log("写入 avatar_segments.json 失败", "error")
        return False

    def validate_avatar_coverage(self) -> bool:
        """检查数字人实际时长和脚本引用是否足够覆盖当前脚本。"""
        avatar_duration = self.get_video_duration(self.aiman_file)
        avatar_payload = self.load_json_file(self.avatar_segments_json, {})
        segments = avatar_payload.get("segments") or []
        script_payload = self.load_json_file(self.script_units_json, {})
        script_units = script_payload.get("script_units") or []
        required_end = 0.0
        for item in segments:
            try:
                required_end = max(required_end, float(item.get("end") or 0.0))
            except Exception:
                continue

        script_refs = [str(item.get("id")) for item in script_units if item.get("id")]
        avatar_refs = [str(item.get("script_ref")) for item in segments if item.get("script_ref")]
        if script_refs and avatar_refs and script_refs != avatar_refs:
            missing_refs = [ref for ref in script_refs if ref not in avatar_refs]
            extra_refs = [ref for ref in avatar_refs if ref not in script_refs]
            self.log(
                f"数字人与脚本未完全对齐：缺少 {missing_refs or '无'}，多出 {extra_refs or '无'}。建议重新生成数字人以获得完整口播。",
                "warning"
            )

        if avatar_duration <= 0 or required_end <= 0:
            return True

        coverage_ratio = avatar_duration / required_end if required_end else 1.0
        if coverage_ratio < 0.9:
            self.log(
                f"数字人时长不足：实际 {avatar_duration:.2f}s / 需要 {required_end:.2f}s，停止后续渲染",
                "error"
            )
            return False
        return True

    def build_execution_plan_from_edit_plan(self) -> bool:
        """把 edit_plan 翻译成当前合成器可执行的时间线计划。"""
        script_payload = self.load_json_file(self.script_units_json, {})
        script_units = script_payload.get("script_units") or []
        if self.aiman_file.exists() and script_units and not self.is_avatar_cache_compatible(script_units):
            self.log("当前脚本与现有数字人缓存不一致，停止生成 execution_plan，请先重新生成数字人", "error")
            self.clear_stale_avatar_runtime_artifacts()
            return False

        edit_plan = self.load_json_file(self.edit_plan_json, {})
        blocks = edit_plan.get("blocks") or []
        selected_segments_payload = self.load_json_file(self.output_dir / "selected_segments.json", {})
        if isinstance(selected_segments_payload, dict):
            selected_segments = list(selected_segments_payload.get("segments") or [])
        elif isinstance(selected_segments_payload, list):
            selected_segments = selected_segments_payload
        else:
            selected_segments = []
        scored_segments_payload = self.load_json_file(self.output_dir / "material_segments_scored.json", {})
        scored_segments = scored_segments_payload.get("segments") if isinstance(scored_segments_payload, dict) else scored_segments_payload
        scored_segments = scored_segments if isinstance(scored_segments, list) else []
        avatar_segments_payload = self.load_json_file(self.avatar_segments_json, {})
        avatar_segments = avatar_segments_payload.get("segments") or []
        avatar_map = {
            str(item.get("script_ref")): item
            for item in avatar_segments
            if item.get("script_ref")
        }
        clip_matches_payload = self.load_json_file(self.output_dir / "clip_matches.json", {})
        clip_matches_list = clip_matches_payload.get("clip_matches") or []
        clip_match_map = {
            str(item.get("script_ref")): item
            for item in clip_matches_list
            if item.get("script_ref")
        }
        selected_ids = {str(item.get("id")) for item in selected_segments if item.get("id")}
        all_candidate_segments = list(selected_segments) + [
            seg for seg in scored_segments if str(seg.get("id") or "") not in selected_ids
        ]
        selected_segment_map = {
            str(item.get("id")): item
            for item in all_candidate_segments
            if item.get("id")
        }

        if not blocks:
            self.log("edit_plan 中没有 blocks，无法生成执行计划", "warning")
            return False

        constraints = edit_plan.get("constraints") if isinstance(edit_plan.get("constraints"), dict) else {}
        min_single_clip_sec = float(constraints.get("min_single_clip_sec") or 4.0)
        min_hook_clip_sec = float(constraints.get("min_hook_clip_sec") or max(4.5, min_single_clip_sec))
        min_explain_clip_sec = float(constraints.get("min_explain_clip_sec") or max(6.0, min_single_clip_sec))
        max_single_clip_sec = float(constraints.get("max_single_clip_sec") or 8.0)
        material_source_duration = self.get_video_duration(self.material_path)
        if material_source_duration <= 0 and self.material_file.exists():
            material_source_duration = self.get_video_duration(self.material_file)

        material_cursor = 0
        current_time = 0.0
        execution_plan = []
        segment_usage_cursor = {}

        def next_material_segment():
            nonlocal material_cursor
            if not isinstance(selected_segments, list) or not selected_segments:
                return None
            if material_cursor >= len(selected_segments):
                return None
            segment = selected_segments[material_cursor]
            material_cursor += 1
            return segment

        def expand_material_window(start: float, end: float, requested_duration: float) -> tuple[float, float]:
            requested_duration = max(0.5, float(requested_duration or 0.0))
            source_start = 0.0
            source_end = float(material_source_duration or 0.0)
            if source_end <= 0:
                return start, end
            start = max(source_start, min(float(start), source_end))
            end = max(start, min(float(end), source_end))
            if end - start >= requested_duration - 0.05:
                return start, end
            expanded_end = min(source_end, start + requested_duration)
            expanded_start = start
            if expanded_end - expanded_start < requested_duration - 0.05:
                expanded_start = max(source_start, expanded_end - requested_duration)
            expanded_end = min(source_end, expanded_start + requested_duration)
            return expanded_start, max(expanded_start + 0.5, expanded_end)

        def resolve_material_window(source_segment: dict, requested_duration: float, match: dict = None) -> tuple[float, float]:
            seg_id = str(source_segment.get("id") or "")
            base_start = float(source_segment.get("start", source_segment.get("start_time", 0.0)) or 0.0)
            base_end = float(source_segment.get("end", source_segment.get("end_time", base_start + requested_duration)) or (base_start + requested_duration))

            if match and match.get("material_cut_start") is not None and match.get("material_cut_end") is not None:
                match_start = float(match.get("material_cut_start") or base_start)
                match_end = float(match.get("material_cut_end") or base_end)
                # 对整段素材的全量匹配不直接信任起点，避免每次都从 0 秒重复截
                if not (match_start <= base_start + 0.2 and match_end >= base_end - 0.2):
                    return expand_material_window(
                        match_start,
                        min(match_end, match_start + requested_duration),
                        requested_duration,
                    )

            cursor = float(segment_usage_cursor.get(seg_id, base_start))
            if cursor >= base_end - 0.2:
                cursor = base_start
            end = min(base_end, cursor + requested_duration)
            if end - cursor < 0.5:
                cursor = base_start
                end = min(base_end, cursor + requested_duration)
            if end - cursor < requested_duration - 0.05:
                cursor, end = expand_material_window(cursor, end, requested_duration)
            segment_usage_cursor[seg_id] = end
            return cursor, end

        def should_insert_cutaway(block_type: str, layout: str) -> bool:
            layout_key = str(layout or "").strip().lower()
            block_key = str(block_type or "").strip().lower()
            return block_key == "evidence_clip" or layout_key in {"cutaway_silent", "evidence_first", "cutaway"}

        for index, block in enumerate(blocks, start=1):
            block_type = str(block.get("type") or "").strip()
            role = str(block.get("role") or "").strip().lower()
            layout = str(block.get("visual_layout") or "").strip()
            duration = float(block.get("duration") or 0.0)
            if duration <= 0:
                duration = self.estimate_duration_from_text(block.get("text") or "", min_duration=2.0)
            wants_cutaway = should_insert_cutaway(block_type, layout)
            if wants_cutaway:
                if role == "hook":
                    min_clip = min_hook_clip_sec
                elif role == "explain":
                    min_clip = min_explain_clip_sec
                else:
                    min_clip = min_single_clip_sec
                duration = min(max_single_clip_sec, max(min_clip, duration))

            start_time = round(current_time, 2)
            end_time = round(current_time + duration, 2)

            if block_type == "avatar_talk" and not wants_cutaway:
                avatar_segment = avatar_map.get(str(block.get("script_ref")), {})
                cut_start = avatar_segment.get("start")
                cut_end = avatar_segment.get("end")
                if cut_start is None or cut_end is None:
                    self.log(
                        f"脚本 {block.get('script_ref')} 缺少对应数字人片段，已跳过该段以避免尾部复读",
                        "warning"
                    )
                    continue
                actual_avatar_duration = round(max(0.0, float(cut_end) - float(cut_start)), 2)
                if actual_avatar_duration < 0.3:
                    self.log(
                        f"脚本 {block.get('script_ref')} 的数字人口播有效时长不足，已跳过该段",
                        "warning"
                    )
                    continue
                execution_plan.append({
                    "type": "aiman",
                    "video_source": "aiman.mp4",
                    "audio_source": "main",
                    "start_time": start_time,
                    "end_time": round(start_time + actual_avatar_duration, 2),
                    "start": round(float(cut_start), 2),
                    "end": round(float(cut_end), 2),
                    "duration": actual_avatar_duration,
                    "tts_duration": actual_avatar_duration,
                    "ost": 1,
                    "subtitle_text": block.get("text"),
                    "visual_layout": layout,
                    "avatar_cut_start": round(float(cut_start), 2),
                    "avatar_cut_end": round(float(cut_end), 2),
                    "script_ref": block.get("script_ref"),
                    "block_id": block.get("id"),
                })
                end_time = round(start_time + actual_avatar_duration, 2)
            else:
                match = clip_match_map.get(str(block.get("script_ref")), {})
                source_segment = selected_segment_map.get(str(match.get("segment_id"))) if match else None
                if not source_segment:
                    source_segment = next_material_segment()
                if not source_segment:
                    self.log("素材片段不足，后续片段回退为数字人", "warning")
                    fallback_segment = self._make_aiman_execution_segment(block, start_time, end_time)
                    execution_plan.append(fallback_segment)
                    end_time = round(float(fallback_segment.get("end_time") or end_time), 2)
                else:
                    seg_start, seg_end = resolve_material_window(source_segment, duration, match)
                    available_duration = max(0.5, seg_end - seg_start)
                    clip_duration = min(duration, available_duration)
                    avatar_segment = avatar_map.get(str(block.get("script_ref")), {})
                    avatar_cut_start = avatar_segment.get("start")
                    avatar_cut_end = avatar_segment.get("end")
                    if avatar_cut_start is None or avatar_cut_end is None:
                        self.log(
                            f"脚本 {block.get('script_ref')} 缺少对应数字人片段，已跳过该段以避免口播错位",
                            "warning"
                        )
                        continue
                    avatar_total_duration = 0.0
                    if avatar_cut_start is not None and avatar_cut_end is not None:
                        avatar_total_duration = max(0.0, float(avatar_cut_end) - float(avatar_cut_start))
                    tts_total_duration = max(
                        duration,
                        avatar_total_duration if avatar_total_duration > 0 else 0.0,
                        self.estimate_duration_from_text(block.get("text") or "", min_duration=2.0)
                    )
                    use_cutaway = wants_cutaway

                    if use_cutaway and avatar_cut_start is not None and avatar_cut_end is not None:
                        cutaway_end_time = round(start_time + clip_duration, 2)
                        execution_plan.append({
                            "type": "material_cutaway",
                            "video_source": "material.mp4",
                            "audio_source": "main",
                            "start_time": start_time,
                            "end_time": cutaway_end_time,
                            "start": round(seg_start, 2),
                            "end": round(seg_start + clip_duration, 2),
                            "duration": round(clip_duration, 2),
                            "tts_duration": round(clip_duration, 2),
                            "ost": 0,
                            "subtitle_text": block.get("text") or source_segment.get("text"),
                            "material_cut_start": round(seg_start, 2),
                            "material_cut_end": round(seg_start + clip_duration, 2),
                            "visual_layout": layout,
                            "avatar_cut_start": round(float(avatar_cut_start), 2),
                            "avatar_cut_end": round(float(avatar_cut_end), 2),
                            "script_ref": block.get("script_ref"),
                            "block_id": block.get("id"),
                        })
                        remaining_duration = round(max(0.0, tts_total_duration - clip_duration), 2)
                        if remaining_duration >= 0.6:
                            remaining_avatar_start = round(float(avatar_cut_start) + clip_duration, 2)
                            remaining_avatar_end = round(min(float(avatar_cut_end), remaining_avatar_start + remaining_duration), 2)
                            if remaining_avatar_end - remaining_avatar_start < 0.3:
                                remaining_avatar_start = round(max(float(avatar_cut_start), float(avatar_cut_end) - remaining_duration), 2)
                                remaining_avatar_end = round(float(avatar_cut_end), 2)
                            actual_avatar_duration = round(max(0.0, remaining_avatar_end - remaining_avatar_start), 2)
                            if actual_avatar_duration < 0.3:
                                self.log(
                                    f"脚本 {block.get('script_ref')} 的数字人尾段有效时长不足，跳过尾段避免重复口播",
                                    "warning"
                                )
                                current_time = cutaway_end_time
                                continue
                            execution_plan.append({
                                "type": "aiman",
                                "video_source": "aiman.mp4",
                                "audio_source": "main",
                                "start_time": cutaway_end_time,
                                "end_time": round(cutaway_end_time + actual_avatar_duration, 2),
                                "start": remaining_avatar_start,
                                "end": remaining_avatar_end,
                                "duration": actual_avatar_duration,
                                "tts_duration": actual_avatar_duration,
                                "ost": 1,
                                "subtitle_text": block.get("text") or source_segment.get("text"),
                                "visual_layout": "avatar_full",
                                "avatar_cut_start": remaining_avatar_start,
                                "avatar_cut_end": remaining_avatar_end,
                                "script_ref": block.get("script_ref"),
                                "block_id": f"{block.get('id')}_tail",
                            })
                            end_time = round(cutaway_end_time + actual_avatar_duration, 2)
                        else:
                            end_time = cutaway_end_time
                    else:
                        actual_avatar_duration = round(
                            max(
                                0.0,
                                float(avatar_cut_end if avatar_cut_end is not None else start_time + clip_duration)
                                - float(avatar_cut_start if avatar_cut_start is not None else start_time)
                            ),
                            2
                        )
                        actual_avatar_duration = max(0.3, min(clip_duration, actual_avatar_duration))
                        execution_plan.append({
                            "type": "aiman",
                            "video_source": "aiman.mp4",
                            "audio_source": "main",
                            "start_time": start_time,
                            "end_time": round(start_time + actual_avatar_duration, 2),
                            "start": round(float(avatar_cut_start if avatar_cut_start is not None else start_time), 2),
                            "end": round(float(avatar_cut_end if avatar_cut_end is not None else start_time + clip_duration), 2),
                            "duration": actual_avatar_duration,
                            "tts_duration": actual_avatar_duration,
                            "ost": 1,
                            "subtitle_text": block.get("text") or source_segment.get("text"),
                            "visual_layout": "avatar_full",
                            "avatar_cut_start": round(float(avatar_cut_start if avatar_cut_start is not None else start_time), 2),
                            "avatar_cut_end": round(float(avatar_cut_end if avatar_cut_end is not None else start_time + clip_duration), 2),
                            "script_ref": block.get("script_ref"),
                            "block_id": block.get("id"),
                        })
                        end_time = round(start_time + actual_avatar_duration, 2)

            current_time = end_time

        if self.save_json_file(self.execution_plan_json, execution_plan):
            self.log(f"已生成执行计划: {self.execution_plan_json.name}", "success")
            return True

        self.log("写入 execution_plan.json 失败", "error")
        return False

    def _make_aiman_execution_segment(self, block: dict, start_time: float, end_time: float) -> dict:
        """Create a fallback avatar execution segment from a block."""
        avatar_segments_payload = self.load_json_file(self.avatar_segments_json, {})
        avatar_segments = avatar_segments_payload.get("segments") or []
        avatar_map = {
            str(item.get("script_ref")): item
            for item in avatar_segments
            if item.get("script_ref")
        }
        avatar_segment = avatar_map.get(str(block.get("script_ref")), {})
        cut_start = float(avatar_segment.get("start", start_time) or start_time)
        cut_end = float(avatar_segment.get("end", end_time) or end_time)
        source_duration = max(0.0, cut_end - cut_start)
        requested_duration = max(0.3, float(end_time - start_time))
        actual_duration = round(
            max(0.3, min(requested_duration, source_duration if source_duration > 0 else requested_duration)),
            2,
        )
        actual_end_time = round(float(start_time) + actual_duration, 2)
        return {
            "type": "aiman",
            "video_source": "aiman.mp4",
            "audio_source": "main",
            "start_time": round(float(start_time), 2),
            "end_time": actual_end_time,
            "start": round(cut_start, 2),
            "end": round(cut_end, 2),
            "duration": actual_duration,
            "tts_duration": actual_duration,
            "ost": 1,
            "subtitle_text": block.get("text"),
            "avatar_cut_start": round(cut_start, 2),
            "avatar_cut_end": round(cut_end, 2),
            "script_ref": block.get("script_ref"),
            "block_id": block.get("id"),
        }

    def rerender_from_execution_plan(self) -> bool:
        """基于当前 execution_plan 重新渲染一次成片。"""
        if not self.execution_plan_json.exists():
            self.log("缺少 execution_plan，无法重渲染", "error")
            return False

        try:
            composer = SmartVideoComposer(str(self.output_dir))
            success = composer.compose_from_director_plan(
                director_plan_path=str(self.execution_plan_json),
                material_video=str(self.material_file),
                aiman_video=str(self.aiman_file),
                output_path=str(self.output_file),
                use_smart_clip=self.use_smart_clip
            )
            if success:
                self.log("已根据新 execution_plan 完成自动重渲染", "success")
            else:
                self.log("自动重渲染失败", "error")
            return success
        except Exception as e:
            self.log(f"自动重渲染异常: {e}", "error")
            return False

    def clear_legacy_artifacts(self) -> None:
        """清理旧审核链遗留产物，避免历史文件干扰当前主链。"""
        for stale_file in [
            self.output_dir / "review_metadata.json",
            self.output_dir / "qc_report.json",
            self.output_dir / "qc_callback.json",
            self.output_dir / "dispatch_plan.json",
            self.output_dir / "title_suggestion.json",
            self.output_dir / "reedit_state.json",
        ]:
            try:
                if stale_file.exists():
                    stale_file.unlink()
            except Exception:
                pass

    def generate_edit_plan(self, reuse_scripts: bool = False) -> bool:
        """根据当前工作目录里的中间产物生成 edit_plan.json。

        Args:
            reuse_scripts: 为 True 时跳过 LLM 脚本重写，直接复用已有的
                script_units.json，避免非确定性 LLM 输出与已生成的数字人
                视频 / avatar_segments 产生数量不一致。
        """
        outline = self.load_json_file(self.output_dir / "content_outline.json", {})
        narration = self.load_json_file(self.narration_json, {})
        audio_items = self.load_json_file(self.audio_json, [])
        selected_segments = self.load_json_file(self.output_dir / "selected_segments.json", {})
        source_post = self.load_source_post()
        director_plan = []

        router = ContentRouterSkill()
        route_result = router.run({
            "outline": outline,
            "narration": narration,
            "selected_segments": selected_segments,
            "director_plan": director_plan,
        })

        # ------------------------------------------------------------------
        # reuse_scripts=True: 复用已有 script_units，不重跑 LLM
        # 避免 Step6 中 LLM 非确定性输出导致 script_units 数量与
        # 已生成的数字人视频 / avatar_segments 不一致
        # ------------------------------------------------------------------
        rewrite_result = None
        script_result = None
        script_generation_meta = {
            "llm_attempted": False,
            "llm_used": False,
            "fallback_used": False,
            "fallback_type": None,
            "final_mode": "unknown",
            "final_provider": "unknown",
            "final_model": "unknown",
            "final_source": "unknown",
        }

        script_rewriter = ScriptRewriterSkill()

        if reuse_scripts and self.script_units_json.exists():
            existing_payload = self.load_json_file(self.script_units_json, {})
            script_units = existing_payload.get("script_units") or []
            if script_units and script_rewriter.is_script_context_compatible(
                script_units=script_units,
                source_post=source_post,
                outline=outline,
                audio=audio_items,
                selected_segments=selected_segments,
            ):
                self.log(f"复用已有 script_units ({len(script_units)} 段)，跳过 LLM 重写", "info")
                # 构造与正常流程兼容的 mock result
                from collections import namedtuple
                _MockResult = namedtuple("_MockResult", ["output", "meta"])
                rewrite_result = _MockResult(
                    output={"script_units": script_units},
                    meta={"status": "reused", "decision_mode": "reuse_existing",
                          "provider": "cache", "model": "cache"}
                )
                script_result = rewrite_result
                script_generation_meta.update({
                    "llm_attempted": False,
                    "llm_used": False,
                    "fallback_used": False,
                    "fallback_type": None,
                    "final_mode": "reuse_existing",
                    "final_provider": "cache",
                    "final_model": "cache",
                    "final_source": "cache",
                })
            elif script_units:
                self.log(
                    "检测到已有 script_units 与当前原帖/素材上下文不一致，复用模式已中止；请先从步骤5重建口播并重新生成数字人",
                    "warning",
                )
                return False

        if rewrite_result is None:
            rewrite_result = script_rewriter.run({
                "outline": outline,
                "narration": narration,
                "audio": audio_items,
                "selected_segments": selected_segments,
                "source_post": source_post,
                "route": route_result.output,
            })
            script_units = rewrite_result.output.get("script_units") or []
            script_result = rewrite_result
            script_generation_meta.update({
                "llm_attempted": True,
                "llm_used": bool(script_units),
                "fallback_used": False,
                "fallback_type": None,
                "final_mode": str(rewrite_result.meta.get("decision_mode") or "unknown"),
                "final_provider": str(rewrite_result.meta.get("provider") or "unknown"),
                "final_model": str(rewrite_result.meta.get("model") or "unknown"),
                "final_source": "llm",
            })

        rewrite_mode = str(rewrite_result.meta.get("decision_mode") or "unknown")
        rewrite_provider = str(rewrite_result.meta.get("provider") or "unknown")
        rewrite_model = str(rewrite_result.meta.get("model") or "unknown")
        self.log(f"口播稿生成模式: {rewrite_mode}", "info")
        if rewrite_provider != "unknown" or rewrite_model != "unknown":
            self.log(f"口播稿生成模型: {rewrite_provider}/{rewrite_model}", "info")
        if not script_units:
            if self.require_llm:
                self.log("LLM 口播重写未产出有效脚本，严格模式已中止，禁止回退 script_builder", "error")
                return False
            self.log("LLM 口播重写未产出有效脚本，回退到规则式 script_builder", "warning")
            script_builder = ScriptBuilderSkill()
            script_result = script_builder.run({
                "outline": outline,
                "narration": narration,
                "route": route_result.output,
            })
            script_units = script_result.output.get("script_units") or []
            script_generation_meta.update({
                "llm_attempted": True,
                "llm_used": False,
                "fallback_used": True,
                "fallback_type": "script_builder",
                "final_mode": "script_builder_fallback",
                "final_provider": "fallback",
                "final_model": "script_builder",
                "final_source": str(script_result.meta.get("source") or "fallback"),
            })

        self.log(
            f"口播稿LLM使用情况: llm_used={script_generation_meta['llm_used']} "
            f"fallback_used={script_generation_meta['fallback_used']} "
            f"final_mode={script_generation_meta['final_mode']}",
            "info",
        )

        if rewrite_result is None or str(rewrite_result.meta.get("status") or "") != "reused":
            script_polisher = ScriptPolisherSkill()
            polish_result = script_polisher.run({
                "draft_script_units": script_units,
                "source_post": source_post,
                "outline": outline,
                "audio": audio_items,
                "selected_segments": selected_segments,
                "source_anchor": (
                    rewrite_result.meta.get("source_anchor")
                    or rewrite_result.output.get("decision_meta", {}).get("source_anchor")
                    if isinstance(rewrite_result.output, dict)
                    else None
                ),
            })
            polish_units = polish_result.output.get("script_units") or []
            polish_status = str(polish_result.meta.get("status") or "")
            if not self.save_json_file(self.script_polisher_skill_json, {
                **polish_result.output,
                "meta": polish_result.meta,
                "draft_script_units_count": len(script_units),
                "final_script_units_count": len(polish_units),
            }):
                self.log("写入 script_polisher_skill.json 失败", "warning")

            if polish_status not in {"ready", "skipped"} or not polish_units:
                self.log(
                    f"二次口播优化失败，已中止避免错误口播进入数字人生成: {polish_result.meta.get('validation_errors') or polish_result.meta.get('message')}",
                    "error",
                )
                return False

            script_units = polish_units
            script_generation_meta.update({
                "polish_attempted": True,
                "polish_used": polish_status == "ready",
                "polish_provider": str(polish_result.meta.get("provider") or "unknown"),
                "polish_model": str(polish_result.meta.get("model") or "unknown"),
                "polish_repair_applied": bool(polish_result.meta.get("repair_applied")),
                "polish_char_count": polish_result.meta.get("char_count"),
            })
            if polish_status == "ready":
                script_generation_meta.update({
                    "final_mode": str(polish_result.meta.get("decision_mode") or "llm_polish"),
                    "final_provider": str(polish_result.meta.get("provider") or "unknown"),
                    "final_model": str(polish_result.meta.get("model") or "unknown"),
                    "final_source": "llm_polish",
                })
            self.log(
                f"二次口播优化完成: status={polish_status} chars={polish_result.meta.get('char_count')}",
                "info",
            )
        else:
            script_generation_meta.update({
                "polish_attempted": False,
                "polish_used": False,
                "polish_provider": "cache",
                "polish_model": "cache",
                "polish_repair_applied": False,
            })

        copywriting_skill = CopywritingSkill()
        copywriting_result = copywriting_skill.run({
            "route": route_result.output,
            "outline": outline,
            "narration": narration,
            "script_units": script_units,
        })
        copywriting_guidance = copywriting_result.output.get("guidance") or {}
        script_units = copywriting_result.output.get("script_units") or script_units

        avatar_segments_payload = {}
        if script_units and self.aiman_file.exists():
            if not self.is_avatar_cache_compatible(script_units):
                self.clear_stale_avatar_runtime_artifacts()
                self.log("检测到现有数字人与当前脚本不一致，已跳过 avatar_segments / execution_plan 刷新，请先重新生成数字人", "warning")
            elif not self.generate_avatar_segments(script_units):
                self.clear_stale_avatar_runtime_artifacts()
                self.log("基于当前脚本刷新 avatar_segments 失败，已清理旧切段避免继续错配", "warning")
            else:
                avatar_segments_payload = self.load_json_file(self.avatar_segments_json, {})

        editing_style_skill = EditingStyleSkill()
        editing_style_result = editing_style_skill.run({
            "route": route_result.output,
            "script_units": script_units,
        })
        editing_style = editing_style_result.output or {}

        clip_selector = ClipSelectorSkill()
        scored_segments_payload = self.load_json_file(self.output_dir / "material_segments_scored.json", {})
        clip_result = clip_selector.run({
            "script_units": script_units,
            "selected_segments": selected_segments,
            "material_segments": scored_segments_payload,
            "route": route_result.output,
            "editing_style": editing_style,
        })
        clip_matches = clip_result.output
        clip_decision_meta = clip_matches.get("decision_meta") or {}

        decision_mode = str(
            clip_decision_meta.get("decision_mode")
            or clip_result.meta.get("decision_mode")
            or "unknown"
        )
        decision_provider = str(clip_decision_meta.get("provider") or "unknown")
        decision_model = str(clip_decision_meta.get("model") or "unknown")
        llm_error = str(
            clip_decision_meta.get("llm_error")
            or clip_result.meta.get("llm_error")
            or ""
        ).strip()

        self.log(f"素材插片决策模式: {decision_mode}", "info")
        self.log(f"素材插片决策模型: {decision_provider}/{decision_model}", "info")
        if self.require_llm and (llm_error or decision_provider == "local"):
            if llm_error:
                self.log(f"素材插片 LLM/Embedding 失败，严格模式已中止: {llm_error}", "error")
            else:
                self.log("素材插片决策未使用远程 LLM/Embedding，严格模式已中止", "error")
            return False
        if llm_error:
            self.log(f"素材插片 LLM 失败，已回退规则模式: {llm_error}", "warning")

        clip_decision_meta["llm_used"] = bool(decision_provider != "local" and not llm_error)
        clip_decision_meta["fallback_used"] = bool(decision_provider == "local" or llm_error)
        clip_decision_meta["full_llm_success"] = bool(decision_provider != "local" and not llm_error)
        clip_matches["decision_meta"] = clip_decision_meta

        if not self.save_json_file(self.output_dir / "clip_matches.json", clip_matches):
            self.log("写入 clip_matches.json 失败", "error")
            return False

        retrieval_candidates = clip_matches.get("retrieval_candidates")
        if retrieval_candidates is not None:
            if not self.save_json_file(self.output_dir / "retrieval_candidates.json", {
                "retrieval_candidates": retrieval_candidates,
                "meta": clip_decision_meta,
            }):
                self.log("写入 retrieval_candidates.json 失败", "warning")

        if not self.save_json_file(self.script_units_json, {
            "version": "v1",
            "meta": script_generation_meta,
            "script_units": script_units,
        }):
            self.log("写入 script_units.json 失败", "error")
            return False

        if not self.save_json_file(self.script_rewriter_skill_json, {
            **rewrite_result.output,
            "meta": {
                **rewrite_result.meta,
                **script_generation_meta,
            },
            "final_script_units_count": len(script_units),
        }):
            self.log("写入 script_rewriter_skill.json 失败", "warning")

        if not self.save_json_file(self.copywriting_skill_json, copywriting_result.output):
            self.log("写入 copywriting_skill.json 失败", "warning")

        if not self.save_json_file(self.editing_style_skill_json, editing_style):
            self.log("写入 editing_style_skill.json 失败", "warning")

        source_video_refs = [str(self.material_file)]
        assets = {
            "source_video_refs": source_video_refs,
            "script_units_ref": str(self.script_units_json),
            "narration_ref": str(self.output_dir / "narration.txt"),
        }
        if self.aiman_file.exists():
            assets["avatar_video_ref"] = str(self.aiman_file)
        if self.avatar_segments_json.exists():
            assets["avatar_segments_ref"] = str(self.avatar_segments_json)
        subtitles_path = self.output_dir / "subtitles.json"
        if subtitles_path.exists():
            assets["subtitle_ref"] = str(subtitles_path)

        music = {
            "music_ref": None,
            "volume": 0.18,
        }

        payload = {
            "task": {
                "task_id": self.output_dir.name,
                "platform": "generic",
                "aspect_ratio": "16:9",
            },
            "route": route_result.output,
            "script": {
                **(script_result.output or {}),
                "script_units": script_units,
            },
            "assets": assets,
            "music": music,
            "editing_style": editing_style,
            "avatar_segments": avatar_segments_payload,
            "clip_matches": clip_matches,
        }

        plan = build_edit_plan(payload)
        selected_segment_items = selected_segments.get("segments") if isinstance(selected_segments, dict) else selected_segments
        plan["meta"]["director_shot_count"] = len(director_plan) if isinstance(director_plan, list) else 0
        plan["meta"]["selected_segment_count"] = len(selected_segment_items) if isinstance(selected_segment_items, list) else 0
        plan["meta"]["router_status"] = route_result.meta.get("status")
        plan["meta"]["script_source"] = script_result.meta.get("source")
        plan["meta"]["script_rewriter_status"] = rewrite_result.meta.get("status")
        plan["meta"]["script_rewriter_mode"] = rewrite_result.meta.get("decision_mode")
        plan["meta"]["script_rewriter_provider"] = rewrite_result.meta.get("provider")
        plan["meta"]["script_rewriter_model"] = rewrite_result.meta.get("model")
        plan["meta"]["script_llm_used"] = script_generation_meta.get("llm_used")
        plan["meta"]["script_fallback_used"] = script_generation_meta.get("fallback_used")
        plan["meta"]["script_fallback_type"] = script_generation_meta.get("fallback_type")
        plan["meta"]["copywriting_status"] = copywriting_result.meta.get("status")
        plan["meta"]["copywriting_voice_style"] = copywriting_result.meta.get("voice_style")
        plan["meta"]["editing_style_status"] = editing_style_result.meta.get("status")
        plan["meta"]["editing_style_id"] = editing_style.get("style_id")
        plan["meta"]["clip_selector_status"] = clip_result.meta.get("status")
        plan["meta"]["clip_llm_used"] = clip_decision_meta.get("llm_used")
        plan["meta"]["clip_fallback_used"] = clip_decision_meta.get("fallback_used")
        scored_meta = scored_segments_payload.get("meta") if isinstance(scored_segments_payload, dict) else {}
        if isinstance(scored_meta, dict):
            plan["meta"]["material_scoring_llm_used"] = scored_meta.get("llm_used")
            plan["meta"]["material_scoring_fallback_used"] = scored_meta.get("fallback_used")
            plan["meta"]["material_scoring_mode"] = scored_meta.get("decision_mode")

        try:
            self.edit_plan_json.write_text(
                json.dumps(plan, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            self.log(f"已生成剪辑计划: {self.edit_plan_json.name}", "success")
            return True
        except Exception as e:
            self.log(f"生成剪辑计划失败: {e}", "error")
            return False

    def ensure_content_outline(self, force_regenerate: bool = True) -> bool:
        """生成用于脚本重构的 content_outline.json。默认强制重建，避免旧缓存污染。"""
        outline_path = self.output_dir / "content_outline.json"
        if outline_path.exists() and not force_regenerate:
            return True

        selected_segments = []
        selected_segments_path = self.output_dir / "selected_segments.json"
        if selected_segments_path.exists():
            try:
                selected_payload = json.loads(selected_segments_path.read_text(encoding="utf-8"))
                if isinstance(selected_payload, dict):
                    selected_segments = list(selected_payload.get("segments") or [])
                elif isinstance(selected_payload, list):
                    selected_segments = selected_payload
                else:
                    selected_segments = []
            except Exception:
                selected_segments = []

        segments = []
        total_duration = 0.0
        for idx, item in enumerate(selected_segments if isinstance(selected_segments, list) else []):
            try:
                start = float(item.get("start_time", item.get("start", 0.0)))
                end = float(item.get("end_time", item.get("end", 0.0)))
            except Exception:
                start, end = 0.0, 0.0
            duration = max(0.0, end - start)
            raw_text = str(
                item.get("summary")
                or item.get("text")
                or item.get("subtitle_text")
                or item.get("goal")
                or ""
            ).strip()
            if not raw_text:
                continue
            chunk_count = 1
            if duration >= 36:
                chunk_count = 4
            elif duration >= 24:
                chunk_count = 3
            elif duration >= 12:
                chunk_count = 2
            groups = self.split_text_into_semantic_groups(raw_text, target_groups=chunk_count)
            if not groups:
                groups = [self.normalize_sentence_text(raw_text)]
            if not groups:
                continue

            per_group_duration = max(1.2, duration / max(1, len(groups)))
            for group_index, summary in enumerate(groups):
                group_start = start + group_index * per_group_duration
                group_end = min(end if end > start else group_start + per_group_duration, group_start + per_group_duration)
                total_duration += max(0.0, group_end - group_start)
                segments.append({
                    "id": f"segment_{idx + 1}_{group_index + 1}",
                    "summary": summary,
                    "goal": summary,
                    "supporting_context": "",
                    "start_time": round(group_start, 3),
                    "end_time": round(group_end, 3),
                    "duration_sec": round(max(0.5, group_end - group_start), 3)
                })

        if not segments and self.audio_json.exists():
            try:
                audio_items = json.loads(self.audio_json.read_text(encoding="utf-8"))
            except Exception:
                audio_items = []
            if isinstance(audio_items, list):
                for idx, item in enumerate(audio_items[:8]):
                    text = self.normalize_sentence_text(item.get("text", ""))
                    if not text:
                        continue
                    try:
                        start = float(item.get("start", 0.0))
                        end = float(item.get("end", start + 3.0))
                    except Exception:
                        start, end = 0.0, 3.0
                    duration = max(0.5, end - start)
                    total_duration += duration
                    segments.append({
                        "id": f"segment_{idx + 1}",
                        "summary": text,
                        "goal": text,
                        "supporting_context": "",
                        "start_time": round(start, 3),
                        "end_time": round(end, 3),
                        "duration_sec": round(duration, 3)
                    })

        if not segments:
            # 最低限兜底：避免出现模板腔，给中性引导语
            segments = [{
                "id": "segment_1",
                "summary": "先把素材里的关键信息讲清楚，再补充一句结论。",
                "goal": "输出自然、简洁、可直接配音的口播",
                "supporting_context": "",
                "start_time": 0.0,
                "end_time": 30.0,
                "duration_sec": 30.0
            }]
            total_duration = 30.0

        outline = {
            "topic": "热点转视频生产线",
            "title": "热点素材脚本大纲",
            "summary": "根据已选素材自动重建",
            "source_duration_sec": round(total_duration, 3),
            "target_duration_sec": int(min(90, max(30, total_duration if total_duration > 0 else 45))),
            "segments": segments
        }

        try:
            outline_path.write_text(json.dumps(outline, ensure_ascii=False, indent=2), encoding="utf-8")
            self.log(f"已自动生成口播大纲: {outline_path.name}", "info")
            return True
        except Exception as e:
            self.log(f"生成口播大纲失败: {e}", "error")
            return False

    def step1_prepare_material(self) -> bool:
        """步骤1: 准备素材"""
        emit_stage("prepare", "准备素材文件")
        self.log("=" * 60, "step")
        self.log("步骤1: 准备素材", "step")
        self.log("=" * 60, "step")

        if not self.material_path.exists():
            self.log(f"素材文件不存在: {self.material_path}", "error")
            return False

        # 复制素材到工作目录
        import shutil
        source_path = self.material_path.resolve()
        target_path = self.material_file.resolve()
        if source_path == target_path:
            self.log(f"素材已在工作目录，跳过复制: {self.material_file}", "info")
        else:
            shutil.copy2(source_path, target_path)
            self.log(f"素材已复制到: {self.material_file}", "success")

        return True

    def _run_script_async(self, script_name: str, args: list = None, cwd: str = None):
        """异步运行 Python 脚本，返回 subprocess.Popen 对象。"""
        script_path = self.pipeline_dir / script_name
        if not script_path.exists():
            self.log(f"脚本不存在: {script_name}", "error")
            return None
        cmd = [sys.executable, str(script_path)]
        if args:
            cmd.extend(args)
        self.log(f"异步启动: {script_name}", "info")
        env = os.environ.copy()
        env["MATERIAL_REQUIRE_LLM_SCORING"] = "1" if self.require_llm else "0"
        return subprocess.Popen(
            cmd,
            cwd=cwd or str(self.output_dir),
            stdout=sys.stdout,
            stderr=sys.stderr,
            env=env,
        )

    def step2_analyze_material(self) -> bool:
        """步骤2: 分析素材（ASR + VLM）"""
        emit_stage("analyze", "分析素材内容")
        self.log("=" * 60, "step")
        self.log("步骤2: 分析素材", "step")
        self.log("=" * 60, "step")

        if self.use_cache and self.has_cached_files([self.audio_json, self.result_json]):
            self.log("命中缓存：复用已有 audio.json 和 result.json，跳过素材分析", "success")
            return True

        # ---- 并行执行 ASR 和 VLM ----
        # ASR 和 VLM 互不依赖：ASR 处理音频，VLM 处理视频画面。
        # 并行可节省 min(ASR耗时, VLM耗时) ≈ 3-4 分钟。
        self.log("2.1 + 2.2 并行启动 ASR 和 VLM...", "info")

        asr_args = [
            "--input", str(self.material_file),
            "--allow-no-audio",
            "--audio-json", str(self.audio_json),
            "--subtitles-json", "subtitles.json",
            "--speaker-scene-json", "speaker_scene.json"
        ]
        source_post = self.load_source_post()
        material_url = source_post.get("materialUrl") or ""
        if self.is_public_http_url(material_url):
            asr_args.extend(["--file-url", material_url])

        asr_proc = self._run_script_async("run_asr.py", asr_args)
        vlm_proc = self._run_script_async("video_vlm.py")

        if asr_proc is None or vlm_proc is None:
            # 某个脚本不存在，终止另一个
            for proc in [asr_proc, vlm_proc]:
                if proc is not None:
                    proc.kill()
            return False

        asr_rc = asr_proc.wait()
        vlm_rc = vlm_proc.wait()

        if asr_rc != 0:
            self.log(f"run_asr.py 失败 (返回码: {asr_rc})", "error")
            return False
        self.log("run_asr.py 完成", "success")

        if vlm_rc != 0:
            self.log(f"video_vlm.py 失败 (返回码: {vlm_rc})", "error")
            return False
        self.log("video_vlm.py 完成", "success")

        if not self.check_file(self.audio_json, "音频识别结果"):
            return False
        if not self.check_file(self.result_json, "视觉分析结果"):
            return False

        return True

    def step3_segment_material(self) -> bool:
        """步骤3: 素材切片和评分"""
        emit_stage("segment", "素材切片和评分")
        self.log("=" * 60, "step")
        self.log("步骤3: 素材切片", "step")
        self.log("=" * 60, "step")

        if self.use_cache and self.has_cached_files([
            self.output_dir / "material_segments.json",
            self.output_dir / "material_segments_scored.json",
            self.output_dir / "selected_segments.json",
        ]):
            self.log("命中缓存：复用已有素材切片、评分和选段结果", "success")
            return True

        # 3.1 切片
        self.log("3.1 按语义切片...", "info")
        if not self.run_script("segment_material.py"):
            return False

        # 3.2 评分
        self.log("3.2 评分素材片段...", "info")
        if not self.run_script("score_material_segments.py"):
            return False

        # 3.3 选择
        self.log("3.3 选择优质片段...", "info")
        if not self.run_script("select_material_segments.py"):
            return False

        required_outputs = [
            (self.output_dir / "material_segments_scored.json", "素材评分结果"),
            (self.output_dir / "selected_segments.json", "已选素材结果"),
        ]
        for file_path, description in required_outputs:
            if not self.check_file(file_path, description):
                self.log("步骤3脚本返回成功，但关键产物缺失，停止后续流程", "error")
                return False

        scored_payload = self.load_json_file(self.output_dir / "material_segments_scored.json", {})
        scored_meta = scored_payload.get("meta") if isinstance(scored_payload, dict) else {}
        if isinstance(scored_meta, dict) and scored_meta:
            self.log(
                f"素材评分来源: {scored_meta.get('provider', 'unknown')}/{scored_meta.get('model', 'unknown')} "
                f"[mode={scored_meta.get('decision_mode', 'unknown')}]",
                "info",
            )
            self.log(
                f"  llm_used={bool(scored_meta.get('llm_used'))} "
                f"fully_llm_scored={bool(scored_meta.get('fully_llm_scored'))} "
                f"fallback_used={bool(scored_meta.get('fallback_used'))}",
                "info",
            )

        return True

    def step4_director_planning(self) -> bool:
        """步骤4: 新编排规划。"""
        emit_stage("planning", "生成新链路编排输入")
        self.log("=" * 60, "step")
        self.log("步骤4: 编排规划", "step")
        self.log("=" * 60, "step")

        self.log("正在基于已选素材生成新链路编排输入...", "info")
        if not self.ensure_content_outline(force_regenerate=True):
            return False

        selected_payload = self.load_json_file(self.output_dir / "selected_segments.json", {})
        selected_segments = selected_payload.get("segments") if isinstance(selected_payload, dict) else selected_payload
        selected_segments = selected_segments if isinstance(selected_segments, list) else []
        total_duration = round(sum(float(item.get("duration_sec", 0) or 0) for item in selected_segments), 2)
        self.log("编排摘要:", "info")
        self.log(f"  已选素材段数: {len(selected_segments)}", "info")
        self.log(f"  素材总时长: {total_duration:.1f}秒", "info")

        for legacy_file in [self.output_dir / "director_raw.json", self.output_dir / "director_final.json"]:
            try:
                if legacy_file.exists():
                    legacy_file.unlink()
            except Exception:
                pass

        return True

    def step5_generate_narration(self) -> bool:
        """步骤5: 基于新链路生成脚本与整段口播稿。"""
        emit_stage("narration", "生成数字人解说词")
        self.log("=" * 60, "step")
        self.log("步骤5: 重建脚本与整段口播稿", "step")
        self.log("=" * 60, "step")

        manual_txt_file = self.output_dir / "manual_narration.txt"
        if manual_txt_file.exists():
            self.log("检测到手动输入口播稿，将跳过 AI 改写步骤...", "success")
            raw_text = manual_txt_file.read_text(encoding="utf-8").strip()
            if not raw_text:
                self.log("手动口播稿为空，回退到 AI 生成", "warning")
            else:
                # 将手动文本切分
                groups = self.split_text_into_semantic_groups(raw_text, target_groups=4)
                script_units = []
                for idx, text in enumerate(groups, start=1):
                    role = "hook" if idx == 1 else "ending" if idx == len(groups) else "explain"
                    script_units.append({
                        "id": f"script_{idx:03d}",
                        "role": role,
                        "text": text,
                        "audio_mode": "voiceover",
                        "subtitle_mode": "follow_global"
                    })
                
                self.save_json_file(self.script_units_json, {"version": "v1", "script_units": script_units})
                self.log(f"已手动生成 {len(script_units)} 段脚本单元", "success")
                
                # 直接回写规范化口播
                if not self.write_canonical_narration_from_script_units(script_units):
                    return False
                
                if self.aiman_file.exists():
                    if not self.is_avatar_cache_compatible(script_units):
                        self.clear_stale_avatar_runtime_artifacts()
                        self.log("检测到当前手动口播稿与现有数字人不一致，已跳过 execution_plan 生成，请重新生成数字人", "warning")
                        return True
                    if not self.build_execution_plan_from_edit_plan():
                        return False
                return True

        self.log("根据素材大纲重建脚本，不再调用旧口播生成器...", "info")

        if not self.ensure_content_outline():
            return False

        for stale_file in [self.narration_json, self.output_dir / "narration.txt"]:
            try:
                if stale_file.exists():
                    stale_file.unlink()
            except Exception:
                pass

        if not self.generate_edit_plan():
            return False

        script_payload = self.load_json_file(self.script_units_json, {})
        script_units = script_payload.get("script_units") or []
        if not script_units:
            self.log("未生成 script_units，无法继续生成整段口播稿", "error")
            return False

        if not self.write_canonical_narration_from_script_units(script_units):
            self.log("回写规范化口播稿失败", "error")
            return False

        self.log("已用 script_units 生成整段口播稿，后续数字人只使用新脚本", "success")
        if not self.check_file(self.narration_json, "解说词"):
            return False

        self.log("已跳过二次整套剪辑计划生成，直接复用本轮 script_units 结果", "info")

        try:
            with open(self.narration_json, 'r', encoding='utf-8') as f:
                narration = json.load(f)

            full_text = narration.get('full_text', '')
            target_duration = float(narration.get('target_duration_sec', 0) or 0)

            self.log(f"解说词摘要:", "info")
            self.log(f"  目标时长: {target_duration:.1f}秒", "info")
            self.log(f"  字数: {len(full_text)}字", "info")
            if target_duration > 0:
                self.log(f"  预计语速: {len(full_text)/target_duration:.1f}字/秒", "info")

        except Exception as e:
            self.log(f"读取解说词失败: {e}", "warning")

        if self.aiman_file.exists():
            if not self.is_avatar_cache_compatible(script_units):
                self.clear_stale_avatar_runtime_artifacts()
                self.log("检测到当前最终口播稿与现有数字人不一致，已跳过 execution_plan 生成，请重新生成数字人", "warning")
                return True
            if not self.build_execution_plan_from_edit_plan():
                return False

        return True

    def step6_generate_avatar(self) -> bool:
        """步骤6: 生成数字人（需要ComfyUI）"""
        emit_stage("avatar", "生成数字人视频")
        self.log("=" * 60, "step")
        self.log("步骤6: 生成数字人", "step")
        self.log("=" * 60, "step")

        self.log("⚠️ 此步骤需要通过Node.js服务调用ComfyUI", "warning")
        self.log("请确保:", "info")
        self.log("  1. ComfyUI服务正在运行", "info")
        self.log("  2. 已配置COMFYUI_BASE_URL", "info")
        self.log("  3. 通过前端或API触发数字人生成", "info")

        # 等待aiman.mp4生成
        self.log("等待数字人视频生成...", "info")
        self.log(f"预期输出: {self.aiman_file}", "info")

        script_payload = self.load_json_file(self.script_units_json, {})
        script_units = script_payload.get("script_units") or []

        # 检查是否已存在且与当前脚本兼容
        if self.use_cache and self.check_file(self.aiman_file, "数字人视频缓存"):
            if not self.avatar_manifest_json.exists():
                self.log("未找到数字人缓存清单，按当前口播继续生成映射并补写清单", "info")
            if script_units and not self.is_avatar_cache_compatible(script_units):
                self.log("检测到当前最终口播稿与现有数字人缓存不一致，请重新生成数字人", "warning")
                return False
            if script_units:
                if not self.generate_avatar_segments(script_units):
                    return False
                if not self.validate_avatar_coverage():
                    return False
                if not self.generate_edit_plan(reuse_scripts=True):
                    return False
                if not self.build_execution_plan_from_edit_plan():
                    return False
            return True

        if self.check_file(self.aiman_file, "数字人视频"):
            if not self.avatar_manifest_json.exists():
                self.log("未找到数字人缓存清单，按当前口播继续生成映射并补写清单", "info")
            if script_units and not self.is_avatar_cache_compatible(script_units):
                self.log("检测到当前最终口播稿与现有数字人不一致，请重新生成数字人", "warning")
                return False
            if script_units:
                if not self.generate_avatar_segments(script_units):
                    return False
                if not self.validate_avatar_coverage():
                    return False
                if not self.generate_edit_plan(reuse_scripts=True):
                    return False
                if not self.build_execution_plan_from_edit_plan():
                    return False
            return True

        self.log("数字人视频未找到，请手动生成后继续", "warning")
        return False

    def step7_smart_mixing(self) -> bool:
        """步骤7: 数字人解说渲染"""
        emit_stage("mixing", "数字人解说渲染")
        self.log("=" * 60, "step")
        self.log("步骤7: 数字人解说渲染", "step")
        self.log("=" * 60, "step")

        # 检查必要文件
        if not self.check_file(self.aiman_file, "数字人视频"):
            self.log("缺少数字人视频，无法渲染", "error")
            return False

        if not self.check_file(self.material_file, "素材视频"):
            self.log("缺少素材视频，无法渲染", "error")
            return False

        plan_path = str(self.execution_plan_json)
        if self.execution_plan_json.exists():
            self.log("优先使用 edit_plan 转换后的执行计划进行渲染", "info")
        else:
            self.log("缺少 execution_plan，无法渲染", "error")
            return False

        # 使用 SmartVideoComposer 进行数字人解说渲染
        try:
            self.log("初始化智能视频合成器", "info")
            composer = SmartVideoComposer(str(self.output_dir))

            if self.use_smart_clip:
                self.log("使用数字人主讲模式（静音插片 + 硬件加速 + 单音轨口播）", "info")
            else:
                self.log("使用基础剪辑模式", "info")

            success = composer.compose_from_director_plan(
                director_plan_path=plan_path,
                material_video=str(self.material_file),
                aiman_video=str(self.aiman_file),
                output_path=str(self.output_file),
                use_smart_clip=self.use_smart_clip
            )

            if not success:
                self.log("数字人解说渲染失败", "error")
                return False

        except Exception as e:
            self.log(f"数字人解说渲染异常: {e}", "error")
            return False

        if not self.check_file(self.output_file, "最终视频"):
            return False

        self.clear_legacy_artifacts()
        self.log("已清理旧审核链历史产物", "info")

        return True

    def run(self, start_from: int = 1, end_at: int = 7) -> bool:
        """运行完整流程"""
        self.log("🚀 素材驱动的数字人视频制作流程", "step")
        self.log(f"素材: {self.material_path}", "info")
        self.log(f"输出: {self.output_dir}", "info")
        self.log(f"智能剪辑: {'启用' if self.use_smart_clip else '禁用'}", "info")
        self.log(f"缓存复用: {'启用' if self.use_cache else '禁用'}", "info")
        self.log(f"LLM 严格模式: {'启用' if self.require_llm else '禁用'}", "info")

        steps = [
            (1, "准备素材", self.step1_prepare_material),
            (2, "分析素材", self.step2_analyze_material),
            (3, "素材切片", self.step3_segment_material),
            (4, "编排规划", self.step4_director_planning),
            (5, "生成解说词", self.step5_generate_narration),
            (6, "生成数字人", self.step6_generate_avatar),
            (7, "数字人解说渲染", self.step7_smart_mixing),
        ]

        for step_num, step_name, step_func in steps:
            if step_num < start_from:
                continue
            if step_num > end_at:
                break

            try:
                if not step_func():
                    self.log(f"步骤{step_num}失败: {step_name}", "error")
                    return False
            except Exception as e:
                self.log(f"步骤{step_num}异常: {e}", "error")
                import traceback
                traceback.print_exc()
                return False

        self.log("=" * 60, "step")
        if end_at < 7:
            self.log(f"阶段执行完成，当前停在步骤{end_at}", "success")
            emit_result({"output_dir": str(self.output_dir), "end_at": end_at})
        else:
            self.log("🎉 流程完成！", "success")
            self.log(f"最终视频: {self.output_file}", "success")
            emit_result({"output": str(self.output_file)})
        self.log("=" * 60, "step")
        return True


def main():
    parser = argparse.ArgumentParser(description="素材驱动的数字人视频制作")
    parser.add_argument("material", help="素材视频路径")
    parser.add_argument("--output-dir", "-o", default="./", help="输出目录")
    parser.add_argument("--no-smart-clip", action="store_true", help="禁用智能剪辑")
    parser.add_argument("--use-cache", action="store_true", help="优先复用已有中间产物缓存")
    parser.add_argument("--strict-llm", action="store_true", help="兼容参数；当前默认已启用严格 LLM")
    parser.add_argument("--allow-rule-fallback", action="store_true", help="显式允许规则回退，覆盖默认严格模式")
    parser.add_argument("--start-from", type=int, default=1, choices=range(1, 8),
                       help="从指定步骤开始 (1-7)")
    parser.add_argument("--end-at", type=int, default=7, choices=range(1, 8),
                       help="在指定步骤结束 (1-7)")

    args = parser.parse_args()

    pipeline = MaterialDrivenPipeline(
        material_path=args.material,
        output_dir=args.output_dir,
        use_smart_clip=not args.no_smart_clip,
        use_cache=args.use_cache,
        require_llm=(not bool(args.allow_rule_fallback)) or bool(args.strict_llm),
    )

    success = pipeline.run(start_from=args.start_from, end_at=args.end_at)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
