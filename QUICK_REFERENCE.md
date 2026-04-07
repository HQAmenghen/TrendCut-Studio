# NarratoAI 功能集成 - 快速参考

## 🚀 一键命令

### 测试所有功能
```bash
python python/pipeline/test_all_features.py
```

### 智能剪辑
```bash
python python/pipeline/build_video_smart.py --hwaccel --smart-audio
```

### 素材搜索
```bash
python python/pipeline/material_search.py '关键词' --platform pexels --download
```

### TTS合成
```bash
python python/pipeline/tts_engine.py "文本内容" --output audio.mp3
```

### YouTube下载
```bash
python python/pipeline/youtube_downloader.py "URL" --resolution 720p
```

### 字幕生成
```bash
python python/pipeline/subtitle_generator.py video.mp4 --output subtitle.srt
```

### 视频工具
```bash
# 调整尺寸
python python/pipeline/video_utils.py resize video.mp4 -w 1080 -h 1920 -o out.mp4

# 循环音频
python python/pipeline/video_utils.py loop audio.mp3 -d 60 -o looped.mp3

# 视频信息
python python/pipeline/video_utils.py info video.mp4

# 提取音频
python python/pipeline/video_utils.py extract video.mp4 -o audio.mp3
```

### 统一管理
```bash
# 缓存统计
python python/pipeline/material_manager.py cache stats

# 搜索素材
python python/pipeline/material_manager.py search '关键词'

# TTS合成
python python/pipeline/material_manager.py tts "文本"

# YouTube下载
python python/pipeline/material_manager.py youtube "URL" -r 720p
```

## 📦 依赖安装

```bash
pip install requests python-dotenv moviepy Pillow yt-dlp faster-whisper edge-tts azure-cognitiveservices-speech
```

## 🔧 环境配置

在 `.env` 文件中添加：

```bash
# 素材搜索
PEXELS_API_KEY=your_key
PIXABAY_API_KEY=your_key

# TTS
TTS_ENGINE=edge_tts
EDGE_TTS_VOICE=zh-CN-XiaoxiaoNeural

# Azure Speech (可选)
AZURE_SPEECH_KEY=your_key
AZURE_SPEECH_REGION=eastus

# 智能剪辑
SMART_CLIP_HWACCEL_ENABLED=true
SMART_CLIP_AUDIO_ENABLED=true

# YouTube
YOUTUBE_DEFAULT_RESOLUTION=720p

# 字幕
WHISPER_DEVICE=auto
WHISPER_DEFAULT_LANGUAGE=zh
```

## 📚 文档

- [完整功能文档](docs/COMPLETE_FEATURES.md)
- [智能剪辑文档](docs/SMART_CLIP_INTEGRATION.md)
- [素材功能文档](docs/MATERIAL_FEATURES.md)
- [集成总结](INTEGRATION_SUMMARY.md)

## ✨ 核心功能

| 功能 | 模块 | 状态 |
|------|------|------|
| 智能剪辑 | video_clip_engine.py | ✅ |
| 音频处理 | audio_processor.py | ✅ |
| 素材搜索 | material_search.py | ✅ |
| TTS合成 | tts_engine.py | ✅ |
| YouTube下载 | youtube_downloader.py | ✅ |
| 字幕生成 | subtitle_generator.py | ✅ |
| 视频工具 | video_utils.py | ✅ |
| 统一管理 | material_manager.py | ✅ |

## 🎯 常见场景

### 场景1: 从YouTube制作视频
```bash
# 1. 下载
python python/pipeline/youtube_downloader.py "URL" -r 720p

# 2. 生成字幕
python python/pipeline/subtitle_generator.py video.mp4

# 3. 调整尺寸
python python/pipeline/video_utils.py resize video.mp4 -w 1080 -h 1920 -o out.mp4

# 4. 智能剪辑
python python/pipeline/build_video_smart.py --hwaccel --smart-audio
```

### 场景2: 数字人视频
```bash
# 1. 搜索素材
python python/pipeline/material_search.py '办公室' --download

# 2. 合成语音
python python/pipeline/tts_engine.py "配音文本" --output voice.mp3

# 3. 智能剪辑
python python/pipeline/build_video_smart.py --hwaccel --smart-audio
```

### 场景3: 批量处理
```python
from pipeline.material_manager import MaterialManager
from pipeline.subtitle_generator import SubtitleGenerator
import asyncio

async def batch():
    manager = MaterialManager()
    generator = SubtitleGenerator()
    
    urls = ["url1", "url2", "url3"]
    for url in urls:
        video = manager.download_youtube(url)
        subtitle = generator.generate_from_video(video)
        
asyncio.run(batch())
```

## 🎉 完成状态

✅ 所有核心功能已集成  
✅ 9个Python模块  
✅ 5个文档文件  
✅ 2个测试脚本  
✅ 功能完整度 100%

---

**版本**: 3.0.0  
**日期**: 2026-04-03  
**状态**: ✅ 可用
