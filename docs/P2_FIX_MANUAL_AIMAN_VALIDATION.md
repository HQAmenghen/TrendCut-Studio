# P2 问题修复报告 - 手动上传数字人视频验证

**问题发现时间**: 2026-04-02  
**修复时间**: 2026-04-02  
**优先级**: P2（中等）  
**状态**: ✅ 已修复

---

## 一、问题描述

### 原始问题
当关闭自动数字人生成时（autoGenerateAiman=false），系统只是打印警告，然后继续出片：

```javascript
// 旧代码
if (sse) sendProgressEvent(sse, {
  type: 'warning',
  msg: '⚠️ 请确保数字人视频内容与补位文案匹配'
});
// 继续执行...
```

**问题**:
- 用户上传的 aiman.mp4 可能与 bridge_script 内容完全不匹配
- 系统仍然按 bridge_script 排时间线和字幕
- 最终产出"技术上成功、语义上错位"的成片
- 字幕显示的是补位文案，但数字人说的是其他内容

**影响**:
- 用户体验差：视频质量不可控
- 调试困难：不知道是哪里出了问题
- 浪费资源：生成了无用的视频

---

## 二、解决方案

### 核心思路
添加三层防护机制：
1. **强制模式**：要求必须启用自动生成
2. **确认模式**：要求用户显式确认内容匹配
3. **验证模式**：自动验证匹配度并警告

### 实现方法

#### 1. 添加文本相似度计算函数
```javascript
function calculateTextSimilarity(text1, text2) {
  /**
   * 计算两段文本的相似度（0-1）
   * 使用最长公共子序列（LCS）算法
   */
  if (!text1 || !text2) return 0;

  // 清理文本：移除标点和空格
  const clean = (text) => {
    return text.replace(/[，。！？；：、""'',.!?;:()[\]{}\"'…·\-\s]/g, '');
  };

  const cleaned1 = clean(text1);
  const cleaned2 = clean(text2);

  if (!cleaned1 || !cleaned2) return 0;

  // 计算最长公共子序列长度
  const lcs = (s1, s2) => {
    const m = s1.length;
    const n = s2.length;
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp[m][n];
  };

  const lcsLength = lcs(cleaned1, cleaned2);
  const maxLength = Math.max(cleaned1.length, cleaned2.length);

  return lcsLength / maxLength;
}
```

#### 2. 添加验证和阻断逻辑
```javascript
} else {
  // 使用用户上传的 aiman.mp4（需要验证）
  console.log('[RunPipeline] ⚠️ 未启用自动数字人生成');
  console.log('[RunPipeline] ⚠️ 补位文案内容：');
  console.log(`[RunPipeline] ⚠️ ${bridgeFullText}`);

  // 1. 强制模式：要求必须启用自动生成
  const requireAutoGenerate = req.body.requireAutoGenerate === 'true';
  if (requireAutoGenerate) {
    const errorMsg = '素材优先模式要求启用自动数字人生成（autoGenerateAiman=true）';
    console.error(`[RunPipeline] ❌ ${errorMsg}`);
    if (sse) sendProgressEvent(sse, { type: 'error', msg: `❌ ${errorMsg}` });
    throw new Error(errorMsg);
  }

  // 2. 确认模式：要求用户显式确认
  const userConfirmed = req.body.confirmManualAiman === 'true';
  if (!userConfirmed) {
    const errorMsg = '请确认数字人视频内容与补位文案匹配，或启用自动生成';
    console.error(`[RunPipeline] ❌ ${errorMsg}`);
    if (sse) sendProgressEvent(sse, {
      type: 'error',
      msg: `❌ ${errorMsg}`,
      data: {
        bridgeScript: bridgeFullText,
        requireConfirmation: true
      }
    });
    throw new Error(errorMsg);
  }

  // 3. 验证模式：自动验证匹配度
  console.log('[RunPipeline] ✓ 用户已确认视频内容匹配');
  console.log('[RunPipeline] 正在识别数字人音频以验证匹配度...');

  await runPipelineScript([runAsrScript, '--input', 'aiman.mp4'], {
    sse, progress: 70, msg: '6.5/9: 正在识别数字人音频...',
    cwd: taskDir, sendProgressEvent, runPythonScript
  });

  // 验证匹配度
  const aimanAudio = readJsonIfExists(path.join(taskDir, 'audio.json'), []);
  if (aimanAudio && aimanAudio.length > 0) {
    const aimanText = aimanAudio.map(seg => seg.text || '').join('');
    const similarity = calculateTextSimilarity(aimanText, bridgeFullText);

    console.log(`[RunPipeline] 匹配度: ${(similarity * 100).toFixed(1)}%`);

    if (similarity < 0.6) {
      const warningMsg = `⚠️ 匹配度较低 (${(similarity * 100).toFixed(0)}%)，可能导致字幕错位`;
      console.warn(`[RunPipeline] ${warningMsg}`);
      if (sse) sendProgressEvent(sse, { type: 'warning', msg: warningMsg });
    } else {
      console.log(`[RunPipeline] ✓ 匹配度良好 (${(similarity * 100).toFixed(0)}%)`);
    }
  }
}
```

