import sys
import io
import json
import argparse
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


def build_audio_segments(audio_data):
    if not isinstance(audio_data, list):
        return []
    segments = []
    for item in audio_data:
        try:
            start = float(item.get('start', 0))
            end = float(item.get('end', 0))
        except Exception:
            continue
        text = str(item.get('text', '')).strip()
        if end <= start:
            continue
        segments.append({
            'start': start,
            'end': end,
            'text': text,
        })
    return segments


def find_covering_audio_segment(audio_segments, timestamp, tolerance=0.15):
    for segment in audio_segments:
        if segment['start'] + tolerance < timestamp < segment['end'] - tolerance:
            return segment
    return None


def snap_main_to_broll_boundaries(plan, audio_segments, max_shift=2.5):
    """
    避免数字人主讲一句话没说完就切到素材原声。
    如果从 main 切到 b_roll 的边界落在句子中间，就把边界推到当前句末。
    """
    if not plan or not audio_segments:
        return plan

    for index in range(1, len(plan)):
        prev_segment = plan[index - 1]
        current_segment = plan[index]

        if prev_segment.get('audio_source') != 'main':
            continue
        if current_segment.get('audio_source') != 'b_roll':
            continue

        boundary = float(current_segment.get('start_time', 0))
        covering = find_covering_audio_segment(audio_segments, boundary)
        if not covering:
            continue

        sentence_end = float(covering['end'])
        shift = sentence_end - boundary
        if shift <= 0 or shift > max_shift:
            continue

        prev_segment['end_time'] = round(sentence_end, 3)
        current_segment['start_time'] = round(sentence_end, 3)
        print(
            f"✓ 边界顺延到句末：片段 {index - 1}->{index} "
            f"{boundary:.2f}s -> {sentence_end:.2f}s"
        )

    return plan


def is_material_segment(segment):
    return segment.get('video_source') in {'material.mp4', 'b_roll'}


def set_main_segment(segment):
    segment['video_source'] = 'aiman.mp4'
    segment['cut_start'] = None
    segment['cut_end'] = None
    return segment


def merge_adjacent_segments(segments):
    merged = []
    for segment in segments:
        if not merged:
            merged.append(segment)
            continue

        last = merged[-1]
        same_video = last.get('video_source') == segment.get('video_source')
        same_audio = last.get('audio_source') == segment.get('audio_source')
        contiguous = abs(float(last.get('end_time', 0)) - float(segment.get('start_time', 0))) < 0.1

        if same_video and same_audio and contiguous:
            last['end_time'] = segment.get('end_time', last['end_time'])
            last_subtitle = str(last.get('subtitle_text', '')).strip()
            seg_subtitle = str(segment.get('subtitle_text', '')).strip()
            if last_subtitle and seg_subtitle:
                last['subtitle_text'] = f"{last_subtitle} {seg_subtitle}".strip()
            elif seg_subtitle:
                last['subtitle_text'] = seg_subtitle
            continue

        merged.append(segment)
    return merged


def normalize_audio_transitions(plan, min_source_audio_duration=6.0, min_audio_switch_gap=5.0):
    """
    优先把素材原声保留成完整段，减少频繁来回切换。
    - 太短的素材原声段改成 main 音频
    - 如果上一个音频段还没站稳就切换，也尽量保持当前音频连续
    """
    if not plan:
        return plan

    normalized = [segment.copy() for segment in plan]

    for i, segment in enumerate(normalized):
        duration = float(segment.get('end_time', 0)) - float(segment.get('start_time', 0))
        if segment.get('audio_source') == 'b_roll' and duration < min_source_audio_duration:
            segment['audio_source'] = 'main'
            print(f"✓ 片段 {i} 素材原声段过短，改为保留素材画面 + 数字人口播")

    for i in range(1, len(normalized)):
        prev = normalized[i - 1]
        current = normalized[i]
        prev_duration = float(prev.get('end_time', 0)) - float(prev.get('start_time', 0))
        if prev.get('audio_source') == current.get('audio_source'):
            continue
        if prev_duration < min_audio_switch_gap:
            current['audio_source'] = prev.get('audio_source')
            print(
                f"✓ 片段 {i} 音频切换过密，保持上一段音频源 "
                f"{prev.get('audio_source')} 以减少违和感"
            )

    return normalized


