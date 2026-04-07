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
        HWACCEL_TYPES
    )
    from pipeline.audio_processor import AudioProcessor
    SMART_CLIP_AVAILABLE = True
except ImportError:
    print("⚠️ 智能剪辑模块未找到，将使用基础模式")
    SMART_CLIP_AVAILABLE = False

parser = argparse.ArgumentParser(description="Build mixed 16:9 video from director plan or timeline.")
parser.add_argument("--no-subs", action="store_true", help="Disable subtitle burn-in for 16:9 output.")
parser.add_argument("--timeline", type=str, help="Path to timeline.json (material-first mode). If not provided, uses director_final.json.")
parser.add_argument("--hwaccel", action="store_true", help="启用硬件加速编码（推荐）")
parser.add_argument("--smart-audio", action="store_true", help="启用智能音频处理（响度分析+音量平衡）")
parser.add_argument("--quality", type=int, default=23, help="视频质量 (18-28, 越小越好, 默认23)")
args = parser.parse_args()

# 初始化智能剪辑组件
hwaccel_type = None
encoder_config = None
audio_processor = None

if SMART_CLIP_AVAILABLE:
    if args.hwaccel:
        print("\n🚀 检测硬件加速...")
        hwaccel_type = check_hardware_acceleration()
        if hwaccel_type:
            print(f"   ✅ 检测到: {HWACCEL_TYPES.get(hwaccel_type, hwaccel_type)}")
            encoder_config = get_encoder_config(hwaccel_type)
            print(f"   编码器: {encoder_config['video_codec']}")
        else:
            print("   ℹ️ 未检测到GPU，使用软件编码")
            encoder_config = get_encoder_config(None)
    else:
        encoder_config = get_encoder_config(None)

    if args.smart_audio:
        print("\n🎵 初始化智能音频处理器...")
        audio_processor = AudioProcessor()
        print("   ✅ 音频处理器就绪")

emit_stage("subtitle_build", "正在生成混剪字幕文件")
if args.no_subs:
    print("\n0. 已禁用 16:9 嵌入字幕，本次跳过字幕烧录准备...")
else:
    print("\n0. 正在自动生成字幕文件 (双轨混合字幕)...")

def format_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds * 1000) % 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

try:
    # 读取时间线或导演方案
    plan_file = args.timeline if args.timeline else 'director_final.json'
    print(f"   正在读取: {plan_file}")
    if not os.path.exists(plan_file):
        raise FileNotFoundError(f"缺少必要输入文件: {plan_file}")
    with open(plan_file, 'r', encoding='utf-8') as f:
        director = json.load(f)
    if not isinstance(director, list) or not director:
        raise RuntimeError(f"{plan_file} 为空或格式无效，无法生成成片")

    if not args.no_subs:
        srt_content = ""
        for i, seg in enumerate(director):
            if "subtitle_text" in seg and seg["subtitle_text"]:
                srt_content += f"{i+1}\n"
                srt_content += f"{format_time(seg['start_time'])} --> {format_time(seg['end_time'])}\n"
                srt_content += f"{seg['subtitle_text']}\n\n"
        with open('subtitles.srt', 'w', encoding='utf-8') as f:
            f.write(srt_content)

        print("   ✅ SRT 字幕生成成功！")

        # 额外生成一份给动态竖屏脚本用的 JSON 字幕
        try:
            sub_json_data = [{"time": [seg['start_time'], seg['end_time']], "text": seg['subtitle_text']} for seg in director]
            with open('subtitles.json', 'w', encoding='utf-8') as f:
                json.dump(sub_json_data, f, ensure_ascii=False, indent=2)
            print("   ✅ 动态竖屏 JSON 字幕也已生成！")
        except Exception as e:
            print(f"   ❌ 生成动态竖屏字幕JSON失败: {e}")
    else:
        print("   ℹ️ 已跳过 16:9 字幕文件生成。")

except Exception as e:
    print(f"   ❌ 生成字幕失败: {e}")
    raise

# 自动获取数字人视频(aiman.mp4)的原始分辨率，防止素材被拉伸变形
def get_video_size(filename):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", filename],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
        )
        w, h = result.stdout.strip().split("x")
        return int(w), int(h)
    except:
        return 1080, 1920 # 默认竖屏

