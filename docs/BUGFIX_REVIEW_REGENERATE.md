# Bug 修复：审核中心"按建议重做"功能

## 修复时间
2026-03-31

## 问题：绝对不能使用合成过的视频再次合成

### 问题描述
"按建议重做"功能可能使用已合成的竖屏视频作为源视频，导致重新生成时会叠加效果。

### 根本原因
`regenerate.js` 在找不到源视频时，会回退使用合成后的视频：

```javascript
// ❌ 错误的逻辑
if (!sourceVideoPath) {
  sourceVideoPath = videoPath;  // videoPath 是合成后的视频
}
```

### 修复方案
**严格要求必须找到源视频，否则拒绝执行**：

```javascript
// 查找源视频路径
let sourceVideoPath = null;
if (metadata.taskDir) {
  const possibleSourcePath = require('path').join(metadata.taskDir, 'source.mp4');
  if (require('fs').existsSync(possibleSourcePath)) {
    sourceVideoPath = possibleSourcePath;
  }
}

// ✅ 如果找不到源视频，拒绝执行
if (!sourceVideoPath) {
  const error = new Error('无法找到源视频文件，无法重新生成');
  error.code = 'REVIEW_SOURCE_VIDEO_NOT_FOUND';
  error.hint = '只有通过自动流水线生成的视频才支持重新生成，且源视频文件必须存在';
  throw error;
}
```

### 保护机制
1. **必须有 taskDir**：只有通过流水线生成的视频才有 taskDir
2. **必须有 source.mp4**：源视频文件必须存在于 taskDir 中
3. **找不到就报错**：绝不使用合成后的视频作为回退

### 相关文件
- `server/services/review/regenerate.js:78-97`

## 测试结果
所有 68 个测试通过。

## 用户体验
- 如果视频支持重新生成：正常执行，使用源视频
- 如果视频不支持重新生成：明确报错，提示用户原因
