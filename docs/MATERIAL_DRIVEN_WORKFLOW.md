# 素材驱动的数字人视频制作流程

## 🎯 工作流概述

**素材驱动** = 先分析素材 → 规划剪辑 → 生成数字人 → 智能混剪

```
素材视频 (material.mp4)
    ↓
1. 分析素材（ASR + VLM）
    ↓ 提取音频和视觉信息
2. 素材切片和评分
    ↓ 切成语义段并评分
3. AI导演规划 ⭐ 核心
    ↓ 规划素材70% + 数字人30%
    ↓ 确定数字人说什么、说多久
4. 生成解说词
    ↓ 根据规划生成精确时长的解说词
5. 生成数字人 (ComfyUI)
    ↓ 根据解说词生成数字人视频
6. 智能混剪 🚀
    ↓ 硬件加速 + 智能音频
最终视频 (output_final.mp4)
```

## 🚀 快速开始

### 一键执行完整流程

```bash
python python/pipeline/run_material_driven.py material.mp4 --output-dir ./output
```

### 使用智能剪辑（推荐）

```bash
python python/pipeline/run_material_driven.py material.mp4 \
    --output-dir ./output
```

### 禁用智能剪辑

```bash
python python/pipeline/run_material_driven.py material.mp4 \
    --output-dir ./output \
    --no-smart-clip
```

## 📋 分步执行

如果需要分步执行或从某个步骤继续：

### 步骤1-5: 准备到生成解说词

```bash
python python/pipeline/run_material_driven.py material.mp4 \
    --output-dir ./output \
    --end-at 5
```

### 步骤6: 生成数字人（需要ComfyUI）

通过Node.js服务调用ComfyUI生成数字人视频

### 步骤7: 从混剪开始

```bash
python python/pipeline/run_material_driven.py material.mp4 \
    --output-dir ./output \
    --start-from 7
```

## 📊 完整流程详解

### 步骤1: 准备素材
- 复制素材到工作目录
- 输出: `material.mp4`

### 步骤2: 分析素材
- **2.1 音频识别 (ASR)**
  - 提取音频并识别文字
  - 输出: `audio.json`
  
- **2.2 视觉分析 (VLM)**
  - 分析视频内容
  - 输出: `result.json`

### 步骤3: 素材切片
- **3.1 按语义切片**
  - 根据字幕和停顿切片
  - 输出: `segments.json`
  
- **3.2 评分素材片段**
  - 评估每个片段的质量
  
- **3.3 选择优质片段**
  - 选择最佳片段用于混剪

### 步骤4: 导演规划 ⭐ 核心步骤

AI导演会：
- 分析素材内容和质量
- 规划素材使用（目标70%）
- 规划数字人位置（目标30%）
- 确定数字人需要说什么
- 确定每个片段的时长

**输出**: `director_final.json`

**规划原则**:
- 素材内容为主（70%画面时长）
- 数字人只负责：开场、串联、补充、收尾
- 优先保留素材原声中的关键信息
- 避免频繁切镜，保持节奏稳定

### 步骤5: 生成解说词

根据导演规划生成：
- 精确时长的解说词
- 符合语速要求（4-5字/秒）
- 自然流畅的表达

**输出**: `narration.json`

### 步骤6: 生成数字人

**需要通过Node.js服务调用ComfyUI**

1. 确保ComfyUI服务运行
2. 配置 `COMFYUI_BASE_URL`
3. 通过前端或API触发生成
4. 等待生成完成

**输出**: `aiman.mp4`

### 步骤7: 智能混剪

使用升级后的智能剪辑引擎：
- 🚀 硬件加速编码（3-5倍提速）
- 🎵 智能音频处理（响度统一）
- 🎬 精确的音视频同步
- 📝 字幕烧录

**输出**: `output_final.mp4`

## 🎯 工作目录结构

```
output/
├── material.mp4           # 素材视频
├── audio.json            # 音频识别结果
├── result.json           # 视觉分析结果
├── segments.json         # 素材切片
├── director_final.json   # 导演方案 ⭐
├── narration.json        # 解说词
├── aiman.mp4            # 数字人视频
├── subtitles.srt        # 字幕文件
└── output_final.mp4     # 最终视频 ✅
```

## 💡 使用技巧

### 1. 查看规划摘要