# 智能音频分析
def analyze_audio_loudness(audio_file):
    """分析音频响度"""
    if not audio_processor:
        return None

    try:
        loudness = audio_processor.analyze_loudness(audio_file)
        return loudness
    except:
        return None

# 新版序列拼接逻辑：使用智能剪辑引擎
emit_stage("video_build", "正在构造并执行混剪合成命令")
print("\n1. 正在动态构造序列化剪辑命令...")
concat_file = "concat_list.txt"

# 获取数字人视频(aiman.mp4)的原始分辨率
target_w, target_h = get_video_size("aiman.mp4")
print(f"   检测到主视频的分辨率为: {target_w}x{target_h}")

# 智能音频分析（如果启用）
aiman_loudness = None
material_loudness = None
if args.smart_audio and audio_processor:
    print("\n🎵 分析音频响度...")
    if os.path.exists("aiman.mp4"):
        aiman_loudness = analyze_audio_loudness("aiman.mp4")
        if aiman_loudness:
            print(f"   数字人音频响度: {aiman_loudness:.1f} LUFS")

    if os.path.exists("material.mp4"):
        material_loudness = analyze_audio_loudness("material.mp4")
        if material_loudness:
            print(f"   素材音频响度: {material_loudness:.1f} LUFS")

with open(concat_file, 'w', encoding='utf-8') as f:
    for i, scene in enumerate(director):
        v_src = scene["video_source"]
        a_src = "material.mp4" if scene.get("audio_source") == "b_roll" else "aiman.mp4"

        dur = float(scene["end_time"]) - float(scene["start_time"])
        if dur <= 0:
            print(f"   ⚠️ 跳过无效片段 slice_{i}.mp4：时长 {dur}")
            continue

        if v_src == "aiman.mp4":
            v_start = scene.get("avatar_cut_start")
            if v_start is None:
                v_start = float(scene["start_time"])
        else:
            v_start = scene.get("material_cut_start") or scene.get("cut_start")

        if a_src == "aiman.mp4":
            a_start = scene.get("avatar_cut_start")
            if a_start is None:
                a_start = float(scene["start_time"])
        else:
            a_start = scene.get("material_cut_start") or scene.get("cut_start")

        if v_start is None:
            print(f"   ⚠️ 片段 slice_{i}.mp4 缺少视频切点，回退为主轨时间轴")
            v_start = float(scene["start_time"])
        if a_start is None:
            print(f"   ⚠️ 片段 slice_{i}.mp4 缺少音频切点，回退为主轨时间轴")
            a_start = float(scene["start_time"])

        # 音频淡入淡出
        fade_in = float(scene.get("audio_fade_in", min(0.12, max(0.0, dur / 4))))
        fade_out = float(scene.get("audio_fade_out", min(0.15, max(0.0, dur / 4))))
        fade_out_start = max(0.0, dur - fade_out)

        # 智能音频处理
        audio_filter = f"asetpts=PTS-STARTPTS,aresample=async=1000"

        if args.smart_audio and audio_processor:
            # 智能音量调整
            source_loudness = aiman_loudness if a_src == "aiman.mp4" else material_loudness
            if source_loudness:
                target_loudness = audio_processor.TARGET_LOUDNESS
                volume_adjust = audio_processor.calculate_volume_adjustment(source_loudness, target_loudness)
                audio_filter += f",volume={volume_adjust:.3f}"
                print(f"   🎚️ 片段 {i} 音量调整: {volume_adjust:.3f}x")

        audio_filter += f",afade=t=in:st=0:d={fade_in:.2f},afade=t=out:st={fade_out_start:.2f}:d={fade_out:.2f}"

        # 视频淡入淡出
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

        slice_name = f"slice_{i}.mp4"
        print(f"   正在预渲染切片 {slice_name} (画面:{v_src}, 声音:{a_src})...")

        # 构建FFmpeg命令（使用智能编码器）
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(v_start), "-t", str(dur), "-i", v_src,
            "-ss", str(a_start), "-t", str(dur), "-i", a_src,
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-vf", video_filter,
            "-af", audio_filter,
        ]

        # 使用智能编码器配置
        if encoder_config:
            cmd.extend(["-c:v", encoder_config['video_codec']])
            if encoder_config.get('hwaccel'):
                cmd.extend(["-hwaccel", encoder_config['hwaccel']])
            if encoder_config.get('hwaccel_output_format'):
                cmd.extend(["-hwaccel_output_format", encoder_config['hwaccel_output_format']])

            # 添加编码器特定参数
            for param in encoder_config.get('encoder_params', []):
                cmd.extend(param.split())

            # 质量设置
            if 'nvenc' in encoder_config['video_codec'] or 'qsv' in encoder_config['video_codec']:
                cmd.extend(["-preset", "medium", "-b:v", "5M"])
            elif 'videotoolbox' in encoder_config['video_codec']:
                cmd.extend(["-b:v", "5M"])
            else:
                cmd.extend(["-preset", "ultrafast", "-crf", str(args.quality)])
        else:
            cmd.extend(["-c:v", "libx264", "-preset", "ultrafast", "-crf", str(args.quality)])

        cmd.extend([
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            slice_name
        ])

        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

        if result.returncode != 0 or not os.path.exists(slice_name):
            err_tail = (result.stderr or "").strip().splitlines()[-1] if result.stderr else "unknown ffmpeg error"
            print(f"   ⚠️ 硬件编码失败，尝试软件编码...")

            # Fallback到软件编码
            cmd_fallback = [
                "ffmpeg", "-y",
                "-ss", str(v_start), "-t", str(dur), "-i", v_src,
                "-ss", str(a_start), "-t", str(dur), "-i", a_src,
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-vf", video_filter,
                "-af", audio_filter,
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", str(args.quality),
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-ar", "44100", "-ac", "2",
                slice_name
            ]

            result = subprocess.run(cmd_fallback, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

            if result.returncode != 0 or not os.path.exists(slice_name):
                err_tail = (result.stderr or "").strip().splitlines()[-1] if result.stderr else "unknown ffmpeg error"
                raise RuntimeError(f"切片生成失败 {slice_name}: {err_tail}")

        f.write(f"file '{slice_name}'\n")

if not os.path.exists(concat_file) or os.path.getsize(concat_file) == 0:
    raise RuntimeError("concat_list.txt 为空，说明前置时间线没有生成任何可拼接片段")

# 拼接并按需打上字幕
print("\n2. 正在合成最终视频...")
cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file]