def enforce_material_visual_ratio(plan, target_ratio=0.6, material_duration_limit=None):
    """
    优先把“素材原声 + 数字人画面”的混合段改成“素材原声 + 素材画面”，
    确保最终视觉上真的是素材主导，而不是只有音频在用素材。
    """
    if not plan:
        return plan

    normalized = [segment.copy() for segment in plan]
    total_duration = sum(max(0.0, float(seg.get('end_time', 0)) - float(seg.get('start_time', 0))) for seg in normalized)
    if total_duration <= 0:
        return normalized

    def material_video_duration(items):
        return sum(
            max(0.0, float(seg.get('end_time', 0)) - float(seg.get('start_time', 0)))
            for seg in items
            if seg.get('video_source') == 'material.mp4'
        )

    current_ratio = material_video_duration(normalized) / total_duration
    if current_ratio >= target_ratio:
        return normalized

    for i, seg in enumerate(normalized):
        if current_ratio >= target_ratio:
            break
        if seg.get('video_source') != 'aiman.mp4':
            continue
        if seg.get('audio_source') != 'b_roll':
            continue

        duration = max(0.0, float(seg.get('end_time', 0)) - float(seg.get('start_time', 0)))
        if duration <= 0:
            continue

        cut_start = seg.get('cut_start')
        cut_end = seg.get('cut_end')
        if cut_start is None or cut_end is None or float(cut_end) <= float(cut_start):
            fallback_start = max(0.0, float(seg.get('start_time', 0)))
            fallback_end = fallback_start + duration
            if material_duration_limit is not None:
                fallback_end = min(float(material_duration_limit), fallback_end)
                fallback_start = max(0.0, fallback_end - duration)
            cut_start = round(fallback_start, 3)
            cut_end = round(fallback_end, 3)

        seg['video_source'] = 'material.mp4'
        seg['cut_start'] = cut_start
        seg['cut_end'] = cut_end
        current_ratio = material_video_duration(normalized) / total_duration
        print(
            f"✓ 片段 {i} 改为素材画面以提升视觉素材占比 "
            f"(当前 {current_ratio:.0%} / 目标 {target_ratio:.0%})"
        )

    return normalized


