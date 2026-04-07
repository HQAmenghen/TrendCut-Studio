# 素材驱动工作流 - 快速参考

## 🚀 一键执行

```bash
python python/pipeline/run_material_driven.py material.mp4 --output-dir ./output
```

## 📋 7个步骤

| 步骤 | 名称 | 输出 | 说明 |
|------|------|------|------|
| 1 | 准备素材 | material.mp4 | 复制到工作目录 |
| 2 | 分析素材 | audio.json, result.json | ASR + VLM |
| 3 | 素材切片 | segments.json | 切片+评分+选择 |
| 4 | 导演规划 ⭐ | director_final.json | 规划素材70%+数字人30% |
| 5 | 生成解说词 | narration.json | 精确时长的解说词 |
| 6 | 生成数字人 | aiman.mp4 | 通过ComfyUI生成 |
| 7 | 智能混剪 🚀 | output_final.mp4 | 硬件加速+智能音频 |

## 💡 常用命令

### 完整流程
```bash
python python/pipeline/run_material_driven.py material.mp4 -o ./output
```

### 执行到步骤5（等待生成数字人）
```bash
python python/pipeline/run_material_driven.py material.mp4 -o ./output --end-at 5
```

### 从步骤7开始（已有数字人）
```bash
python python/pipeline/run_material_driven.py material.mp4 -o ./output --start-from 7
```

### 禁用智能剪辑
```bash
python python/pipeline/run_material_driven.py material.mp4 -o ./output --no-smart-clip
```

### 重新规划（从步骤4开始）
```bash
python python/pipeline/run_material_driven.py material.mp4 -o ./output --start-from 4
```

## 🎯 核心原则

### 素材驱动 = 素材优先
- ✅ 素材占70%画面时长
- ✅ 数字人占30%（开场+串联+收尾）
- ✅ 保留素材原声的关键信息
- ✅ 避免频繁切镜

### 智能剪辑 = 质量提升
- 🚀 硬件加速（3-5倍提速）
- 🎵 智能音频（响度统一）
- 🎬 精确同步
- 📝 自动字幕

## 📁 输出文件

```
output/
├── material.mp4           # 素材
├── audio.json            # 音频识别
├── result.json           # 视觉分析
├── director_final.json   # 导演方案 ⭐
├── narration.json        # 解说词
├── aiman.mp4            # 数字人
└── output_final.mp4     # 最终视频 ✅
```

## ⚙️ 环境配置

```bash
# .env
COMFYUI_BASE_URL=https://your-comfyui:8443
LLM_PROVIDER=qwen
QWEN_API_KEY=your_key
SMART_CLIP_HWACCEL_ENABLED=true
SMART_CLIP_AUDIO_ENABLED=true
```

## 🐛 快速排查

| 问题 | 解决 |
|------|------|
| 步骤2失败 | 检查FFmpeg和LLM配置 |
| 步骤4失败 | 检查audio.json和result.json |
| 步骤6失败 | 确认ComfyUI运行 |
| 步骤7失败 | 确认aiman.mp4存在 |

## 📊 效果对比

| 指标 | 传统 | 素材驱动+智能剪辑 |
|------|------|------------------|
| 素材利用率 | 30% | 70% ⬆️ |
| 编码速度 | 1x | 3-5x ⬆️ |
| 音频质量 | 不统一 | 统一 ✅ |
| 自动化 | 手动 | 一键 ✅ |

---

**完整文档**: [MATERIAL_DRIVEN_WORKFLOW.md](MATERIAL_DRIVEN_WORKFLOW.md)
