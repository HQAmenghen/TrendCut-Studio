# Node / Python 执行协议

## 1. 目标

这份文档定义当前项目里 Node.js 调用 Python 脚本时的统一执行协议。

目的有 4 个：

- 统一脚本启动方式
- 统一结果返回方式
- 统一错误返回方式
- 统一前后端可观测性

当前实现入口：

- Node 侧 runner：
  - [server/core/python.js](/Users/PC/Desktop/comfy_panel_demo/server/core/python.js)
- Python 侧协议辅助：
  - [python/script_protocol.py](/Users/PC/Desktop/comfy_panel_demo/python/script_protocol.py)

---

## 2. 总体设计

### 2.1 Node 侧职责

Node 不再直接“裸 `spawn('python')` 然后猜 stdout/stderr”。

现在统一通过：

- `runPythonScript(scriptPath, args, options)`
- `runPythonScriptSync(scriptPath, args, options)`

这两个入口负责：

- 注入环境变量 `CODEX_PYTHON_PROTOCOL=jsonl-v1`
- 解析 Python 输出中的协议事件
- 保留非协议日志给现有 UI / SSE / 控制台
- 将 Python 的结构化错误转成统一 Error 对象

### 2.2 Python 侧职责

Python 脚本继续可以正常 `print(...)` 普通日志。

如果脚本希望把“阶段 / 结果 / 错误”明确传回 Node，需要调用：

- `emit_stage(...)`
- `emit_result(...)`
- `emit_error(...)`

推荐入口包装：

- `run_guarded(...)`

---

## 3. 协议格式

协议格式是 stdout / stderr 中的一行 JSONL 事件，前缀固定为：

```text
__CODEX_PYTHON__
```

示例：

```text
__CODEX_PYTHON__{"type":"stage","stage":"asr","message":"正在进行 Whisper ASR 识别"}
```

Node runner 会拦截这一类行，不把它当普通日志，而是当结构化协议事件处理。

---

## 4. 事件类型

### 4.1 `stage`

用于表示脚本执行阶段变化。

示例：

```json
{
  "type": "stage",
  "stage": "titling",
  "message": "正在读取字幕并生成标题"
}
```

建议字段：

- `type`
- `stage`
- `message`

可附加额外字段。

### 4.2 `result`

用于表示脚本已成功完成，并且可以附带结构化结果。

示例：

```json
{
  "type": "result",
  "message": "标题生成完成",
  "title": "万事达卡突然出手\n支付格局要变？"
}
```

常见用途：

- 标题生成结果
- 文案优化结果
- 输出文件路径
- 统计信息

### 4.3 `error`

用于表示脚本内部明确知道自己失败了，并返回稳定错误结构。

示例：

```json
{
  "type": "error",
  "code": "TITLE_GENERATION_FAILED",
  "message": "自动标题生成失败",
  "stage": "titling",
  "details": "Gemini returned empty text",
  "hint": "请检查 Gemini Key、字幕文件和标题生成脚本输出"
}
```

---

## 5. Node 侧返回的错误对象

当 Python runner 捕获到结构化错误后，会在 Node 侧生成一个 Error，并补充：

- `error.code`
- `error.stage`
- `error.details`
- `error.hint`
- `error.protocol`

这样业务层可以直接：

```js
sendError(res, {
  status: 500,
  code: err.code || 'XXX_FAILED',
  stage: err.stage || 'xxx',
  error: 'xxx 失败',
  details: err.details || err.message,
  hint: err.hint || ''
})
```

---

## 6. 标准接入方式

### 6.1 Node 侧

异步脚本：

```js
const result = await runPythonScript(scriptPath, ['--input', inputPath], {
  cwd: workdir,
  onStdout: (chunk) => {
    // 这里拿到的是“去掉协议行之后”的普通输出
  },
  onStderr: (chunk) => {
    // 这里拿到的是“去掉协议行之后”的普通错误输出
  }
});
```

