#!/usr/bin/env python3
"""
数字人补位文案生成脚本
只生成开场、转场、结尾的短句补位文案
"""
import sys
import io
import json
import os
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_text_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded
from pipeline.skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.6-plus"


def get_text_model(provider=None):
    """获取文本生成模型"""
    provider = provider or get_text_llm_provider()
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    if provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def load_json(path_str, default=None):
    """加载 JSON 文件"""
    path = Path(path_str)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ 读取 {path_str} 失败: {e}")
        return default


def write_json(path_str, data):
    """写入 JSON 文件"""
    try:
        Path(path_str).write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        return True
    except Exception as e:
        print(f"❌ 写入 {path_str} 失败: {e}")
        return False


def extract_json_from_response(text):
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


BRIDGE_SCRIPT_PROMPT = load_prompt_text("build_bridge_script_skill.md")


def clean_bridge_line(text, role="bridge"):
    value = str(text or "").strip()
    if not value:
        return value

    value = re.sub(r'^(这段|这一段)(分析了|讲了|说的是)', '', value).strip()
    value = re.sub(r'^(让我们来看看|接下来|这一点|这说明了)', '', value).strip()
    value = re.sub(r'[。]{2,}', '。', value)
    value = re.sub(r'\s+', '', value)
    value = value.strip('，。；： ')

    if role == "intro":
        banned_starts = ("这段", "这一段", "这是", "这里", "今天我们")
        if value.startswith(banned_starts):
            value = "真正值得注意的变化，可能才刚开始"
        if len(value) < 8:
            value = "真正值得注意的变化，可能才刚开始"
    elif role == "outro":
        if len(value) < 6:
            value = "接下来，就看它会不会真的改变市场判断"
    else:
        if len(value) < 6:
            value = "这里的分歧，其实已经说得很清楚了"

    if not re.search(r'[。！？!?]$', value):
        suffix = '？' if role == "intro" and "吗" in value else '。'
        value = f"{value}{suffix}"
    return value


def generate_bridge_script(selected_segments, client, model, provider=None):
    """生成补位文案"""
    # 准备素材摘要
    segments_summary = []
    for seg in selected_segments:
        segments_summary.append({
            "role": seg["role"],
            "text": seg["text"][:100]  # 只发送前100字
        })

    prompt = BRIDGE_SCRIPT_PROMPT.format(
        selected_segments=json.dumps(segments_summary, ensure_ascii=False, indent=2)
    )

    response = generate_content(client, model=model, contents=prompt, provider=provider)
    response_text = response.text

    return extract_json_from_response(response_text)


def main():
    """主函数"""
    emit_stage("build_bridge_script", "正在生成数字人补位文案")

    print("1. 正在读取已选素材片段...")

    selected_data = load_json("selected_segments.json", {})
    if not selected_data:
        print("❌ 找不到 selected_segments.json，请先运行 select_material_segments.py")
        return

    segments = selected_data.get("segments", [])
    if not segments:
        raise RuntimeError("selected_segments.json 中没有可用素材片段，无法生成补位文案")

    print(f"   ✓ 加载了 {len(segments)} 个选中片段")

    print("\n2. 正在调用 LLM 生成补位文案...")

    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    model = get_text_model(provider)

    try:
        bridge_script = generate_bridge_script(segments, client, model, provider=provider)

        intro = clean_bridge_line(bridge_script.get("intro", ""), "intro")
        bridges = [clean_bridge_line(item, "bridge") for item in bridge_script.get("bridges", []) if str(item or "").strip()]
        outro = clean_bridge_line(bridge_script.get("outro", ""), "outro")

        print(f"   ✓ 生成完成")
        print(f"      开场: {intro}")
        for i, bridge in enumerate(bridges, 1):
            print(f"      转场{i}: {bridge}")
        print(f"      结尾: {outro}")

    except Exception as e:
        print(f"❌ LLM 生成失败: {e}")
        return

    print("\n3. 正在保存结果...")

    output = {
        "intro": intro,
        "bridges": bridges,
        "outro": outro,
        "total_sentences": 2 + len(bridges)
    }

    if write_json("bridge_script.json", output):
        print("   ✓ 已保存: bridge_script.json")
        emit_result(
            "补位文案生成完成",
            bridge_file="bridge_script.json",
            sentences_count=output["total_sentences"]
        )
    else:
        print("❌ 保存失败")
        return

    print("\n✅ 补位文案生成完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="BUILD_BRIDGE_SCRIPT_FAILED",
        error_message="补位文案生成失败",
        error_stage="build_bridge_script",
        hint="请检查 selected_segments.json 是否存在，以及 LLM 配置"
    ))
