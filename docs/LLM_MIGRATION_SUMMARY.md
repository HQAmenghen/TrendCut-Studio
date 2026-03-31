# LLM 提供商改造总结

## 改造完成 ✅

项目已全面支持 **Gemini** 和 **Qwen（千问）** 双 LLM 提供商，可通过环境变量一键切换。

## 改造的模块

### 核心基础设施
1. **`python/llm_client.py`** - 统一的 LLM 客户端接口
2. **`python/qwen_client.py`** - 千问客户端实现（OpenAI 兼容）
3. **`python/gemini_client.py`** - 保留原有 Gemini 客户端

### 改造的功能模块

| 模块 | 文件路径 | 功能 | 状态 |
|------|---------|------|------|
| AI Review | `python/review/ai_video_review.py` | 视频审核 | ✅ |
| ASR | `python/pipeline/run_asr.py` | 语音识别 + 翻译 | ✅ |
| Video VLM | `python/pipeline/video_vlm.py` | 视频分析 | ✅ |
| 标题生成 | `python/pipeline/generate_title.py` | 生成视频标题 | ✅ |
| 文案优化 | `python/pipeline/optimize_text.py` | 优化口播文案 | ✅ |
| 导演模式 | `python/pipeline/run_director.py` | 生成混剪方案 | ✅ |
| 发布描述 | `python/publish/generate_publish_description.py` | 生成发布文案 | ✅ |
| 翻译 | `python/xai/translate_result_summaries.py` | 翻译摘要 | ✅ |

## 使用方法

### 1. 切换到千问

```bash
# .env 文件
LLM_PROVIDER=qwen
QWEN_API_KEY=your-dashscope-api-key
```

### 2. 切换到 Gemini

```bash
# .env 文件
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
```

### 3. 重启服务

```bash
npm start  # 或你的启动命令
```

## 技术实现

### 统一接口设计

所有模块通过 `llm_client.py` 调用 LLM，自动根据 `LLM_PROVIDER` 路由到对应的实现：

```python
from llm_client import create_llm_client, generate_content

client = create_llm_client()  # 自动选择 Gemini 或 Qwen
response = generate_content(client, model="...", contents=[...])
```

### 文件上传处理

- **Gemini**: 使用 Files API 上传（支持大文件）
- **Qwen**: 使用 base64 inline_data（建议 < 50MB）

`video_vlm.py` 和 `ai_video_review.py` 会自动根据提供商选择合适的方式。

### 模型配置

每个功能可以独立配置模型：

```bash
# Gemini
GEMINI_MODEL=gemini-2.5-pro
AI_REVIEW_GEMINI_MODEL=gemini-2.5-pro

# Qwen
QWEN_VL_MODEL=qwen3-vl-flash             # 视频分析
QWEN_ASR_MODEL=qwen3-asr-flash           # 语音识别
QWEN_TEXT_MODEL=qwen3.5-plus             # 文本生成
```

## 兼容性说明

### Gemini 特性
- ✅ 文件上传 API（无大小限制）
- ✅ 原生多模态支持
- ⚠️ 需要科学上网（或使用中转服务）

### Qwen 特性
- ✅ OpenAI 兼容接口
- ✅ 国内直连，速度快
- ✅ Qwen3-ASR 支持 52 种语言
- ✅ Qwen3-VL 强大的视觉理解
- ⚠️ base64 传输（建议 < 50MB）

## 测试建议

### 1. 测试千问配置

```bash
# 1. 获取千问 API Key
# https://dashscope.console.aliyun.com/

# 2. 配置 .env
LLM_PROVIDER=qwen
QWEN_API_KEY=sk-xxx

# 3. 测试文本生成
python python/pipeline/generate_title.py --summary "测试摘要"

# 4. 测试视频分析（小视频）
python python/review/ai_video_review.py --video test.mp4 --metadata meta.json
```

### 2. 测试 Gemini 配置

```bash
# 1. 配置 .env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key

# 2. 运行相同测试
```

## 回退方案

如果遇到问题，可以快速回退：

```bash
# 方法 1: 切换回 Gemini
LLM_PROVIDER=gemini

# 方法 2: 使用 git 回退（如果需要）
git checkout HEAD -- python/
```

## 后续优化建议

1. **性能优化**
   - 添加响应缓存
   - 实现请求批处理

2. **错误处理**
   - 添加更详细的错误日志
   - 实现自动降级（Qwen 失败时切换到 Gemini）

3. **监控**
   - 添加 API 调用统计
   - 监控成本和性能

4. **测试**
   - 添加单元测试
   - 添加集成测试

## 参考文档

- [LLM 提供商切换指南](./LLM_PROVIDER_GUIDE.md)
- [Qwen3-ASR 文档](https://pypi.org/project/qwen-asr/)
- [Qwen3-VL GitHub](https://github.com/QwenLM/Qwen3-VL)
- [千问 OpenAI 兼容接口](https://helpcdn.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai)
- [阿里云百炼平台](https://dashscope.console.aliyun.com/)

## 改造日期

2026-03-31

## 改造人员

Claude Code (Sonnet 4.5)
