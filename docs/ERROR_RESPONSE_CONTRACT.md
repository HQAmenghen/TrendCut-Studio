# Error Response Contract

## 1. 目标

这份文档定义后端统一错误响应格式，方便前端展示、日志记录和后续排障。

当前项目跨越：

- Node 路由层
- Python 子进程层
- 本地文件系统
- 外部 AI 服务

如果错误格式不统一，前端会出现：

- 报错不稳定
- 无法区分失败阶段
- 很难自动分类和记录

---

## 2. 推荐统一结构

建议所有业务接口尽量返回：

```json
{
  "error": "自动标题生成失败",
  "code": "TITLE_GENERATION_FAILED",
  "stage": "titling",
  "details": "generate_title.py exited with code 1",
  "hint": "检查 Gemini API Key、标题脚本输出和 subtitles.json 是否存在"
}
```

字段定义：

- `error`
  - 给前端直接展示的简短错误

- `code`
  - 稳定错误码，便于前端分类

- `stage`
  - 当前失败阶段

- `details`
  - 调试信息，适合日志

- `hint`
  - 第一条排障建议

---

## 3. 推荐阶段枚举

- `bootstrap`
- `validation`
- `upload`
- `generate`
- `pipeline`
- `asr`
- `vlm`
- `director`
- `titling`
- `rendering`
- `publish`
- `wechat_rpa`
- `xai`
- `filesystem`

---

## 4. 推荐错误码

### 4.1 环境类

- `ENV_MISSING`
- `DEPENDENCY_MISSING`
- `SCRIPT_NOT_FOUND`
- `CONFIG_NOT_FOUND`

### 4.2 请求输入类

- `VALIDATION_FAILED`
- `FILE_MISSING`
- `UNSUPPORTED_INPUT`

### 4.3 执行流程类

- `PROCESS_FAILED`
- `OUTPUT_MISSING`
- `TITLE_GENERATION_FAILED`
- `ASR_FAILED`
- `VERTICAL_RENDER_FAILED`
- `PIPELINE_BUILD_FAILED`
- `XAI_RUN_FAILED`
- `WECHAT_RPA_FAILED`

### 4.4 外部服务类

- `COMFYUI_REQUEST_FAILED`
- `GEMINI_REQUEST_FAILED`
- `XAI_REQUEST_FAILED`
- `PLAYWRIGHT_UNAVAILABLE`

---

## 5. 各模块错误示例

### 5.1 Pipeline

```json
{
  "error": "混剪阶段失败",
  "code": "PIPELINE_BUILD_FAILED",
  "stage": "pipeline",
  "details": "build_video.py failed: ffmpeg concat error",
  "hint": "检查 director.json、素材切片和 ffmpeg 输出"
}
```

### 5.2 Standalone

```json
{
  "error": "自动标题生成失败",
  "code": "TITLE_GENERATION_FAILED",
  "stage": "titling",
  "details": "generate_title.py exited with code 1",
  "hint": "检查标题脚本、Gemini Key 和 subtitles.json"
}
```

### 5.3 XAI

```json
{
  "error": "热点榜单运行失败",
  "code": "XAI_RUN_FAILED",
  "stage": "xai",
  "details": "run_xai_top10.py failed: rate limited",
  "hint": "检查 XAI_API_KEY、账号池配置和并发设置"
}
```

### 5.4 Publish

```json
{
  "error": "微信视频号配置不完整",
  "code": "VALIDATION_FAILED",
  "stage": "publish",
  "details": "missing finderUserName, helperAccount",
  "hint": "检查 publish 平台配置中的微信账号字段"
}
```

---

## 6. 前端处理建议

前端显示优先级建议：

1. 优先展示 `error`
2. 调试面板展示 `code + stage`
3. 展开详情时展示 `details`
4. 底部显示 `hint`

---

## 7. 最低改造目标

如果暂时不想大改，至少先保证：

- 所有关键接口返回 `error`
- 再逐步补 `code`
- 再逐步补 `stage`

最低版本示例：

```json
{
  "error": "自动标题生成失败",
  "code": "TITLE_GENERATION_FAILED",
  "stage": "titling"
}
```
