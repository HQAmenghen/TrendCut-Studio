#!/usr/bin/env python3
"""
素材打分脚本
对每个片段评估信息密度、完整性、原声可保留性等
"""
import sys
import io
import json
import os
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.5-plus"


def get_text_model():
    """获取文本生成模型"""
    provider = get_llm_provider()
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
    import re
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


SCORING_PROMPT = """你是一位视频素材评估专家，负责评估素材片段的质量和可用性。

【输入片段】
{segments_json}

【评分维度】
对每个片段评估以下维度（0-10分）：

1. **information_density** (信息密度)
   - 是否包含关键数据、事实、观点
   - 是否有新信息或重要表态
   - 10分：核心信息，必须保留
   - 5分：一般信息
   - 0分：无关紧要

2. **sentence_completeness** (句子完整性)
   - 语义是否完整
   - 是否可以独立理解
   - 10分：完整独立的表达
   - 5分：需要上下文
   - 0分：残句或碎片

3. **source_audio_quality** (原声质量)
   - 原声是否值得保留
   - 是否有专家表态、关键问答
   - 10分：必须保留原声
   - 5分：可保留可不保留
   - 0分：无原声或质量差

4. **visual_usability** (画面可用性)
   - 画面是否清晰有用
   - 是否有关键视觉信息
   - 10分：画面信息丰富
   - 5分：一般画面
   - 0分：画面无用

5. **position_suitability** (位置适用性)
   - opening: 适合开场（0-10分）
   - main: 适合主体（0-10分）
   - closing: 适合收尾（0-10分）

【输出格式】
对每个片段输出评分，格式如下：

{{
  "segments": [
    {{
      "id": "seg_01",
      "scores": {{
        "information_density": 8,
        "sentence_completeness": 9,
        "source_audio_quality": 10,
        "visual_usability": 7,
        "position_suitability": {{
          "opening": 3,
          "main": 9,
          "closing": 2
        }}
      }},
      "total_score": 34,
      "recommendation": "high_priority",
      "reason": "包含核心数据和专家表态，信息密度高"
    }}
  ]
}}

【评分原则】
- 优先保留信息密度高的片段
- 优先保留有强原声的片段
- 优先保留句子完整的片段
- recommendation 可选值：high_priority, medium_priority, low_priority

请直接输出 JSON，不要有其他文字。
"""


def score_segments_with_llm(segments, client, model):
    """使用 LLM 对片段打分"""
    # 准备输入（只发送必要信息）
    segments_for_llm = []
    for seg in segments:
        segments_for_llm.append({
            "id": seg["id"],
            "duration_sec": seg["duration_sec"],
            "text": seg["text"],
            "source_audio_text": seg.get("source_audio_text", ""),
            "visual_summary": seg.get("visual_summary", ""),
            "has_strong_source_audio": seg.get("has_strong_source_audio", False)
        })

    prompt = SCORING_PROMPT.format(
        segments_json=json.dumps(segments_for_llm, ensure_ascii=False, indent=2)
    )

    response = generate_content(client, model=model, contents=prompt)
    response_text = response.text

    return extract_json_from_response(response_text)


def main():
    """主函数"""
    emit_stage("score_material", "正在评估素材片段")

    print("1. 正在读取素材片段...")

    segments_data = load_json("material_segments.json", {})
    if not segments_data:
        print("❌ 找不到 material_segments.json，请先运行 segment_material.py")
        return

    segments = segments_data.get("segments", [])
    if not segments:
        print("❌ 没有找到素材片段")
        return

    print(f"   ✓ 加载了 {len(segments)} 个片段")

    print("\n2. 正在调用 LLM 评估片段...")

    client = create_llm_client()
    model = get_text_model()

    try:
        scored_result = score_segments_with_llm(segments, client, model)
        scored_segments = scored_result.get("segments", [])

        print(f"   ✓ 评估完成: {len(scored_segments)} 个片段")

        # 合并评分到原始片段
        scored_map = {s["id"]: s for s in scored_segments}
        for seg in segments:
            seg_id = seg["id"]
            if seg_id in scored_map:
                seg["scores"] = scored_map[seg_id].get("scores", {})
                seg["total_score"] = scored_map[seg_id].get("total_score", 0)
                seg["recommendation"] = scored_map[seg_id].get("recommendation", "medium_priority")
                seg["reason"] = scored_map[seg_id].get("reason", "")

        # 按总分排序
        segments.sort(key=lambda x: x.get("total_score", 0), reverse=True)

        # 显示前5个高分片段
        print("\n   高分片段:")
        for seg in segments[:5]:
            score = seg.get("total_score", 0)
            rec = seg.get("recommendation", "")
            print(f"      [{seg['id']}] 总分: {score}, 推荐: {rec}")
            print(f"          {seg['text'][:50]}...")

    except Exception as e:
        print(f"❌ LLM 评估失败: {e}")
        return

    print("\n3. 正在保存结果...")

    output = {
        "total_segments": len(segments),
        "segments": segments
    }

    if write_json("material_segments_scored.json", output):
        print("   ✓ 已保存: material_segments_scored.json")
        emit_result(
            "素材打分完成",
            scored_file="material_segments_scored.json",
            segments_count=len(segments)
        )
    else:
        print("❌ 保存失败")
        return

    print("\n✅ 素材打分完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SCORE_MATERIAL_FAILED",
        error_message="素材打分失败",
        error_stage="score_material",
        hint="请检查 material_segments.json 是否存在，以及 LLM 配置"
    ))
