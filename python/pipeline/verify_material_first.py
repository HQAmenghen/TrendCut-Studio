#!/usr/bin/env python3
"""
素材优先方案验证脚本
快速检查所有必要文件和配置是否就绪
"""
import sys
import io
from pathlib import Path
import json
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 加载环境变量
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from load_env import load_project_env
    load_project_env(__file__)
except:
    pass

def check_file_exists(file_path, description):
    """检查文件是否存在"""
    path = Path(file_path)
    if path.exists():
        print(f"✓ {description}: {file_path}")
        return True
    else:
        print(f"✗ {description}: {file_path} (不存在)")
        return False

def check_python_syntax(file_path):
    """检查 Python 文件语法"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            compile(f.read(), file_path, 'exec')
        return True
    except SyntaxError as e:
        print(f"  语法错误: {e}")
        return False

def main():
    print("=" * 60)
    print("素材优先方案 - 环境验证")
    print("=" * 60)

    all_ok = True

    # 1. 检查核心脚本
    print("\n1. 检查核心脚本文件...")
    scripts = [
        ("segment_material.py", "素材切片脚本"),
        ("score_material_segments.py", "素材打分脚本"),
        ("select_material_segments.py", "素材选用脚本"),
        ("build_bridge_script.py", "补位文案脚本"),
        ("compose_timeline.py", "时间线编排脚本"),
        ("build_video.py", "视频合成脚本"),
        ("run_asr.py", "ASR 识别脚本"),
        ("video_vlm.py", "VLM 分析脚本")
    ]

    for script, desc in scripts:
        if check_file_exists(script, desc):
            if not check_python_syntax(script):
                all_ok = False
        else:
            all_ok = False

    # 2. 检查依赖模块
    print("\n2. 检查依赖模块...")
    modules = [
        ("../load_env.py", "环境加载模块"),
        ("../llm_client.py", "LLM 客户端模块"),
        ("../script_protocol.py", "脚本协议模块")
    ]

    for module, desc in modules:
        if not check_file_exists(module, desc):
            all_ok = False

    # 3. 检查 Python 包
    print("\n3. 检查 Python 依赖包...")

    # 检查 google-generativeai
    try:
        import google.generativeai
        print(f"✓ google.generativeai")
    except ImportError:
        print(f"  google.generativeai (未安装，如使用 Gemini 则需要)")

    # 检查 faster_whisper
    try:
        import faster_whisper
        print(f"✓ faster_whisper")
    except ImportError:
        print(f"✗ faster_whisper (未安装)")
        all_ok = False

    # 4. 检查环境变量
    print("\n4. 检查环境变量...")
    env_vars = [
        ("GEMINI_API_KEY", "Gemini API Key"),
        ("QWEN_API_KEY", "Qwen API Key")
    ]

    has_llm = False
    for var, desc in env_vars:
        value = os.getenv(var)
        if value:
            masked_value = value[:8] + "..." if len(value) > 8 else "***"
            print(f"✓ {desc}: {masked_value}")
            has_llm = True
        else:
            print(f"  {desc}: 未配置")

    if not has_llm:
        print("⚠️ 警告: 至少需要配置一个 LLM API Key")
        # 不标记为失败，因为可能在运行时加载

    # 5. 检查 FFmpeg
    print("\n5. 检查 FFmpeg...")
    import subprocess
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"✓ FFmpeg: {version_line}")
        else:
            print("✗ FFmpeg: 无法运行")
            all_ok = False
    except FileNotFoundError:
        print("✗ FFmpeg: 未安装")
        all_ok = False

    # 6. 检查后端文件
    print("\n6. 检查后端文件...")
    backend_file = Path("../../server/services/pipeline/handlers.js")
    if check_file_exists(backend_file, "后端处理器"):
        # 检查是否包含素材优先链路的关键代码
        with open(backend_file, 'r', encoding='utf-8') as f:
            content = f.read()
            if "segmentMaterialScript" in content:
                print("  ✓ 包含素材优先链路代码")
            else:
                print("  ✗ 未找到素材优先链路代码")
                all_ok = False
    else:
        all_ok = False

    # 总结
    print("\n" + "=" * 60)
    if all_ok:
        print("✅ 所有检查通过！素材优先方案已就绪。")
        print("\n下一步:")
        print("1. 准备测试素材 (material.mp4 和 aiman.mp4)")
        print("2. 启动服务: npm run dev")
        print("3. 访问前端界面进行测试")
        return 0
    else:
        print("❌ 部分检查未通过，请修复上述问题。")
        return 1

if __name__ == "__main__":
    sys.exit(main())
