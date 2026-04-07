#!/usr/bin/env python3
"""
Director Critic Agent
检查导演方案的质量问题
"""
import sys
import io
import json
import os
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 添加项目根目录到路径
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded

# 导入 agents 模块
AGENTS_DIR = Path(__file__).parent
if str(AGENTS_DIR) not in sys.path:
    sys.path.insert(0, str(AGENTS_DIR))

from utils import (
    load_json, write_json, calculate_duration,
    extract_time_ranges, calculate_coverage_duration, calculate_ratio
)
from prompts import DIRECTOR_CRITIC_PROMPT, format_prompt
from schemas import ISSUE_CODES

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.5-plus"


def get_text_model():
    """获取文本生成模型"""
    provider = get_llm_provider()
    if provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def extract_json_from_response(text: str) -> dict:
    """从 LLM 响应中提取 JSON"""
    try:
        return json.loads(text)
    except:
        pass

    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except:
            pass

    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except:
            pass

    raise ValueError("无法从响应中提取有效的 JSON")


def calculate_metrics(director_data: list, audio_data: list) -> dict:
    """
    计算质量指标

    Args:
        director_data: 导演方案数据（director_raw.json 或 director.json）
        audio_data: 数字人音频数据

    Returns:
        质量指标字典
    """
    if not director_data:
        return {
            "total_duration_sec": 0.0,
            "material_video_ratio": 0.0,
            "avatar_video_ratio": 0.0,
            "source_audio_ratio": 0.0,
            "hard_cut_risk_count": 0
        }

    # 计算总时长
    total_duration = max(shot.get("end_time", 0) for shot in director_data)

    # 计算素材视觉占比
    material_ranges = [
        (shot.get("start_time", 0), shot.get("end_time", 0))
        for shot in director_data
        if shot.get("video_source", "").startswith("material")
    ]
    material_duration = calculate_coverage_duration(material_ranges)
    material_ratio = calculate_ratio(material_duration, total_duration)

    # 计算数字人视觉占比
    avatar_ratio = 1.0 - material_ratio

    # 计算素材原声占比
    source_audio_ranges = [
        (shot.get("start_time", 0), shot.get("end_time", 0))
        for shot in director_data
        if shot.get("audio_source", "") == "b_roll"  # 当前链路使用 "b_roll" 表示素材原声
    ]
    source_audio_duration = calculate_coverage_duration(source_audio_ranges)
    source_audio_ratio = calculate_ratio(source_audio_duration, total_duration)

    # 检测硬切风险
    hard_cut_count = 0
    for i, shot in enumerate(director_data):
        # 如果当前镜头是数字人，下一个镜头切换了
        if shot.get("video_source", "").startswith("aiman"):
            if i + 1 < len(director_data):
                next_shot = director_data[i + 1]
                # 检查是否在数字人说话中间切换
                shot_end = shot.get("end_time", 0)
                # 查找对应的音频段
                for audio in audio_data:
                    audio_start = audio.get("start", 0)
                    audio_end = audio.get("end", 0)
                    # 如果切换点在音频段中间（不是结尾），算作硬切风险
                    if audio_start < shot_end < audio_end - 0.3:  # 留0.3秒容差
                        hard_cut_count += 1
                        break

    return {
        "total_duration_sec": round(total_duration, 2),
        "material_video_ratio": round(material_ratio, 2),
        "avatar_video_ratio": round(avatar_ratio, 2),
        "source_audio_ratio": round(source_audio_ratio, 2),
        "hard_cut_risk_count": hard_cut_count
    }


