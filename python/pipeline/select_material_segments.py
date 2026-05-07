#!/usr/bin/env python3
"""
素材选用脚本
从高分视觉片段中选出开场、主体、收尾素材段
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


def select_segments(scored_segments, target_duration=45):
    """
    选择素材片段

    Args:
        scored_segments: 已打分的片段列表
        target_duration: 目标总时长（秒）

    Returns:
        选中的片段列表
    """
    if not scored_segments:
        return [], 0.0

    def total_score(seg):
        return float(seg.get("total_score", 0) or 0)

    def position_score(seg, key):
        return float(seg.get("scores", {}).get("position_suitability", {}).get(key, 0) or 0)

    def priority(seg):
        value = seg.get("recommendation")
        if isinstance(value, dict):
            value = value.get("priority")
        value = str(value or "").strip().lower()
        mapping = {
            "high_priority": "high",
            "medium_priority": "medium",
            "low_priority": "low",
        }
        return mapping.get(value, value or "medium")

    # 按推荐级别分组
    high_priority = [s for s in scored_segments if priority(s) == "high"]
    medium_priority = [s for s in scored_segments if priority(s) == "medium"]

    # 选择开场片段（适合开场的高分片段）
    opening_candidates = sorted(
        scored_segments,
        key=lambda x: (position_score(x, "opening"), total_score(x)),
        reverse=True
    )
    opening_segment = opening_candidates[0] if opening_candidates else None

    # 选择收尾片段（适合收尾的高分片段）
    closing_candidates = sorted(
        scored_segments,
        key=lambda x: (position_score(x, "closing"), total_score(x)),
        reverse=True
    )
    closing_segment = closing_candidates[0] if closing_candidates else None

    # 选择主体片段（高优先级 + 适合主体），如果没有高优先级则自动退回中/全量片段
    prioritized_pool = high_priority or medium_priority or scored_segments
    main_candidates = sorted(
        prioritized_pool,
        key=lambda x: (
            position_score(x, "main"),
            total_score(x)
        ),
        reverse=True
    )

    # 计算已选片段时长
    selected = []
    used_duration = 0.0

    # 添加开场（如果不同于主体片段）
    if opening_segment and position_score(opening_segment, "opening") >= 7:
        selected.append({
            "segment": opening_segment,
            "role": "opening",
            "keep_source_audio": False
        })
        used_duration += opening_segment.get("duration_sec", 0)

    # 添加主体片段（填充到目标时长的 70-80%）
    target_main_duration = target_duration * 0.75
    for seg in main_candidates:
        if seg["id"] == (opening_segment or {}).get("id"):
            continue
        if seg["id"] == (closing_segment or {}).get("id"):
            continue

        if used_duration >= target_main_duration:
            break

        selected.append({
            "segment": seg,
            "role": f"main_{len([s for s in selected if s['role'].startswith('main')]) + 1}",
            "keep_source_audio": False
        })
        used_duration += seg.get("duration_sec", 0)

    # 添加收尾（如果不同于已选片段）
    if closing_segment and position_score(closing_segment, "closing") >= 7:
        if closing_segment["id"] not in [s["segment"]["id"] for s in selected]:
            selected.append({
                "segment": closing_segment,
                "role": "closing",
                "keep_source_audio": False
            })
            used_duration += closing_segment.get("duration_sec", 0)

    # 保底规则 1：如果一个片段都没选出来，至少保留总分最高的一段
    if not selected:
        fallback_segment = max(scored_segments, key=total_score)
        selected.append({
            "segment": fallback_segment,
            "role": "main_1",
            "keep_source_audio": False
        })
        used_duration += fallback_segment.get("duration_sec", 0)

    # 保底规则 2：如果只有开场/收尾，没有主体，就用最高分主体段补一段
    main_count = len([s for s in selected if s["role"].startswith("main")])
    if main_count == 0:
        used_ids = {s["segment"]["id"] for s in selected}
        fallback_main = next((seg for seg in main_candidates if seg["id"] not in used_ids), None)
        if not fallback_main:
            fallback_main = max(
                [seg for seg in scored_segments if seg["id"] not in used_ids] or scored_segments,
                key=total_score
            )
        if fallback_main["id"] not in used_ids:
            selected.append({
                "segment": fallback_main,
                "role": "main_1",
                "keep_source_audio": False
            })
            used_duration += fallback_main.get("duration_sec", 0)

    # 保底规则 3：短素材/弱结构素材允许最多补到 2 段主体，不强求 opening/closing
    if used_duration < min(target_duration * 0.45, 18):
        used_ids = {s["segment"]["id"] for s in selected}
        fallback_candidates = [
            seg for seg in main_candidates
            if seg["id"] not in used_ids
        ]
        if fallback_candidates:
            extra_segment = fallback_candidates[0]
            selected.append({
                "segment": extra_segment,
                "role": f"main_{len([s for s in selected if s['role'].startswith('main')]) + 1}",
                "keep_source_audio": False
            })
            used_duration += extra_segment.get("duration_sec", 0)

    return selected, used_duration


def main():
    """主函数"""
    emit_stage("select_material", "正在选择素材片段")

    print("1. 正在读取已打分的素材片段...")

    scored_data = load_json("material_segments_scored.json", {})
    if not scored_data:
        print("❌ 找不到 material_segments_scored.json，请先运行 score_material_segments.py")
        return 1

    segments = scored_data.get("segments", [])
    if not segments:
        print("❌ 没有找到素材片段")
        return 1

    print(f"   ✓ 加载了 {len(segments)} 个已打分片段")

    print("\n2. 正在读取目标时长配置...")

    # 从 content_outline.json 读取目标时长
    content_outline = load_json("content_outline.json", {})
    target_duration = content_outline.get("target_duration_sec", 45)

    # 如果 content_outline 中没有，尝试从 video_script.json 读取
    if target_duration == 45 and not content_outline:
        video_script = load_json("video_script.json", {})
        target_duration = video_script.get("target_duration_sec", 45)

    print(f"   ✓ 目标时长: {target_duration}s")

    print("\n3. 正在选择素材片段...")

    selected, used_duration = select_segments(segments, target_duration)

    print(f"   ✓ 选择了 {len(selected)} 个片段")
    print(f"   ✓ 素材总时长: {used_duration:.1f}s (目标: {target_duration}s)")

    if not selected:
        raise RuntimeError("素材筛选结果为空，无法继续生成 bridge 文案和时间线")

    # 显示选中的片段
    print("\n   选中片段:")
    for item in selected:
        seg = item["segment"]
        role = item["role"]
        keep_audio = "🔊" if item["keep_source_audio"] else "  "
        print(f"      {keep_audio} [{seg['id']}] {role}: {seg['start']:.1f}s-{seg['end']:.1f}s")
        print(f"          {seg['text'][:50]}...")

    print("\n4. 正在保存结果...")

    # 构建输出格式
    output = {
        "target_duration_sec": target_duration,
        "actual_material_duration_sec": round(used_duration, 2),
        "segments": [
            {
                "id": item["segment"]["id"],
                "role": item["role"],
                "start": item["segment"]["start"],
                "end": item["segment"]["end"],
                "duration_sec": item["segment"]["duration_sec"],
                "text": item["segment"]["text"],
                "keep_source_audio": item["keep_source_audio"],
                "total_score": item["segment"].get("total_score", 0)
            }
            for item in selected
        ]
    }

    if write_json("selected_segments.json", output):
        print("   ✓ 已保存: selected_segments.json")
        emit_result(
            "素材选用完成",
            selected_file="selected_segments.json",
            segments_count=len(selected),
            material_duration=used_duration
        )
    else:
        print("❌ 保存失败")
        return 1

    print("\n✅ 素材选用完成")
    return 0


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="SELECT_MATERIAL_FAILED",
        error_message="素材选用失败",
        error_stage="select_material",
        hint="请检查 material_segments_scored.json 是否存在"
    ))
