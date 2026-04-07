#!/usr/bin/env python3
"""
Script Planner Agent
决定视频怎么讲，生成分段结构
"""
import sys
import io
import json
import os
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

from utils import load_json, write_json, safe_text, calculate_duration
from prompts import SCRIPT_PLANNER_PROMPT, format_prompt

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
    """
    从 LLM 响应中提取 JSON

    Args:
        text: LLM 响应文本

    Returns:
        解析后的 JSON 对象
    """
    # 尝试直接解析
    try:
        return json.loads(text)
    except:
        pass

    # 尝试提取 JSON 代码块
    import re
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


def main():
    """主函数"""
    emit_stage("script_planner", "正在生成脚本计划")

    print("1. 正在读取输入文件...")

    # 读取必需文件
    audio_data = load_json("audio.json", [])
    if not audio_data:
        print("❌ 找不到 audio.json，请先运行 ASR")
        return

    subtitles_data = load_json("subtitles.json", [])
    if not subtitles_data:
        print("❌ 找不到 subtitles.json")
        return

    # 读取可选文件
    outline_data = load_json("content_outline.json", {})

    # 提取标题和摘要
    title = outline_data.get("title", "")
    summary = outline_data.get("summary", "")

    # 如果没有大纲，尝试从其他地方获取
    if not title:
        # 可以从 audio 的第一句提取
        if audio_data:
            title = safe_text(audio_data[0].get("text", ""), 50)

    if not summary:
        # 可以从 audio 的前几句拼接
        if len(audio_data) >= 3:
            summary = " ".join([
                safe_text(item.get("text", ""), 100)
                for item in audio_data[:3]
            ])

    print(f"   ✓ 标题: {title}")
    print(f"   ✓ 摘要: {summary[:100]}...")
    print(f"   ✓ 数字人口播: {len(audio_data)} 段")
    print(f"   ✓ 素材字幕: {len(subtitles_data)} 段")

    # 计算数字人音频总时长
    audio_duration = calculate_duration(audio_data, "start", "end")
    print(f"   ✓ 数字人音频时长: {audio_duration:.1f}s")

    print("\n2. 正在调用 LLM 生成脚本计划...")

    # 准备提示词
    prompt = format_prompt(
        SCRIPT_PLANNER_PROMPT,
        title=title,
        summary=summary,
        audio_data=json.dumps(audio_data, ensure_ascii=False, indent=2),
        subtitles_data=json.dumps(subtitles_data, ensure_ascii=False, indent=2),
        outline_data=json.dumps(outline_data, ensure_ascii=False, indent=2) if outline_data else "{}"
    )

    # 调用 LLM
    client = create_llm_client()
    model = get_text_model()

    try:
        response = generate_content(client, model=model, contents=prompt)
        response_text = response.text
        print(f"   ✓ LLM 响应长度: {len(response_text)} 字符")

        # 提取 JSON
        script_plan = extract_json_from_response(response_text)

        # 验证必需字段
        required_fields = ["topic", "angle", "target_duration_sec", "segments"]
        for field in required_fields:
            if field not in script_plan:
                raise ValueError(f"缺少必需字段: {field}")

        print(f"   ✓ 主题: {script_plan['topic']}")
        print(f"   ✓ 角度: {script_plan['angle']}")
        print(f"   ✓ 目标时长: {script_plan['target_duration_sec']}s")
        print(f"   ✓ 分段数: {len(script_plan['segments'])}")

        # 输出每个段落的摘要
        for seg in script_plan['segments']:
            print(f"      - [{seg['id']}] {seg['summary'][:50]}...")

    except Exception as e:
        print(f"❌ LLM 调用失败: {e}")
        return

    print("\n3. 正在保存脚本计划...")

    # 保存到文件
    if write_json("script_plan.json", script_plan):
        print("   ✓ 已保存: script_plan.json")
        emit_result(
            "脚本计划生成完成",
            script_plan_file="script_plan.json",
            segments_count=len(script_plan['segments']),
            target_duration=script_plan['target_duration_sec']
        )
    else:
        print("❌ 保存失败")
        return

    print("\n✅ Script Planner 完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SCRIPT_PLANNER_FAILED",
        error_message="脚本计划生成失败",
        error_stage="script_planner",
        hint="请检查 audio.json、subtitles.json 和 LLM 配置"
    ))
