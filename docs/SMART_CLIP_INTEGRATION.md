# 智能视频剪辑集成文档

## 概述

本次集成将 NarratoAI 的智能剪辑能力融合到 Comfy Panel Demo 项目中，提供以下增强功能：

1. **硬件加速优化** - 自动检测并使用 NVIDIA/AMD/Intel/macOS 硬件加速
2. **智能音频处理** - 音量分析、智能平衡、响度归一化
3. **多层Fallback机制** - 确保剪辑成功率
4. **OST音频策略** - 支持纯解说/纯原声/混合模式

## 新增文件

### Python模块

1. **`python/pipeline/video_clip_engine.py`** - 智能剪辑引擎
   - 硬件加速检测
   - 编码器配置管理
   - FFmpeg命令构建
   - 多层fallback机制

2. **`python/pipeline/audio_processor.py`** - 音频处理器
   - 响度分析
   - 音量归一化
   - 智能音量平衡
   - 音频混合
   - 淡入淡出

3. **`python/pipeline/build_video_smart.py`** - 增强版视频构建脚本
   - 兼容原有 `build_video.py` 的所有功能
   - 新增智能剪辑选项
   - 支持硬件加速
   - 支持智能音频处理

### 配置文件

4. **`.env.smart_clip`** - 智能剪辑配置
   - 硬件加速开关
   - 音频处理参数
   - 编码质量设置
   - Fallback策略

## 使用方法

### 方式一：使用增强版脚本（推荐）

```bash
# 启用所有智能功能
python python/pipeline/build_video_smart.py --hwaccel --smart-audio

# 仅启用硬件加速
python python/pipeline/build_video_smart.py --hwaccel

# 仅启用智能音频
python python/pipeline/build_video_smart.py --smart-audio

# 禁用字幕
python python/pipeline/build_video_smart.py --no-subs --hwaccel

# 使用自定义timeline
python python/pipeline/build_video_smart.py --timeline timeline.json --hwaccel
```

### 方式二：保持原有方式（向后兼容）

```bash
# 原有脚本继续可用
python python/pipeline/build_video.py
```

## 功能对比

| 功能 | 原版 build_video.py | 增强版 build_video_smart.py |
|------|---------------------|----------------------------|
| 基础剪辑 | ✅ | ✅ |
| 字幕生成 | ✅ | ✅ |
| 硬件加速 | ❌ | ✅ 自动检测 |
| 智能音频 | ❌ | ✅ 响度分析 |
| Fallback | ❌ | ✅ 多层保障 |
| 音量平衡 | ❌ | ✅ 智能调整 |
| 编码优化 | 基础 | 高级 |

## 硬件加速支持

### NVIDIA GPU
- 自动检测 `h264_nvenc` 编码器
- 使用 CQ 质量控制
- 避免滤镜链问题

### AMD GPU
- 自动检测 `h264_amf` 编码器
- 使用 QP 质量控制

### Intel GPU
- 自动检测 `h264_qsv` 编码器
- 使用 global_quality 控制

### macOS
- 自动检测 `h264_videotoolbox` 编码器
- 使用比特率控制

### 软件编码
- 自动降级到 `libx264`
- 保证兼容性

## 智能音频处理

### 响度分析
```python
# 自动分析音频响度（LUFS）
tts_loudness = -18.5 LUFS
original_loudness = -12.3 LUFS

# 计算调整系数
tts_adjustment = 1.15
original_adjustment = 0.85
```

### 音量归一化
- 目标响度: -16.0 LUFS
- 真峰值限制: -1.5 dB
- 响度范围: 11 LU

### 智能平衡
- 自动平衡TTS和原声音量
- 避免音量忽大忽小
- 保持听感一致

## Fallback机制

### 四层保障

1. **主命令** - 使用硬件加速 + 高质量参数
2. **兼容性模式** - 软件编码 + 保守参数
3. **快速模式** - ultrafast预设 + 降低质量
4. **基础模式** - 直接复制流

### 自动降级
```
硬件加速失败 → 兼容性模式
超时 → 快速模式
异常 → 基础模式
```

## 配置说明

### 环境变量

在 `.env` 或 `.env.smart_clip` 中配置：

```bash
# 启用硬件加速
SMART_CLIP_HWACCEL_ENABLED=true

# 启用智能音频
SMART_CLIP_AUDIO_ENABLED=true

# 音量配置
SMART_CLIP_VOICE_VOLUME=1.0
SMART_CLIP_ORIGINAL_VOLUME=1.2
SMART_CLIP_BGM_VOLUME=0.3

# 编码质量（CRF值，越小质量越高）
SMART_CLIP_VIDEO_QUALITY=23

# 编码预设（ultrafast/fast/medium/slow）
SMART_CLIP_VIDEO_PRESET=medium
```

## Node.js集成

### 修改 server.js

