#!/usr/bin/env python3
"""
Material Planner Agent
找出素材中的高价值片段
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

from utils import load_json, write_json, safe_text
from prompts import MATERIAL_PLANNER_PROMPT, format_prompt

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

    # 尝试提取 JSON 代码块
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except:
            pass

    # 尝试查找第一个完整的 JSON 对象
    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except:
            pass

    raise ValueError("无法从响应中提取有效的 JSON")


def parse_time_range(time_str: str) -> tuple:
    """
    解析时间范围字符串

    Args:
        time_str: 时间范围字符串（如 "00:25-00:57" 或 "25-57"）

    Returns:
        (start_sec, end_sec) 元组
    """
    # 移除空格
    time_str = time_str.strip()

    # 尝试匹配 MM:SS-MM:SS 格式
    match = re.match(r'(\d+):(\d+)-(\d+):(\d+)', time_str)
    if match:
        start_min, start_sec, end_min, end_sec = map(int, match.groups())
        return (start_min * 60 + start_sec, end_min * 60 + end_sec)

    # 尝试匹配 SS-SS 格式
    match = re.match(r'(\d+)-(\d+)', time_str)
    if match:
        start_sec, end_sec = map(int, match.groups())
        return (start_sec, end_sec)

    # 尝试匹配 MM:SS 单个时间点
    match = re.match(r'(\d+):(\d+)', time_str)
    if match:
        minutes, seconds = map(int, match.groups())
        total_sec = minutes * 60 + seconds
        return (total_sec, total_sec)

    return (0, 0)


def calculate_material_duration(result_data: dict) -> float:
    """
    计算素材总时长

    Args:
        result_data: result.json 数据

    Returns:
        总时长（秒）
    """
    max_time = 0.0

    # 从 visual_timeline 提取
    visual_timeline = result_data.get("visual_timeline", [])
    for item in visual_timeline:
        time_str = item.get("time", "")
        start, end = parse_time_range(time_str)
        max_time = max(max_time, end)

    # 从 audio_transcript 提取
    audio_transcript = result_data.get("audio_transcript", [])
    for item in audio_transcript:
        time_str = item.get("time", "")
        start, end = parse_time_range(time_str)
        max_time = max(max_time, end)

    return max_time


def main():
    """主函数"""
    emit_stage("material_planner", "正在分析素材片段")

    print("1. 正在读取输入文件...")

    # 读取必需文件
    result_data = load_json("result.json", {})
    if not result_data:
        print("❌ 找不到 result.json，请先运行 VLM 分析")
        return

    subtitles_data = load_json("subtitles.json", [])
    if not subtitles_data:
        print("❌ 找不到 subtitles.json")
        return

    # 读取可选文件
    speaker_scene_data = load_json("speaker_scene.json", {})

    print(f"   ✓ 素材摘要: {safe_text(result_data.get('summary', ''), 100)}")
    print(f"   ✓ 视觉时间轴: {len(result_data.get('visual_timeline', []))} 段")
    print(f"   ✓ 音频转录: {len(result_data.get('audio_transcript', []))} 段")
    print(f"   ✓ 素材字幕: {len(subtitles_data)} 段")

    # 计算素材时长
    material_duration = calculate_material_duration(result_data)
    print(f"   ✓ 素材时长: {material_duration:.1f}s")

    print("\n2. 正在调用 LLM 分析素材...")

    # 准备提示词
    prompt = format_prompt(
        MATERIAL_PLANNER_PROMPT,
        result_data=json.dumps(result_data, ensure_ascii=False, indent=2),
        subtitles_data=json.dumps(subtitles_data, ensure_ascii=False, indent=2),
        speaker_scene_data=json.dumps(speaker_scene_data, ensure_ascii=False, indent=2) if speaker_scene_data else "{}"
    )

    # 调用 LLM
    client = create_llm_client()
    model = get_text_model()

    try:
        response = generate_content(client, model=model, contents=prompt)
        response_text = response.text
        print(f"   ✓ LLM 响应长度: {len(response_text)} 字符")

        # 提取 JSON
        material_plan = extract_json_from_response(response_text)

        # 验证必需字段
        required_fields = ["material_duration_sec", "recommended_total_duration_sec", "segments"]
        for field in required_fields:
            if field not in material_plan:
                raise ValueError(f"缺少必需字段: {field}")

        print(f"   ✓ 素材时长: {material_plan['material_duration_sec']}s")
        print(f"   ✓ 建议成片时长: {material_plan['recommended_total_duration_sec']}s")
        print(f"   ✓ 高价值片段数: {len(material_plan['segments'])}")

        # 输出每个片段的摘要
        for seg in material_plan['segments']:
            duration = seg['end'] - seg['start']
            audio_mark = "🔊" if seg.get('has_strong_source_audio') else "  "
            print(f"      {audio_mark} [{seg['id']}] {seg['start']:.1f}s-{seg['end']:.1f}s ({duration:.1f}s) - {seg['summary'][:40]}...")

    except Exception as e:
        print(f"❌ LLM 调用失败: {e}")
        return

    print("\n3. 正在保存素材计划...")

    # 保存到文件
    if write_json("material_plan.json", material_plan):
        print("   ✓ 已保存: material_plan.json")
        emit_result(
            "素材计划生成完成",
            material_plan_file="material_plan.json",
            segments_count=len(material_plan['segments']),
            recommended_duration=material_plan['recommended_total_duration_sec']
        )
    else:
        print("❌ 保存失败")
        return

    print("\n✅ Material Planner 完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="MATERIAL_PLANNER_FAILED",
        error_message="素材计划生成失败",
        error_stage="material_planner",
        hint="请检查 result.json、subtitles.json 和 LLM 配置"
    ))
