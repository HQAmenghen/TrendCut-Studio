"""
智能视频合成器 - 集成NarratoAI的OST策略和MoviePy合成逻辑

核心功能:
1. OST-based智能剪辑 (从clip_video.py)
2. MoviePy多轨合成 (从generate_video.py)
3. 硬件加速 + 智能Fallback
4. 音频响度统一
"""

import os
import json
import subprocess
from pathlib import Path
from typing import List, Dict, Optional, Tuple
# MoviePy 2.x 移除了 moviepy.editor 入口；这里做双版本兼容
try:
    from moviepy import (
        VideoFileClip, AudioFileClip, CompositeVideoClip,
        CompositeAudioClip, concatenate_videoclips
    )
except ImportError:  # pragma: no cover - 兼容旧版
    from moviepy.editor import (
        VideoFileClip, AudioFileClip, CompositeVideoClip,
        CompositeAudioClip, concatenate_videoclips
    )
from moviepy.video.VideoClip import TextClip
import logging

try:
    from .video_clip_engine import VideoClipEngine
except Exception:
    try:
        from video_clip_engine import VideoClipEngine
    except Exception:
        # 兼容当前仓库 video_clip_engine 只有函数、没有类 的情况
        try:
            from . import video_clip_engine as _video_clip_engine
        except Exception:
            import video_clip_engine as _video_clip_engine

        class VideoClipEngine:
            def __init__(self):
                self.hwaccel_type = _video_clip_engine.check_hardware_acceleration()

            def get_encoder_config(self):
                cfg = _video_clip_engine.get_encoder_config(self.hwaccel_type)
                codec = cfg.get('video_codec', 'libx264')
                preset = cfg.get('preset', 'medium')
                quality_param = cfg.get('quality_param', 'crf')
                quality_value = str(cfg.get('quality_value', '23'))
                args = ['-c:v', codec, '-preset', preset]
                if quality_param == 'cq':
                    args.extend(['-cq', quality_value])
                elif quality_param == 'global_quality':
                    args.extend(['-global_quality', quality_value])
                elif quality_param == 'b:v':
                    args.extend(['-b:v', quality_value])
                elif quality_param == 'qp_i':
                    args.extend(['-qp_i', quality_value])
                else:
                    args.extend(['-crf', quality_value])
                return args

try:
    from .audio_processor import AudioProcessor
except ImportError:  # 兼容直接脚本运行
    from audio_processor import AudioProcessor

logger = logging.getLogger(__name__)


