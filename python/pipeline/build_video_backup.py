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

parser = argparse.ArgumentParser(description="Build mixed 16:9 video from director plan or timeline.")
parser.add_argument("--no-subs", action="store_true", help="Disable subtitle burn-in for 16:9 output.")
parser.add_argument("--timeline", type=str, help="Path to timeline.json (material-first mode). If not provided, uses director_final.json.")
args = parser.parse_args()

emit_stage("subtitle_build", "正在生成混剪字幕文件")
if args.no_subs:
    print("0. 已禁用 16:9 嵌入字幕，本次跳过字幕烧录准备...")
else:
    print("0. 正在自动生成字幕文件 (双轨混合字幕)...")
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

# 新版序列拼接逻辑：使用 FFmpeg concat demuxer
emit_stage("video_build", "正在构造并执行混剪合成命令")
print("1. 正在动态构造序列化剪辑命令...")
concat_file = "concat_list.txt"

# 获取数字人视频(aiman.mp4)的原始分辨率
target_w, target_h = get_video_size("aiman.mp4")
print(f"检测到主视频的分辨率为: {target_w}x{target_h}")

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
            # 支持 timeline.json 的 material_cut_start 和 director_final.json 的 cut_start
            v_start = scene.get("material_cut_start") or scene.get("cut_start")

        if a_src == "aiman.mp4":
            a_start = scene.get("avatar_cut_start")
            if a_start is None:
                a_start = float(scene["start_time"])
        else:
            # 支持 timeline.json 的 material_cut_start 和 director_final.json 的 cut_start
            a_start = scene.get("material_cut_start") or scene.get("cut_start")

        if v_start is None:
            print(f"   ⚠️ 片段 slice_{i}.mp4 缺少视频切点，回退为主轨时间轴")
            v_start = float(scene["start_time"])
        if a_start is None:
            print(f"   ⚠️ 片段 slice_{i}.mp4 缺少音频切点，回退为主轨时间轴")
            a_start = float(scene["start_time"])

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

        slice_name = f"slice_{i}.mp4"
        print(f"   正在预渲染切片 {slice_name} (画面:{v_src}, 声音:{a_src})...")
        
        # 核心终极修复：彻底解决AI数字人视频"卡帧、无画面、丢帧"的魔咒。
        # 为什么会卡住？因为数字人视频的 PTS（播放时间戳）乱七八糟，FFmpeg 认为帧过期了直接丢弃。
        # 解法：不再用高级的 filter_complex 搞双轴并行，而是回归最原始的“重编码暴力抽取”。
        # 我们用 -ss 和 -to 强行指定时间，并给数字人加上 -r 30 强制补帧！
        
        result = subprocess.run([
            "ffmpeg", "-y", 
            # 提取并修复视频流
            "-ss", str(v_start), "-t", str(dur), "-i", v_src,
            # 提取音频流
            "-ss", str(a_start), "-t", str(dur), "-i", a_src,
            
            "-map", "0:v:0", 
            "-map", "1:a:0",
            
            # 对视频流进行强制重置时间戳(setpts)并强制输出 30fps，解决画面卡住的问题
            "-vf", video_filter,
            
            # 对音频流进行强制重采样
            "-af", audio_filter,
            
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            
            slice_name
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

        if result.returncode != 0 or not os.path.exists(slice_name):
            err_tail = (result.stderr or "").strip().splitlines()[-1] if result.stderr else "unknown ffmpeg error"
            raise RuntimeError(f"切片生成失败 {slice_name}: {err_tail}")
        
        f.write(f"file '{slice_name}'\n")

if not os.path.exists(concat_file) or os.path.getsize(concat_file) == 0:
    raise RuntimeError("concat_list.txt 为空，说明前置时间线没有生成任何可拼接片段")

# 拼接并按需打上字幕
cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file]
if not args.no_subs:
    cmd.extend([
        "-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'"
    ])
cmd.extend([
    "-c:v", "libx264", "-c:a", "aac", "output_final.mp4"
])

print("\n--- 即将执行终极音视频混联合成 ---")
subprocess.run(cmd, check=True)

# 清理切片
for i in range(len(director)):
    sname = f"slice_{i}.mp4"
    if os.path.exists(sname): os.remove(sname)
if os.path.exists(concat_file): os.remove(concat_file)

if args.no_subs:
    print("\n🎉 合成完毕！无嵌入字幕的 16:9 成品 output_final.mp4 已生成！")
else:
    print("\n🎉 合成完毕！包含双轨音频和字幕的成品 output_final.mp4 已生成！")
emit_result("混剪成片生成完成", output_video="output_final.mp4", segment_count=len(director))
