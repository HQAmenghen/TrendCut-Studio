#!/usr/bin/env python3
"""
时间线编排脚本
按固定结构编排时间线：intro → material → bridge → material → outro
"""
import sys
import io
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)


def load_json(path_str, default=None):
    path = Path(path_str)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except:
        return default


def write_json(path_str, data):
    try:
        Path(path_str).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return True
    except:
        return False


def find_audio_segments_for_text(target_text, audio_segments, start_index=0):
    """
    为目标文本找到对应的音频片段

    Args:
        target_text: 目标文本（如 intro、bridge、outro）
        audio_segments: ASR 产出的音频片段列表
        start_index: 开始搜索的索引（避免重复使用已匹配的片段）

    Returns:
        (start_time, end_time, end_index, matched_start_index, matched_end_index) 或 None
        end_index: 匹配结束的片段索引，用于下次搜索的起点
    """
    if not audio_segments or not target_text:
        return None

    # 清理文本（移除标点和空格）
    def clean_text(text):
        import re
        return re.sub(r'[，。！？；：、""'',.!?;:()\[\]{}\"\'…·\-\s]', '', text or '')

    target_clean = clean_text(target_text)
    if not target_clean:
        return None

    best_match = None

    # 从 start_index 开始搜索，避免重复使用已匹配的片段
    for i in range(start_index, len(audio_segments)):
        accumulated_text = ''
        for j in range(i, len(audio_segments)):
            seg_text = audio_segments[j].get('text', '')
            accumulated_text += clean_text(seg_text)
            if not accumulated_text:
                continue

            overlap_ratio = 0.0
            if target_clean in accumulated_text or accumulated_text in target_clean:
                overlap_ratio = min(len(target_clean), len(accumulated_text)) / max(len(target_clean), len(accumulated_text))
            else:
                common = 0
                for ch in set(target_clean):
                    common += min(target_clean.count(ch), accumulated_text.count(ch))
                overlap_ratio = common / max(len(target_clean), len(accumulated_text))

            if overlap_ratio >= 0.62:
                k = j
                start_time = audio_segments[i].get('start', 0)
                end_time = audio_segments[k].get('end', start_time + 3.0)
                extra_ratio = max(0.0, (len(accumulated_text) - len(target_clean)) / max(len(target_clean), 1))
                span_penalty = (k - i) * 0.06
                score = overlap_ratio - extra_ratio * 0.18 - span_penalty
                candidate = (start_time, end_time, k + 1, i, k, overlap_ratio, score)
                if not best_match or candidate[6] > best_match[6]:
                    best_match = candidate
                if overlap_ratio >= 0.92 and extra_ratio <= 0.15:
                    break

            # 如果累积文本已经超过目标文本很多，停止
            if len(accumulated_text) > len(target_clean) * 1.5:
                break

        if best_match and best_match[5] >= 0.92:
            break

    if best_match:
        return (best_match[0], best_match[1], best_match[2], best_match[3], best_match[4])
    return None


def apply_transition_hints(timeline):
    if not timeline:
        return timeline

    for idx, shot in enumerate(timeline):
        duration = max(0.0, float(shot["end_time"]) - float(shot["start_time"]))
        is_first = idx == 0
        is_last = idx == len(timeline) - 1
        prev_shot = timeline[idx - 1] if idx > 0 else None
        next_shot = timeline[idx + 1] if idx + 1 < len(timeline) else None

        audio_fade_in = 0.0 if is_first else min(0.18, max(0.06, duration * 0.06))
        audio_fade_out = 0.0 if is_last else min(0.18, max(0.06, duration * 0.06))

        video_fade_in = 0.0 if is_first else min(0.12, max(0.04, duration * 0.04))
        video_fade_out = 0.0 if is_last else min(0.12, max(0.04, duration * 0.04))

        if prev_shot and prev_shot["video_source"] == shot["video_source"]:
            video_fade_in = min(video_fade_in, 0.05)
        if next_shot and next_shot["video_source"] == shot["video_source"]:
            video_fade_out = min(video_fade_out, 0.05)

        shot["audio_fade_in"] = round(audio_fade_in, 2)
        shot["audio_fade_out"] = round(audio_fade_out, 2)
        shot["video_fade_in"] = round(video_fade_in, 2)
        shot["video_fade_out"] = round(video_fade_out, 2)

    return timeline