if not args.no_subs:
    cmd.extend([
        "-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'"
    ])

# 使用智能编码器进行最终合成
if encoder_config and args.hwaccel:
    cmd.extend(["-c:v", encoder_config['video_codec']])
    if 'nvenc' in encoder_config['video_codec']:
        cmd.extend(["-preset", "medium", "-b:v", "8M"])
    elif 'qsv' in encoder_config['video_codec']:
        cmd.extend(["-preset", "medium", "-b:v", "8M"])
    elif 'videotoolbox' in encoder_config['video_codec']:
        cmd.extend(["-b:v", "8M"])
    else:
        cmd.extend(["-crf", str(args.quality)])
else:
    cmd.extend(["-c:v", "libx264", "-crf", str(args.quality)])

cmd.extend(["-c:a", "aac", "output_final.mp4"])

print("\n--- 即将执行终极音视频混联合成 ---")
if args.hwaccel:
    print("   🚀 使用硬件加速编码")
if args.smart_audio:
    print("   🎵 使用智能音频处理")

result = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)

if result.returncode != 0:
    print("   ⚠️ 硬件加速合成失败，尝试软件编码...")
    cmd_fallback = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file]
    if not args.no_subs:
        cmd_fallback.extend([
            "-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'"
        ])
    cmd_fallback.extend(["-c:v", "libx264", "-crf", str(args.quality), "-c:a", "aac", "output_final.mp4"])
    subprocess.run(cmd_fallback, check=True)

# 清理切片
print("\n3. 清理临时文件...")
for i in range(len(director)):
    sname = f"slice_{i}.mp4"
    if os.path.exists(sname): os.remove(sname)
if os.path.exists(concat_file): os.remove(concat_file)

print("\n✅ 视频合成完成！")
if args.hwaccel:
    print("   🚀 已使用硬件加速")
if args.smart_audio:
    print("   🎵 已使用智能音频处理")
print(f"   📁 输出文件: output_final.mp4")

emit_result({"output": "output_final.mp4"})
