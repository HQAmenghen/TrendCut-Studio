# 完整功能集成文档

## 概述

本次集成将 NarratoAI 的所有核心功能完整移植到 Comfy Panel Demo 项目中，包括：

1. ✅ 智能视频剪辑（硬件加速 + 音频处理）
2. ✅ 素材搜索引擎（Pexels + Pixabay）
3. ✅ TTS语音合成（Edge TTS + Azure Speech）
4. ✅ YouTube视频下载
5. ✅ 字幕自动生成（Whisper）
6. ✅ 视频处理工具集

## 新增功能详解

### 1. YouTube视频下载 (`youtube_downloader.py`)

支持从YouTube下载多种分辨率和格式的视频。

#### 核心功能
- 多分辨率支持（2160p/1440p/1080p/720p/480p/360p）
- 多格式支持（mp4/mkv/webm/flv/avi）
- 自动选择最佳视频+音频流
- 下载进度显示
- 视频信息查询

#### 使用示例

**命令行使用:**
```bash
# 下载720p视频
python python/pipeline/youtube_downloader.py "https://youtube.com/watch?v=xxx" \
    --resolution 720p \
    --format mp4

# 查看视频信息
python python/pipeline/youtube_downloader.py "https://youtube.com/watch?v=xxx" --info

# 列出可用格式
python python/pipeline/youtube_downloader.py "https://youtube.com/watch?v=xxx" --list-formats

# 自定义文件名
python python/pipeline/youtube_downloader.py "https://youtube.com/watch?v=xxx" \
    --output my_video \
    --resolution 1080p
```

**Python API:**
```python
from pipeline.youtube_downloader import YouTubeDownloader

# 创建下载器
downloader = YouTubeDownloader(output_dir="./downloads")

# 获取视频信息
info = downloader.get_video_info("https://youtube.com/watch?v=xxx")
print(f"标题: {info['title']}")
print(f"时长: {info['duration']}秒")

# 获取可用格式
formats = downloader.get_available_formats("https://youtube.com/watch?v=xxx")
for fmt in formats:
    print(f"{fmt['resolution']} - {fmt['ext']}")

# 下载视频
task_id, output_path = downloader.download(
    url="https://youtube.com/watch?v=xxx",
    resolution="720p",
    output_format="mp4",
    filename="my_video"
)
print(f"下载完成: {output_path}")
```

#### 依赖安装
```bash
pip install yt-dlp
```

### 2. 字幕自动生成 (`subtitle_generator.py`)

使用Whisper模型自动生成视频字幕。

#### 核心功能
- 支持音频和视频文件
- 自动检测CUDA加速
- 多语言支持（中文/英文/日文等）
- 自动断句和时间戳
- SRT格式输出

#### 使用示例

**命令行使用:**
```bash
# 从视频生成字幕
python python/pipeline/subtitle_generator.py video.mp4 \
    --output subtitle.srt \
    --language zh

# 从音频生成字幕
python python/pipeline/subtitle_generator.py audio.mp3 \
    --output subtitle.srt \
    --language en

# 使用本地模型
python python/pipeline/subtitle_generator.py video.mp4 \
    --model ./models/whisper-large-v3 \
    --device cuda

# 使用CPU模式
python python/pipeline/subtitle_generator.py video.mp4 \
    --device cpu \
    --compute-type int8
```

**Python API:**
```python
from pipeline.subtitle_generator import SubtitleGenerator

# 创建生成器（自动检测设备）
generator = SubtitleGenerator(device="auto", compute_type="auto")

# 从视频生成字幕
subtitle_file = generator.generate_from_video(
    video_file="video.mp4",
    output_file="subtitle.srt",
    language="zh"
)

# 从音频生成字幕
subtitle_file = generator.generate_from_audio(
    audio_file="audio.mp3",
    output_file="subtitle.srt",
    language="en"
)

# 使用本地模型
generator = SubtitleGenerator(
    model_path="./models/whisper-large-v3",
    device="cuda",
    compute_type="float16"
)
```

#### 依赖安装
```bash
pip install faster-whisper
pip install moviepy  # 用于视频音频提取
```

#### 模型下载
```bash
# 使用在线模型（自动下载）
# 首次运行会自动下载 base 模型

# 或下载本地模型
# 从 https://huggingface.co/guillaumekln/faster-whisper-large-v3 下载
# 放置到 ./models/whisper-large-v3 目录
```