def post_process_director(raw_plan, config=None, audio_segments=None):
    """
    对导演原始输出进行后处理，修正常见问题

    规则：
    1. 单镜头最短时长限制（默认 2 秒）
    2. 连续 B-roll 限制（默认最多连续 2 个）
    3. 越界修正（确保 cut_start < cut_end）
    4. 过碎片段合并
    5. 明显不合理片段回退到数字人主画面
    """
    if not raw_plan or not isinstance(raw_plan, list):
        return []

    config = config or {}
    min_shot_duration = config.get('min_shot_duration', 4.0)  # 单镜头最短时长
    max_consecutive_broll = config.get('max_consecutive_broll', 1)  # 最多连续 B-roll 数量
    min_broll_duration = config.get('min_broll_duration', 3.5)  # B-roll 最短时长
    min_main_on_material_duration = config.get('min_main_on_material_duration', 6.0)
    opening_main_duration = config.get('opening_main_duration', 6.0)
    closing_main_duration = config.get('closing_main_duration', 0.0)
    avatar_duration = max((float(item.get('end', 0)) for item in (audio_segments or [])), default=0.0)

    processed = []
    consecutive_broll_count = 0

    for i, segment in enumerate(raw_plan):
        # 复制原始片段
        new_segment = segment.copy()

        # 规则 0: 开头和结尾更保守，避免一上来/最后阶段乱切
        if segment.get('start_time', 0) < opening_main_duration and is_material_segment(new_segment):
            print(f"⚠️ 片段 {i} 位于开头 {opening_main_duration}s 内，强制回退为数字人主画面")
            set_main_segment(new_segment)
            consecutive_broll_count = 0

        # 规则 1: 单镜头最短时长限制
        duration = segment.get('end_time', 0) - segment.get('start_time', 0)
        if duration < min_shot_duration:
            print(f"⚠️ 片段 {i} 时长过短 ({duration:.2f}s < {min_shot_duration}s)，尝试合并或调整")
            # 如果是 B-roll 且时长过短，改回数字人主画面
            if is_material_segment(segment):
                set_main_segment(new_segment)
                print(f"  → 已回退为数字人主画面")
                consecutive_broll_count = 0
            else:
                # 如果是数字人主画面且时长过短，保持不变（可能是有意的快节奏）
                pass

        # 规则 2: 连续 B-roll 限制
        if is_material_segment(new_segment):
            consecutive_broll_count += 1
            if consecutive_broll_count > max_consecutive_broll:
                print(f"⚠️ 片段 {i} 连续 B-roll 过多 (第 {consecutive_broll_count} 个)，回退为数字人主画面")
                set_main_segment(new_segment)
                consecutive_broll_count = 0
        else:
            consecutive_broll_count = 0

        # 规则 3: 越界修正
        if is_material_segment(new_segment):
            cut_start = new_segment.get('cut_start', 0)
            cut_end = new_segment.get('cut_end', 0)
            if cut_start >= cut_end:
                print(f"⚠️ 片段 {i} B-roll 时间越界 (cut_start={cut_start} >= cut_end={cut_end})，回退为数字人主画面")
                set_main_segment(new_segment)
                consecutive_broll_count = 0

        # 规则 4: B-roll 时长过短
        if is_material_segment(new_segment):
            cut_start = new_segment.get('cut_start', 0)
            cut_end = new_segment.get('cut_end', 0)
            broll_duration = cut_end - cut_start
            if broll_duration < min_broll_duration:
                print(f"⚠️ 片段 {i} B-roll 素材时长过短 ({broll_duration:.2f}s < {min_broll_duration}s)，回退为数字人主画面")
                set_main_segment(new_segment)
                consecutive_broll_count = 0

        # 规则 4.5: 数字人口播时如果素材画面太短，容易出现“说半句就切画面”的生硬感
        if (
            new_segment.get('audio_source') == 'main'
            and new_segment.get('video_source') == 'material.mp4'
        ):
            main_duration = float(new_segment.get('end_time', 0)) - float(new_segment.get('start_time', 0))
            if main_duration < min_main_on_material_duration:
                print(
                    f"⚠️ 片段 {i} 数字人口播+素材画面过短 "
                    f"({main_duration:.2f}s < {min_main_on_material_duration}s)，回退为数字人主画面"
                )
                set_main_segment(new_segment)
                consecutive_broll_count = 0

        processed.append(new_segment)

    # 规则 5: 合并相邻的同源片段，减少碎切
    merged = merge_adjacent_segments(processed)

    # 规则 6: 如果主讲还没说完整句就切到素材原声，顺延到句末
    merged = snap_main_to_broll_boundaries(merged, audio_segments or [])

    # 规则 6.5: 音频切换节奏平滑，尽量保留完整素材原声段
    merged = normalize_audio_transitions(merged)
    merged = merge_adjacent_segments(merged)

    # 规则 7: 再次检查边界修正后过短的素材片段
    final_segments = []
    for i, segment in enumerate(merged):
        seg = segment.copy()
        duration = float(seg.get('end_time', 0)) - float(seg.get('start_time', 0))
        if is_material_segment(seg) and duration < min_broll_duration:
            print(f"⚠️ 片段 {i} 在边界修正后素材段过短 ({duration:.2f}s)，回退为数字人主画面")
            set_main_segment(seg)
        final_segments.append(seg)

    # 规则 8: 处理超过数字人主轨的尾段，只允许素材原声继续往后讲
    if final_segments and avatar_duration > 0:
        for i, seg in enumerate(final_segments):
            seg_start = float(seg.get('start_time', 0))
            seg_end = float(seg.get('end_time', 0))
            if seg_start >= avatar_duration and seg.get('audio_source') == 'main':
                print(f"⚠️ 片段 {i} 超过数字人主轨尾部，改为素材原声尾段")
                seg['audio_source'] = 'b_roll'
                seg['video_source'] = 'material.mp4'
                if seg.get('cut_start') is None or seg.get('cut_end') is None:
                    seg['cut_start'] = round(seg_start, 3)
                    seg['cut_end'] = round(seg_end, 3)

    # 规则 9: 如有需要，结尾阶段可选回到数字人；默认关闭，允许素材收尾
    if final_segments and closing_main_duration > 0:
        total_end = float(final_segments[-1].get('end_time', 0))
        for i, seg in enumerate(final_segments):
            if total_end - float(seg.get('end_time', 0)) < closing_main_duration and is_material_segment(seg):
                print(f"⚠️ 片段 {i} 位于结尾 {closing_main_duration}s 内，回退为数字人主画面")
                set_main_segment(seg)

    print(f"\n✓ 后处理完成：原始 {len(raw_plan)} 个片段 → 最终 {len(final_segments)} 个片段")
    return final_segments


