# 数字人生成问题与解决方案

**问题发现时间**: 2026-04-02  
**优先级**: P0（严重）

---

## 一、问题描述

### 当前流程
```
1. 用户上传 aiman.mp4（原始数字人视频）
2. 生成 bridge_script.json（补位文案）
3. 直接使用用户上传的 aiman.mp4
4. 对 aiman.mp4 做 ASR 生成 audio.json
5. compose_timeline.py 使用 bridge_script 作为字幕，audio.json 作为时长
```

### 问题
**三者不匹配**:
- 时间线字幕文本：bridge_script.json（新生成的补位文案）
- 数字人实际说的话：aiman.mp4 的内容（用户上传的原始内容）
- 音频时长：audio.json（aiman.mp4 的 ASR 结果）

**后果**:
- 口播不匹配：字幕显示的是补位文案，但数字人说的是其他内容
- 切点错位：audio.json 的时长与 bridge_script 的句子数量不对应
- 字幕对不上：字幕与音频完全不同步

---

## 二、解决方案

### 方案 A：自动生成数字人视频（推荐）

**流程**:
```
1. 生成 bridge_script.json
2. 调用 ComfyUI 生成新的 aiman.mp4（基于 bridge_script）
3. 对新的 aiman.mp4 做 ASR 生成 audio.json
4. compose_timeline.py 使用匹配的 bridge_script 和 audio.json
```

**优点**:
- 完全自动化
- 三者完全匹配
- 用户体验好

**缺点**:
- 需要集成 ComfyUI 或其他数字人生成服务
- 需要音频合成（TTS）
- 需要人物图片

**实现步骤**:

#### 1. 添加 TTS 服务
```javascript
// 在 handlers.js 中添加 TTS 函数
async function generateAudioFromText(text, outputPath) {
  // 调用 TTS 服务（如 Azure TTS, Google TTS, 或本地 TTS）
  // 生成音频文件
}
```

#### 2. 调用 ComfyUI 生成数字人
```javascript
// 在生成 bridge_script 后
const bridgeFullText = bridgeTexts.join('。');

// 生成音频
const bridgeAudioPath = path.join(taskDir, 'bridge_audio.wav');
await generateAudioFromText(bridgeFullText, bridgeAudioPath);

// 调用 ComfyUI 生成数字人视频
const newAimanPath = path.join(taskDir, 'aiman_generated.mp4');
await generateDigitalHuman({
  text: bridgeFullText,
  audioPath: bridgeAudioPath,
  imagePath: req.body.avatarImagePath, // 用户提供的人物图片
  outputPath: newAimanPath,
  baseUrl: req.body.comfyServerUrl
});

// 替换 aiman.mp4
fs.renameSync(newAimanPath, path.join(taskDir, 'aiman.mp4'));

// 对新的 aiman.mp4 做 ASR
await runPipelineScript([runAsrScript, '--input', 'aiman.mp4'], {
  sse, progress: 70, msg: '6.5/9: 正在识别数字人音频...', 
  cwd: taskDir, sendProgressEvent, runPythonScript
});
```

#### 3. 修改前端
```vue
// 在运行界面添加人物图片上传
<input type="file" accept="image/*" @change="handleAvatarImageUpload" />
```

---

### 方案 B：要求用户上传匹配的数字人视频（临时方案）

**流程**:
```
1. 先生成 bridge_script.json（策划阶段）
2. 显示补位文案给用户
3. 用户自行生成匹配的数字人视频
4. 用户上传匹配的 aiman.mp4
5. 继续运行流程
```

**优点**:
- 实现简单
- 不需要集成数字人生成服务

**缺点**:
- 用户体验差
- 需要用户手动生成数字人视频
- 流程复杂

**实现步骤**:

#### 1. 修改策划阶段
```javascript
// 在 handlePlanPipeline 中添加补位文案生成
await runPipelineScript([buildBridgeScript], { ... });

const bridgeScript = readJsonIfExists(path.join(taskDir, 'bridge_script.json'), {});
const bridgeFullText = [
  bridgeScript.intro,
  ...bridgeScript.bridges,
  bridgeScript.outro
].filter(t => t).join('。');

// 返回补位文案
res.json({
  success: true,
  outline,
  narrationPlan,
  videoScript,
  bridgeScript,
  bridgeFullText, // 显示给用户
  taskDir
});
```

#### 2. 修改前端
```vue
// 在策划结果中显示补位文案
<div v-if="bridgeFullText">
  <h3>数字人补位文案</h3>
  <p>{{ bridgeFullText }}</p>
  <p class="warning">
    请使用此文案生成数字人视频，然后在运行界面上传
  </p>
</div>
```

