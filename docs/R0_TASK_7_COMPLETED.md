# Task 7: 把"文件协议"升级成"显式任务对象协议"

## ✅ 完成

### 目标

将 Node 和 Python 之间的文件名耦合升级为显式任务对象协议，避免直接假设文件存在。

### 实施内容

#### 1. 创建任务协议核心模块 ✅

**文件：** `server/core/taskProtocol.js` (200+ 行)

**功能：**
- `createTaskInput()` - 创建任务输入对象
- `createTaskResult()` - 创建任务成功输出对象
- `createTaskFailure()` - 创建任务失败输出对象
- `writeTaskInput()` - 写入 task.json
- `readTaskInput()` - 读取 task.json
- `writeTaskResult()` - 写入 result.json
- `readTaskResult()` - 读取 result.json
- `writeTaskFailure()` - 写入 failure.json
- `readTaskFailure()` - 读取 failure.json
- `readTaskOutput()` - 读取任务输出（优先 result.json，回退 failure.json）
- `isTaskCompleted()` - 检查任务是否完成
- `resolveArtifactPaths()` - 解析产物路径（相对路径转绝对路径）

**协议格式：**

```javascript
// task.json - 任务输入
{
  "taskId": "vertical_1234567890_abc",
  "type": "vertical_queue",
  "input": {
    "videoUrl": "https://...",
    "title": "...",
    // ... 其他输入参数
  },
  "workDir": "/path/to/work/dir",
  "createdAt": "2026-03-31T10:00:00.000Z"
}

// result.json - 任务成功输出
{
  "taskId": "vertical_1234567890_abc",
  "status": "success",
  "artifacts": {
    "video": "output_vertical.mp4",
    "subtitles": "subtitles.json",
    "audio": "audio.json"
  },
  "metadata": {
    "duration": 30.5,
    "resolution": "1080x1920"
  },
  "completedAt": "2026-03-31T10:05:00.000Z"
}

// failure.json - 任务失败输出
{
  "taskId": "vertical_1234567890_abc",
  "status": "failed",
  "error": {
    "code": "DOWNLOAD_FAILED",
    "message": "Failed to download video",
    "stage": "download",
    "details": "Connection timeout after 30s"
  },
  "failedAt": "2026-03-31T10:02:00.000Z"
}
```

#### 2. 添加任务协议测试 ✅

**文件：** `server/core/__tests__/taskProtocol.test.js`

**测试覆盖：**
- 创建任务输入对象（2 个测试）
- 创建任务结果对象（2 个测试）
- 创建任务失败对象（2 个测试）
- 写入和读取 task.json（3 个测试）
- 写入和读取 result.json（2 个测试）
- 写入和读取 failure.json（2 个测试）
- 读取任务输出（3 个测试）
- 检查任务完成状态（3 个测试）
- 解析产物路径（4 个测试）

**测试结果：** 23 个测试全部通过

#### 3. 创建 Python 端工具模块 ✅

**文件：** `python/pipeline/task_protocol.py`

**功能：**
- `read_task_input()` - 读取 task.json
- `write_task_result()` - 写入 result.json
- `write_task_failure()` - 写入 failure.json
- `get_artifact_path()` - 获取产物的绝对路径

#### 4. 创建 Python 示例脚本 ✅

**文件：** `python/pipeline/task_protocol_example.py`

**功能：**
- 展示如何在 Python 脚本中使用任务协议
- 同时支持旧的命令行参数方式（向后兼容）和新的任务协议方式
- 演示如何读取 task.json 获取输入
- 演示如何写入 result.json 或 failure.json

**使用方式：**
```bash
# 命令行参数方式（旧）
python script.py --input video.mp4 --output result.mp4

# 任务协议方式（新）
python script.py --work-dir /path/to/work/dir
```

#### 5. 集成任务协议到 vertical queue ✅

**文件：** `server/services/vertical/queue.js`

**改动：**
- 在 ASR 阶段前写入 task.json（包含输入文件路径、参数）
- 在 ASR 阶段后尝试读取 result.json（如果存在，使用协议输出；否则回退到文件假设）
- 在渲染阶段前写入 task.json（包含输入文件、内容、字幕、输出路径、渲染选项）
- 在渲染阶段后尝试读取 result.json（如果存在，使用协议输出；否则回退到文件假设）

**向后兼容：**
- 任务协议是可选的，脚本可以选择使用或忽略
- 如果脚本不写入 result.json，Node 会回退到原有的文件假设逻辑
- 不影响现有脚本的运行

### 架构改进

#### 之前的问题
- ❌ Node 和 Python 靠文件名耦合太深
- ❌ Node 直接假设某些文件一定存在（如 `subtitles.json`, `output_vertical.mp4`）
- ❌ 重构 Python 脚本时容易破坏 Node 端的假设
- ❌ 错误处理不统一，难以追踪失败原因

#### 现在的状态
- ✅ 明确每条任务的输入、输出、产物清单
- ✅ 用 `task.json / result.json / failure.json` 统一描述
- ✅ Node 优先读取任务结果对象，回退到文件假设（向后兼容）
- ✅ Python 脚本可以选择性地采用任务协议
- ✅ 错误信息结构化，包含 code/message/stage/details
- ✅ 产物路径自动解析（相对路径转绝对路径）

### 测试结果

```bash
npm test
# Test Suites: 5 passed, 5 total
# Tests:       53 passed, 53 total (新增 23 个任务协议测试)
# Time:        ~1s
```

### 使用示例

#### Node 端（vertical queue）

```javascript
// 写入任务输入
const taskInput = createTaskInput(job.id, 'asr', {
  inputFile: sourceVideoPath,
  allowNoAudio: true
}, jobDir);
writeTaskInput(jobDir, taskInput);

// 调用 Python 脚本
await runPythonScript(scriptPath, args, options);

// 读取任务输出
const output = readTaskOutput(jobDir);
if (output && output.status === 'success') {
  // 使用任务协议输出
  const artifacts = resolveArtifactPaths(jobDir, output.artifacts);
  const subtitlesFile = artifacts.subtitles;
} else {
  // 回退到文件假设
  const subtitlesFile = path.join(jobDir, 'subtitles.json');
}
```

#### Python 端

```python
from task_protocol import read_task_input, write_task_result, write_task_failure

# 读取任务输入
task_input = read_task_input(work_dir)
if task_input:
    input_file = task_input['input']['inputFile']
    # ... 处理任务

    # 写入成功输出
    write_task_result(work_dir, task_input['taskId'], {
        'subtitles': 'subtitles.json',
        'audio': 'audio.json'
    }, {
        'duration': 30.5
    })
else:
    # 回退到命令行参数
    input_file = args.input
```

### 收益

1. **解耦合** - Node 和 Python 不再依赖文件名约定
2. **可维护性** - 重构 Python 脚本时更安全，不会破坏 Node 端
3. **错误追踪** - 结构化的错误信息，包含 code/stage/details
4. **向后兼容** - 现有脚本无需修改即可继续工作
5. **渐进式迁移** - 可以逐步将脚本迁移到任务协议

### 下一步建议

1. **迁移更多脚本** - 将 `run_asr.py`, `make_vertical_video.py` 等脚本迁移到任务协议
2. **扩展到其他服务** - 将任务协议应用到 pipeline, xai, wechatRpa 等服务
3. **增强元数据** - 在 result.json 中包含更多元数据（如执行时间、资源使用）
4. **错误恢复** - 利用 failure.json 实现自动重试和错误恢复

### 总结

Task 7 完成。建立了显式任务对象协议，Node 和 Python 之间的通信更加清晰和可靠。所有测试通过，向后兼容现有脚本。