脚本会自动显示规划摘要：
```
规划摘要:
  总时长: 45.2秒
  素材占比: 68.5%
  数字人占比: 31.5%
```

### 2. 查看解说词摘要

```
解说词摘要:
  目标时长: 15秒
  字数: 68字
  预计语速: 4.5字/秒
```

### 3. 断点续传

如果某个步骤失败，可以从该步骤重新开始：

```bash
# 从步骤4（导演规划）重新开始
python python/pipeline/run_material_driven.py material.mp4 \
    --output-dir ./output \
    --start-from 4
```

### 4. 只执行特定步骤

```bash
# 只执行步骤2（分析素材）
python python/pipeline/run_material_driven.py material.mp4 \
    --output-dir ./output \
    --start-from 2 \
    --end-at 2
```

## 🔧 配置说明

### 环境变量

在 `.env` 文件中配置：

```bash
# ComfyUI
COMFYUI_BASE_URL=https://your-comfyui-host:8443

# LLM (用于导演规划和解说词生成)
LLM_PROVIDER=qwen
QWEN_API_KEY=your_key
QWEN_TEXT_MODEL=qwen3.5-plus

# 智能剪辑
SMART_CLIP_HWACCEL_ENABLED=true
SMART_CLIP_AUDIO_ENABLED=true
```

## 📊 性能对比

| 环节 | 传统方式 | 素材驱动 + 智能剪辑 |
|------|---------|-------------------|
| 素材利用率 | 30-40% | 70% ⬆️ |
| 时长控制 | 不精确 | 精确 ✅ |
| 编码速度 | 基准 | 3-5倍 ⬆️ |
| 音频质量 | 忽大忽小 | 统一响度 ✅ |
| 工作流 | 手动多步 | 一键自动 ✅ |

## 🎬 完整示例

```bash
# 1. 准备素材
# 假设你有一个新闻素材视频

# 2. 执行完整流程
python python/pipeline/run_material_driven.py \
    /path/to/news_material.mp4 \
    --output-dir ./projects/news_001

# 3. 等待步骤1-5完成
# 脚本会在步骤6暂停，提示你生成数字人

# 4. 通过前端或API生成数字人
# 确保 aiman.mp4 生成在 ./projects/news_001/

# 5. 继续执行混剪
python python/pipeline/run_material_driven.py \
    /path/to/news_material.mp4 \
    --output-dir ./projects/news_001 \
    --start-from 7

# 6. 完成！
# 最终视频: ./projects/news_001/output_final.mp4
```

## 🐛 故障排查

### 问题1: 步骤2失败（分析素材）

**症状**: ASR或VLM失败

**解决**:
1. 检查素材格式（推荐mp4）
2. 检查FFmpeg是否安装
3. 检查LLM API配置

### 问题2: 步骤4失败（导演规划）

**症状**: AI导演规划失败

**解决**:
1. 检查 `audio.json` 和 `result.json` 是否存在
2. 检查LLM API Key
3. 检查网络连接

### 问题3: 步骤6失败（生成数字人）

**症状**: aiman.mp4 未生成

**解决**:
1. 确认ComfyUI服务运行
2. 检查 `COMFYUI_BASE_URL` 配置
3. 通过前端手动触发生成

### 问题4: 步骤7失败（混剪）

**症状**: 混剪失败或质量差

**解决**:
1. 确认 `aiman.mp4` 和 `material.mp4` 都存在
2. 确认 `director_final.json` 存在
3. 尝试禁用硬件加速: `--no-smart-clip`

## 📚 相关文档

- [智能剪辑集成文档](../../docs/SMART_CLIP_INTEGRATION.md)
- [完整功能文档](../../docs/COMPLETE_FEATURES.md)
- [素材功能文档](../../docs/MATERIAL_FEATURES.md)

## 🎉 优势总结

### 素材驱动的优势

1. **素材利用率高** - 70%的画面来自素材
2. **时长精确可控** - 先规划再生成
3. **内容质量高** - 保留素材原声的关键信息
4. **节奏更紧凑** - 避免数字人冗长

### 智能剪辑的优势

1. **速度快** - 硬件加速3-5倍提速
2. **质量好** - 智能音频处理，响度统一
3. **自动化** - 一键完成，无需手动调整
4. **兼容性强** - 自动Fallback，保证成功

---

**版本**: 1.0.0  
**日期**: 2026-04-03  
**状态**: ✅ 可用