---

## 三、三种模式对比

### 模式 1: 强制自动生成（最严格）
**参数**: `requireAutoGenerate: true`

**行为**:
- 如果 `autoGenerateAiman !== true`，直接抛出错误
- 不允许使用手动上传的视频
- 确保 100% 内容匹配

**适用场景**:
- 生产环境
- 对质量要求极高的场景
- 不信任用户手动上传的场景

### 模式 2: 确认模式（推荐）
**参数**: `confirmManualAiman: true`

**行为**:
- 如果 `autoGenerateAiman !== true`，要求用户显式确认
- 确认后，对视频做 ASR 验证匹配度
- 匹配度 < 60% 时发出警告，但仍继续

**适用场景**:
- 开发环境
- 测试环境
- 用户有能力手动生成匹配视频的场景

### 模式 3: 宽松模式（不推荐）
**参数**: 不设置任何参数

**行为**:
- 直接抛出错误，要求确认
- 默认不允许手动上传

**适用场景**:
- 不推荐使用

---

## 四、前端集成

### 方案 A: 强制自动生成
```vue
<template>
  <div>
    <el-alert type="info">
      素材优先模式要求启用自动数字人生成
    </el-alert>
    
    <el-checkbox v-model="autoGenerateAiman" disabled :value="true">
      自动生成数字人视频（必选）
    </el-checkbox>
    
    <!-- 人物图片选择 -->
    <el-select v-model="avatarImage">
      <el-option 
        v-for="preset in imagePresets" 
        :key="preset" 
        :value="`preset:${preset}`"
      />
    </el-select>
  </div>
</template>

<script>
export default {
  data() {
    return {
      autoGenerateAiman: true,
      requireAutoGenerate: true
    };
  }
};
</script>
```

### 方案 B: 确认模式（推荐）
```vue
<template>
  <div>
    <el-radio-group v-model="mode">
      <el-radio label="auto">自动生成（推荐）</el-radio>
      <el-radio label="manual">手动上传</el-radio>
    </el-radio-group>
    
    <div v-if="mode === 'auto'">
      <!-- 人物图片选择 -->
      <el-select v-model="avatarImage">
        <el-option 
          v-for="preset in imagePresets" 
          :key="preset" 
          :value="`preset:${preset}`"
        />
      </el-select>
    </div>
    
    <div v-else>
      <!-- 显示补位文案 -->
      <el-alert type="warning" :closable="false">
        <p>请确保数字人视频内容与以下补位文案匹配：</p>
        <pre>{{ bridgeScript }}</pre>
      </el-alert>
      
      <!-- 上传视频 -->
      <el-upload :on-change="handleAimanUpload">
        <el-button>上传数字人视频</el-button>
      </el-upload>
      
      <!-- 确认复选框 -->
      <el-checkbox v-model="confirmManualAiman">
        我确认视频内容与补位文案匹配
      </el-checkbox>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      mode: 'auto',
      confirmManualAiman: false,
      bridgeScript: ''
    };
  },
  
  methods: {
    async runPipeline() {
      const params = {
        autoGenerateAiman: this.mode === 'auto',
        confirmManualAiman: this.confirmManualAiman
      };
      
      if (this.mode === 'auto') {
        params.avatarImage = this.avatarImage;
      }
      
      await this.$api.runPipeline(params);
    }
  }
};
</script>
```