def main():
    """主函数"""
    emit_stage("director_critic", "正在审查导演方案")

    print("1. 正在读取输入文件...")

    # 读取导演方案（优先 director_raw.json，回退到 director.json）
    director_data = load_json("director_raw.json", None)
    if director_data is None:
        director_data = load_json("director.json", [])
        if not director_data:
            print("❌ 找不到 director_raw.json 或 director.json")
            return
        print("   ⚠️ 使用 director.json（未找到 director_raw.json）")
    else:
        print("   ✓ 已读取 director_raw.json")

    # 读取其他文件
    script_plan = load_json("script_plan.json", {})
    material_plan = load_json("material_plan.json", {})
    audio_data = load_json("audio.json", [])

    print(f"   ✓ 导演方案: {len(director_data)} 个镜头")
    print(f"   ✓ 脚本计划: {'已加载' if script_plan else '未找到'}")
    print(f"   ✓ 素材计划: {'已加载' if material_plan else '未找到'}")
    print(f"   ✓ 音频数据: {len(audio_data)} 段")

    # 计算基础指标
    print("\n2. 正在计算质量指标...")
    metrics = calculate_metrics(director_data, audio_data)

    print(f"   ✓ 总时长: {metrics['total_duration_sec']}s")
    print(f"   ✓ 素材视觉占比: {metrics['material_video_ratio']*100:.1f}%")
    print(f"   ✓ 数字人视觉占比: {metrics['avatar_video_ratio']*100:.1f}%")
    print(f"   ✓ 素材原声占比: {metrics['source_audio_ratio']*100:.1f}%")
    print(f"   ✓ 硬切风险: {metrics['hard_cut_risk_count']} 处")

    print("\n3. 正在调用 LLM 进行深度审查...")

    # 准备提示词
    prompt = format_prompt(
        DIRECTOR_CRITIC_PROMPT,
        director_data=json.dumps(director_data, ensure_ascii=False, indent=2),
        script_plan_data=json.dumps(script_plan, ensure_ascii=False, indent=2) if script_plan else "{}",
        material_plan_data=json.dumps(material_plan, ensure_ascii=False, indent=2) if material_plan else "{}",
        audio_data=json.dumps(audio_data, ensure_ascii=False, indent=2)
    )

    # 调用 LLM
    client = create_llm_client()
    model = get_text_model()

    try:
        response = generate_content(client, model=model, contents=prompt)
        response_text = response.text
        print(f"   ✓ LLM 响应长度: {len(response_text)} 字符")

        # 提取 JSON
        review = extract_json_from_response(response_text)

        # 验证必需字段
        required_fields = ["passed", "issues", "suggestions", "metrics"]
        for field in required_fields:
            if field not in review:
                raise ValueError(f"缺少必需字段: {field}")

        # 合并计算的指标和 LLM 返回的指标
        if "metrics" in review:
            review["metrics"].update(metrics)
        else:
            review["metrics"] = metrics

        print(f"   ✓ 审查结果: {'✅ 通过' if review['passed'] else '❌ 未通过'}")
        print(f"   ✓ 发现问题: {len(review['issues'])} 个")
        print(f"   ✓ 改进建议: {len(review['suggestions'])} 条")

        # 输出问题详情
        if review['issues']:
            print("\n   问题列表:")
            for issue in review['issues']:
                code = issue.get('code', 'UNKNOWN')
                message = issue.get('message', '')
                print(f"      ⚠️ [{code}] {message}")

        # 输出建议
        if review['suggestions']:
            print("\n   改进建议:")
            for i, suggestion in enumerate(review['suggestions'], 1):
                print(f"      {i}. {suggestion}")

    except Exception as e:
        print(f"❌ LLM 调用失败: {e}")
        # 即使 LLM 失败，也生成基础审查报告
        review = {
            "passed": metrics['material_video_ratio'] >= 0.6 and metrics['hard_cut_risk_count'] == 0,
            "issues": [],
            "suggestions": [],
            "metrics": metrics
        }

        # 基于指标生成基础问题
        if metrics['material_video_ratio'] < 0.6:
            review['issues'].append({
                "code": "MATERIAL_RATIO_TOO_LOW",
                "message": f"素材视觉占比仅 {metrics['material_video_ratio']*100:.1f}%，建议至少 60%"
            })

        if metrics['hard_cut_risk_count'] > 0:
            review['issues'].append({
                "code": "HARD_CUT_RISK",
                "message": f"检测到 {metrics['hard_cut_risk_count']} 处硬切风险"
            })

        print("   ⚠️ 使用基础审查结果")

    print("\n4. 正在保存审查报告...")

    # 保存到文件
    if write_json("director_review.json", review):
        print("   ✓ 已保存: director_review.json")
        emit_result(
            "导演方案审查完成",
            review_file="director_review.json",
            passed=review['passed'],
            issues_count=len(review['issues'])
        )
    else:
        print("❌ 保存失败")
        return

    print("\n✅ Director Critic 完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="DIRECTOR_CRITIC_FAILED",
        error_message="导演方案审查失败",
        error_stage="director_critic",
        hint="请检查 director_raw.json 或 director.json 是否存在"
    ))
