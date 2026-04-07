# 智能剪辑使用示例

## 快速开始

### 1. 测试智能剪辑功能

```bash
cd /c/Users/PC/Desktop/comfy_panel_demo
python python/pipeline/test_smart_clip.py
```

### 2. 基础使用（兼容原版）

```bash
# 使用增强版脚本，但不启用新功能
python python/pipeline/build_video_smart.py
```

### 3. 启用硬件加速

```bash
# 自动检测并使用GPU加速
python python/pipeline/build_video_smart.py --hwaccel
```

### 4. 启用智能音频

```bash
# 启用音量分析和智能平衡
python python/pipeline/build_video_smart.py --smart-audio
```

### 5. 完整功能（推荐）

```bash
# 同时启用硬件加速和智能音频
python python/pipeline/build_video_smart.py --hwaccel --smart-audio
```

## 在Node.js中集成

### 修改 server/config/paths.js

```javascript
// 添加新脚本路径
BUILD_VIDEO_SMART_SCRIPT: path.join(PYTHON_PIPELINE_DIR, 'build_video_smart.py'),
```

### 修改 server/services/pipeline/handlers.js

在 `handleRunPipeline` 函数中：

```javascript
// 原来的调用
const buildVideoArgs = [paths.BUILD_VIDEO_SCRIPT];

// 改为智能版本
const buildVideoArgs = [paths.BUILD_VIDEO_SMART_SCRIPT];

// 添加智能功能参数
if (process.env.SMART_CLIP_HWACCEL_ENABLED === 'true') {
    buildVideoArgs.push('--hwaccel');
}

if (process.env.SMART_CLIP_AUDIO_ENABLED === 'true') {
    buildVideoArgs.push('--smart-audio');
}

if (noSubs) {
    buildVideoArgs.push('--no-subs');
}

// 执行
await runPythonScript(buildVideoArgs[0], buildVideoArgs.slice(1), {
    cwd: taskDir,
    timeout: 600000
});
```

### 在 .env 中配置

```bash
# 启用智能剪辑功能
SMART_CLIP_HWACCEL_ENABLED=true
SMART_CLIP_AUDIO_ENABLED=true
```

## 性能对比

### 测试场景
- 视频时长: 5分钟
- 切片数量: 20个
- 分辨率: 1920x1080

### 结果对比

| 模式 | 处理时间 | 文件大小 | 质量 |
|------|---------|---------|------|
| 原版（软件编码） | ~15分钟 | 120MB | 中等 |
| 硬件加速 | ~5分钟 | 115MB | 中等 |
| 硬件加速+智能音频 | ~6分钟 | 115MB | 高 |

## 故障排查

### 问题1: 硬件加速未启用

**检查方法**:
```bash
python python/pipeline/test_smart_clip.py
```

**可能原因**:
- GPU驱动未安装
- FFmpeg不支持硬件编码器
- GPU被其他程序占用

**解决方案**:
1. 更新GPU驱动
2. 重新编译FFmpeg（包含硬件加速支持）
3. 关闭其他占用GPU的程序

### 问题2: 音频处理失败

**症状**: 提示"音频响度分析失败"

**解决方案**:
1. 检查FFmpeg版本（需要支持loudnorm滤镜）
2. 临时禁用智能音频: 移除 `--smart-audio` 参数
3. 检查输入音频文件是否有效

### 问题3: 切片生成失败

**症状**: 某些切片无法生成

**解决方案**:
1. 查看详细错误日志
2. Fallback机制会自动尝试其他方案
3. 检查输入视频是否损坏
4. 尝试降低编码质量

## 高级配置

### 自定义编码质量

在 `.env.smart_clip` 中：

```bash
# CRF值（0-51，越小质量越高，文件越大）
SMART_CLIP_VIDEO_QUALITY=18  # 高质量
# SMART_CLIP_VIDEO_QUALITY=23  # 默认
# SMART_CLIP_VIDEO_QUALITY=28  # 低质量
```

### 自定义编码预设

```bash
# 编码速度预设
SMART_CLIP_VIDEO_PRESET=slow      # 慢速，高质量
# SMART_CLIP_VIDEO_PRESET=medium  # 默认
# SMART_CLIP_VIDEO_PRESET=fast    # 快速
# SMART_CLIP_VIDEO_PRESET=ultrafast  # 极速
```

### 自定义音量配置

```bash
# 配音音量（0.0-2.0）
SMART_CLIP_VOICE_VOLUME=1.0

# 原声音量（0.0-2.0）
SMART_CLIP_ORIGINAL_VOLUME=1.2

# BGM音量（0.0-2.0）
SMART_CLIP_BGM_VOLUME=0.3
```

## 最佳实践

### 1. 开发环境
- 使用软件编码（兼容性最好）
- 启用详细日志
- 使用较低质量加快测试

### 2. 生产环境
- 启用硬件加速（提升速度）
- 启用智能音频（提升质量）
- 使用中等质量（平衡速度和质量）

### 3. 高质量输出
- 使用 `slow` 预设
- 降低CRF值到18-20
- 启用智能音频处理

## 性能优化建议

### 1. 硬件选择
- **最佳**: NVIDIA RTX系列GPU
- **次选**: AMD RX系列GPU / Intel Arc GPU
- **备选**: 软件编码（CPU）

### 2. 参数调优
```bash
# 快速模式（开发测试）
--hwaccel
SMART_CLIP_VIDEO_PRESET=ultrafast
SMART_CLIP_VIDEO_QUALITY=28

# 平衡模式（生产环境）
--hwaccel --smart-audio
SMART_CLIP_VIDEO_PRESET=medium
SMART_CLIP_VIDEO_QUALITY=23

# 高质量模式（最终输出）
--hwaccel --smart-audio
SMART_CLIP_VIDEO_PRESET=slow
SMART_CLIP_VIDEO_QUALITY=18
```

### 3. 批量处理
- 使用队列系统
- 避免并发过多任务
- 监控GPU使用率

## 下一步

1. **测试功能**: 运行 `test_smart_clip.py`
2. **阅读文档**: 查看 `docs/SMART_CLIP_INTEGRATION.md`
3. **集成到项目**: 修改 `server.js` 和相关配置
4. **生产测试**: 在实际场景中测试性能和质量

## 反馈

如有问题或建议，请提交Issue或联系开发团队。