def resolve_avatar_duration(text, aiman_audio, audio_search_index, label):
    estimated_duration = max(1.6, len(text) * 0.3)
    duration = estimated_duration
    next_index = audio_search_index
    cut_start = 0.0
    cut_end = duration
    matched_precisely = False
    def clean_text(value):
        import re
        return re.sub(r'[，。！？；：、""'',.!?;:()\[\]{}\"\'…·\-\s]', '', str(value or ''))

    def choose_best_contiguous_group(target, segments, start_idx, end_idx):
        if start_idx > end_idx:
            return None
        groups = []
        group_start = start_idx
        for idx in range(start_idx + 1, end_idx + 1):
            prev_end = float(segments[idx - 1].get("end", 0.0))
            curr_start = float(segments[idx].get("start", prev_end))
            if curr_start - prev_end > 0.45:
                groups.append((group_start, idx - 1))
                group_start = idx
        groups.append((group_start, end_idx))

        if len(groups) <= 1:
            return None

        target_clean = clean_text(target)
        best = None
        for g_start, g_end in groups:
            group_text = ''.join(clean_text(segments[i].get("text", "")) for i in range(g_start, g_end + 1))
            if not group_text:
                continue
            common = 0
            for ch in set(target_clean):
                common += min(target_clean.count(ch), group_text.count(ch))
            overlap = common / max(len(target_clean), len(group_text), 1)
            # outro 优先后面的连续组，intro/bridge 优先更高重合度
            later_bias = (g_start / max(len(segments), 1)) * 0.08 if label == "outro" else 0.0
            score = overlap + later_bias
            if not best or score > best[0]:
                best = (score, g_start, g_end, overlap)
        return best

    if aiman_audio and len(aiman_audio) > 0 and text:
        result = find_audio_segments_for_text(text, aiman_audio, audio_search_index)
        if result:
            start_time, end_time, next_index, match_start_index, match_end_index = result
            gap_trimmed = choose_best_contiguous_group(text, aiman_audio, match_start_index, match_end_index)
            if gap_trimmed:
                _, group_start, group_end, overlap = gap_trimmed
                start_time = float(aiman_audio[group_start].get("start", start_time))
                end_time = float(aiman_audio[group_end].get("end", end_time))
                next_index = group_end + 1
                print(
                    f"   ⚠️ {label} 检测到内部停顿，收缩到连续音频段: "
                    f"{start_time:.2f}s - {end_time:.2f}s (片段 {group_start}-{group_end}, overlap={overlap:.2f})"
                )
            duration = end_time - start_time
            cut_start = start_time
            cut_end = end_time
            matched_precisely = True
            print(f"   ✓ {label} 匹配到音频: {start_time:.2f}s - {end_time:.2f}s (片段 {next_index - 1})")
        else:
            if audio_search_index < len(aiman_audio):
                fallback_seg = aiman_audio[audio_search_index]
                cut_start = float(fallback_seg.get("start", 0.0))
                cut_end = min(
                    float(aiman_audio[-1].get("end", cut_start + estimated_duration)),
                    cut_start + estimated_duration
                )
                next_index = min(len(aiman_audio), audio_search_index + 1)
                print(f"   ⚠️ {label} 未精确匹配，回退使用后续音频段: {cut_start:.2f}s - {cut_end:.2f}s")
            else:
                if aiman_audio:
                    cut_start = max(0.0, float(aiman_audio[-1].get("end", estimated_duration)) - estimated_duration)
                    cut_end = cut_start + estimated_duration
                print(f"   ⚠️ {label} 未匹配到音频，使用尾部估算时长: {estimated_duration:.2f}s")
    if cut_end <= cut_start:
        cut_end = cut_start + estimated_duration
    duration = (cut_end - cut_start) if matched_precisely else max(1.6, cut_end - cut_start)
    return duration, next_index, round(cut_start, 2), round(cut_end, 2)


