# OST策略集成文档

## 🎯 什么是OST策略？

**OST (Original Sound Track)** 是NarratoAI的核心剪辑策略，用于智能处理素材原声和解说音频的关系。

### OST类型

| OST值 | 名称 | 说明 | 音频处理 | 时长依据 |
|-------|------|------|---------|---------|
| 0 | 纯解说 | 只有解说，无原声 | 移除原声 | TTS时长 |
| 1 | 纯原声 | 只有原声，无解说 | 保留原声 | 时间戳 |
| 2 | 混合 | 原声+解说混合 | 保留原声 | TTS时长 |

## 🚀 核心优势

### 1. 智能音频处理
- **OST=0**: 完全移除原声，避免噪音干扰
- **OST=1**: 保留原声关键信息（如采访、现场音）
- **OST=2**: 原声作为背景，解说作为主音

### 2. 精确时长控制
- **按TTS时长剪辑** (OST=0,2): 确保解说完整播放
- **按时间戳剪辑** (OST=1): 保留原声完整语义

### 3. 画面质量优化
- 智能选择剪辑点
- 避免画面跳跃
- 保持视觉连贯性

## 📋 集成实现

### SmartVideoComposer

```python
from smart_video_composer import SmartVideoComposer

composer = SmartVideoComposer(work_dir="./output")

success = composer.compose_from_director_plan(
    director_plan_path="director_final.json",
    material_video="material.mp4",
    aiman_video="aiman.mp4",
    output_path="output_final.mp4",
    use_smart_clip=True  # 启用OST策略
)
```

### 导演方案格式

```json
{
  "segments": [
    {
      "type": "material",
      "ost": 0,
      "start": 0.0,
      "duration": 5.0,
      "tts_duration": 4.5,
      "content": "开场素材"
    },
    {
      "type": "aiman",
      "start": 0.0,
      "duration": 3.0,
      "content": "数字人介绍"
    },
    {
      "type": "material",
      "ost": 1,
      "start": 10.0,
      "end": 15.0,
      "content": "保留原声的采访片段"
    },
    {
      "type": "material",
      "ost": 2,
      "start": 20.0,
      "tts_duration": 6.0,
      "content": "混合音频的讲解片段"
    }
  ]
}
```

## 🎬 剪辑流程

### OST=0 纯解说片段

```
素材视频 → 剪辑(start, tts_duration) → 移除音频 → 输出
```

**特点**:
- 移除原声（`-an`）
- 按TTS时长剪辑
- 适合：背景画面、B-roll

**FFmpeg命令**:
```bash
ffmpeg -ss {start} -t {tts_duration} -i material.mp4 -an -c:v h264_nvenc output.mp4
```

### OST=1 纯原声片段

```
素材视频 → 剪辑(start, end-start) → 保留音频 → 输出
```

**特点**:
- 保留原声（`-c:a aac`）
- 按时间戳剪辑
- 适合：采访、现场音、关键信息

**FFmpeg命令**:
```bash
ffmpeg -ss {start} -t {duration} -i material.mp4 -c:v h264_nvenc -c:a aac output.mp4
```

### OST=2 混合片段

```
素材视频 → 剪辑(start, tts_duration) → 保留音频 → 输出
```

**特点**:
- 保留原声作为背景
- 按TTS时长剪辑
- 后续会混合解说音频
- 适合：讲解、分析、评论

**FFmpeg命令**:
```bash
ffmpeg -ss {start} -t {tts_duration} -i material.mp4 -c:v h264_nvenc -c:a aac output.mp4
```

## 🔧 硬件加速集成

### 4层Fallback机制

```
1. 硬件加速 (h264_nvenc/h264_amf/h264_qsv/h264_videotoolbox)
   ↓ 失败
2. 兼容模式 (降低preset)
   ↓ 失败
3. 软件编码 (libx264)
   ↓ 失败
4. 基础模式 (copy)
```

### 编码器选择

