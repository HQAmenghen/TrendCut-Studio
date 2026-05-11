#!/usr/bin/env python3
"""
素材切片脚本
以视觉候选窗口为主生成静音插片段，字幕文本只作为辅助描述。
"""
import sys
import json
import re
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)


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


def parse_time_range(time_str):
    """解析时间范围字符串 MM:SS-MM:SS 或 SS-SS"""
    time_str = time_str.strip()

    # MM:SS-MM:SS
    match = re.match(r'(\d+):(\d+)-(\d+):(\d+)', time_str)
    if match:
        start_min, start_sec, end_min, end_sec = map(int, match.groups())
        return (start_min * 60 + start_sec, end_min * 60 + end_sec)

    # SS-SS
    match = re.match(r'(\d+)-(\d+)', time_str)
    if match:
        start_sec, end_sec = map(int, match.groups())
        return (start_sec, end_sec)

    return (0, 0)


def is_sentence_complete(text):
    """判断是否是完整句子"""
    text = text.strip()
    if not text:
        return False

    # 以句号、问号、感叹号结尾
    if text[-1] in '。！？.!?':
        return True

    # 长度足够且语义完整（简单判断）
    if len(text) >= 10:
        return True

    return False


def get_subtitle_time(item):
    raw = item.get("time")
    if isinstance(raw, list) and len(raw) >= 2:
        return float(raw[0]), float(raw[1])
    return float(item.get("start", 0.0) or 0.0), float(item.get("end", 0.0) or 0.0)


def collect_visual_windows(subtitles, visual_timeline, min_duration=1.8, max_duration=5.0):
    """
    生成更适合静音插片的视觉候选窗口。
    优先按视觉时间线分块，再用字幕断句/时长上限细分。
    """
    if not subtitles:
        visual_ranges = []
        for visual in visual_timeline or []:
            start, end = parse_time_range(str(visual.get("time", "")).strip())
            if end > start:
                visual_ranges.append({
                    "start": round(float(start), 2),
                    "end": round(float(end), 2),
                    "texts": [],
                    "visual_summary": str(visual.get("action") or "").strip(),
                })
        return visual_ranges

    subtitle_items = []
    for item in subtitles:
        start, end = get_subtitle_time(item)
        subtitle_items.append({
            "start": round(float(start), 2),
            "end": round(float(end), 2),
            "text": str(item.get("zh") or item.get("text") or "").strip()
        })
    subtitle_items = [item for item in subtitle_items if item["end"] > item["start"]]
    if not subtitle_items:
        return []

    total_end = max(item["end"] for item in subtitle_items)
    visual_ranges = []
    for visual in visual_timeline or []:
        start, end = parse_time_range(str(visual.get("time", "")).strip())
        if end > start:
            visual_ranges.append({
                "start": float(start),
                "end": float(end),
                "action": str(visual.get("action") or "").strip()
            })
    if not visual_ranges:
        visual_ranges = [{
            "start": 0.0,
            "end": total_end,
            "action": ""
        }]

    windows = []
    for visual in visual_ranges:
        v_start = max(0.0, visual["start"])
        v_end = max(v_start + min_duration, min(total_end, visual["end"]))
        block_subs = [
            item for item in subtitle_items
            if item["start"] < v_end and item["end"] > v_start
        ]
        if not block_subs:
            continue

        current_start = max(v_start, block_subs[0]["start"])
        current_texts = []
        last_end = current_start

        for idx, sub in enumerate(block_subs):
            current_texts.append(sub["text"])
            last_end = max(last_end, sub["end"])
            duration = last_end - current_start
            text = sub["text"]
            next_sub = block_subs[idx + 1] if idx + 1 < len(block_subs) else None
            gap_to_next = (next_sub["start"] - sub["end"]) if next_sub else 0.0
            should_split = False

            if duration >= max_duration:
                should_split = True
            elif duration >= 3.0 and text.endswith(("。", "！", "？", ".", "!", "?")):
                should_split = True
            elif duration >= 2.4 and gap_to_next >= 0.45:
                should_split = True
            elif next_sub is None and duration >= min_duration:
                should_split = True

            if should_split:
                windows.append({
                    "start": round(current_start, 2),
                    "end": round(last_end, 2),
                    "texts": [item for item in current_texts if item],
                    "visual_summary": visual["action"],
                })
                if next_sub:
                    current_start = next_sub["start"]
                    current_texts = []

        if current_texts:
            fallback_end = max(last_end, current_start + min_duration)
            windows.append({
                "start": round(current_start, 2),
                "end": round(min(v_end, fallback_end), 2),
                "texts": [item for item in current_texts if item],
                "visual_summary": visual["action"],
            })

    deduped = []
    for item in windows:
        if item["end"] - item["start"] < min_duration:
            item["end"] = round(item["start"] + min_duration, 2)
        if deduped and abs(deduped[-1]["start"] - item["start"]) < 0.05 and abs(deduped[-1]["end"] - item["end"]) < 0.05:
            continue
        deduped.append(item)
    return deduped