同步脚本：

```js
const result = runPythonScriptSync(scriptPath, ['--result', resultPath], {
  cwd: workdir,
  timeout: 30000
});
```

读取结构化结果：

```js
const title = result.protocol?.result?.title || result.stdout.trim();
```

### 6.2 Python 侧

推荐模板：

```python
from script_protocol import emit_result, emit_stage, run_guarded

def main():
    emit_stage("titling", "正在读取字幕并生成标题")
    title = "示例标题"
    emit_result("标题生成完成", title=title)
    print(title)

if __name__ == "__main__":
    import sys
    sys.exit(run_guarded(
        main,
        error_code="TITLE_GENERATION_FAILED",
        error_message="自动标题生成失败",
        error_stage="titling",
        hint="请检查字幕文件和模型输出",
    ))
```

---

## 7. 当前已接入模块

截至当前，下面这些脚本 / 模块已经接入统一协议：

### 7.1 Node 侧 runner 使用者

- [server/services/pipeline/handlers.js](/Users/PC/Desktop/comfy_panel_demo/server/services/pipeline/handlers.js)
- [server/services/vertical/standalone.js](/Users/PC/Desktop/comfy_panel_demo/server/services/vertical/standalone.js)
- [server/services/vertical/queue.js](/Users/PC/Desktop/comfy_panel_demo/server/services/vertical/queue.js)
- [server/services/system/handlers.js](/Users/PC/Desktop/comfy_panel_demo/server/services/system/handlers.js)
- [server/services/xai/service.js](/Users/PC/Desktop/comfy_panel_demo/server/services/xai/service.js)
- [server.js](/Users/PC/Desktop/comfy_panel_demo/server.js) 中的发布描述生成与通用装配

### 7.2 Python 已发送协议事件的脚本

- [python/pipeline/run_asr.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/run_asr.py)
- [python/pipeline/video_vlm.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/video_vlm.py)
- [python/pipeline/run_director.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/run_director.py)
- [python/pipeline/build_video.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/build_video.py)
- [python/pipeline/make_vertical_video.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/make_vertical_video.py)
- [python/pipeline/generate_title.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/generate_title.py)
- [python/pipeline/convert_srt_to_json.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/convert_srt_to_json.py)
- [python/pipeline/optimize_text.py](/Users/PC/Desktop/comfy_panel_demo/python/pipeline/optimize_text.py)
- [python/publish/generate_publish_description.py](/Users/PC/Desktop/comfy_panel_demo/python/publish/generate_publish_description.py)
- [python/xai/run_xai_top10.py](/Users/PC/Desktop/comfy_panel_demo/python/xai/run_xai_top10.py)

---

## 8. 新脚本接入 checklist

以后新增 Python 脚本时，建议按这个顺序：

1. Python 脚本支持明确参数，不依赖隐式全局状态
2. 在关键阶段调用 `emit_stage(...)`
3. 成功结束前调用 `emit_result(...)`
4. 用 `run_guarded(...)` 包主入口
5. Node 侧通过 `runPythonScript(...)` 或 `runPythonScriptSync(...)` 调用
6. Node 侧优先读取 `result.protocol`
7. API 层优先透传 `err.code / err.stage / err.details / err.hint`

---

## 9. 当前约束

这套协议当前仍然是“单进程 stdout/stderr 协议”，不是 RPC。

优点：

- 改造成本低
- 兼容现有脚本
- 保留原始日志体验
- 适合当前单机本地工具

限制：

- 还没有统一任务表持久化
- 还没有统一阶段日志落库
- 复杂流式结果仍主要依赖普通日志

---

## 10. 后续建议

下一步最值得做的两件事：

1. 给这套协议补一个最小自动化测试
2. 把任务阶段日志写入统一存储（JSON 或 SQLite）

这样这套协议就不只是“能用”，而是“可持续扩展”。
