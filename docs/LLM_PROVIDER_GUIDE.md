# LLM 提供商切换指南

本项目支持两种 LLM 提供商：**Gemini** 和 **Qwen（千问）**

## 快速切换

在 `.env` 文件中设置 `LLM_PROVIDER`：

```bash
# 使用千问
LLM_PROVIDER=qwen

# 或使用 Gemini
LLM_PROVIDER=gemini
```

## 配置说明

### 1. 使用 Gemini

```bash
LLM_PROVIDER=gemini

# Gemini API 配置
GEMINI_API_KEY=your-gemini-api-key
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com  # 官方 API
# 或使用中转服务
# GEMINI_API_BASE_URL=https://your-proxy.com

# 模型配置
GEMINI_MODEL=gemini-2.5-pro
AI_REVIEW_GEMINI_MODEL=gemini-2.5-pro
```

**特点：**
- ✅ 支持文件上传 API（大文件无限制）
- ✅ 多模态能力强
- ❌ 需要科学上网（或使用中转服务）
- ❌ 中转服务可能不支持文件上传

### 2. 使用千问（Qwen）

```bash
LLM_PROVIDER=qwen

# 千问 API 配置
QWEN_API_KEY=your-dashscope-api-key
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 模型配置
QWEN_VL_MODEL=qwen3-vl-flash             # 视频分析
QWEN_ASR_MODEL=qwen3-asr-flash           # 语音识别
QWEN_TEXT_MODEL=qwen3.5-plus             # 文本生成
```

**特点：**
- ✅ 国内访问快速稳定
- ✅ 支持视频、音频、图片分析
- ✅ Qwen3-ASR 支持 52 种语言
- ✅ OpenAI 兼容接口
- ⚠️ 使用 base64 传输（建议 < 50MB）

## 功能对比

| 功能 | Gemini | Qwen |
|------|--------|------|
| 视频分析 | ✅ | ✅ |
| 语音识别（ASR） | ✅ | ✅ (Qwen3-ASR) |
| 文本生成 | ✅ | ✅ |
| 文件上传 API | ✅ | ❌ (使用 base64) |
| 大文件支持 | ✅ 无限制 | ⚠️ < 50MB |
| 国内访问 | ❌ 需要代理 | ✅ 直连 |
| OpenAI 兼容 | ❌ | ✅ |

## 千问模型说明

### 视觉模型（VL）
- `qwen3-vl-flash` - 速度优先，适合日常视频理解（推荐）
- `qwen3-vl-72b-instruct` - 更强视觉理解
- `qwen3-vl-30b-instruct` - 平衡性能和速度

### ASR 模型
- `qwen3-asr-flash` - 快速识别（推荐）
- `qwen3-asr-plus` - 高精度识别

### 文本模型
- `qwen3.5-plus` - 文本质量和稳定性更好（推荐）
- `qwen3-72b-instruct` - 兼容旧配置
- `qwen3-30b-instruct` - 平衡选择

## 获取千问 API Key

1. 访问 [阿里云百炼平台](https://dashscope.console.aliyun.com/)
2. 注册/登录账号
3. 创建 API Key
4. 将 API Key 填入 `.env` 的 `QWEN_API_KEY`

## 注意事项

1. **切换提供商后需要重启服务**
2. **千问使用 base64 传输，视频文件建议 < 50MB**
3. **两套配置可以同时保留，通过 `LLM_PROVIDER` 切换**
4. **千问的 OpenAI 兼容接口文档：** [阿里云文档](https://helpcdn.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai)

## 参考资料

- [Qwen3-ASR 文档](https://pypi.org/project/qwen-asr/)
- [Qwen3-VL GitHub](https://github.com/QwenLM/Qwen3-VL)
- [千问 OpenAI 兼容接口](https://helpcdn.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai)
- [阿里云百炼平台](https://dashscope.console.aliyun.com/)
