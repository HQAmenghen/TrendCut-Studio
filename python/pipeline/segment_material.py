#!/usr/bin/env python3
"""
素材切片脚本
按字幕时间轴和停顿点，把素材切成完整语义段
"""
import sys
import io
import json
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

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


def merge_segments_by_pause(subtitles, max_gap=2.0, min_duration=3.0):
    """
    按停顿点合并字幕为语义段

    Args:
        subtitles: 字幕列表
        max_gap: 最大停顿间隔（秒）
        min_duration: 最小片段时长（秒）

    Returns:
        合并后的片段列表
    """
    if not subtitles:
        return []

    segments = []
    current_segment = {
        "start": subtitles[0]["time"][0],
        "end": subtitles[0]["time"][1],
        "texts": [subtitles[0]["zh"]]
    }

    for i in range(1, len(subtitles)):
        prev_end = subtitles[i-1]["time"][1]
        curr_start = subtitles[i]["time"][0]
        curr_end = subtitles[i]["time"][1]
        curr_text = subtitles[i]["zh"]

        gap = curr_start - prev_end

        # 如果停顿小于阈值，合并到当前段
        if gap <= max_gap:
            current_segment["end"] = curr_end
            current_segment["texts"].append(curr_text)
        else:
            # 停顿较大，结束当前段，开始新段
            duration = current_segment["end"] - current_segment["start"]
            if duration >= min_duration:
                segments.append(current_segment)

            current_segment = {
                "start": curr_start,
                "end": curr_end,
                "texts": [curr_text]
            }

    # 添加最后一段
    duration = current_segment["end"] - current_segment["start"]
    if duration >= min_duration:
        segments.append(current_segment)

    return segments


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
    # 按停顿合并字幕
    merged = merge_segments_by_pause(subtitles)

    # 获取视觉时间轴
    visual_timeline = result_data.get("visual_timeline", [])
    audio_transcript = result_data.get("audio_transcript", [])

    segments = []
    for i, seg in enumerate(merged):
        segment_id = f"seg_{i+1:02d}"
        start = seg["start"]
        end = seg["end"]
        duration = end - start
        text = " ".join(seg["texts"])

        # 查找对应的视觉描述
        visual_summary = ""
        for visual in visual_timeline:
            v_start, v_end = parse_time_range(visual.get("time", ""))
            if v_start <= start < v_end or start <= v_start < end:
                visual_summary = visual.get("action", "")
                break

        # 查找对应的原声文本
        source_audio_text = ""
        for audio in audio_transcript:
            a_start, a_end = parse_time_range(audio.get("time", ""))
            if a_start <= start < a_end or start <= a_start < end:
                source_audio_text = audio.get("text", "")
                break

        # 判断是否有强原声
        has_strong_source_audio = len(source_audio_text) > 20

        # 判断句子完整性
        is_complete = is_sentence_complete(text)

        # 提取说话人（简化版）
        speaker = "unknown"
        if speaker_scene_data:
            speakers = speaker_scene_data.get("speakers", [])
            if speakers:
                speaker = speakers[0].get("id", "unknown")

        segments.append({
            "id": segment_id,
            "start": round(start, 2),
            "end": round(end, 2),
            "duration_sec": round(duration, 2),
            "text": text,
            "source_audio_text": source_audio_text,
            "is_complete_sentence": is_complete,
            "speaker": speaker,
            "visual_summary": visual_summary,
            "has_strong_source_audio": has_strong_source_audio
        })

    return segments


def main():
    """主函数"""
    emit_stage("segment_material", "正在切分素材片段")

    print("1. 正在读取输入文件...")

    # 读取字幕
    subtitles = load_json("subtitles.json", [])
    if not subtitles:
        print("❌ 找不到 subtitles.json")
        return

    # 读取 VLM 结果
    result_data = load_json("result.json", {})
    if not result_data:
        print("❌ 找不到 result.json")
        return

    # 读取人物关系（可选）
    speaker_scene_data = load_json("speaker_scene.json", {})

    print(f"   ✓ 字幕: {len(subtitles)} 段")
    print(f"   ✓ VLM 结果: {len(result_data.get('visual_timeline', []))} 个视觉片段")

    print("\n2. 正在切分素材片段...")

    segments = create_material_segments(subtitles, result_data, speaker_scene_data)

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
        return

    print("\n✅ 素材切片完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SEGMENT_MATERIAL_FAILED",
        error_message="素材切片失败",
        error_stage="segment_material",
        hint="请检查 subtitles.json 和 result.json 是否存在"
    ))