### 3. 视频处理工具集 (`video_utils.py`)

提供常用的视频处理工具函数。

#### 核心功能
- 文本自动换行
- 视频尺寸调整（带黑边）
- 音频循环
- 视频信息获取
- 音频提取

#### 使用示例

**命令行使用:**
```bash
# 调整视频尺寸
python python/pipeline/video_utils.py resize input.mp4 \
    --width 1080 \
    --height 1920 \
    --output output.mp4

# 循环音频
python python/pipeline/video_utils.py loop bgm.mp3 \
    --duration 60 \
    --output looped_bgm.mp3

# 获取视频信息
python python/pipeline/video_utils.py info video.mp4

# 提取音频
python python/pipeline/video_utils.py extract video.mp4 \
    --output audio.mp3
```

**Python API:**
```python
from pipeline.video_utils import VideoUtils

utils = VideoUtils()

# 文本自动换行
wrapped_text, height = utils.wrap_text(
    text="这是一段很长的文本需要换行",
    max_width=800,
    font_path="./fonts/SimHei.ttf",
    fontsize=60
)

# 调整视频尺寸并添加黑边
success = utils.resize_with_padding(
    video_path="input.mp4",
    target_width=1080,
    target_height=1920,
    output_path="output.mp4",
    bg_color=(0, 0, 0)  # 黑色背景
)

# 循环音频
success = utils.loop_audio(
    audio_path="bgm.mp3",
    target_duration=60.0,
    output_path="looped_bgm.mp3"
)

# 获取视频信息
info = utils.get_video_info("video.mp4")
print(f"尺寸: {info['width']}x{info['height']}")
print(f"时长: {info['duration']}秒")
print(f"帧率: {info['fps']}")

# 提取音频
audio_path = utils.extract_audio(
    video_path="video.mp4",
    output_path="audio.mp3"
)
```

#### 依赖安装
```bash
pip install moviepy
pip install Pillow
```

### 4. 统一素材管理器增强

`material_manager.py` 现已集成YouTube下载功能。

#### 新增功能

**命令行使用:**
```bash
# 下载YouTube视频
python python/pipeline/material_manager.py youtube "https://youtube.com/watch?v=xxx" \
    --resolution 720p \
    --format mp4 \
    --filename my_video
```

**Python API:**
```python
from pipeline.material_manager import MaterialManager

manager = MaterialManager(cache_dir="./cache")

# 下载YouTube视频（自动缓存）
video_path = manager.download_youtube(
    url="https://youtube.com/watch?v=xxx",
    resolution="720p",
    output_format="mp4",
    filename="my_video"
)
```

## 完整工作流示例

### 场景1: 从YouTube制作带字幕的视频

```python
from pipeline.material_manager import MaterialManager
from pipeline.subtitle_generator import SubtitleGenerator
from pipeline.video_utils import VideoUtils
import asyncio

async def create_video_with_subtitles():
    manager = MaterialManager()
    generator = SubtitleGenerator()
    utils = VideoUtils()
    
    # 1. 下载YouTube视频
    print("📥 下载视频...")
    video_path = manager.download_youtube(
        url="https://youtube.com/watch?v=xxx",
        resolution="720p"
    )
    
    # 2. 生成字幕
    print("🎤 生成字幕...")
    subtitle_path = generator.generate_from_video(
        video_file=video_path,
        language="zh"
    )
    
    # 3. 调整视频尺寸（如需要）
    print("📐 调整尺寸...")
    resized_path = "resized_video.mp4"
    utils.resize_with_padding(
        video_path=video_path,
        target_width=1080,
        target_height=1920,
        output_path=resized_path
    )
    
    # 4. 合成TTS语音（如需要）
    print("🎙️ 合成语音...")
    audio_path = await manager.synthesize_speech(
        text="这是配音文本",
        engine="edge_tts",
        voice="zh-CN-XiaoxiaoNeural"
    )
    
    print("✅ 完成！")
    return resized_path, subtitle_path, audio_path

asyncio.run(create_video_with_subtitles())
```

### 场景2: 批量处理视频

