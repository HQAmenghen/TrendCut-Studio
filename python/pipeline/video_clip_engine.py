#!/usr/bin/env python3
"""
智能视频剪辑引擎 - 从 NarratoAI 移植
提供硬件加速、智能音频处理、多层fallback等能力
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
import subprocess
import json
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# 硬件加速类型
HWACCEL_TYPES = {
    'nvenc': 'NVIDIA NVENC',
    'nvenc_pure': 'NVIDIA NVENC (纯编码)',
    'cuda': 'NVIDIA CUDA',
    'amf': 'AMD AMF',
    'qsv': 'Intel QSV',
    'videotoolbox': 'macOS VideoToolbox',
    'software': '软件编码'
}


def check_hardware_acceleration() -> Optional[str]:
    """
    检测系统支持的硬件加速类型

    Returns:
        硬件加速类型字符串，如果不支持则返回None
    """
    # 检测 NVIDIA
    try:
        result = subprocess.run(
            ['ffmpeg', '-hide_banner', '-encoders'],
            capture_output=True, text=True, timeout=5
        )
        encoders = result.stdout

        if 'h264_nvenc' in encoders:
            return 'nvenc_pure'
    except:
        pass

    # 检测 AMD
    try:
        if 'h264_amf' in encoders:
            return 'amf'
    except:
        pass

    # 检测 Intel QSV
    try:
        if 'h264_qsv' in encoders:
            return 'qsv'
    except:
        pass

    # 检测 macOS VideoToolbox
    try:
        if sys.platform == 'darwin' and 'h264_videotoolbox' in encoders:
            return 'videotoolbox'
    except:
        pass

    return None


def get_encoder_config(hwaccel_type: Optional[str] = None) -> Dict[str, str]:
    """
    获取编码器配置

    Args:
        hwaccel_type: 硬件加速类型

    Returns:
        编码器配置字典
    """
    config = {
        "video_codec": "libx264",
        "audio_codec": "aac",
        "pixel_format": "yuv420p",
        "preset": "medium",
        "quality_param": "crf",
        "quality_value": "23"
    }

    if hwaccel_type == 'nvenc_pure':
        config.update({
            "video_codec": "h264_nvenc",
            "preset": "medium",
            "quality_param": "cq",
            "quality_value": "23"
        })
    elif hwaccel_type == 'amf':
        config.update({
            "video_codec": "h264_amf",
            "preset": "balanced",
            "quality_param": "qp_i",
            "quality_value": "23"
        })
    elif hwaccel_type == 'qsv':
        config.update({
            "video_codec": "h264_qsv",
            "preset": "medium",
            "quality_param": "global_quality",
            "quality_value": "23"
        })
    elif hwaccel_type == 'videotoolbox':
        config.update({
            "video_codec": "h264_videotoolbox",
            "preset": "medium",
            "quality_param": "b:v",
            "quality_value": "5M"
        })

    return config


def build_ffmpeg_command(
    input_video: str,
    input_audio: str,
    output_path: str,
    start_time: float,
    duration: float,
    encoder_config: Dict[str, str],
    video_filters: Optional[str] = None,
    audio_filters: Optional[str] = None,
    remove_audio: bool = False
) -> List[str]:
    """
    构建优化的FFmpeg命令

    Args:
        input_video: 输入视频路径
        input_audio: 输入音频路径
        output_path: 输出路径
        start_time: 开始时间(秒)
        duration: 持续时间(秒)
        encoder_config: 编码器配置
        video_filters: 视频滤镜
        audio_filters: 音频滤镜
        remove_audio: 是否移除音频

    Returns:
        FFmpeg命令列表
    """
    cmd = ["ffmpeg", "-y"]

    # 输入文件
    cmd.extend(["-ss", str(start_time), "-t", str(duration), "-i", input_video])

    if not remove_audio and input_audio:
        cmd.extend(["-ss", str(start_time), "-t", str(duration), "-i", input_audio])

    # 映射流
    cmd.extend(["-map", "0:v:0"])
    if not remove_audio and input_audio:
        cmd.extend(["-map", "1:a:0"])

    # 视频编码器
    cmd.extend(["-c:v", encoder_config["video_codec"]])

    # 视频滤镜
    if video_filters:
        cmd.extend(["-vf", video_filters])

    # 像素格式
    cmd.extend(["-pix_fmt", encoder_config["pixel_format"]])

    # 质量参数
    if encoder_config["video_codec"] == "h264_nvenc":
        cmd.extend(["-preset", encoder_config["preset"]])
        cmd.extend(["-cq", encoder_config["quality_value"]])
        cmd.extend(["-profile:v", "main"])
    elif encoder_config["video_codec"] == "h264_amf":
        cmd.extend(["-quality", encoder_config["preset"]])
        cmd.extend(["-qp_i", encoder_config["quality_value"]])
    elif encoder_config["video_codec"] == "h264_qsv":
        cmd.extend(["-preset", encoder_config["preset"]])
        cmd.extend(["-global_quality", encoder_config["quality_value"]])
    elif encoder_config["video_codec"] == "h264_videotoolbox":
        cmd.extend(["-profile:v", "high"])
        cmd.extend(["-b:v", encoder_config["quality_value"]])
    else:
        cmd.extend(["-preset", encoder_config["preset"]])
        cmd.extend(["-crf", encoder_config["quality_value"]])

    # 音频处理
    if remove_audio:
        cmd.extend(["-an"])
    else:
        cmd.extend(["-c:a", encoder_config["audio_codec"]])
        if audio_filters:
            cmd.extend(["-af", audio_filters])
        cmd.extend(["-ar", "44100", "-ac", "2"])

    # 优化参数
    cmd.extend(["-avoid_negative_ts", "make_zero"])
    cmd.extend(["-movflags", "+faststart"])

    cmd.append(output_path)

    return cmd


def execute_with_fallback(
    cmd: List[str],
    input_video: str,
    input_audio: str,
    output_path: str,
    start_time: float,
    duration: float,
    scene_index: int
) -> bool:
    """
    执行FFmpeg命令，带智能fallback机制

    Args:
        cmd: 主命令
        input_video: 输入视频
        input_audio: 输入音频
        output_path: 输出路径
        start_time: 开始时间
        duration: 持续时间
        scene_index: 场景索引

    Returns:
        是否成功
    """
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return True

        print(f"   ⚠️ 主命令失败，尝试兼容性模式...")
        return try_compatibility_fallback(input_video, input_audio, output_path, start_time, duration, scene_index)

    except subprocess.TimeoutExpired:
        print(f"   ⚠️ 命令超时，尝试快速模式...")
        return try_fast_fallback(input_video, input_audio, output_path, start_time, duration, scene_index)
    except Exception as e:
        print(f"   ❌ 执行异常: {e}")
        return try_basic_fallback(input_video, input_audio, output_path, start_time, duration, scene_index)


def try_compatibility_fallback(
    input_video: str,
    input_audio: str,
    output_path: str,
    start_time: float,
    duration: float,
    scene_index: int
) -> bool:
    """兼容性fallback - 使用最保守的参数"""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time), "-t", str(duration), "-i", input_video,
        "-ss", str(start_time), "-t", str(duration), "-i", input_audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-pix_fmt", "yuv420p",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        output_path
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=300)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"   ✅ 兼容性模式成功: slice_{scene_index}.mp4")
            return True
    except:
        pass

    return False


def try_fast_fallback(
    input_video: str,
    input_audio: str,
    output_path: str,
    start_time: float,
    duration: float,
    scene_index: int
) -> bool:
    """快速fallback - 使用ultrafast预设"""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time), "-t", str(duration), "-i", input_video,
        "-ss", str(start_time), "-t", str(duration), "-i", input_audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-pix_fmt", "yuv420p",
        output_path
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=180)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"   ✅ 快速模式成功: slice_{scene_index}.mp4")
            return True
    except:
        pass

    return False


def try_basic_fallback(
    input_video: str,
    input_audio: str,
    output_path: str,
    start_time: float,
    duration: float,
    scene_index: int
) -> bool:
    """基础fallback - 最简单的命令"""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time), "-t", str(duration), "-i", input_video,
        "-ss", str(start_time), "-t", str(duration), "-i", input_audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c", "copy",
        output_path
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"   ✅ 基础模式成功: slice_{scene_index}.mp4")
            return True
    except:
        pass

    print(f"   ❌ 所有fallback方案均失败: slice_{scene_index}.mp4")
    return False