#### 3. 修改运行阶段
```javascript
// 在 handleRunPipeline 中添加验证
// 检查 aiman.mp4 的内容是否与 bridge_script 匹配
const aimanAsr = readJsonIfExists(path.join(taskDir, 'audio.json'), []);
const aimanText = aimanAsr.map(seg => seg.text).join('');
const similarity = calculateSimilarity(aimanText, bridgeFullText);

if (similarity < 0.8) {
  console.warn('[RunPipeline] ⚠️ 警告: 数字人视频内容与补位文案不匹配');
  if (sse) sendProgressEvent(sse, {
    type: 'warning',
    msg: '⚠️ 数字人视频内容与补位文案不匹配，可能导致字幕错位'
  });
}
```

---

### 方案 C：混合方案（推荐用于过渡期）

**流程**:
```
1. 生成 bridge_script.json
2. 检查是否有 ComfyUI 配置
3. 如果有：自动生成数字人视频（方案 A）
4. 如果没有：提示用户上传匹配的视频（方案 B）
```

**优点**:
- 灵活性高
- 支持自动和手动两种模式
- 平滑过渡

**实现步骤**:

```javascript
// 在 handleRunPipeline 中
const hasComfyUI = req.body.comfyServerUrl && req.body.avatarImagePath;

if (hasComfyUI) {
  // 方案 A：自动生成
  console.log('[RunPipeline] 使用 ComfyUI 自动生成数字人视频');
  await generateDigitalHumanWithComfyUI({ ... });
} else {
  // 方案 B：使用用户上传的视频
  console.log('[RunPipeline] 使用用户上传的数字人视频');
  console.log('[RunPipeline] ⚠️ 警告: 请确保视频内容与补位文案匹配');
  
  // 验证匹配度
  const aimanAsr = readJsonIfExists(path.join(taskDir, 'audio.json'), []);
  const aimanText = aimanAsr.map(seg => seg.text).join('');
  const similarity = calculateSimilarity(aimanText, bridgeFullText);
  
  if (similarity < 0.8) {
    if (sse) sendProgressEvent(sse, {
      type: 'warning',
      msg: `⚠️ 匹配度: ${(similarity * 100).toFixed(0)}%，建议重新上传匹配的视频`
    });
  }
}
```

---

## 三、推荐实施路径

### 短期（1-2天）
1. 实现方案 B：要求用户上传匹配的视频
2. 在策划阶段生成并显示补位文案
3. 添加匹配度验证和警告

### 中期（1周）
1. 集成 TTS 服务（Azure TTS 或 Google TTS）
2. 实现方案 A：自动生成数字人视频
3. 添加人物图片上传功能

### 长期（1个月）
1. 优化数字人生成质量
2. 支持多种 TTS 语音
3. 支持多种数字人风格
4. 缓存常用数字人视频

---

## 四、临时解决方案（立即可用）

在完整实现之前，可以使用以下临时方案：

### 1. 修改 compose_timeline.py
不使用 audio.json 的实际时长，而是根据 bridge_script 的字数估算时长：

```python
def compose_timeline(selected_segments, bridge_script, aiman_audio):
    """编排时间线"""
    timeline = []
    current_time = 0.0

    # 1. 开场数字人
    intro_text = bridge_script.get("intro", "")
    # 使用估算时长：每个字 0.3 秒
    intro_duration = len(intro_text) * 0.3
    # 不使用 aiman_audio，因为它可能不匹配

    timeline.append({
        "start_time": round(current_time, 2),
        "end_time": round(current_time + intro_duration, 2),
        "video_source": "aiman.mp4",
        "audio_source": "main",
        "subtitle_text": intro_text,
        "role": "intro"
    })
    current_time += intro_duration
    
    # ... 其他片段同理
```

### 2. 添加警告日志
在 handlers.js 中添加明确的警告：

```javascript
console.log('[RunPipeline] ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️');
console.log('[RunPipeline] 当前使用用户上传的 aiman.mp4');
console.log('[RunPipeline] 请确保视频内容与以下补位文案匹配：');
console.log(`[RunPipeline] ${bridgeFullText}`);
console.log('[RunPipeline] 否则会导致口播不匹配、字幕错位等问题');
```

### 3. 前端提示
在前端添加明确的提示：

```vue
<div class="warning-box">
  <h3>⚠️ 重要提示</h3>
  <p>请确保上传的数字人视频内容与补位文案完全匹配</p>
  <p>补位文案：{{ bridgeFullText }}</p>
  <p>如果不匹配，会导致字幕与口播不同步</p>
</div>
```

---

## 五、总结

**当前状态**: P0 问题，需要立即解决

**推荐方案**: 方案 C（混合方案）

**实施优先级**:
1. 立即：实现临时解决方案（估算时长 + 警告）
2. 短期：实现方案 B（用户上传匹配视频）
3. 中期：实现方案 A（自动生成数字人）

**预期效果**:
- 临时方案：减轻问题，但不能完全解决
- 方案 B：解决问题，但用户体验差
- 方案 A：完全解决问题，用户体验好

---

**文档生成时间**: 2026-04-02  
**状态**: 待实施
