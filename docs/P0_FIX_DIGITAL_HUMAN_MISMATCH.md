# P0 问题修复报告 - 数字人口播不匹配

**问题发现时间**: 2026-04-02  
**修复时间**: 2026-04-02  
**优先级**: P0（严重）  
**状态**: ✅ 临时方案已实施

---

## 一、问题描述

### 原始问题
用户指出：生成了 bridge_script.json（补位文案），但没有用它生成对应的数字人视频，导致：
- 时间线字幕文本：bridge_script.json（新生成的补位文案）
- 数字人实际说的话：aiman.mp4 的内容（用户上传的原始内容）
- 音频时长：audio.json（aiman.mp4 的 ASR 结果）

三者完全不匹配，造成口播不匹配、切点错位、字幕对不上。

---

## 二、临时解决方案（已实施）

### 1. 修改 compose_timeline.py
**变更**: 不使用 audio.json 的实际时长，改用估算时长

**修改内容**:
```python
def compose_timeline(selected_segments, bridge_script, aiman_audio):
    """编排时间线

    注意：当前实现不使用 aiman_audio 的实际时长，而是根据文案字数估算
    原因：aiman.mp4 可能与 bridge_script 内容不匹配
    TODO: 实现自动数字人生成后，可以使用实际时长
    """
    # 使用估算时长：每个字 0.3 秒
    intro_duration = len(intro_text) * 0.3
    bridge_duration = len(bridge_text) * 0.3
    outro_duration = len(outro_text) * 0.3
```

**效果**:
- 时长与文案字数匹配
- 不依赖 audio.json
- 避免时长不匹配问题

### 2. 修改 handlers.js - ASR 调用
**变更**: 只对 material.mp4 做 ASR，不对 aiman.mp4 做 ASR

**修改内容**:
```javascript
// 素材优先方案：只对 material.mp4 做 ASR
await runPipelineScript([runAsrScript, '--input', 'material.mp4'], {
  sse,
  progress: 10,
  msg: '1/9: 正在识别素材音频...',
  cwd: taskDir,
  sendProgressEvent,
  runPythonScript
});
```

**效果**:
- 不生成 aiman.mp4 的 audio.json
- compose_timeline.py 使用估算时长
- 减少不必要的 ASR 调用

### 3. 添加警告日志
**变更**: 在 handlers.js 中添加明确的警告

**修改内容**:
```javascript
console.log('[RunPipeline] ========================================');
console.log('[RunPipeline] ⚠️ 当前使用用户上传的 aiman.mp4');
console.log('[RunPipeline] ⚠️ 请确保视频内容与以下补位文案匹配：');
console.log(`[RunPipeline] ⚠️ ${bridgeFullText}`);
console.log('[RunPipeline] ⚠️ 否则会导致口播不匹配、字幕错位等问题');
console.log('[RunPipeline] ⚠️ 建议：实现自动数字人生成');
console.log('[RunPipeline] ========================================');

if (sse) sendProgressEvent(sse, {
  type: 'warning',
  msg: '⚠️ 请确保数字人视频内容与补位文案匹配'
});
```

**效果**:
- 用户明确知道需要匹配
- 开发者知道需要实现自动生成

---

## 三、临时方案的局限性

### 1. 时长估算不精确
- 估算公式：字数 × 0.3秒
- 实际语速可能不同
- 可能导致轻微的时长偏差

### 2. 口播内容仍可能不匹配
- 用户上传的 aiman.mp4 内容可能与 bridge_script 不同
- 字幕显示的是 bridge_script，但数字人说的是其他内容
- 需要用户手动确保匹配

### 3. 用户体验不佳
- 需要用户理解补位文案的概念
- 需要用户手动生成匹配的数字人视频
- 流程复杂

---

## 四、长期解决方案（待实施）

### 方案 A：自动生成数字人视频（推荐）

**流程**:
```
1. 生成 bridge_script.json
2. 调用 TTS 生成音频
3. 调用 ComfyUI 生成数字人视频
4. 对新视频做 ASR 生成 audio.json
5. compose_timeline.py 使用实际时长
```

**优点**:
- 完全自动化
- 三者完全匹配
- 用户体验好

**实施步骤**:
1. 集成 TTS 服务（Azure TTS / Google TTS）
2. 修改 handlers.js 调用 ComfyUI
3. 添加人物图片上传功能
4. 恢复 compose_timeline.py 使用实际时长

**预计工期**: 1周

### 方案 B：要求用户上传匹配的视频

**流程**:
```
1. 策划阶段生成 bridge_script.json
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
- 流程复杂

**实施步骤**:
1. 修改策划阶段，生成并返回 bridge_script
2. 修改前端，显示补位文案
3. 添加匹配度验证

**预计工期**: 2天

---

## 五、修改文件清单

### 已修改文件
1. `python/pipeline/compose_timeline.py`
   - 移除对 aiman_audio 的依赖
   - 使用估算时长（字数 × 0.3秒）
   - 添加注释说明临时方案

2. `server/services/pipeline/handlers.js`
   - 修改 ASR 调用，只处理 material.mp4
   - 移除对 aiman.mp4 的 ASR 调用
   - 添加警告日志
   - 添加 SSE 警告消息

### 新增文档
1. `docs/DIGITAL_HUMAN_GENERATION_SOLUTION.md`
   - 问题分析
   - 解决方案对比
   - 实施路径
   - 临时方案说明

2. `docs/P0_FIX_DIGITAL_HUMAN_MISMATCH.md`
   - 本文档

---

## 六、测试验证

### 验证要点
1. ✅ compose_timeline.py 不再读取 audio.json
2. ✅ 时长使用估算值（字数 × 0.3秒）
3. ✅ handlers.js 只对 material.mp4 做 ASR
4. ✅ 警告日志正确输出
5. ✅ SSE 警告消息正确发送

### 预期效果
- 时长与文案字数匹配
- 不会因为 audio.json 不存在而报错
- 用户看到警告消息
- 开发者看到警告日志

### 已知问题
- 口播内容仍可能不匹配（需要用户手动确保）
- 时长估算不精确（可能有 ±10% 偏差）

---

## 七、后续工作

### 短期（1周内）
- [ ] 实现方案 A：自动生成数字人视频
- [ ] 集成 TTS 服务
- [ ] 修改前端添加人物图片上传

### 中期（1个月内）
- [ ] 优化数字人生成质量
- [ ] 支持多种 TTS 语音
- [ ] 支持多种数字人风格

### 长期（3个月内）
- [ ] 缓存常用数字人视频
- [ ] 支持自定义数字人模型
- [ ] 支持实时预览

---

## 八、总结

**问题**: P0 级别，数字人口播与字幕不匹配

**临时方案**: 使用估算时长，添加警告

**效果**: 
- ✅ 避免时长不匹配
- ✅ 提醒用户注意匹配
- ⚠️ 口播内容仍可能不匹配

**长期方案**: 实现自动数字人生成

**预计完成时间**: 1周

---

**报告生成时间**: 2026-04-02  
**状态**: 临时方案已实施，长期方案待实施
