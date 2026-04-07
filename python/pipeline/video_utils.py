#!/usr/bin/env python3
"""
视频工具集
提供视频处理的常用工具函数
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
from pathlib import Path
from typing import Optional, Tuple
from PIL import ImageFont

# 检查依赖
MOVIEPY_AVAILABLE = False
try:
    from moviepy import (
        VideoFileClip,
        AudioFileClip,
        ColorClip,
        CompositeVideoClip,
        CompositeAudioClip
    )
    MOVIEPY_AVAILABLE = True
except ImportError:
    print("⚠️ moviepy 未安装，视频处理功能不可用")
    print("   安装: pip install moviepy")


class VideoUtils:
    """视频工具类"""

    @staticmethod
    def wrap_text(
        text: str,
        max_width: int,
        font_path: str,
        fontsize: int = 60
    ) -> Tuple[str, int]:
        """
        文本自动换行

        Args:
            text: 待处理的文本
            max_width: 最大宽度（像素）
            font_path: 字体文件路径
            fontsize: 字体大小

        Returns:
            (换行后的文本, 文本高度)
        """
        if not os.path.exists(font_path):
            print(f"⚠️ 字体文件不存在: {font_path}")
            return text, fontsize

        # 创建字体对象
        font = ImageFont.truetype(font_path, fontsize)

        def get_text_size(inner_text: str) -> Tuple[int, int]:
            """获取文本尺寸"""
            inner_text = inner_text.strip()
            left, top, right, bottom = font.getbbox(inner_text)
            return right - left, bottom - top

        width, height = get_text_size(text)
        if width <= max_width:
            return text, height

        print(f"   换行文本，最大宽度: {max_width}, 文本宽度: {width}")

        # 尝试按空格分词换行
        wrapped_lines = []
        words = text.split(" ")
        current_line = ""

        for word in words:
            test_line = f"{current_line}{word} "
            test_width, _ = get_text_size(test_line)

            if test_width <= max_width:
                current_line = test_line
            else:
                if current_line.strip():
                    wrapped_lines.append(current_line.strip())
                current_line = f"{word} "

        if current_line.strip():
            wrapped_lines.append(current_line.strip())

        if wrapped_lines:
            result = "\n".join(wrapped_lines)
            total_height = len(wrapped_lines) * height
            return result, total_height

        # 如果按空格分词失败，按字符换行
        wrapped_lines = []
        current_line = ""

        for char in text:
            test_line = current_line + char
            test_width, _ = get_text_size(test_line)

            if test_width <= max_width:
                current_line = test_line
            else:
                if current_line:
                    wrapped_lines.append(current_line)
                current_line = char

        if current_line:
            wrapped_lines.append(current_line)

        result = "\n".join(wrapped_lines)
        total_height = len(wrapped_lines) * height
        return result, total_height

    @staticmethod
    def resize_with_padding(
        video_path: str,
        target_width: int,
        target_height: int,
        output_path: str,
        bg_color: Tuple[int, int, int] = (0, 0, 0)
    ) -> bool:
        """
        调整视频尺寸并添加黑边（保持宽高比）

        Args:
            video_path: 输入视频路径
            target_width: 目标宽度
            target_height: 目标高度
            output_path: 输出视频路径
            bg_color: 背景颜色 (R, G, B)

        Returns:
            是否成功
        """
        if not MOVIEPY_AVAILABLE:
            print("❌ moviepy 未安装")
            return False

        if not os.path.exists(video_path):
            print(f"❌ 视频文件不存在: {video_path}")
            return False

        print(f"\n📐 调整视频尺寸...")
        print(f"   输入: {video_path}")
        print(f"   目标尺寸: {target_width}x{target_height}")

        try:
            video = VideoFileClip(video_path)

            # 计算缩放比例
            clip_ratio = video.w / video.h
            target_ratio = target_width / target_height

            if clip_ratio == target_ratio:
                # 宽高比相同，直接缩放
                resized = video.resize((target_width, target_height))
            else:
                # 宽高比不同，添加黑边
                if clip_ratio > target_ratio:
                    # 视频更宽，以宽度为准
                    scale_factor = target_width / video.w
                else:
                    # 视频更高，以高度为准
                    scale_factor = target_height / video.h

                new_width = int(video.w * scale_factor)
                new_height = int(video.h * scale_factor)

                print(f"   缩放后尺寸: {new_width}x{new_height}")

                resized = video.resize((new_width, new_height))

                # 创建背景
                background = ColorClip(
                    size=(target_width, target_height),
                    color=bg_color
                ).set_duration(video.duration)

                # 合成
                resized = CompositeVideoClip([
                    background,
                    resized.set_position("center")
                ])

            # 导出
            resized.write_videofile(
                output_path,
                codec='libx264',
                audio_codec='aac',
                fps=video.fps
            )

            video.close()
            resized.close()

            print(f"✅ 视频已保存: {output_path}")
            return True

        except Exception as e:
            print(f"❌ 处理失败: {e}")
            return False

    @staticmethod
    def loop_audio(
        audio_path: str,
        target_duration: float,
        output_path: str
    ) -> bool:
        """
        循环音频直到达到目标时长

        Args:
            audio_path: 输入音频路径
            target_duration: 目标时长（秒）
            output_path: 输出音频路径

        Returns:
            是否成功
        """
        if not MOVIEPY_AVAILABLE:
            print("❌ moviepy 未安装")
            return False

        if not os.path.exists(audio_path):
            print(f"❌ 音频文件不存在: {audio_path}")
            return False

        print(f"\n🔁 循环音频...")
        print(f"   输入: {audio_path}")
        print(f"   目标时长: {target_duration}秒")

        try:
            audio = AudioFileClip(audio_path)

            if audio.duration >= target_duration:
                # 音频已经足够长，直接裁剪
                looped = audio.subclip(0, target_duration)
            else:
                # 需要循环
                loops_needed = int(target_duration / audio.duration) + 1
                print(f"   需要循环: {loops_needed}次")

                # 创建循环音频
                extended = audio
                for _ in range(loops_needed - 1):
                    extended = CompositeAudioClip([
                        extended,
                        audio.set_start(extended.duration)
                    ])

                # 裁剪到目标时长
                looped = extended.subclip(0, target_duration)

            # 导出
            looped.write_audiofile(output_path)

            audio.close()
            looped.close()

            print(f"✅ 音频已保存: {output_path}")
            return True

        except Exception as e:
            print(f"❌ 处理失败: {e}")
            return False

    @staticmethod
    def get_video_info(video_path: str) -> Optional[dict]:
        """
        获取视频信息

        Args:
            video_path: 视频文件路径

        Returns:
            视频信息字典
        """
        if not MOVIEPY_AVAILABLE:
            print("❌ moviepy 未安装")
            return None

        if not os.path.exists(video_path):
            print(f"❌ 视频文件不存在: {video_path}")
            return None

        try:
            video = VideoFileClip(video_path)

            info = {
                'width': video.w,
                'height': video.h,
                'duration': video.duration,
                'fps': video.fps,
                'has_audio': video.audio is not None,
                'size_mb': os.path.getsize(video_path) / (1024 * 1024)
            }

            video.close()
            return info

        except Exception as e:
            print(f"❌ 获取信息失败: {e}")
            return None

    @staticmethod
    def extract_audio(
        video_path: str,
        output_path: Optional[str] = None
    ) -> Optional[str]:
        """
        从视频提取音频

        Args:
            video_path: 视频文件路径
            output_path: 输出音频路径

        Returns:
            音频文件路径
        """
        if not MOVIEPY_AVAILABLE:
            print("❌ moviepy 未安装")
            return None

        if not os.path.exists(video_path):
            print(f"❌ 视频文件不存在: {video_path}")
            return None

        if not output_path:
            video_dir = Path(video_path).parent
            video_name = Path(video_path).stem
            output_path = str(video_dir / f"{video_name}_audio.mp3")

        print(f"\n🎵 提取音频...")
        print(f"   输入: {video_path}")

        try:
            video = VideoFileClip(video_path)

            if video.audio is None:
                print("❌ 视频没有音轨")
                video.close()
                return None

            video.audio.write_audiofile(output_path, verbose=False, logger=None)
            video.close()

            print(f"✅ 音频已保存: {output_path}")
            return output_path

        except Exception as e:
            print(f"❌ 提取失败: {e}")
            return None


def create_utils() -> VideoUtils:
    """创建视频工具实例"""
    return VideoUtils()


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="视频处理工具")
    subparsers = parser.add_subparsers(dest="command", help="子命令")

    # 调整尺寸
    resize_parser = subparsers.add_parser("resize", help="调整视频尺寸")
    resize_parser.add_argument("input", help="输入视频")
    resize_parser.add_argument("--width", "-w", type=int, required=True, help="目标宽度")
    resize_parser.add_argument("--height", "-h", type=int, required=True, help="目标高度")
    resize_parser.add_argument("--output", "-o", required=True, help="输出视频")

    # 循环音频
    loop_parser = subparsers.add_parser("loop", help="循环音频")
    loop_parser.add_argument("input", help="输入音频")
    loop_parser.add_argument("--duration", "-d", type=float, required=True, help="目标时长（秒）")
    loop_parser.add_argument("--output", "-o", required=True, help="输出音频")

    # 视频信息
    info_parser = subparsers.add_parser("info", help="获取视频信息")
    info_parser.add_argument("input", help="输入视频")

    # 提取音频
    extract_parser = subparsers.add_parser("extract", help="提取音频")
    extract_parser.add_argument("input", help="输入视频")
    extract_parser.add_argument("--output", "-o", help="输出音频")

    args = parser.parse_args()

    if not MOVIEPY_AVAILABLE:
        print("❌ moviepy 未安装")
        print("   安装: pip install moviepy")
        sys.exit(1)

    utils = create_utils()

    if args.command == "resize":
        success = utils.resize_with_padding(
            args.input,
            args.width,
            args.height,
            args.output
        )
        sys.exit(0 if success else 1)

    elif args.command == "loop":
        success = utils.loop_audio(
            args.input,
            args.duration,
            args.output
        )
        sys.exit(0 if success else 1)

    elif args.command == "info":
        info = utils.get_video_info(args.input)
        if info:
            print("\n📊 视频信息:")
            print(f"   尺寸: {info['width']}x{info['height']}")
            print(f"   时长: {info['duration']:.2f}秒")
            print(f"   帧率: {info['fps']}")
            print(f"   音频: {'有' if info['has_audio'] else '无'}")
            print(f"   大小: {info['size_mb']:.2f}MB")
        else:
            sys.exit(1)

    elif args.command == "extract":
        result = utils.extract_audio(args.input, args.output)
        sys.exit(0 if result else 1)

    else:
        parser.print_help()