```javascript
// 在 server.js 中添加智能剪辑选项
const buildVideoArgs = [
    paths.BUILD_VIDEO_SMART_SCRIPT,  // 使用增强版脚本
    '--hwaccel',                      // 启用硬件加速
    '--smart-audio'                   // 启用智能音频
];

if (noSubs) {
    buildVideoArgs.push('--no-subs');
}

await runPythonScript(buildVideoArgs[0], buildVideoArgs.slice(1), {
    cwd: taskDir,
    timeout: 600000  // 10分钟超时
});
```

### 添加配置路径

在 `server/config/paths.js` 中添加：

```javascript
BUILD_VIDEO_SMART_SCRIPT: path.join(PYTHON_PIPELINE_DIR, 'build_video_smart.py'),
```

## 性能优化建议

### 1. 硬件加速
- 优先使用 NVIDIA GPU（最快）
- AMD/Intel GPU 次之
- 软件编码最慢但最兼容

### 2. 编码预设
- `ultrafast` - 最快，质量较低
- `fast` - 快速，质量中等
- `medium` - 平衡（推荐）
- `slow` - 慢速，质量高

### 3. 并行处理
- 当前版本串行处理切片
- 未来可考虑并行处理多个切片

### 4. 缓存策略
- 缓存已处理的切片
- 避免重复计算

## 故障排查

### 硬件加速失败

**症状**: 提示"未检测到硬件加速"

**解决**:
1. 检查GPU驱动是否安装
2. 运行 `ffmpeg -encoders | grep nvenc` 检查编码器
3. 尝试更新FFmpeg版本

### 音频处理失败

**症状**: 音量异常或无声

**解决**:
1. 检查输入音频文件是否有效
2. 禁用智能音频: 移除 `--smart-audio` 参数
3. 检查FFmpeg是否支持loudnorm滤镜

### 切片生成失败

**症状**: 某些切片无法生成

**解决**:
1. 检查日志中的错误信息
2. Fallback机制会自动尝试其他方案
3. 如果所有方案都失败，检查输入视频是否损坏

## 迁移指南

### 从原版迁移到增强版

1. **无需修改现有代码** - 增强版完全兼容原版
2. **逐步启用新功能** - 先测试硬件加速，再启用智能音频
3. **保留原版脚本** - 作为备用方案

### 推荐迁移步骤

```bash
# 第1步：测试基础功能
python python/pipeline/build_video_smart.py

# 第2步：启用硬件加速
python python/pipeline/build_video_smart.py --hwaccel

# 第3步：启用智能音频
python python/pipeline/build_video_smart.py --hwaccel --smart-audio

# 第4步：更新Node.js调用
# 修改 server.js 使用新脚本
```

## 未来扩展

### 计划中的功能

1. **OST策略支持** - 纯解说/纯原声/混合模式
2. **并行处理** - 多切片并行生成
3. **智能缓存** - 避免重复处理
4. **质量检测** - 自动检测生成质量
5. **AI内容理解** - 基于内容智能调整参数

### 扩展接口

```python
# 未来可以这样使用
from pipeline.video_clip_engine import SmartClipEngine

engine = SmartClipEngine(
    hwaccel=True,
    smart_audio=True,
    ost_strategy='mixed'  # 混合模式
)

result = engine.process_scenes(director_plan)
```

## 技术细节

### 硬件加速检测逻辑

```python
def check_hardware_acceleration():
    # 1. 检测NVIDIA NVENC
    if 'h264_nvenc' in encoders:
        return 'nvenc_pure'
    
    # 2. 检测AMD AMF
    if 'h264_amf' in encoders:
        return 'amf'
    
    # 3. 检测Intel QSV
    if 'h264_qsv' in encoders:
        return 'qsv'
    
    # 4. 检测macOS VideoToolbox
    if sys.platform == 'darwin' and 'h264_videotoolbox' in encoders:
        return 'videotoolbox'
    
    return None  # 软件编码
```

### 音频响度分析

```python
def analyze_audio_loudness(audio_path):
    # 使用FFmpeg loudnorm滤镜
    cmd = [
        'ffmpeg', '-i', audio_path,
        '-af', 'loudnorm=print_format=json',
        '-f', 'null', '-'
    ]
    
    # 解析JSON输出
    loudness_data = json.loads(output)
    return float(loudness_data['input_i'])  # LUFS值
```

### Fallback决策树

```
执行主命令
  ├─ 成功 → 返回
  ├─ 失败 → 兼容性模式
  │   ├─ 成功 → 返回
  │   └─ 失败 → 快速模式
  │       ├─ 成功 → 返回
  │       └─ 失败 → 基础模式
  │           ├─ 成功 → 返回
  │           └─ 失败 → 报错
  └─ 超时 → 快速模式
```

## 贡献指南

欢迎贡献代码和建议！

### 代码规范
- Python: PEP 8
- JavaScript: ESLint配置
- 注释: 中文

### 测试
```bash
# 运行测试
npm test

# Python测试
python -m pytest python/pipeline/tests/
```

## 许可证

本集成遵循原项目许可证。

## 联系方式

如有问题，请提交 Issue 或 Pull Request。

---

**版本**: 1.0.0  
**更新日期**: 2026-04-03  
**作者**: AI Assistant
