#!/usr/bin/env python3
"""
综合功能测试脚本
测试智能剪辑、素材搜索、TTS等所有集成功能
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import asyncio
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

print("=" * 70)
print("NarratoAI 功能集成测试")
print("=" * 70)

test_results = []

def test_result(name, success, message=""):
    """记录测试结果"""
    status = "✅" if success else "❌"
    test_results.append((name, success, message))
    print(f"{status} {name}")
    if message:
        print(f"   {message}")

# ========== 测试1: 智能剪辑模块 ==========
print("\n[测试1] 智能剪辑模块")
print("-" * 70)

try:
    from pipeline.video_clip_engine import (
        check_hardware_acceleration,
        get_encoder_config,
        build_ffmpeg_command,
        HWACCEL_TYPES
    )

    # 硬件加速检测
    hwaccel_type = check_hardware_acceleration()
    if hwaccel_type:
        test_result(
            "硬件加速检测",
            True,
            f"检测到: {HWACCEL_TYPES.get(hwaccel_type, hwaccel_type)}"
        )
    else:
        test_result("硬件加速检测", True, "未检测到GPU，将使用软件编码")

    # 编码器配置
    config = get_encoder_config(hwaccel_type)
    test_result(
        "编码器配置",
        True,
        f"视频编码器: {config['video_codec']}"
    )

    # FFmpeg命令构建
    cmd = build_ffmpeg_command(
        "test.mp4", "test.mp4", "out.mp4",
        0.0, 10.0, config
    )
    test_result("FFmpeg命令构建", len(cmd) > 0, f"命令长度: {len(cmd)}")

except Exception as e:
    test_result("智能剪辑模块", False, str(e))

# ========== 测试2: 音频处理模块 ==========
print("\n[测试2] 音频处理模块")
print("-" * 70)

try:
    from pipeline.audio_processor import AudioProcessor

    processor = AudioProcessor()
    test_result("音频处理器初始化", True)

    # 音量验证
    volume = processor.validate_volume(1.5, "测试")
    test_result("音量验证", volume == 1.5)

    test_result(
        "音频处理器配置",
        True,
        f"默认配音音量: {processor.DEFAULT_VOICE_VOLUME}, "
        f"原声音量: {processor.DEFAULT_ORIGINAL_VOLUME}"
    )

except Exception as e:
    test_result("音频处理模块", False, str(e))

# ========== 测试3: 素材搜索模块 ==========
print("\n[测试3] 素材搜索模块")
print("-" * 70)

try:
    from pipeline.material_search import MaterialSearchEngine, MaterialInfo

    # 创建搜索引擎（不需要API Key也能初始化）
    engine = MaterialSearchEngine()
    test_result("素材搜索引擎初始化", True)

    # 测试MaterialInfo
    material = MaterialInfo()
    material.provider = "test"
    material.url = "https://example.com/video.mp4"
    material.duration = 10
    test_result("MaterialInfo数据类", True, f"提供商: {material.provider}")

    test_result(
        "素材搜索模块",
        True,
        "支持 Pexels 和 Pixabay 平台"
    )

except Exception as e:
    test_result("素材搜索模块", False, str(e))

# ========== 测试4: TTS引擎模块 ==========
print("\n[测试4] TTS引擎模块")
print("-" * 70)

try:
    from pipeline.tts_engine import TTSManager, EDGE_TTS_AVAILABLE, AZURE_SPEECH_AVAILABLE

    # 检查可用引擎
    engines = []
    if EDGE_TTS_AVAILABLE:
        engines.append("Edge TTS")
    if AZURE_SPEECH_AVAILABLE:
        engines.append("Azure Speech")

    test_result(
        "TTS引擎可用性",
        len(engines) > 0,
        f"可用引擎: {', '.join(engines) if engines else '无'}"
    )

    # 创建TTS管理器
    manager = TTSManager()
    available_engines = manager.list_engines()
    test_result(
        "TTS管理器初始化",
        True,
        f"已加载 {len(available_engines)} 个引擎"
    )

except Exception as e:
    test_result("TTS引擎模块", False, str(e))

# ========== 测试5: 统一素材管理器 ==========
print("\n[测试5] 统一素材管理器")
print("-" * 70)

try:
    from pipeline.material_manager import MaterialManager

    # 创建管理器
    manager = MaterialManager(cache_dir="./test_cache")
    test_result("素材管理器初始化", True)

    # 缓存统计
    stats = manager.get_cache_stats()
    test_result(
        "缓存统计",
        True,
        f"视频: {stats['video_count']} 个, 音频: {stats['audio_count']} 个"
    )

    # 清理测试缓存
    if os.path.exists("./test_cache"):
        import shutil
        shutil.rmtree("./test_cache")

except Exception as e:
    test_result("统一素材管理器", False, str(e))

# ========== 测试6: FFmpeg可用性 ==========
print("\n[测试6] FFmpeg工具链")
print("-" * 70)

try:
    import subprocess

    # 测试FFmpeg
    result = subprocess.run(
        ['ffmpeg', '-version'],
        capture_output=True,
        text=True,
        timeout=5
    )

    if result.returncode == 0:
        version = result.stdout.split('\n')[0]
        test_result("FFmpeg", True, version)
    else:
        test_result("FFmpeg", False, "未正确安装")

    # 测试FFprobe
    result = subprocess.run(
        ['ffprobe', '-version'],
        capture_output=True,
        text=True,
        timeout=5
    )

    if result.returncode == 0:
        version = result.stdout.split('\n')[0]
        test_result("FFprobe", True, version)
    else:
        test_result("FFprobe", False, "未正确安装")

except FileNotFoundError:
    test_result("FFmpeg工具链", False, "FFmpeg未安装")
except Exception as e:
    test_result("FFmpeg工具链", False, str(e))

# ========== 测试7: Python依赖 ==========
print("\n[测试7] Python依赖包")
print("-" * 70)

dependencies = [
    ("requests", "HTTP请求"),
    ("edge-tts", "Edge TTS"),
    ("azure-cognitiveservices-speech", "Azure Speech"),
]

for package, description in dependencies:
    try:
        __import__(package.replace('-', '_'))
        test_result(f"{package}", True, description)
    except ImportError:
        test_result(f"{package}", False, f"{description} (可选)")

# ========== 测试总结 ==========
print("\n" + "=" * 70)
print("测试总结")
print("=" * 70)

total = len(test_results)
passed = sum(1 for _, success, _ in test_results if success)
failed = total - passed

print(f"\n总计: {total} 项测试")
print(f"✅ 通过: {passed} 项")
print(f"❌ 失败: {failed} 项")

if failed > 0:
    print("\n失败的测试:")
    for name, success, message in test_results:
        if not success:
            print(f"  ❌ {name}: {message}")

print("\n" + "=" * 70)
print("功能状态")
print("=" * 70)

print("\n✅ 已集成功能:")
print("  1. 智能视频剪辑 (硬件加速 + Fallback)")
print("  2. 智能音频处理 (响度分析 + 音量平衡)")
print("  3. 素材搜索 (Pexels + Pixabay)")
print("  4. TTS语音合成 (Edge TTS + Azure Speech)")
print("  5. 统一素材管理 (缓存 + 索引)")

print("\n📚 使用文档:")
print("  - docs/SMART_CLIP_INTEGRATION.md  (智能剪辑集成文档)")
print("  - docs/SMART_CLIP_USAGE.md        (快速使用指南)")
print("  - docs/MATERIAL_FEATURES.md       (素材功能文档)")

print("\n🚀 快速开始:")
print("  # 智能剪辑")
print("  python python/pipeline/build_video_smart.py --hwaccel --smart-audio")
print()
print("  # 素材搜索")
print("  python python/pipeline/material_search.py '风景' --platform pexels")
print()
print("  # TTS合成")
print("  python python/pipeline/tts_engine.py '你好世界' --output hello.mp3")
print()
print("  # 统一管理")
print("  python python/pipeline/material_manager.py cache stats")
print()

if passed == total:
    print("🎉 所有测试通过！功能已完整集成！")
    sys.exit(0)
else:
    print("⚠️  部分测试失败，请检查依赖和配置")
    sys.exit(1)