def main():
    parser = argparse.ArgumentParser(description="Post-process director output to fix common issues.")
    parser.add_argument("--input", default="director_raw.json", help="Input raw director plan")
    parser.add_argument("--output", default="director_final.json", help="Output final director plan")
    parser.add_argument("--min-shot-duration", type=float, default=4.0, help="Minimum shot duration in seconds")
    parser.add_argument("--max-consecutive-broll", type=int, default=1, help="Maximum consecutive B-roll shots")
    parser.add_argument("--min-broll-duration", type=float, default=3.5, help="Minimum B-roll duration in seconds")
    parser.add_argument("--min-main-on-material-duration", type=float, default=6.0, help="Minimum duration for main-audio on material visuals")
    parser.add_argument("--opening-main-duration", type=float, default=6.0, help="Keep avatar/main shot for the first N seconds")
    parser.add_argument("--closing-main-duration", type=float, default=0.0, help="Prefer avatar/main shot in the last N seconds")
    args = parser.parse_args()

    emit_stage("post_process_director", "正在对导演方案进行后处理修正")

    raw_plan = load_json(args.input, [])
    if not raw_plan:
        raise RuntimeError(f"找不到有效的导演原始方案: {args.input}")

    audio_segments = build_audio_segments(load_json("audio.json", []))

    config = {
        'min_shot_duration': args.min_shot_duration,
        'max_consecutive_broll': args.max_consecutive_broll,
        'min_broll_duration': args.min_broll_duration,
        'min_main_on_material_duration': args.min_main_on_material_duration,
        'opening_main_duration': args.opening_main_duration,
        'closing_main_duration': args.closing_main_duration,
    }

    material_duration_limit = None
    try:
        video_result = load_json("result.json", {})
        material_duration_limit = (
            video_result.get('duration_sec')
            or video_result.get('video_duration')
            or video_result.get('duration')
        )
        if material_duration_limit is not None:
            material_duration_limit = float(material_duration_limit)
    except Exception:
        material_duration_limit = None

    final_plan = post_process_director(raw_plan, config, audio_segments=audio_segments)
    final_plan = enforce_material_visual_ratio(
        final_plan,
        target_ratio=0.6,
        material_duration_limit=material_duration_limit
    )

    # 写入输出文件
    output_path = Path(args.output)
    output_path.write_text(json.dumps(final_plan, ensure_ascii=False, indent=2), encoding="utf-8")

    emit_result(
        "post_process_director",
        path=str(output_path),
        raw_segments=len(raw_plan),
        final_segments=len(final_plan),
        fixed_count=len(raw_plan) - len(final_plan),
    )

    print(f"\n✓ 导演后处理完成: {output_path}")
    print(f"  - 原始片段: {len(raw_plan)}")
    print(f"  - 最终片段: {len(final_plan)}")
    print(f"  - 修正数量: {len(raw_plan) - len(final_plan)}")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="DIRECTOR_POST_PROCESS_FAILED",
        error_message="导演后处理失败",
        error_stage="director_post_process",
        hint="请检查 director_raw.json 结构以及镜头时长修正规则",
    ))
