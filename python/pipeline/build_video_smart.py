#!/usr/bin/env python3
"""
智能视频混剪引擎 - 增强版
融合 NarratoAI 的智能剪辑能力
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import json
import subprocess
import os
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from script_protocol import emit_result, emit_stage

# 导入智能剪辑模块
try:
    from pipeline.video_clip_engine import (
        check_hardware_acceleration,
        get_encoder_config,
        build_ffmpeg_command,
        execute_with_fallback
    )
    from pipeline.audio_processor import AudioProcessor
    SMART_CLIP_AVAILABLE = True
except ImportError:
    print("⚠️ 智能剪辑模块未找到，使用传统模式")
    SMART_CLIP_AVAILABLE = False


parser = argparse.ArgumentParser(description="Build mixed 16:9 video with smart clipping.")
parser.add_argument("--no-subs", action="store_true", help="Disable subtitle burn-in.")
parser.add_argument("--timeline", type=str, help="Path to timeline.json.")
parser.add_argument("--smart-audio", action="store_true", help="Enable smart audio processing.")
parser.add_argument("--hwaccel", action="store_true", help="Enable hardware acceleration.")
args = parser.parse_args()


def format_time(seconds):
    """格式化时间为SRT格式"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds * 1000) % 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def get_video_size(filename):
    """获取视频分辨率"""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", filename],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
        )
        w, h = result.stdout.strip().split("x")
        return int(w), int(h)
    except:
        return 1080, 1920


def generate_subtitles(director: list) -> bool:
    """生成字幕文件"""
    emit_stage("subtitle_build", "正在生成混剪字幕文件")

    if args.no_subs:
        print("0. 已禁用字幕，跳过字幕生成...")
        return True

    print("0. 正在生成字幕文件...")

    try:
        # 生成SRT字幕
        srt_content = ""
        for i, seg in enumerate(director):
            if "subtitle_text" in seg and seg["subtitle_text"]:
                srt_content += f"{i+1}\n"
                srt_content += f"{format_time(seg['start_time'])} --> {format_time(seg['end_time'])}\n"
                srt_content += f"{seg['subtitle_text']}\n\n"

        with open('subtitles.srt', 'w', encoding='utf-8') as f:
            f.write(srt_content)
        print("   ✅ SRT 字幕生成成功")

        # 生成JSON字幕
        sub_json_data = [
            {"time": [seg['start_time'], seg['end_time']], "text": seg['subtitle_text']}
            for seg in director if seg.get('subtitle_text')
        ]
        with open('subtitles.json', 'w', encoding='utf-8') as f:
            json.dump(sub_json_data, f, ensure_ascii=False, indent=2)
        print("   ✅ JSON 字幕生成成功")

        return True

    except Exception as e:
        print(f"   ❌ 字幕生成失败: {e}")
        return False


