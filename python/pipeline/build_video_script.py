import sys
import io
import json
import argparse
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from script_protocol import emit_result, emit_stage, run_guarded


def load_json(path_str, default):
    path = Path(path_str)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def normalize_text(value):
    return str(value or "").strip()


def sanitize_script_text(text):
    cleaned = " ".join(str(text or "").split()).strip()
    cleaned = re.sub(r"^(?:(?:口播|原声|素材原声)\s*[：:]\s*)+", "", cleaned)
    cleaned = re.sub(r"^(?:(?:数字人简述|数字人补充|播放素材原声|继续播放素材原声|保留素材原声|保留素材原话|保留原话)\s*[，：:]?\s*)+", "", cleaned)
    cleaned = cleaned.replace("保留记者提问，", "")
    return cleaned.strip("，。； ")


def infer_segment_role(segment_id, index, total_segments):
    segment_key = normalize_text(segment_id).lower()
    if segment_key in {"hook", "intro", "opening", "start"} or index == 0:
        return "hook"
    if segment_key in {"fact", "background", "detail"}:
        return "fact"
    if segment_key in {"impact", "analysis", "insight", "conflict"}:
        return "impact"
    if segment_key in {"close", "ending", "summary", "outro"} or index == total_segments - 1:
        return "close"
    return "fact"


def infer_visual_keywords(text):
    normalized = normalize_text(text)
    keyword_groups = [
        (("白宫", "发言人", "总统", "声明", "表态", "记者会"), "只从当前素材里选取白宫、发言人、新闻发布会或官方表态相关画面，强化“官方确认”和消息源可信度。"),
        (("预算", "军费", "亿美元", "赔偿", "成本", "买单", "支出"), "只使用当前素材里已有的数字、字幕条、账单感镜头或预算相关画面，不补外部图表，突出成本压力和资金规模。"),
        (("伊朗", "中东", "沙特", "阿联酋", "科威特", "盟友", "地缘"), "只使用当前素材里已有的国家人物、地区场景或相关字幕信息，不额外补地图，帮助观众建立地缘关系。"),
        (("战争", "冲突", "袭击", "军事", "五角大楼"), "只从当前素材中选择冲突现场、军方画面或相关报道镜头，强化事件紧张感，不引入额外资料素材。"),
        (("分析", "影响", "后续", "可行性", "策略", "意味着"), "这一段仍然只用当前素材里的现有镜头和原生信息，数字人负责提炼判断，不额外补充外部解释画面。"),
    ]
    for keywords, intent in keyword_groups:
        if any(keyword in normalized for keyword in keywords):
            return intent
    return ""


def build_visual_intent(segment_id, summary, narration_text, index, total_segments):
    role = infer_segment_role(segment_id, index, total_segments)
    keyword_intent = infer_visual_keywords(f"{summary} {narration_text}")

    if role == "hook":
        return keyword_intent or "开场先用数字人快速抛出问题，再切入当前素材的核心原生画面；如果素材里已有强冲突原话或现场信息，优先保留素材表达。"
    if role == "fact":
        return keyword_intent or "这一段以当前素材画面和素材信息为主，数字人只负责串联关键事实；如素材已有明确表态或现场原话，优先保留原生内容。"
    if role == "impact":
        return keyword_intent or "这一段强调影响和代价，优先让当前素材承担主要信息密度，再由数字人补充判断；若素材原声有关键数字或结论，应优先保留。"
    if role == "close":
        return keyword_intent or "结尾由数字人做短总结，同时保留当前素材里的后续画面或原生语境，避免完全回到纯口播收尾。"
    return keyword_intent or "整体以当前素材内容为主，数字人负责提炼和转场，尽量给素材原生画面与原生原话留足空间，不使用额外素材。"


def build_video_script(outline, narration_plan):
    """
    将 content_outline.json 和 narration_plan.json 整合成统一的 video_script.json

    video_script 结构：
    {
        "topic": "主题",
        "angle": "角度",
        "target_duration_sec": 45,
        "segments": [
            {
                "id": "hook",
                "narration_text": "口播文本",
                "target_duration_sec": 10,
                "visual_intent": "画面意图描述",
                "allow_broll": true
            },
            ...
        ]
    }
    """
    if not outline or not narration_plan:
        raise RuntimeError("缺少必要的大纲或口播数据")

    # 提取基础信息
    topic = outline.get("topic", "")
    angle = outline.get("angle", "")
    target_duration_sec = outline.get("target_duration_sec", 45)

    # 构建分段脚本
    outline_segments = outline.get("segments", [])
    narration_sections = narration_plan.get("script_sections", [])

    # 建立 segment_id 到 narration 的映射
    narration_map = {}
    for section in narration_sections:
        segment_id = section.get("segment_id", "")
        if segment_id:
            narration_map[segment_id] = section.get("text", "")

    segments = []
    total_segments = len(outline_segments)

    for index, seg in enumerate(outline_segments):
        segment_id = seg.get("id", "")
        summary = seg.get("summary", "")
        narration_text = sanitize_script_text(narration_map.get(segment_id, summary))
        role = infer_segment_role(segment_id, index, total_segments)
        visual_intent = build_visual_intent(segment_id, summary, narration_text, index, total_segments)

        allow_broll = True
        preferred_video_source = "mixed" if role in {"hook", "close"} else "material"
        prefer_source_audio = role in {"fact", "impact"}

        segments.append({
            "id": segment_id,
            "narration_text": narration_text,
            "target_duration_sec": seg.get("estimated_sec", 15),
            "visual_intent": visual_intent,
            "allow_broll": allow_broll,
            "preferred_video_source": preferred_video_source,
            "prefer_source_audio": prefer_source_audio,
            "info_source": seg.get("info_source", "material"),
            "supporting_context": seg.get("supporting_context", "")
        })

    video_script = {
        "topic": topic,
        "angle": angle,
        "target_duration_sec": target_duration_sec,
        "segments": segments
    }

    return video_script


def main():
    parser = argparse.ArgumentParser(description="Build unified video script from outline and narration.")
    parser.add_argument("--outline", default="content_outline.json", help="Path to content_outline.json")
    parser.add_argument("--narration", default="narration_plan.json", help="Path to narration_plan.json")
    parser.add_argument("--output", default="video_script.json", help="Output path for video_script.json")
    args = parser.parse_args()

    emit_stage("video_script", "正在整合大纲和口播，生成统一视频脚本")

    outline = load_json(args.outline, {})
    narration_plan = load_json(args.narration, {})

    video_script = build_video_script(outline, narration_plan)

    # 写入输出文件
    output_path = Path(args.output)
    output_path.write_text(json.dumps(video_script, ensure_ascii=False, indent=2), encoding="utf-8")

    emit_result(
        "video_script",
        path=str(output_path),
        segments_count=len(video_script.get("segments", [])),
        total_duration_sec=video_script.get("target_duration_sec", 0),
    )

    print(f"✓ 视频脚本已生成: {output_path}")
    print(f"  - 主题: {video_script.get('topic', '')}")
    print(f"  - 分段数: {len(video_script.get('segments', []))}")
    print(f"  - 目标时长: {video_script.get('target_duration_sec', 0)} 秒")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="VIDEO_SCRIPT_BUILD_FAILED",
        error_message="视频脚本整合失败",
        error_stage="video_script",
        hint="请检查 content_outline.json、narration_plan.json 和视频脚本字段映射",
    ))
