# Startup Self Check

## 1. 目标

启动自检用于在服务启动时或启动前，尽早发现“环境缺失、路径错误、脚本缺失、关键配置缺失”等问题。

目标不是替代运行测试，而是把“运行到一半才炸”的问题提前暴露。

---

## 2. 推荐检查结果级别

- `ok`
  - 当前项可正常使用

- `warn`
  - 服务可继续启动，但部分功能不可用或可能异常

- `fail`
  - 当前项是阻断性问题，服务不应继续执行对应链路

---

## 3. 启动自检项

### 3.1 基础运行环境

1. `node`
   - 检查方式：`node -v`
   - 失败级别：`fail`

2. `python`
   - 检查方式：`python --version`
   - 失败级别：`fail`

3. `ffmpeg`
   - 检查方式：`ffmpeg -version`
   - 失败级别：`fail`

### 3.2 Python 执行能力

检查这些脚本是否存在：

- `python/pipeline/run_asr.py`
- `python/pipeline/video_vlm.py`
- `python/pipeline/run_director.py`
- `python/pipeline/build_video.py`
- `python/pipeline/make_vertical_video.py`
- `python/pipeline/generate_title.py`
- `python/publish/generate_publish_description.py`
- `python/publish/wechat_channels_rpa.py`
- `python/xai/run_xai_top10.py`
- `python/xai/translate_result_summaries.py`

建议：

- 缺少 pipeline 核心脚本：`fail`
- 缺少 publish / xai 脚本：`warn` 或按业务需要 `fail`

### 3.3 配置文件

检查这些文件是否存在：

- `config/workflow_api.json`
- `.env`
- `python/publish/platform_config.json`
- `python/xai/xai_accounts.json`

建议：

- `workflow_api.json` 缺失：`fail`
- `.env` 缺失：`warn` 或 `fail`
- `platform_config.json` 缺失：`warn`
- `xai_accounts.json` 缺失：`warn`

### 3.4 目录结构

检查这些目录是否存在，不存在则自动创建：

- `data/uploads/`
- `data/uploads/runtime_jobs/`
- `data/uploads/xai_vertical_queue/`
- `public/`
- `python/publish/browser_profiles/wechatChannels/`
- `python/publish/wechat_channels_tasks/`

### 3.5 环境变量

建议检查这些环境变量：

- `COMFYUI_BASE_URL`
- `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`
- `XAI_API_KEY`
- `GEMINI_MODEL`
- `XAI_MODEL`

建议级别：

- `COMFYUI_BASE_URL` 缺失：`warn`
- `GEMINI_API_KEY` 和 `GOOGLE_API_KEY` 都缺失：`warn` 或 `fail`
- `XAI_API_KEY` 缺失：`warn`

### 3.6 外部浏览器能力

检查：

- Playwright 是否安装
- Chromium 是否可启动

适用模块：

- 微信视频号发布

建议级别：

- 缺失：`warn`

---

## 4. 推荐输出格式

建议启动自检接口或日志统一输出：

```json
{
  "status": "warn",
  "checks": [
    {
      "name": "python",
      "level": "ok",
      "message": "Python 3.11.8"
    },
    {
      "name": "ffmpeg",
      "level": "ok",
      "message": "ffmpeg detected"
    },
    {
      "name": "xai_api_key",
      "level": "warn",
      "message": "XAI_API_KEY missing, xai module disabled"
    }
  ]
}
```

---

## 5. 执行时机建议

- 服务启动时执行一次
- 提供一个单独接口可手动触发
- 每次环境迁移后执行一次

---

## 6. 当前最值得优先加入的检查

如果你只想先做最小版，优先这 8 项：

1. Python 是否存在
2. FFmpeg 是否存在
3. `config/workflow_api.json` 是否存在
4. `python/pipeline/generate_title.py` 是否存在
5. `python/publish/wechat_channels_rpa.py` 是否存在
6. `python/xai/run_xai_top10.py` 是否存在
7. `.env` 是否存在
8. `GEMINI_API_KEY / GOOGLE_API_KEY` 是否存在