def process_scene_smart(
    scene: dict,
    scene_index: int,
    target_w: int,
    target_h: int,
    encoder_config: dict,
    audio_processor: AudioProcessor
) -> str:
    """
    使用智能模式处理场景

    Args:
        scene: 场景配置
        scene_index: 场景索引
        target_w: 目标宽度
        target_h: 目标高度
        encoder_config: 编码器配置
        audio_processor: 音频处理器

    Returns:
        输出文件路径
    """
    v_src = scene["video_source"]
    a_src = "material.mp4" if scene.get("audio_source") == "b_roll" else "aiman.mp4"

    dur = float(scene["end_time"]) - float(scene["start_time"])
    if dur <= 0:
        print(f"   ⚠️ 跳过无效片段 slice_{scene_index}.mp4：时长 {dur}")
        return None

    # 获取切点
    if v_src == "aiman.mp4":
        v_start = scene.get("avatar_cut_start", scene["start_time"])
    else:
        v_start = scene.get("material_cut_start") or scene.get("cut_start", scene["start_time"])

    if a_src == "aiman.mp4":
        a_start = scene.get("avatar_cut_start", scene["start_time"])
    else:
        a_start = scene.get("material_cut_start") or scene.get("cut_start", scene["start_time"])

    # 构建视频滤镜
    video_fade_in = float(scene.get("video_fade_in", min(0.08, max(0.0, dur / 5))))
    video_fade_out = float(scene.get("video_fade_out", min(0.08, max(0.0, dur / 5))))
    video_fade_out_start = max(0.0, dur - video_fade_out)

    video_filter = (
        f"setpts=PTS-STARTPTS,fps=30,"
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h}"
    )

    if video_fade_in > 0:
        video_filter += f",fade=t=in:st=0:d={video_fade_in:.2f}"
    if video_fade_out > 0:
        video_filter += f",fade=t=out:st={video_fade_out_start:.2f}:d={video_fade_out:.2f}"

    # 构建音频滤镜
    fade_in = float(scene.get("audio_fade_in", min(0.12, max(0.0, dur / 4))))
    fade_out = float(scene.get("audio_fade_out", min(0.15, max(0.0, dur / 4))))
    fade_out_start = max(0.0, dur - fade_out)

    audio_filter = (
        f"asetpts=PTS-STARTPTS,aresample=async=1000,"
        f"afade=t=in:st=0:d={fade_in:.2f},"
        f"afade=t=out:st={fade_out_start:.2f}:d={fade_out:.2f}"
    )

    # 智能音量调整
    if args.smart_audio and audio_processor:
        try:
            # 这里可以添加智能音量分析
            volume_adjustment = scene.get("volume_adjustment", 1.0)
            audio_filter += f",volume={volume_adjustment}"
        except:
            pass

    slice_name = f"slice_{scene_index}.mp4"
    print(f"   🎬 智能处理切片 {slice_name} (画面:{v_src}, 声音:{a_src})...")

    # 构建命令
    cmd = build_ffmpeg_command(
        input_video=v_src,
        input_audio=a_src,
        output_path=slice_name,
        start_time=v_start,
        duration=dur,
        encoder_config=encoder_config,
        video_filters=video_filter,
        audio_filters=audio_filter
    )

    # 执行命令（带fallback）
    success = execute_with_fallback(
        cmd, v_src, a_src, slice_name,
        v_start, dur, scene_index
    )

    return slice_name if success else None