class SmartVideoComposer:
    """智能视频合成器"""

    def __init__(self, work_dir: str):
        self.work_dir = Path(work_dir)
        self.clip_engine = VideoClipEngine()
        self.audio_processor = AudioProcessor()
        # 轻微软转场，避免硬切。默认 80ms，可通过环境变量关闭/调整。
        try:
            self.crossfade_seconds = max(0.0, float(os.getenv("SMART_CLIP_CROSSFADE_SECONDS", "0.08")))
        except Exception:
            self.crossfade_seconds = 0.08

    def compose_from_director_plan(
        self,
        director_plan_path: str,
        material_video: str,
        aiman_video: str,
        output_path: str,
        use_smart_clip: bool = True
    ) -> bool:
        """
        根据导演方案合成最终视频

        Args:
            director_plan_path: 导演方案JSON路径
            material_video: 素材视频路径
            aiman_video: 数字人视频路径
            output_path: 输出视频路径
            use_smart_clip: 是否使用智能剪辑

        Returns:
            是否成功
        """
        try:
            # 1. 加载导演方案
            with open(director_plan_path, 'r', encoding='utf-8') as f:
                plan = json.load(f)

            if isinstance(plan, dict):
                raw_segments = plan.get('segments', [])
            elif isinstance(plan, list):
                raw_segments = plan
            else:
                raw_segments = []

            # 兼容两种导演方案格式：
            # 1) 新格式: {"segments":[{"type","start","end","duration","ost"...}]}
            # 2) 现格式: [{"video_source","start_time","end_time","cut_start","cut_end"...}]
            segments = []
            for item in raw_segments:
                if not isinstance(item, dict):
                    continue
                seg_type = item.get('type')
                if not seg_type:
                    video_source = str(item.get('video_source', '')).lower()
                    seg_type = 'aiman' if 'aiman' in video_source else 'material'

                start = float(item.get('start', item.get('cut_start', item.get('start_time', 0.0))) or 0.0)
                end = float(item.get('end', item.get('cut_end', item.get('end_time', start))) or start)
                duration = float(item.get('duration', max(0.0, end - start)) or 0.0)
                tts_duration = float(item.get('tts_duration', duration) or duration)
                ost = int(item.get('ost', 1 if item.get('audio_source') == 'main' else 0))

                segments.append({
                    **item,
                    'type': seg_type,
                    'start': start,
                    'end': end,
                    'duration': duration,
                    'tts_duration': tts_duration,
                    'ost': ost
                })

            logger.info(f"加载导演方案: {len(segments)} 个片段")

            # 2. 准备临时目录
            temp_dir = self.work_dir / "temp_clips"
            temp_dir.mkdir(exist_ok=True)

            # 3. 根据OST策略剪辑片段
            clip_paths = []
            for i, segment in enumerate(segments):
                clip_path = temp_dir / f"clip_{i:03d}.mp4"

                if use_smart_clip:
                    success = self._clip_segment_with_ost(
                        segment, material_video, aiman_video, clip_path
                    )
                else:
                    success = self._clip_segment_basic(
                        segment, material_video, aiman_video, clip_path
                    )

                if success:
                    clip_paths.append(str(clip_path))
                else:
                    logger.warning(f"片段 {i} 剪辑失败，跳过")

            if not clip_paths:
                logger.error("没有成功剪辑的片段")
                return False

            # 4. 使用MoviePy合成最终视频
            logger.info(f"开始合成 {len(clip_paths)} 个片段")
            success = self._compose_with_moviepy(clip_paths, output_path)

            # 5. 清理临时文件
            if success:
                logger.info("清理临时文件")
                for clip_path in clip_paths:
                    try:
                        os.remove(clip_path)
                    except:
                        pass

            return success

        except Exception as e:
            logger.error(f"合成失败: {e}", exc_info=True)
            return False

    def _clip_segment_with_ost(
        self,
        segment: Dict,
        material_video: str,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """
        使用OST策略剪辑片段

        OST策略:
        - type="material" + ost=0: 纯解说，移除原声，按TTS时长剪辑
        - type="material" + ost=1: 纯原声，保留原声，按时间戳剪辑
        - type="material" + ost=2: 混合，保留原声，按TTS时长剪辑
        - type="aiman": 数字人片段，直接剪辑
        """
        try:
            seg_type = segment.get('type')
            ost = segment.get('ost', 0)

            if seg_type == 'aiman':
                # 数字人片段
                return self._clip_aiman_segment(segment, aiman_video, output_path)

            elif seg_type == 'material':
                if ost == 0:
                    # 纯解说：移除原声
                    return self._clip_material_narration_only(
                        segment, material_video, output_path
                    )
                elif ost == 1:
                    # 纯原声：保留原声
                    return self._clip_material_original_audio(
                        segment, material_video, output_path
                    )
                elif ost == 2:
                    # 混合：保留原声+解说
                    return self._clip_material_mixed(
                        segment, material_video, output_path
                    )

            logger.warning(f"未知片段类型: {seg_type}, ost={ost}")
            return False

        except Exception as e:
            logger.error(f"剪辑片段失败: {e}", exc_info=True)
            return False

    def _clip_aiman_segment(
        self,
        segment: Dict,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """剪辑数字人片段"""
        try:
            start = segment.get('start', 0)
            duration = segment.get('duration', 0)

            if duration <= 0:
                logger.warning("数字人片段时长无效")
                return False

            # 防止导演方案时间超过数字人素材时长，自动纠正到可用区间
            video_duration = self._get_video_duration(aiman_video)
            if video_duration > 0:
                max_start = max(0.0, video_duration - duration)
                if start > max_start:
                    logger.warning(
                        f"数字人片段起点超出素材时长，自动纠正: start={start:.2f}s -> {max_start:.2f}s"
                    )
                    start = max_start
                duration = min(duration, max(0.1, video_duration - start))

            # 使用硬件加速剪辑
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', aiman_video
            ]

            # 添加编码器配置
            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"数字人片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.warning("数字人片段硬件剪辑失败，尝试软件编码回退")
                ok = self._clip_with_software_fallback(
                    aiman_video, start, duration, output_path, remove_audio=False
                )
                if not ok:
                    logger.error(f"数字人片段剪辑失败: {result.stderr}")
                return ok

        except Exception as e:
            logger.error(f"剪辑数字人片段异常: {e}", exc_info=True)
            return False

    def _clip_material_narration_only(
        self,
        segment: Dict,
        material_video: str,
        output_path: Path
    ) -> bool:
        """
        OST=0: 纯解说片段
        - 移除原声
        - 按TTS时长剪辑
        """
        try:
            start = segment.get('start', 0)
            tts_duration = segment.get('tts_duration', 0)

            if tts_duration <= 0:
                logger.warning("TTS时长无效")
                return False

            # 剪辑视频并移除音频
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(tts_duration),
                '-i', material_video,
                '-an'  # 移除音频
            ]

            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"纯解说片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.error(f"纯解说片段剪辑失败: {result.stderr}")
                # Fallback: 使用软件编码
                return self._clip_with_software_fallback(
                    material_video, start, tts_duration, output_path, remove_audio=True
                )

        except Exception as e:
            logger.error(f"剪辑纯解说片段异常: {e}", exc_info=True)
            return False

    def _clip_material_original_audio(
        self,
        segment: Dict,
        material_video: str,
        output_path: Path
    ) -> bool:
        """
        OST=1: 纯原声片段
        - 保留原声
        - 按时间戳剪辑
        """
        try:
            start = segment.get('start', 0)
            end = segment.get('end', 0)
            duration = end - start

            if duration <= 0:
                logger.warning("片段时长无效")
                return False

            # 剪辑视频并保留音频
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', material_video
            ]

            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-c:a', 'aac',
                '-b:a', '192k',
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"纯原声片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.warning("纯原声片段硬件剪辑失败，尝试软件编码回退")
                return self._clip_with_software_fallback(
                    material_video, start, duration, output_path, remove_audio=False
                )

        except Exception as e:
            logger.error(f"剪辑纯原声片段异常: {e}", exc_info=True)
            return False

    def _clip_material_mixed(
        self,
        segment: Dict,
        material_video: str,
        output_path: Path
    ) -> bool:
        """
        OST=2: 混合片段
        - 保留原声（后续会混合解说）
        - 按TTS时长剪辑
        """
        try:
            start = segment.get('start', 0)
            tts_duration = segment.get('tts_duration', 0)

            if tts_duration <= 0:
                logger.warning("TTS时长无效")
                return False

            # 剪辑视频并保留音频
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(tts_duration),
                '-i', material_video
            ]

            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-c:a', 'aac',
                '-b:a', '192k',
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"混合片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.warning("混合片段硬件剪辑失败，尝试软件编码回退")
                return self._clip_with_software_fallback(
                    material_video, start, tts_duration, output_path, remove_audio=False
                )

        except Exception as e:
            logger.error(f"剪辑混合片段异常: {e}", exc_info=True)
            return False

    def _clip_with_software_fallback(
        self,
        video_path: str,
        start: float,
        duration: float,
        output_path: Path,
        remove_audio: bool = False
    ) -> bool:
        """软件编码Fallback"""
        try:
            logger.info("使用软件编码Fallback")

            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', video_path,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23'
            ]

            if remove_audio:
                cmd.append('-an')
            else:
                cmd.extend(['-c:a', 'aac', '-b:a', '192k'])

            cmd.extend([
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            return result.returncode == 0

        except Exception as e:
            logger.error(f"软件编码Fallback失败: {e}", exc_info=True)
            return False

    def _get_video_duration(self, video_path: str) -> float:
        """通过 ffprobe 获取视频时长（秒）。"""
        try:
            cmd = [
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                return 0.0
            return float((result.stdout or '').strip() or 0.0)
        except Exception:
            return 0.0

    def _clip_segment_basic(
        self,
        segment: Dict,
        material_video: str,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """基础剪辑（不使用智能剪辑）"""
        try:
            seg_type = segment.get('type')
            start = segment.get('start', 0)
            duration = segment.get('duration', 0)

            if duration <= 0:
                return False

            source_video = aiman_video if seg_type == 'aiman' else material_video

            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', source_video,
                '-c', 'copy',
                str(output_path)
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            return result.returncode == 0

        except Exception as e:
            logger.error(f"基础剪辑失败: {e}", exc_info=True)
            return False

    def _compose_with_moviepy(
        self,
        clip_paths: List[str],
        output_path: str
    ) -> bool:
        """
        使用MoviePy合成最终视频
        集成NarratoAI的merge_materials逻辑
        """
        try:
            logger.info("使用MoviePy合成视频")

            # 1. 加载所有片段
            clips = []
            for clip_path in clip_paths:
                try:
                    clip = VideoFileClip(clip_path)
                    clips.append(clip)
                except Exception as e:
                    logger.warning(f"加载片段失败 {clip_path}: {e}")

            if not clips:
                logger.error("没有可用的视频片段")
                return False

            # 2. 拼接视频（带轻微软转场）
            logger.info(f"拼接 {len(clips)} 个片段")
            if len(clips) > 1 and self.crossfade_seconds > 0:
                try:
                    # 负 padding 会在相邻片段间形成短暂重叠，减少“硬切”观感
                    final_video = concatenate_videoclips(
                        clips,
                        method="compose",
                        padding=-self.crossfade_seconds
                    )
                except TypeError:
                    # 兼容部分 MoviePy 版本可能不支持 padding 参数
                    final_video = concatenate_videoclips(clips, method="compose")
            else:
                final_video = concatenate_videoclips(clips, method="compose")

            # 3. 音频响度统一
            if final_video.audio is not None:
                logger.info("统一音频响度")
                final_video = self._normalize_audio(final_video)

            # 4. 导出最终视频
            logger.info(f"导出最终视频: {output_path}")
            final_video.write_videofile(
                output_path,
                codec='libx264',
                audio_codec='aac',
                temp_audiofile='temp-audio.m4a',
                remove_temp=True,
                fps=30,
                preset='medium',
                threads=4
            )

            # 5. 清理
            for clip in clips:
                clip.close()
            final_video.close()

            logger.info("视频合成完成")
            return True

        except Exception as e:
            logger.error(f"MoviePy合成失败: {e}", exc_info=True)
            # Fallback: 使用FFmpeg concat
            return self._compose_with_ffmpeg_concat(clip_paths, output_path)

    def _normalize_audio(self, video_clip):
        """统一音频响度到-16 LUFS"""
        try:
            # 分析音频响度
            temp_audio = "temp_audio_analysis.wav"
            video_clip.audio.write_audiofile(temp_audio, logger=None)

            loudness = self.audio_processor.analyze_loudness(temp_audio)
            target_loudness = -16.0
            adjustment = target_loudness - loudness

            # 调整音量
            if abs(adjustment) > 0.5:
                logger.info(f"调整音量: {adjustment:.1f} dB")
                factor = 10 ** (adjustment / 20)
                # MoviePy 1.x: audio.fx(volumex, factor) + set_audio
                # MoviePy 2.x: with_effects([MultiplyVolume]) + with_audio
                try:
                    from moviepy.audio.fx.all import volumex  # 1.x
                    adjusted_audio = video_clip.audio.fx(volumex, factor)
                except Exception:
                    from moviepy.audio.fx.MultiplyVolume import MultiplyVolume  # 2.x
                    adjusted_audio = video_clip.audio.with_effects([MultiplyVolume(factor)])

                if hasattr(video_clip, 'set_audio'):
                    video_clip = video_clip.set_audio(adjusted_audio)
                else:
                    video_clip = video_clip.with_audio(adjusted_audio)

            # 清理临时文件
            if os.path.exists(temp_audio):
                os.remove(temp_audio)

            return video_clip

        except Exception as e:
            logger.warning(f"音频响度统一失败: {e}")
            return video_clip

    def _compose_with_ffmpeg_concat(
        self,
        clip_paths: List[str],
        output_path: str
    ) -> bool:
        """FFmpeg concat Fallback"""
        try:
            logger.info("使用FFmpeg concat Fallback")

            # 创建concat文件
            concat_file = self.work_dir / "concat_list.txt"
            with open(concat_file, 'w', encoding='utf-8') as f:
                for clip_path in clip_paths:
                    f.write(f"file '{clip_path}'\n")

            # 执行concat
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', str(concat_file),
                '-c', 'copy',
                output_path
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600
            )

            # 清理
            if concat_file.exists():
                concat_file.unlink()

            return result.returncode == 0

        except Exception as e:
            logger.error(f"FFmpeg concat失败: {e}", exc_info=True)
            return False