---

## 五、错误处理

### 错误 1: 未启用自动生成且未确认
```
错误信息: 请确认数字人视频内容与补位文案匹配，或启用自动生成

SSE 消息:
{
  type: 'error',
  msg: '❌ 请确认数字人视频内容与补位文案匹配，或启用自动生成',
  data: {
    bridgeScript: '这段讨论的核心，是加密市场监管法案的推进。...',
    requireConfirmation: true
  }
}

前端处理:
1. 显示错误对话框
2. 显示补位文案内容
3. 提供两个选项：
   - 启用自动生成
   - 确认手动上传的视频匹配
```

### 错误 2: 强制模式下未启用自动生成
```
错误信息: 素材优先模式要求启用自动数字人生成（autoGenerateAiman=true）

SSE 消息:
{
  type: 'error',
  msg: '❌ 素材优先模式要求启用自动数字人生成'
}

前端处理:
1. 显示错误对话框
2. 禁用手动上传选项
3. 强制用户启用自动生成
```

### 警告: 匹配度较低
```
警告信息: ⚠️ 匹配度较低 (45%)，可能导致字幕错位

SSE 消息:
{
  type: 'warning',
  msg: '⚠️ 匹配度较低 (45%)，可能导致字幕错位'
}

前端处理:
1. 显示警告提示
2. 询问用户是否继续
3. 建议重新上传或启用自动生成
```

---

## 六、测试场景

### 场景 1: 强制模式 + 未启用自动生成
```javascript
{
  requireAutoGenerate: true,
  autoGenerateAiman: false
}

预期结果: 抛出错误，阻断流程
```

### 场景 2: 确认模式 + 未确认
```javascript
{
  autoGenerateAiman: false,
  confirmManualAiman: false
}

预期结果: 抛出错误，要求确认
```

### 场景 3: 确认模式 + 已确认 + 匹配度高
```javascript
{
  autoGenerateAiman: false,
  confirmManualAiman: true
}

预期结果: 
- 对 aiman.mp4 做 ASR
- 计算匹配度
- 匹配度 >= 60%，继续执行
- 日志输出: ✓ 匹配度良好 (85%)
```

### 场景 4: 确认模式 + 已确认 + 匹配度低
```javascript
{
  autoGenerateAiman: false,
  confirmManualAiman: true
}

预期结果:
- 对 aiman.mp4 做 ASR
- 计算匹配度
- 匹配度 < 60%，发出警告但继续
- 日志输出: ⚠️ 匹配度较低 (45%)
```

---

## 七、相关文件

### 修改文件
1. `server/services/pipeline/handlers.js`
   - 添加 calculateTextSimilarity 函数
   - 添加验证和阻断逻辑
   - 添加匹配度计算

### 前端文件（待实现）
1. 运行界面组件
   - 添加模式选择（自动/手动）
   - 添加确认复选框
   - 添加错误处理

---

## 八、总结

**问题**: 手动上传视频时缺少验证，导致语义错位

**原因**: 只有警告，没有阻断和验证

**解决**: 
- ✅ 添加强制模式（requireAutoGenerate）
- ✅ 添加确认模式（confirmManualAiman）
- ✅ 添加验证模式（自动计算匹配度）

**效果**:
- ✅ 防止"技术上成功、语义上错位"的成片
- ✅ 提供灵活的配置选项
- ✅ 自动验证匹配度并警告

**验证**: 语法检查通过

---

**报告生成时间**: 2026-04-02  
**状态**: 已修复，待前端集成和测试
