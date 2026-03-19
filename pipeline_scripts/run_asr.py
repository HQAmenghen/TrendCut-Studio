import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from faster_whisper import WhisperModel
import json
import time

import os
import subprocess

print("0. 正在从视频中提取音频...")
# 调用 ffmpeg 自动从 aiman.mp4 中提取出 aiman_audio.mp3
subprocess.run(["ffmpeg", "-y", "-i", "aiman.mp4", "-q:a", "0", "-map", "a", "aiman_audio.mp3"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if not os.path.exists("aiman_audio.mp3"):
    print("❌ 提取音频失败！请检查当前文件夹下是否有 aiman.mp4")
    exit(1)

print("1. 正在加载 AI 语音模型 (首次运行会自动下载约 40MB 的 tiny 模型文件)...")
# 切换为更大的 small 模型（准度大幅提升，适合中文，大约下载 400MB），并开启 VAD 强制切分
model = WhisperModel("small", device="cpu", compute_type="int8")

print("2. 模型加载完毕！开始精准打轴并识别...")
start_time = time.time()

# 开启 word_timestamps 并在标点符号处强制断句，确保时间轴细化到每一小句
segments, info = model.transcribe("aiman_audio.mp3", beam_size=5, word_timestamps=True, vad_filter=True)

segments_data = []
for segment in segments:
    # 提取每一段的开始、结束和文本，这里利用词级时间戳来保证更准
    segments_data.append({
        "start": round(segment.start, 2),
        "end": round(segment.end, 2),
        "text": segment.text.strip()
    })
    # 在屏幕上实时打印出来看看效果
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")

# 把结果打包保存成 AI 导演需要的 JSON 格式
with open("audio.json", "w", encoding="utf-8") as f:
    json.dump(segments_data, f, ensure_ascii=False, indent=2)

end_time = time.time()
print(f"\n3. 大功告成！总耗时: {round(end_time - start_time, 2)} 秒。")
print("快去桌面上看看新生成的 audio.json 文件吧！")