```python
from pipeline.material_manager import MaterialManager
from pipeline.subtitle_generator import SubtitleGenerator
import asyncio

async def batch_process_videos():
    manager = MaterialManager()
    generator = SubtitleGenerator()
    
    video_urls = [
        "https://youtube.com/watch?v=xxx1",
        "https://youtube.com/watch?v=xxx2",
        "https://youtube.com/watch?v=xxx3"
    ]
    
    for url in video_urls:
        # 下载视频
        video_path = manager.download_youtube(url, resolution="720p")
        
        # 生成字幕
        subtitle_path = generator.generate_from_video(video_path)
        
        print(f"✅ 处理完成: {video_path}")

asyncio.run(batch_process_videos())
```

### 场景3: 完整的视频制作流程

```bash
# 1. 搜索素材
python python/pipeline/material_search.py '风景' --platform pexels --download

# 2. 下载YouTube视频
python python/pipeline/youtube_downloader.py "https://youtube.com/watch?v=xxx" \
    --resolution 720p

# 3. 生成字幕
python python/pipeline/subtitle_generator.py video.mp4 --output subtitle.srt

# 4. 合成语音
python python/pipeline/tts_engine.py "配音文本" --output voice.mp3

# 5. 调整视频尺寸
python python/pipeline/video_utils.py resize video.mp4 \
    --width 1080 --height 1920 --output resized.mp4

# 6. 智能剪辑合成
python python/pipeline/build_video_smart.py --hwaccel --smart-audio
```

## 环境变量配置

在 `.env` 文件中添加：

```bash
# ========== YouTube下载 ==========
YOUTUBE_DOWNLOAD_DIR=./downloads
YOUTUBE_DEFAULT_RESOLUTION=720p
YOUTUBE_DEFAULT_FORMAT=mp4

# ========== 字幕生成 ==========
WHISPER_MODEL_PATH=./models/whisper-large-v3
WHISPER_DEVICE=auto
WHISPER_COMPUTE_TYPE=auto
WHISPER_DEFAULT_LANGUAGE=zh

# ========== 视频处理 ==========
VIDEO_UTILS_FONT_PATH=./fonts/SimHei.ttf
VIDEO_UTILS_DEFAULT_BG_COLOR=0,0,0
```

## 依赖安装

完整依赖列表：

```bash
# 基础依赖
pip install requests
pip install python-dotenv

# 视频处理
pip install moviepy
pip install Pillow

# YouTube下载
pip install yt-dlp

# 字幕生成
pip install faster-whisper

# TTS语音合成
pip install edge-tts
pip install azure-cognitiveservices-speech

# 素材搜索（已包含）
# 无需额外安装
```

或使用 requirements.txt:

```bash
pip install -r requirements.txt
```

## 性能优化建议

### 1. 字幕生成优化
- 使用CUDA加速（需要NVIDIA GPU）
- 使用较小的模型（base/small）以提高速度
- 批量处理时复用模型实例

### 2. YouTube下载优化
- 选择合适的分辨率（720p通常足够）
- 使用缓存避免重复下载
- 并发下载多个视频

### 3. 视频处理优化
- 使用硬件加速编码器
- 合理设置视频质量参数
- 避免不必要的格式转换

## 故障排查

### 问题1: YouTube下载失败

**症状**: 下载时出现错误或无法获取视频

**解决**:
1. 更新yt-dlp: `pip install --upgrade yt-dlp`
2. 检查网络连接
3. 确认视频URL正确
4. 尝试使用代理

### 问题2: 字幕生成失败

**症状**: Whisper模型加载失败或生成错误

**解决**:
1. 检查faster-whisper是否正确安装
2. 首次运行会自动下载模型，需要网络连接
3. CUDA错误时尝试使用CPU模式: `--device cpu`
4. 检查视频是否包含音轨

### 问题3: 视频处理内存不足

**症状**: 处理大视频时内存溢出

**解决**:
1. 降低视频分辨率
2. 分段处理长视频
3. 关闭不必要的程序释放内存
4. 使用更高效的编码器

## 下一步计划

1. ⏳ 集成到Node.js后端
2. ⏳ 添加前端界面
3. ⏳ 实现视频预览功能
4. ⏳ 添加批量处理队列
5. ⏳ 部署到生产环境

## 相关文档

- [智能剪辑集成文档](SMART_CLIP_INTEGRATION.md)
- [素材功能文档](MATERIAL_FEATURES.md)
- [快速使用指南](SMART_CLIP_USAGE.md)
- [NarratoAI集成完成总结](../NARRATOAI_INTEGRATION_COMPLETE.md)

---

**版本**: 3.0.0  
**更新日期**: 2026-04-03  
**状态**: ✅ 完成并可用
