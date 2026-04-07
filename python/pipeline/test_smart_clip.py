#!/usr/bin/env python3
"""
智能剪辑功能测试脚本
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

print("=" * 60)
print("智能剪辑功能测试")
print("=" * 60)

# 测试1: 硬件加速检测
print("\n[测试1] 硬件加速检测")
print("-" * 60)
try:
    from pipeline.video_clip_engine import check_hardware_acceleration, HWACCEL_TYPES

    hwaccel_type = check_hardware_acceleration()
    if hwaccel_type:
        print(f"✅ 检测到硬件加速: {HWACCEL_TYPES.get(hwaccel_type, hwaccel_type)}")
    else:
        print("ℹ️  未检测到硬件加速，将使用软件编码")

    print("✅ 硬件加速检测模块正常")
except Exception as e:
    print(f"❌ 硬件加速检测失败: {e}")

# 测试2: 编码器配置
print("\n[测试2] 编码器配置")
print("-" * 60)
try:
    from pipeline.video_clip_engine import get_encoder_config

    # 测试软件编码配置
    config = get_encoder_config(None)
    print(f"软件编码配置: {config['video_codec']}")

    # 测试硬件编码配置
    if hwaccel_type:
        config = get_encoder_config(hwaccel_type)
        print(f"硬件编码配置: {config['video_codec']}")

    print("✅ 编码器配置模块正常")
except Exception as e:
    print(f"❌ 编码器配置失败: {e}")

# 测试3: 音频处理器
print("\n[测试3] 音频处理器")
print("-" * 60)
try:
    from pipeline.audio_processor import AudioProcessor

    processor = AudioProcessor()
    print(f"默认配音音量: {processor.DEFAULT_VOICE_VOLUME}")
    print(f"默认原声音量: {processor.DEFAULT_ORIGINAL_VOLUME}")
    print(f"默认BGM音量: {processor.DEFAULT_BGM_VOLUME}")
    print(f"智能音量: {'启用' if processor.enable_smart_volume else '禁用'}")

    # 测试音量验证
    test_volume = processor.validate_volume(1.5, "测试")
    print(f"音量验证测试: 1.5 → {test_volume}")

    print("✅ 音频处理器模块正常")
except Exception as e:
    print(f"❌ 音频处理器失败: {e}")

# 测试4: FFmpeg命令构建
print("\n[测试4] FFmpeg命令构建")
print("-" * 60)
try:
    from pipeline.video_clip_engine import build_ffmpeg_command, get_encoder_config

    encoder_config = get_encoder_config(None)
    cmd = build_ffmpeg_command(
        input_video="test_video.mp4",
        input_audio="test_audio.mp4",
        output_path="test_output.mp4",
        start_time=0.0,
        duration=10.0,
        encoder_config=encoder_config,
        video_filters="scale=1920:1080",
        audio_filters="volume=1.0"
    )

    print(f"命令长度: {len(cmd)} 个参数")
    print(f"视频编码器: {encoder_config['video_codec']}")
    print(f"音频编码器: {encoder_config['audio_codec']}")

    print("✅ FFmpeg命令构建模块正常")
except Exception as e:
    print(f"❌ FFmpeg命令构建失败: {e}")

# 测试5: 检查FFmpeg可用性
print("\n[测试5] FFmpeg可用性")
print("-" * 60)
try:
    import subprocess

    result = subprocess.run(
        ['ffmpeg', '-version'],
        capture_output=True,
        text=True,
        timeout=5
    )

    if result.returncode == 0:
        version_line = result.stdout.split('\n')[0]
        print(f"✅ FFmpeg已安装: {version_line}")
    else:
        print("❌ FFmpeg未正确安装")
except FileNotFoundError:
    print("❌ FFmpeg未找到，请安装FFmpeg")
except Exception as e:
    print(f"❌ FFmpeg检查失败: {e}")

# 测试6: 检查FFprobe可用性
print("\n[测试6] FFprobe可用性")
print("-" * 60)
try:
    result = subprocess.run(
        ['ffprobe', '-version'],
        capture_output=True,
        text=True,
        timeout=5
    )

    if result.returncode == 0:
        version_line = result.stdout.split('\n')[0]
        print(f"✅ FFprobe已安装: {version_line}")
    else:
        print("❌ FFprobe未正确安装")
except FileNotFoundError:
    print("❌ FFprobe未找到，请安装FFmpeg")
except Exception as e:
    print(f"❌ FFprobe检查失败: {e}")

# 总结
print("\n" + "=" * 60)
print("测试完成")
print("=" * 60)
print("\n如果所有测试都通过，说明智能剪辑功能已正确集成！")
print("\n使用方法:")
print("  python python/pipeline/build_video_smart.py --hwaccel --smart-audio")
print("\n详细文档:")
print("  docs/SMART_CLIP_INTEGRATION.md")
print()