| 平台 | 硬件 | 编码器 | 速度提升 |
|------|------|--------|---------|
| Windows | NVIDIA | h264_nvenc | 3-5x |
| Windows | AMD | h264_amf | 3-4x |
| Windows | Intel | h264_qsv | 2-3x |
| macOS | Apple Silicon | h264_videotoolbox | 4-6x |
| Linux | NVIDIA | h264_nvenc | 3-5x |

## 🎵 音频处理

### 响度统一

所有片段的音频响度统一到 **-16.0 LUFS**（广播标准）

```python
# 分析响度
loudness = audio_processor.analyze_loudness(audio_file)

# 计算调整量
target = -16.0
adjustment = target - loudness

# 应用调整
factor = 10 ** (adjustment / 20)
adjusted_audio = audio.fx(volumex, factor)
```

### 音频混合

对于OST=2的片段，后续会混合：
- 原声（降低音量作为背景）
- 解说（主音频）
- BGM（可选）

## 📊 效果对比

### 传统方式 vs OST策略

| 指标 | 传统方式 | OST策略 |
|------|---------|---------|
| 音频处理 | 统一处理 | 智能分类 ✅ |
| 时长控制 | 不精确 | 精确 ✅ |
| 原声保留 | 全丢失 | 智能保留 ✅ |
| 画面质量 | 随机剪辑 | 智能选点 ✅ |
| 剪辑速度 | 慢 | 硬件加速 ✅ |

### 实际案例

**新闻类视频**:
- 开场：OST=0（纯解说介绍）
- 采访：OST=1（保留原声）
- 分析：OST=2（解说+背景音）
- 收尾：OST=0（纯解说总结）

**教程类视频**:
- 开场：OST=0（纯解说）
- 演示：OST=1（保留操作音）
- 讲解：OST=2（解说+环境音）
- 总结：OST=0（纯解说）

## 🎯 最佳实践

### 1. OST选择原则

- **OST=0**: 画面为主，无关键音频
- **OST=1**: 音频为主，必须保留
- **OST=2**: 音画并重，需要解说

### 2. 时长规划

```python
# OST=0,2: 按TTS时长
segment = {
    "type": "material",
    "ost": 0,
    "start": 10.0,
    "tts_duration": 5.0  # 解说需要5秒
}

# OST=1: 按时间戳
segment = {
    "type": "material",
    "ost": 1,
    "start": 10.0,
    "end": 15.0  # 原声片段10-15秒
}
```

### 3. 导演规划建议

- 素材占比：70%
- 数字人占比：30%
- OST=0: 40-50%（背景画面）
- OST=1: 20-30%（关键原声）
- OST=2: 20-30%（混合讲解）

## 🐛 故障排查

### 问题1: 硬件加速失败

**症状**: 所有片段都使用软件编码

**解决**:
1. 检查GPU驱动
2. 检查FFmpeg编译选项: `ffmpeg -encoders | grep nvenc`
3. 降级到软件编码（自动Fallback）

### 问题2: 音频不同步

**症状**: 画面和音频对不上

**解决**:
1. 检查TTS时长是否准确
2. 使用 `-avoid_negative_ts make_zero`
3. 检查素材视频的时间戳

### 问题3: 画面质量差

**症状**: 画面模糊或有瑕疵

**解决**:
1. 检查硬件编码器质量设置
2. 调整CQ/CRF参数
3. 使用软件编码获得更好质量

## 📚 相关文档

- [素材驱动工作流](MATERIAL_DRIVEN_WORKFLOW.md)
- [智能剪辑集成](SMART_CLIP_INTEGRATION.md)
- [完整功能文档](COMPLETE_FEATURES.md)

## 🎉 总结

OST策略的核心价值：

1. **智能化**: 根据内容特点选择处理方式
2. **精确化**: 时长和音频精确控制
3. **高质量**: 保留关键信息，优化画面
4. **高效率**: 硬件加速，快速处理

通过OST策略，视频制作从"粗暴剪辑"升级为"智能合成"。

---

**版本**: 1.0.0  
**日期**: 2026-04-03  
**状态**: ✅ 已集成
