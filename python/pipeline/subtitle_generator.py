#!/usr/bin/env python3
"""
字幕生成器
使用Whisper模型自动生成视频字幕
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import re
from pathlib import Path
from typing import Optional, List, Dict
from timeit import default_timer as timer

# 检查依赖
WHISPER_AVAILABLE = False
try:
    from faster_whisper import WhisperModel
    WHISPER_AVAILABLE = True
except ImportError:
    print("⚠️ faster-whisper 未安装，字幕生成功能不可用")
    print("   安装: pip install faster-whisper")

MOVIEPY_AVAILABLE = False
try:
    from moviepy import VideoFileClip
    MOVIEPY_AVAILABLE = True
except ImportError:
    print("⚠️ moviepy 未安装，视频音频提取功能不可用")
    print("   安装: pip install moviepy")


class SubtitleGenerator:
    """字幕生成器"""

    def __init__(
        self,
        model_path: Optional[str] = None,
        device: str = "auto",
        compute_type: str = "auto"
    ):
        """
        初始化字幕生成器

        Args:
            model_path: Whisper模型路径（如果为None，使用在线模型）
            device: 设备类型 (auto/cuda/cpu)
            compute_type: 计算类型 (auto/float16/int8)
        """
        if not WHISPER_AVAILABLE:
            raise ImportError("faster-whisper 未安装")

        self.model = None
        self.model_path = model_path
        self.device = device
        self.compute_type = compute_type

        # 自动检测设备
        if device == "auto":
            self.device = self._detect_device()

        # 自动选择计算类型
        if compute_type == "auto":
            self.compute_type = "float16" if self.device == "cuda" else "int8"

    def _detect_device(self) -> str:
        """检测可用设备"""
        try:
            import torch
            if torch.cuda.is_available():
                print("✅ 检测到CUDA，使用GPU加速")
                return "cuda"
        except:
            pass

        print("ℹ️ 使用CPU模式")
        return "cpu"

    def _load_model(self):
        """加载Whisper模型"""
        if self.model:
            return

        print(f"\n📦 加载Whisper模型...")
        print(f"   设备: {self.device}")
        print(f"   计算类型: {self.compute_type}")

        try:
            if self.model_path and os.path.exists(self.model_path):
                # 使用本地模型
                print(f"   模型路径: {self.model_path}")
                self.model = WhisperModel(
                    model_size_or_path=self.model_path,
                    device=self.device,
                    compute_type=self.compute_type,
                    local_files_only=True
                )
            else:
                # 使用在线模型
                model_size = "base"  # 可选: tiny, base, small, medium, large
                print(f"   使用在线模型: {model_size}")
                self.model = WhisperModel(
                    model_size_or_path=model_size,
                    device=self.device,
                    compute_type=self.compute_type
                )

            print("✅ 模型加载完成")

        except Exception as e:
            print(f"❌ 模型加载失败: {e}")
            # 降级到CPU
            if self.device == "cuda":
                print("   尝试使用CPU模式...")
                self.device = "cpu"
                self.compute_type = "int8"
                self.model = WhisperModel(
                    model_size_or_path=self.model_path or "base",
                    device=self.device,
                    compute_type=self.compute_type
                )
                print("✅ CPU模式加载成功")
            else:
                raise

    def generate_from_audio(
        self,
        audio_file: str,
        output_file: Optional[str] = None,
        language: str = "zh"
    ) -> Optional[str]:
        """
        从音频文件生成字幕

        Args:
            audio_file: 音频文件路径
            output_file: 输出SRT文件路径
            language: 语言代码 (zh/en/ja等)

        Returns:
            字幕文件路径
        """
        if not os.path.exists(audio_file):
            print(f"❌ 音频文件不存在: {audio_file}")
            return None

        self._load_model()

        if not output_file:
            output_file = f"{audio_file}.srt"

        print(f"\n🎤 开始生成字幕...")
        print(f"   音频: {audio_file}")
        print(f"   语言: {language}")

        start_time = timer()

        try:
            # 转录音频
            segments, info = self.model.transcribe(
                audio_file,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
                language=language,
                initial_prompt="以下是普通话的句子" if language == "zh" else None
            )

            print(f"   检测语言: {info.language} (置信度: {info.language_probability:.2f})")

            # 处理字幕
            subtitles = []
            for segment in segments:
                if not segment.words:
                    continue

                seg_start = segment.start
                seg_end = segment.end
                seg_text = ""

                # 按标点符号断句
                for word in segment.words:
                    seg_text += word.word

                    if self._contains_punctuation(word.word):
                        # 移除标点
                        text = seg_text[:-1].strip()
                        if text:
                            subtitles.append({
                                "text": text,
                                "start": seg_start,
                                "end": word.end
                            })
                            seg_start = word.end
                            seg_text = ""

                # 处理剩余文本
                if seg_text.strip():
                    subtitles.append({
                        "text": seg_text.strip(),
                        "start": seg_start,
                        "end": seg_end
                    })

            # 写入SRT文件
            self._write_srt(subtitles, output_file)

            elapsed = timer() - start_time
            print(f"\n✅ 字幕生成完成")
            print(f"   输出: {output_file}")
            print(f"   字幕数: {len(subtitles)}")
            print(f"   耗时: {elapsed:.2f}秒")

            return output_file

        except Exception as e:
            print(f"\n❌ 字幕生成失败: {e}")
            return None

    def generate_from_video(
        self,
        video_file: str,
        output_file: Optional[str] = None,
        language: str = "zh"
    ) -> Optional[str]:
        """
        从视频文件生成字幕

        Args:
            video_file: 视频文件路径
            output_file: 输出SRT文件路径
            language: 语言代码

        Returns:
            字幕文件路径
        """
        if not MOVIEPY_AVAILABLE:
            print("❌ moviepy 未安装，无法提取视频音频")
            return None

        if not os.path.exists(video_file):
            print(f"❌ 视频文件不存在: {video_file}")
            return None

        print(f"\n🎬 从视频提取音频...")

        # 提取音频
        video_dir = Path(video_file).parent
        video_name = Path(video_file).stem
        audio_file = video_dir / f"{video_name}_audio.wav"

        try:
            video = VideoFileClip(video_file)
            video.audio.write_audiofile(str(audio_file), codec='pcm_s16le', verbose=False, logger=None)
            video.close()

            print(f"✅ 音频提取完成: {audio_file}")

            # 生成字幕
            result = self.generate_from_audio(str(audio_file), output_file, language)

            # 清理临时音频
            if audio_file.exists():
                audio_file.unlink()
                print("   已清理临时音频文件")

            return result

        except Exception as e:
            print(f"❌ 视频处理失败: {e}")
            return None

    def _contains_punctuation(self, text: str) -> bool:
        """检查文本是否包含标点符号"""
        punctuations = '。！？，、；：,.!?;:'
        return any(p in text for p in punctuations)

    def _write_srt(self, subtitles: List[Dict], output_file: str):
        """写入SRT格式字幕"""
        lines = []
        for idx, sub in enumerate(subtitles, 1):
            start = self._format_timestamp(sub['start'])
            end = self._format_timestamp(sub['end'])
            text = sub['text']

            lines.append(f"{idx}")
            lines.append(f"{start} --> {end}")
            lines.append(text)
            lines.append("")

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

    def _format_timestamp(self, seconds: float) -> str:
        """格式化时间戳为SRT格式"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def create_generator(
    model_path: Optional[str] = None,
    device: str = "auto",
    compute_type: str = "auto"
) -> SubtitleGenerator:
    """创建字幕生成器实例"""
    return SubtitleGenerator(model_path, device, compute_type)


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="字幕生成工具")
    parser.add_argument("input", help="输入文件（音频或视频）")
    parser.add_argument("--output", "-o", help="输出SRT文件路径")
    parser.add_argument("--language", "-l", default="zh", help="语言代码 (zh/en/ja等)")
    parser.add_argument("--model", "-m", help="Whisper模型路径")
    parser.add_argument("--device", "-d", default="auto", choices=["auto", "cuda", "cpu"], help="设备类型")
    parser.add_argument("--compute-type", "-c", default="auto", choices=["auto", "float16", "int8"], help="计算类型")

    args = parser.parse_args()

    if not WHISPER_AVAILABLE:
        print("❌ faster-whisper 未安装")
        print("   安装: pip install faster-whisper")
        sys.exit(1)

    generator = create_generator(args.model, args.device, args.compute_type)

    # 判断输入类型
    input_ext = Path(args.input).suffix.lower()
    if input_ext in ['.mp4', '.avi', '.mkv', '.mov', '.flv']:
        # 视频文件
        result = generator.generate_from_video(args.input, args.output, args.language)
    else:
        # 音频文件
        result = generator.generate_from_audio(args.input, args.output, args.language)

    if result:
        print(f"\n🎉 完成！字幕文件: {result}")
    else:
        print("\n❌ 字幕生成失败")
        sys.exit(1)