def create_material_segments(subtitles, result_data, speaker_scene_data):
    """
    创建素材片段

    Args:
        subtitles: 字幕数据
        result_data: VLM 分析结果
        speaker_scene_data: 人物关系数据

    Returns:
        片段列表
    """
    visual_timeline = result_data.get("visual_timeline", [])
    audio_transcript = result_data.get("audio_transcript", [])
    visual_windows = collect_visual_windows(subtitles, visual_timeline)

    segments = []
    for i, seg in enumerate(visual_windows):
        segment_id = f"seg_{i+1:02d}"
        start = seg["start"]
        end = seg["end"]
        duration = end - start
        text = " ".join(seg.get("texts") or []).strip()

        visual_summary = seg.get("visual_summary", "")

        source_audio_text = ""
        for audio in audio_transcript:
            a_start, a_end = parse_time_range(audio.get("time", ""))
            if a_start <= start < a_end or start <= a_start < end:
                source_audio_text = audio.get("text", "")
                break
        if str(source_audio_text).strip() in {"无明显人声", "无人声", "无语音", "无明显语音"}:
            source_audio_text = ""

        is_complete = is_sentence_complete(text)

        speaker = "unknown"
        if speaker_scene_data:
            speakers = speaker_scene_data.get("speakers", [])
            if speakers:
                speaker = speakers[0].get("id", "unknown")

        segment_text = text or visual_summary or source_audio_text or str(result_data.get("summary") or "").strip()

        segments.append({
            "id": segment_id,
            "start": round(start, 2),
            "end": round(end, 2),
            "duration_sec": round(duration, 2),
            "text": segment_text,
            "source_audio_text": source_audio_text,
            "is_complete_sentence": is_complete,
            "speaker": speaker,
            "visual_summary": visual_summary,
            "has_strong_source_audio": False,
            "visual_priority": True
        })

    return segments


def main():
    """主函数"""
    emit_stage("segment_material", "正在切分素材片段")

    print("1. 正在读取输入文件...")

    # 读取字幕
    subtitles_path = Path("subtitles.json")
    subtitles = load_json("subtitles.json", [])
    subtitles_exists = subtitles_path.exists()

    # 读取 VLM 结果
    result_data = load_json("result.json", {})
    if not result_data:
        print("❌ 找不到 result.json")
        return 1

    # 读取人物关系（可选）
    speaker_scene_data = load_json("speaker_scene.json", {})

    if subtitles_exists:
        if subtitles:
            print(f"   ✓ 字幕: {len(subtitles)} 段")
        else:
            print("   ⚠️ 字幕为空，改用视觉时间线切片（适用于无声素材）")
    else:
        print("   ⚠️ subtitles.json 不存在，改用视觉时间线切片")
    print(f"   ✓ VLM 结果: {len(result_data.get('visual_timeline', []))} 个视觉片段")

    if not subtitles and not result_data.get("visual_timeline"):
        print("❌ 无可用字幕，且 VLM 未产出 visual_timeline，无法切片")
        return 1

    print("\n2. 正在切分素材片段...")

    segments = create_material_segments(subtitles, result_data, speaker_scene_data)
    if not segments:
        print("❌ 未生成任何素材片段")
        return 1

    print(f"   ✓ 切分完成: {len(segments)} 个片段")

    # 输出片段摘要
    for seg in segments[:5]:  # 只显示前5个
        print(f"      [{seg['id']}] {seg['start']:.1f}s-{seg['end']:.1f}s ({seg['duration_sec']:.1f}s)")
        print(f"          {seg['text'][:50]}...")

    if len(segments) > 5:
        print(f"      ... 还有 {len(segments) - 5} 个片段")

    print("\n3. 正在保存结果...")

    output = {
        "total_segments": len(segments),
        "total_duration_sec": round(sum(s["duration_sec"] for s in segments), 2),
        "segments": segments
    }

    if write_json("material_segments.json", output):
        print("   ✓ 已保存: material_segments.json")
        emit_result(
            "素材切片完成",
            segments_file="material_segments.json",
            segments_count=len(segments),
            total_duration=output["total_duration_sec"]
        )
    else:
        print("❌ 保存失败")
        return 1

    print("\n✅ 素材切片完成")
    return 0


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SEGMENT_MATERIAL_FAILED",
        error_message="素材切片失败",
        error_stage="segment_material",
        hint="请检查 subtitles.json 和 result.json 是否存在"
    ))