def process_scene_legacy(scene: dict, scene_index: int, target_w: int, target_h: int) -> str:
    """
    使用传统模式处理场景（保持向后兼容）
    """
    v_src = scene["video_source"]
    a_src = "material.mp4" if scene.get("audio_source") == "b_roll" else "aiman.mp4"

    dur = float(scene["end_time"]) - float(scene["start_time"])
    if dur <= 0:
        return None

    # 获取切点
    if v_src == "aiman.mp4":
        v_start = scene.get("avatar_cut_start", scene["start_time"])
    else:
        v_start = scene.get("material_cut_start") or scene.get("cut_start", scene["start_time"])

    if a_src == "aiman.mp4":
        a_start = scene.get("avatar_cut_start", scene["start_time"])
    else:
        a_start = scene.get("material_cut_start") or scene.get("cut_start", scene["start_time"])

    # 构建滤镜
    fade_in = float(scene.get("audio_fade_in", min(0.12, max(0.0, dur / 4))))
    fade_out = float(scene.get("audio_fade_out", min(0.15, max(0.0, dur / 4))))
    fade_out_start = max(0.0, dur - fade_out)
    audio_filter = f"asetpts=PTS-STARTPTS,aresample=async=1000,afade=t=in:st=0:d={fade_in:.2f},afade=t=out:st={fade_out_start:.2f}:d={fade_out:.2f}"

    video_fade_in = float(scene.get("video_fade_in", min(0.08, max(0.0, dur / 5))))
    video_fade_out = float(scene.get("video_fade_out", min(0.08, max(0.0, dur / 5))))
    video_fade_out_start = max(0.0, dur - video_fade_out)
    video_filter = (
        f"setpts=PTS-STARTPTS,fps=30,"
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h}"
    )
    if video_fade_in > 0:
        video_filter += f",fade=t=in:st=0:d={video_fade_in:.2f}"
    if video_fade_out > 0:
        video_filter += f",fade=t=out:st={video_fade_out_start:.2f}:d={video_fade_out:.2f}"

    slice_name = f"slice_{scene_index}.mp4"
    print(f"   正在预渲染切片 {slice_name} (画面:{v_src}, 声音:{a_src})...")

    result = subprocess.run([
        "ffmpeg", "-y",
        "-ss", str(v_start), "-t", str(dur), "-i", v_src,
        "-ss", str(a_start), "-t", str(dur), "-i", a_src,
        "-map", "0:v:0", "-map", "1:a:0",
        "-vf", video_filter,
        "-af", audio_filter,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        slice_name
    ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

    if result.returncode != 0 or not os.path.exists(slice_name):
        return None

    return slice_name


def main():
    """主函数"""
    # 读取导演方案
    plan_file = args.timeline if args.timeline else 'director_final.json'
    print(f"📖 正在读取: {plan_file}")

    if not os.path.exists(plan_file):
        raise FileNotFoundError(f"缺少必要输入文件: {plan_file}")

    with open(plan_file, 'r', encoding='utf-8') as f:
        director = json.load(f)

    if not isinstance(director, list) or not director:
        raise RuntimeError(f"{plan_file} 为空或格式无效")

    # 生成字幕
    generate_subtitles(director)

    # 检测硬件加速
    hwaccel_type = None
    encoder_config = None
    audio_processor = None

    if SMART_CLIP_AVAILABLE and args.hwaccel:
        hwaccel_type = check_hardware_acceleration()
        if hwaccel_type:
            print(f"🚀 检测到硬件加速: {hwaccel_type}")
        else:
            print("🔧 未检测到硬件加速，使用软件编码")

        encoder_config = get_encoder_config(hwaccel_type)

    if SMART_CLIP_AVAILABLE and args.smart_audio:
        audio_processor = AudioProcessor()
        print("🎵 启用智能音频处理")

    # 获取目标分辨率
    target_w, target_h = get_video_size("aiman.mp4")
    print(f"📐 目标分辨率: {target_w}x{target_h}")

    # 处理场景
    emit_stage("video_build", "正在构造并执行混剪合成")
    print("\n1. 正在处理视频切片...")

    concat_file = "concat_list.txt"
    slice_files = []

    for i, scene in enumerate(director):
        if SMART_CLIP_AVAILABLE and (args.hwaccel or args.smart_audio):
            slice_path = process_scene_smart(
                scene, i, target_w, target_h,
                encoder_config or get_encoder_config(None),
                audio_processor
            )
        else:
            slice_path = process_scene_legacy(scene, i, target_w, target_h)

        if slice_path:
            slice_files.append(slice_path)

    if not slice_files:
        raise RuntimeError("没有成功生成任何切片")

    # 生成concat列表
    with open(concat_file, 'w', encoding='utf-8') as f:
        for slice_file in slice_files:
            f.write(f"file '{slice_file}'\n")

    print(f"\n✅ 成功生成 {len(slice_files)}/{len(director)} 个切片")

    # 拼接视频
    print("\n2. 正在拼接最终视频...")
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file]

    if not args.no_subs:
        cmd.extend([
            "-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'"
        ])

    cmd.extend(["-c:v", "libx264", "-c:a", "aac", "output_final.mp4"])

    subprocess.run(cmd, check=True)

    # 清理切片
    for slice_file in slice_files:
        if os.path.exists(slice_file):
            os.remove(slice_file)
    if os.path.exists(concat_file):
        os.remove(concat_file)

    print("\n🎉 混剪成片生成完成！")
    emit_result("混剪成片生成完成", output_video="output_final.mp4", segment_count=len(director))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
