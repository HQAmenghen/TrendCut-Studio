# Bug 修复：审核中心"按建议重做"视频下载失败

## 问题描述

**严重级别**: P1

用户在审核中心点击"按建议重做"功能时，任务失败并提示"视频下载失败"。

## 根本原因

在 `server/services/review/regenerate.js` line 83，重新生成任务时传入的是原始的网络 URL：

```javascript
const regenerateParams = {
  // ...
  videoUrl: metadata.videoUrl || '',  // 原始网络 URL，可能已失效
  renderOptions: {
    originalVideoPath: videoPath,  // 本地已存在的视频文件
    isRegeneration: true,
    // ...
  }
};
```

问题：
1. `videoUrl` 是原始的网络 URL（如 X/Twitter、小红书等平台的视频链接）
2. 这些 URL 可能已经失效、需要登录、或有访问限制
3. 视频队列在 `queue.js` line 248 会尝试从 `videoUrl` 下载视频
4. 即使 `renderOptions.originalVideoPath` 已经提供了本地视频路径，队列也不会使用它

## 影响范围

- 所有通过"按建议重做"功能触发的重新生成任务
- AutoPilot 自动按建议重做的任务

## 修复方案

修改 `server/services/vertical/queue.js`，在下载视频前检查是否提供了本地视频路径：

```javascript
// 如果是重新生成任务且提供了原始视频路径，直接复制本地文件
if (renderOptions.originalVideoPath && fs.existsSync(renderOptions.originalVideoPath)) {
  updateJob({ status: 'preparing', progress: 10, message: '正在准备源视频...' }, '使用本地视频文件（重新生成任务）');
  try {
    fs.copyFileSync(renderOptions.originalVideoPath, sourceVideoPath);
    appendLog(job, `已复制本地视频: ${renderOptions.originalVideoPath}`);
  } catch (err) {
    throw createError('VERTICAL_QUEUE_VIDEO_COPY_FAILED', `复制本地视频失败: ${err.message}`);
  }
} else {
  // 正常下载流程
  updateJob({ status: 'downloading', progress: 10, message: '正在下载远程视频...' }, '开始下载远程视频');
  await downloadRemoteFile(job.videoUrl, sourceVideoPath);
}
```

## 优势

1. **避免重复下载**：重新生成时不需要再次从网络下载视频
2. **提高可靠性**：不依赖外部 URL 的可用性
3. **提升速度**：本地文件复制比网络下载快得多
4. **节省带宽**：不需要重复下载相同的视频

## 验证结果

所有 68 个测试通过。

## 使用场景

### 场景 1：首次生成视频
- 用户提供网络 URL
- 队列下载视频到本地
- 生成竖屏视频

### 场景 2：按建议重做
- 用户点击"按建议重做"
- 系统传入 `renderOptions.originalVideoPath`（指向已下载的视频）
- 队列直接复制本地文件，跳过下载步骤
- 重新生成竖屏视频

### 场景 3：AutoPilot 自动重做
- AutoPilot 检测到审核失败
- 自动触发重新生成
- 使用本地视频文件，避免下载失败

## 相关文件

- `server/services/vertical/queue.js:242-262` - 添加本地视频复制逻辑
- `server/services/review/regenerate.js:89` - 传入 `originalVideoPath`
- `server/core/errorCodes.js:20` - 添加 `VERTICAL_QUEUE_VIDEO_COPY_FAILED` 错误码

## 修复时间

2026-03-31