def trim_material_segments(selected_segments, material_budget):
    if not selected_segments:
        return []

    min_segment = 4.5
    max_segment = 12.0
    trimmed = []
    remaining = max(0.0, material_budget)
    total_segments = len(selected_segments)

    for idx, seg in enumerate(selected_segments):
        seg_duration = max(0.0, float(seg["end"]) - float(seg["start"]))
        if seg_duration <= 0:
            continue

        segments_left = total_segments - idx
        reserve_for_rest = min_segment * max(0, segments_left - 1)
        allowed = remaining - reserve_for_rest if remaining > reserve_for_rest else remaining

        if allowed < min_segment and not trimmed:
            allowed = min(seg_duration, max(remaining, min_segment))
        elif allowed < min_segment:
            break

        target_duration = min(seg_duration, max_segment, allowed)
        if target_duration < min_segment and seg_duration >= min_segment and remaining >= min_segment:
            target_duration = min(seg_duration, min(max_segment, remaining))

        if target_duration <= 0:
            continue

        trimmed.append({
            **seg,
            "start": round(float(seg["start"]), 2),
            "end": round(float(seg["start"]) + target_duration, 2),
            "original_end": seg["end"],
            "trimmed_duration_sec": round(target_duration, 2)
        })
        remaining = max(0.0, remaining - target_duration)
        if remaining < min_segment:
            break

    if not trimmed:
        best = selected_segments[0]
        fallback_duration = min(max_segment, max(min_segment, float(best["end"]) - float(best["start"])))
        trimmed.append({
            **best,
            "start": round(float(best["start"]), 2),
            "end": round(float(best["start"]) + fallback_duration, 2),
            "original_end": best["end"],
            "trimmed_duration_sec": round(fallback_duration, 2)
        })

    return trimmed


def build_hook_segment(selected_segments):
    if not selected_segments:
        return None

    def hook_score(seg):
        base = float(seg.get("total_score", 0) or 0)
        text_len = len(str(seg.get("text", "")).strip())
        audio_bonus = 2.0 if seg.get("keep_source_audio") else 0.0
        role_bonus = 1.0 if str(seg.get("role", "")).startswith("main") else 0.0
        return base + audio_bonus + role_bonus + min(text_len / 20.0, 2.5)

    source = max(selected_segments, key=hook_score)
    hook_duration = min(5.0, max(3.0, float(source.get("end", 0)) - float(source.get("start", 0))))
    return {
        **source,
        "role": "hook_material",
        "start": round(float(source["start"]), 2),
        "end": round(float(source["start"]) + hook_duration, 2),
        "trimmed_duration_sec": round(hook_duration, 2),
        "keep_source_audio": True
    }


def compose_timeline(selected_segments, bridge_script, aiman_audio, target_duration_sec=45):
    """编排时间线

    如果 aiman_audio 存在且有效，尝试通过文本匹配找到对应的音频片段
    否则使用估算时长（字数 × 0.3秒）

    注意：使用 audio_search_index 跟踪已使用的音频片段，避免重复使用
    """
    timeline = []
    current_time = 0.0
    audio_search_index = 0  # 跟踪已使用的音频片段索引

    intro_text = bridge_script.get("intro", "")
    bridges = [text for text in bridge_script.get("bridges", []) if text]
    outro_text = bridge_script.get("outro", "")

    intro_duration, audio_search_index, intro_cut_start, intro_cut_end = resolve_avatar_duration(intro_text, aiman_audio, audio_search_index, "intro")
    bridge_cuts = []
    for idx, bridge_text in enumerate(bridges, 1):
        duration, audio_search_index, cut_start, cut_end = resolve_avatar_duration(bridge_text, aiman_audio, audio_search_index, f"bridge_{idx}")
        bridge_cuts.append({
            "duration": duration,
            "cut_start": cut_start,
            "cut_end": cut_end
        })
    outro_duration, audio_search_index, outro_cut_start, outro_cut_end = resolve_avatar_duration(outro_text, aiman_audio, audio_search_index, "outro")

    hook_segment = build_hook_segment(selected_segments)
    hook_duration = hook_segment["end"] - hook_segment["start"] if hook_segment else 0.0

    reserved_avatar_duration = hook_duration + intro_duration + sum(item["duration"] for item in bridge_cuts) + outro_duration
    material_budget = max(8.0, float(target_duration_sec) - reserved_avatar_duration)
    timeline_segments = trim_material_segments(selected_segments, material_budget)

    if hook_segment:
        filtered = [seg for seg in timeline_segments if seg["id"] != hook_segment["id"]]
        timeline_segments = filtered or timeline_segments

    print(f"   ✓ Hook 素材时长: {hook_duration:.2f}s")
    print(f"   ✓ 预留数字人时长: {reserved_avatar_duration:.2f}s")
    print(f"   ✓ 素材预算时长: {material_budget:.2f}s")
    print(f"   ✓ 实际采用素材片段: {len(timeline_segments)}")

    if hook_segment:
        timeline.append({
            "start_time": round(current_time, 2),
            "end_time": round(current_time + hook_duration, 2),
            "video_source": "material.mp4",
            "audio_source": "b_roll",
            "subtitle_text": hook_segment["text"],
            "role": "hook_material",
            "material_cut_start": hook_segment["start"],
            "material_cut_end": hook_segment["end"]
        })
        current_time += hook_duration

    timeline.append({
        "start_time": round(current_time, 2),
        "end_time": round(current_time + intro_duration, 2),
        "video_source": "aiman.mp4",
        "audio_source": "main",
        "subtitle_text": intro_text,
        "role": "intro",
        "avatar_cut_start": intro_cut_start,
        "avatar_cut_end": intro_cut_end
    })
    current_time += intro_duration

    bridge_idx = 0

    for seg in timeline_segments:
        seg_duration = seg["end"] - seg["start"]
        audio_source = "b_roll" if seg.get("keep_source_audio") else "main"

        timeline.append({
            "start_time": round(current_time, 2),
            "end_time": round(current_time + seg_duration, 2),
            "video_source": "material.mp4",
            "audio_source": audio_source,
            "subtitle_text": seg["text"],
            "role": seg["role"],
            "material_cut_start": seg["start"],
            "material_cut_end": seg["end"]
        })
        current_time += seg_duration

        if bridge_idx < len(bridges) and seg["role"].startswith("main"):
            bridge_text = bridges[bridge_idx]
            bridge_duration = bridge_cuts[bridge_idx]["duration"]

            timeline.append({
                "start_time": round(current_time, 2),
                "end_time": round(current_time + bridge_duration, 2),
                "video_source": "aiman.mp4",
                "audio_source": "main",
                "subtitle_text": bridge_text,
                "role": f"bridge_{bridge_idx + 1}",
                "avatar_cut_start": bridge_cuts[bridge_idx]["cut_start"],
                "avatar_cut_end": bridge_cuts[bridge_idx]["cut_end"]
            })
            current_time += bridge_duration
            bridge_idx += 1

    timeline.append({
        "start_time": round(current_time, 2),
        "end_time": round(current_time + outro_duration, 2),
        "video_source": "aiman.mp4",
        "audio_source": "main",
        "subtitle_text": outro_text,
        "role": "outro",
        "avatar_cut_start": outro_cut_start,
        "avatar_cut_end": outro_cut_end
    })

    return apply_transition_hints(timeline)


