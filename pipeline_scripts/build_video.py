import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import json
import subprocess
import os
import argparse

print("0. 正在自动生成字幕文件 (双轨混合字幕)...")
def format_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds * 1000) % 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

try:
    with open('director.json', 'r', encoding='utf-8') as f:
        director = json.load(f)
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
        with open('director.json', 'r', encoding='utf-8') as f:
            director = json.load(f)
        sub_json_data = [{"time": [seg['start_time'], seg['end_time']], "text": seg['subtitle_text']} for seg in director]
        with open('subtitles.json', 'w', encoding='utf-8') as f:
            json.dump(sub_json_data, f, ensure_ascii=False, indent=2)
        print("   ✅ 动态竖屏 JSON 字幕也已生成！")
    except Exception as e:
        print(f"   ❌ 生成动态竖屏字幕JSON失败: {e}")

except Exception as e:
    print(f"   ❌ 生成字幕失败: {e}")
    director = [] # 确保 director 变量存在

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
print("1. 正在动态构造序列化剪辑命令...")
concat_file = "concat_list.txt"

# 获取数字人视频(aiman.mp4)的原始分辨率
target_w, target_h = get_video_size("aiman.mp4")
print(f"检测到主视频的分辨率为: {target_w}x{target_h}")

with open(concat_file, 'w', encoding='utf-8') as f:
    for i, scene in enumerate(director):
        v_src = scene["video_source"]
        a_src = "material.mp4" if scene.get("audio_source") == "b_roll" else "aiman.mp4"
        
        v_start = scene["cut_start"]
        dur = scene["end_time"] - scene["start_time"]
        a_start = scene["start_time"] if a_src == "aiman.mp4" else scene["cut_start"]
        
        slice_name = f"slice_{i}.mp4"
        print(f"   正在预渲染切片 {slice_name} (画面:{v_src}, 声音:{a_src})...")
        
        # 核心终极修复：彻底解决AI数字人视频"卡帧、无画面、丢帧"的魔咒。
        # 为什么会卡住？因为数字人视频的 PTS（播放时间戳）乱七八糟，FFmpeg 认为帧过期了直接丢弃。
        # 解法：不再用高级的 filter_complex 搞双轴并行，而是回归最原始的“重编码暴力抽取”。
        # 我们用 -ss 和 -to 强行指定时间，并给数字人加上 -r 30 强制补帧！
        
        subprocess.run([
            "ffmpeg", "-y", 
            # 提取并修复视频流
            "-ss", str(v_start), "-t", str(dur), "-i", v_src,
            # 提取音频流
            "-ss", str(a_start), "-t", str(dur), "-i", a_src,
            
            "-map", "0:v:0", 
            "-map", "1:a:0",
            
            # 对视频流进行强制重置时间戳(setpts)并强制输出 30fps，解决画面卡住的问题
            "-vf", f"setpts=PTS-STARTPTS,fps=30,scale={target_w}:{target_h}:force_original_aspect_ratio=increase,crop={target_w}:{target_h}",
            
            # 对音频流进行强制重采样
            "-af", "asetpts=PTS-STARTPTS,aresample=async=1000",
            
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            
            slice_name
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        f.write(f"file '{slice_name}'\n")

# 拼接并打上字幕
cmd = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file,
    "-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'",
    "-c:v", "libx264", "-c:a", "aac", "output_final.mp4"
]

print("\n--- 即将执行终极音视频混联合成 ---")
subprocess.run(cmd)

# 清理切片
for i in range(len(director)):
    sname = f"slice_{i}.mp4"
    if os.path.exists(sname): os.remove(sname)
if os.path.exists(concat_file): os.remove(concat_file)

print("\n🎉 合成完毕！包含双轨音频和字幕的成品 output_final.mp4 已生成！")