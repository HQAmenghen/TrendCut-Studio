# Vertex AI 集成指南

## 概述

本项目已集成 Google Cloud Vertex AI，支持使用 Gemini 3 Pro 等最新模型进行口播稿生成。

## 1. 安装依赖

```bash
pip install google-cloud-aiplatform
```

## 2. GCP 认证配置

### 方式 1: 服务账号密钥（推荐生产环境）

1. 在 [GCP Console](https://console.cloud.google.com/iam-admin/serviceaccounts) 创建服务账号
2. 授予权限：`Vertex AI User` 角色
3. 创建并下载 JSON 密钥文件
4. 设置环境变量：

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### 方式 2: gcloud CLI（推荐开发环境）

```bash
# 安装 gcloud CLI
# https://cloud.google.com/sdk/docs/install

# 登录
gcloud auth application-default login

# 设置项目
gcloud config set project YOUR_PROJECT_ID
```

## 3. 环境变量配置

在 `.env` 文件中添加：

```bash
# 切换到 Vertex AI
LLM_PROVIDER=vertex

# Vertex AI 配置
VERTEX_AI_PROJECT=your-gcp-project-id
VERTEX_AI_LOCATION=us-central1

# 口播稿生成模型（使用 Gemini 3 Pro）
GEMINI_MODEL=gemini-3-pro-preview
# 或使用完整路径
# GEMINI_MODEL=google/gemini-3-pro-preview

# 其他模型配置（可选）
AI_REVIEW_GEMINI_MODEL=gemini-2.5-pro
PUBLISH_DESCRIPTION_GEMINI_MODEL=gemini-2.5-pro
```

## 4. 支持的模型

### Gemini 3 系列（最新）
- `gemini-3-pro-preview` - Gemini 3 Pro 预览版（推荐用于口播稿生成）
- `google/gemini-3-pro-preview` - 完整路径格式

### Gemini 2.5 系列
- `gemini-2.5-pro` - Gemini 2.5 Pro

### Gemini 2.0 系列
- `gemini-2.0-flash-exp` - Gemini 2.0 Flash 实验版

### Gemini 1.5 系列
- `gemini-1.5-pro` - Gemini 1.5 Pro
- `gemini-1.5-flash` - Gemini 1.5 Flash

## 5. 可用区域

推荐使用以下区域（延迟低、模型支持全）：

- `us-central1` - 美国中部（推荐，默认）
- `us-east4` - 美国东部
- `europe-west1` - 欧洲西部
- `asia-northeast1` - 亚洲东北部（日本）

## 6. 模型名称格式

系统支持多种模型名称格式，会自动标准化：

```python
# 以下格式都会被识别为 gemini-3-pro-preview
"gemini-3-pro"
"gemini-3-pro-preview"
"google/gemini-3-pro-preview"
"publishers/google/models/gemini-3-pro-preview"
```

## 7. 口播稿生成配置

### 使用 Gemini 3 Pro 生成口播稿

```bash
# .env 配置
LLM_PROVIDER=vertex
VERTEX_AI_PROJECT=your-project-id
VERTEX_AI_LOCATION=us-central1
GEMINI_MODEL=gemini-3-pro-preview
```

### 环境变量优先级

口播稿生成会按以下优先级读取模型配置：

1. `GEMINI_SCRIPT_POLISH_MODEL` - 口播润色专用模型
2. `GEMINI_MODEL` - 通用 Gemini 模型
3. 默认值：`gemini-2.5-pro`

## 8. 功能支持对比

| 功能 | Vertex AI | Gemini API | Qwen |
|------|-----------|------------|------|
| 文本生成 | ✅ | ✅ | ✅ |
| 图片理解 | ✅ | ✅ | ✅ |
| 视频理解 | ✅ | ✅ | ✅ |
| 音频转录 | ⚠️ 需要 Speech-to-Text | ✅ | ✅ |
| 向量嵌入 | ⚠️ 需要 Text Embeddings API | ✅ | ✅ |
| 文档重排序 | ❌ | ❌ | ✅ |
| 文件上传 | ❌ 需要 GCS | ✅ | ❌ |

## 9. 成本估算

### Gemini 3 Pro（预览版）
- 输入：$1.25 / 百万 tokens
- 输出：$5.00 / 百万 tokens

### Gemini 2.5 Pro
- 输入：$1.25 / 百万 tokens
- 输出：$5.00 / 百万 tokens

### Gemini 2.0 Flash
- 输入：$0.075 / 百万 tokens
- 输出：$0.30 / 百万 tokens

## 10. 故障排查

### 错误：Missing Vertex AI project

```bash
# 确保设置了项目 ID
export VERTEX_AI_PROJECT=your-project-id
```

### 错误：Permission denied

```bash
# 检查服务账号权限
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### 错误：Model not found

```bash
# 确保区域支持该模型
# Gemini 3 Pro 目前仅在部分区域可用
VERTEX_AI_LOCATION=us-central1
```

### 错误：Quota exceeded

- 检查 [GCP Quotas](https://console.cloud.google.com/iam-admin/quotas)
- 申请提高配额或切换到其他区域

## 11. 测试配置

```bash
# 测试 Vertex AI 连接
python -c "
from python.vertex_ai_client import create_vertex_ai_client, generate_content
client = create_vertex_ai_client()
response = generate_content(
    client,
    model='gemini-3-pro-preview',
    contents='你好，请用一句话介绍自己'
)
print(response.text)
"
```

## 12. 参考链接

- [Vertex AI 文档](https://cloud.google.com/vertex-ai/docs)
- [Gemini 3 Pro 模型页面](https://console.cloud.google.com/vertex-ai/publishers/google/model-garden/gemini-3-pro-preview)
- [定价详情](https://cloud.google.com/vertex-ai/pricing)
- [配额管理](https://console.cloud.google.com/iam-admin/quotas)