def main():
    emit_stage("compose_timeline", "正在编排时间线")

    print("1. 正在读取输入文件...")
    selected_data = load_json("selected_segments.json", {})
    bridge_script = load_json("bridge_script.json", {})
    aiman_audio = load_json("aiman_audio.json", load_json("audio.json", []))
    target_duration_sec = float(selected_data.get("target_duration_sec", 45) or 45)

    if not selected_data or not bridge_script:
        raise RuntimeError("缺少 selected_segments.json 或 bridge_script.json，无法编排时间线")

    segments = selected_data.get("segments", [])
    if not segments:
        raise RuntimeError("selected_segments.json 中没有片段，无法编排时间线")
    print(f"   ✓ 素材片段: {len(segments)}")
    print(f"   ✓ 补位文案: {bridge_script.get('total_sentences', 0)} 句")

    print("\n2. 正在编排时间线...")
    timeline = compose_timeline(segments, bridge_script, aiman_audio, target_duration_sec)
    if not timeline:
        raise RuntimeError("时间线为空，无法继续生成成片")

    print(f"   ✓ 时间线: {len(timeline)} 个片段")
    total_duration = timeline[-1]["end_time"] if timeline else 0
    print(f"   ✓ 总时长: {total_duration:.1f}s")

    # 统计素材占比
    material_duration = sum(
        (shot["end_time"] - shot["start_time"])
        for shot in timeline
        if shot["video_source"] == "material.mp4"
    )
    material_ratio = material_duration / total_duration if total_duration > 0 else 0
    print(f"   ✓ 素材占比: {material_ratio*100:.1f}%")

    print("\n3. 正在保存结果...")
    if write_json("timeline.json", timeline):
        print("   ✓ 已保存: timeline.json")
        emit_result(
            "时间线编排完成",
            timeline_file="timeline.json",
            shots_count=len(timeline),
            total_duration=total_duration,
            material_ratio=material_ratio
        )
    else:
        print("❌ 保存失败")
        return

    print("\n✅ 时间线编排完成")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="COMPOSE_TIMELINE_FAILED",
        error_message="时间线编排失败",
        error_stage="compose_timeline",
        hint="请检查 selected_segments.json 和 bridge_script.json"
    ))
