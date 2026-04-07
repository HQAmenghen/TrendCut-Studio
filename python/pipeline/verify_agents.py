#!/usr/bin/env python3
"""
快速验证 Agent 改造
在 python/pipeline 目录下运行，使用现有的测试数据
"""
import sys
import json
from pathlib import Path

def check_file(filename, description):
    """检查文件是否存在并显示基本信息"""
    path = Path(filename)
    if not path.exists():
        print(f"❌ {description}: {filename} 不存在")
        return False

    try:
        if filename.endswith('.json'):
            data = json.loads(path.read_text(encoding='utf-8'))
            print(f"✅ {description}: {filename}")
            if isinstance(data, dict):
                print(f"   字段: {', '.join(data.keys())}")
            elif isinstance(data, list):
                print(f"   数组长度: {len(data)}")
            return True
        else:
            size = path.stat().st_size
            print(f"✅ {description}: {filename} ({size} bytes)")
            return True
    except Exception as e:
        print(f"⚠️ {description}: {filename} 存在但读取失败 - {e}")
        return False

def main():
    print("=" * 60)
    print("Agent 改造验证")
    print("=" * 60)

    print("\n1. 检查输入文件")
    print("-" * 60)
    inputs = [
        ("audio.json", "数字人音频轴"),
        ("subtitles.json", "素材字幕"),
        ("result.json", "素材视觉轴"),
    ]

    input_ok = all(check_file(f, d) for f, d in inputs)

    print("\n2. 检查 Agent 输出文件")
    print("-" * 60)
    outputs = [
        ("script_plan.json", "脚本计划"),
        ("material_plan.json", "素材计划"),
        ("director_raw.json", "导演原始方案"),
        ("director_review.json", "导演审查报告"),
    ]

    output_results = {f: check_file(f, d) for f, d in outputs}

    print("\n3. 验证结果")
    print("-" * 60)

    if not input_ok:
        print("❌ 输入文件不完整，无法验证")
        return 1

    if all(output_results.values()):
        print("✅ 所有 Agent 输出文件都已生成")
        print("\n4. 详细检查")
        print("-" * 60)

        # 检查 script_plan
        if output_results["script_plan.json"]:
            data = json.loads(Path("script_plan.json").read_text(encoding='utf-8'))
            print(f"✅ Script Plan:")
            print(f"   主题: {data.get('topic', 'N/A')}")
            print(f"   目标时长: {data.get('target_duration_sec', 'N/A')}s")
            print(f"   分段数: {len(data.get('segments', []))}")

        # 检查 material_plan
        if output_results["material_plan.json"]:
            data = json.loads(Path("material_plan.json").read_text(encoding='utf-8'))
            print(f"✅ Material Plan:")
            print(f"   素材时长: {data.get('material_duration_sec', 'N/A')}s")
            print(f"   建议时长: {data.get('recommended_total_duration_sec', 'N/A')}s")
            print(f"   高价值片段: {len(data.get('segments', []))}")

        # 检查 director_review
        if output_results["director_review.json"]:
            data = json.loads(Path("director_review.json").read_text(encoding='utf-8'))
            print(f"✅ Director Review:")
            print(f"   通过审查: {'是' if data.get('passed') else '否'}")
            print(f"   问题数: {len(data.get('issues', []))}")
            print(f"   建议数: {len(data.get('suggestions', []))}")
            metrics = data.get('metrics', {})
            if metrics:
                print(f"   素材占比: {metrics.get('material_video_ratio', 0)*100:.1f}%")
                print(f"   硬切风险: {metrics.get('hard_cut_risk_count', 0)} 处")

        print("\n" + "=" * 60)
        print("✅ Agent 改造验证通过！")
        print("=" * 60)
        return 0
    else:
        missing = [d for f, d in outputs if not output_results[f]]
        print(f"❌ 缺少以下输出文件: {', '.join(missing)}")
        print("\n提示:")
        print("  1. 确保在 python/pipeline 目录下运行")
        print("  2. 依次运行:")
        print("     python agents/script_planner.py")
        print("     python agents/material_planner.py")
        print("     python run_director.py")
        print("     python agents/director_critic.py")
        return 1

if __name__ == "__main__":
    sys.exit(main())
