# 数字人生成集成方案

**时间**: 2026-04-02  
**目标**: 在素材优先链路中集成现有的数字人生成功能

---

## 一、现状分析

### 已有功能
- ✅ handleGenerate 函数可以生成数字人视频
- ✅ ComfyUI 工作流已配置
- ✅ 支持音频预设和图片预设

### 缺少功能
- ❌ TTS（文本转语音）服务
- ❌ 在 handleRunPipeline 中调用数字人生成的逻辑

---

## 二、集成方案

### 方案 A：集成 TTS + 复用 handleGenerate 逻辑（推荐）

**流程**:
```
1. 生成 bridge_script.json
2. 使用 TTS 将 bridgeFullText 转为音频
3. 调用 ComfyUI 生成数字人视频（复用 handleGenerate 逻辑）
4. 替换 aiman.mp4
5. 对新的 aiman.mp4 做 ASR
6. compose_timeline.py 使用实际时长
```

**需要的参数**:
- text: bridgeFullText（已有）
- audio: TTS 生成的音频（需要实现）
- image: 用户提供的人物图片（需要前端支持）
- baseUrl: ComfyUI 服务地址（需要前端传递）

**实施步骤**:

#### 1. 添加 TTS 服务
有多种选择：

**选项 1: Azure TTS（推荐）**
```javascript
const sdk = require('microsoft-cognitiveservices-speech-sdk');

async function generateAudioWithAzureTTS(text, outputPath) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
  );
  speechConfig.speechSynthesisVoiceName = 'zh-CN-XiaoxiaoNeural'; // 中文女声
  
  const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputPath);
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
  
  return new Promise((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      result => {
        synthesizer.close();
        resolve(outputPath);
      },
      error => {
        synthesizer.close();
        reject(error);
      }
    );
  });
}
```

**选项 2: Google TTS**
```javascript
const textToSpeech = require('@google-cloud/text-to-speech');

async function generateAudioWithGoogleTTS(text, outputPath) {
  const client = new textToSpeech.TextToSpeechClient();
  
  const request = {
    input: { text },
    voice: { languageCode: 'zh-CN', name: 'zh-CN-Wavenet-A' },
    audioConfig: { audioEncoding: 'MP3' }
  };
  
  const [response] = await client.synthesizeSpeech(request);
  fs.writeFileSync(outputPath, response.audioContent, 'binary');
  return outputPath;
}
```

**选项 3: Edge TTS（免费）**
```javascript
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function generateAudioWithEdgeTTS(text, outputPath) {
  // 需要安装: pip install edge-tts
  const command = `edge-tts --text "${text}" --voice zh-CN-XiaoxiaoNeural --write-media "${outputPath}"`;
  await execPromise(command);
  return outputPath;
}
```

#### 2. 提取数字人生成逻辑
创建一个独立的函数：

```javascript
async function generateDigitalHuman({
  text,
  audioPath,
  imagePath,
  outputPath,
  baseUrl,
  clientId,
  sse,
  trimSeconds = 0,
  maxDuration = 60
}) {
  // 上传音频和图片到 ComfyUI
  const remoteAudioName = await uploadToComfyUI(audioPath, baseUrl);
  const remoteImageName = await uploadToComfyUI(imagePath, baseUrl);
  
  // 监听进度
  const ws = listenComfyUIProgress({
    clientId,
    baseUrl,
    onProgress: (percent) => {
      if (sse) sendProgressEvent(sse, { 
        type: 'progress', 
        percent: 65 + percent * 0.1, // 65-75%
        msg: `正在生成数字人视频 (${percent}%)...` 
      });
    },
    onStatus: (message) => {
      if (sse) sendProgressEvent(sse, { type: 'status', msg: message });
    }
  });
  
  // 读取工作流
  const workflow = readWorkflow(workflowPath);
  workflow['278'].inputs.text = text;
  workflow['6'].inputs.audio = remoteAudioName;
  workflow['180'].inputs.image = remoteImageName;
  
  const randomSeed = Math.floor(Math.random() * 2147483647);
  workflow['27'].inputs.seed = randomSeed;
  workflow['278'].inputs.seed = randomSeed;
  workflow['50'].inputs.expression = `max(1, (a + (${trimSeconds})) * 25 + 1)`;
  
  const m = Math.floor(maxDuration / 60);
  const s = Math.floor(maxDuration % 60);
  workflow['7'].inputs.end_time = `${m}:${s.toString().padStart(2, '0')}`;
  
  // 提交任务
  const promptRes = await axios.post(`${baseUrl}/prompt`, {
    prompt: workflow,
    client_id: clientId
  }, {
    httpsAgent: insecureHttpsAgent
  });
  
  const promptId = promptRes.data.prompt_id;
  const videoUrl = await waitForCompletion(promptId, baseUrl);
  
  // 下载视频
  await downloadInputVideo(videoUrl, outputPath);
  
  if (ws) ws.close();
  return outputPath;
}
```

#### 3. 在 handleRunPipeline 中集成
```javascript
// Phase 3: 数字人生成（使用补位文案）
const bridgeScriptPath = path.join(taskDir, 'bridge_script.json');
const bridgeScript = readJsonIfExists(bridgeScriptPath, {});

const bridgeTexts = [
  bridgeScript.intro || '',
  ...(bridgeScript.bridges || []),
  bridgeScript.outro || ''
].filter(t => t);
const bridgeFullText = bridgeTexts.join('。');

console.log(`[RunPipeline] 补位文案: ${bridgeFullText}`);

// 检查是否启用自动数字人生成
const autoGenerateAiman = req.body.autoGenerateAiman === 'true';
const comfyServerUrl = req.body.comfyServerUrl || defaultComfyBaseUrl;
const avatarImagePath = req.body.avatarImagePath; // 用户提供的人物图片路径或预设名

if (autoGenerateAiman && avatarImagePath) {
  console.log('[RunPipeline] 开始自动生成数字人视频');
  if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在生成数字人音频...' });
  
  // 1. 生成音频
  const bridgeAudioPath = path.join(taskDir, 'bridge_audio.wav');
  await generateAudioWithEdgeTTS(bridgeFullText, bridgeAudioPath);
  
  if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在生成数字人视频...' });
  
  // 2. 生成数字人视频
  const newAimanPath = path.join(taskDir, 'aiman_generated.mp4');
  
  // 解析图片路径（支持预设或上传）
  let imagePath;
  if (avatarImagePath.startsWith('preset:')) {
    const presetName = avatarImagePath.replace('preset:', '');
    imagePath = path.join(baseDir, 'public/presets/image', presetName);
  } else {
    imagePath = avatarImagePath; // 用户上传的图片路径
  }
  
  await generateDigitalHuman({
    text: bridgeFullText,
    audioPath: bridgeAudioPath,
    imagePath: imagePath,
    outputPath: newAimanPath,
    baseUrl: comfyServerUrl,
    clientId: clientId,
    sse: sse,
    maxDuration: 60
  });
  
  // 3. 替换 aiman.mp4
  const aimanPath = path.join(taskDir, 'aiman.mp4');
  if (fs.existsSync(aimanPath)) {
    fs.unlinkSync(aimanPath);
  }
  fs.renameSync(newAimanPath, aimanPath);
  
  console.log('[RunPipeline] 数字人视频生成完成');
  if (sse) sendProgressEvent(sse, { type: 'status', msg: '数字人视频生成完成' });
  
  // 4. 对新的 aiman.mp4 做 ASR
  if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在识别数字人音频...' });
  await runPipelineScript([runAsrScript, '--input', 'aiman.mp4'], {
    sse,
    progress: 70,
    msg: '6.5/9: 正在识别数字人音频...',
    cwd: taskDir,
    sendProgressEvent,
    runPythonScript
  });
  
  // 5. 恢复 compose_timeline.py 使用实际时长
  // （修改 compose_timeline.py，恢复读取 audio.json）
  
} else {
  // 使用用户上传的 aiman.mp4（临时方案）
  console.log('[RunPipeline] ⚠️ 使用用户上传的 aiman.mp4');
  console.log('[RunPipeline] ⚠️ 请确保视频内容与补位文案匹配');
  if (sse) sendProgressEvent(sse, {
    type: 'warning',
    msg: '⚠️ 请确保数字人视频内容与补位文案匹配'
  });
}
```

#### 4. 修改前端
在运行界面添加选项：

```vue
<template>
  <div>
    <!-- 自动生成数字人选项 -->
    <el-checkbox v-model="autoGenerateAiman">
      自动生成数字人视频（推荐）
    </el-checkbox>
    
    <div v-if="autoGenerateAiman">
      <!-- ComfyUI 服务地址 -->
      <el-input 
        v-model="comfyServerUrl" 
        placeholder="ComfyUI 服务地址"
      />
      
      <!-- 人物图片选择 -->
      <el-radio-group v-model="avatarImageMode">
        <el-radio label="preset">使用预设</el-radio>
        <el-radio label="upload">上传图片</el-radio>
      </el-radio-group>
      
      <el-select 
        v-if="avatarImageMode === 'preset'" 
        v-model="avatarImagePreset"
      >
        <el-option 
          v-for="preset in imagePresets" 
          :key="preset" 
          :value="preset"
        />
      </el-select>
      
      <el-upload 
        v-if="avatarImageMode === 'upload'"
        :on-change="handleAvatarImageUpload"
      />
    </div>
    
    <div v-else>
      <!-- 上传数字人视频 -->
      <el-upload 
        :on-change="handleAimanUpload"
      >
        <el-button>上传数字人视频</el-button>
      </el-upload>
      <p class="warning">
        请确保视频内容与补位文案匹配
      </p>
    </div>
  </div>
</template>
```

---

### 方案 B：使用音频预设（快速方案）

如果暂时不想集成 TTS，可以：
1. 让用户提供一个通用的音频文件（如"欢迎观看"）
2. 使用这个音频生成数字人视频
3. 但字幕仍然使用 bridge_script

**问题**: 口播与字幕不匹配（但至少时长是对的）

---

## 三、推荐实施路径

### 立即（今天）
1. 安装 edge-tts: `pip install edge-tts`
2. 实现 generateAudioWithEdgeTTS 函数
3. 提取 generateDigitalHuman 函数
4. 在 handleRunPipeline 中集成

### 短期（明天）
1. 修改前端，添加自动生成选项
2. 测试完整流程
3. 恢复 compose_timeline.py 使用实际时长

### 中期（本周）
1. 优化 TTS 语音质量
2. 支持多种语音选择
3. 添加预览功能

---

## 四、代码清单

### 需要修改的文件
1. `server/services/pipeline/handlers.js`
   - 添加 TTS 函数
   - 提取 generateDigitalHuman 函数
   - 在 handleRunPipeline 中集成

2. `python/pipeline/compose_timeline.py`
   - 恢复使用 audio.json（当自动生成时）
   - 保留估算时长作为后备

3. 前端文件（待确定）
   - 添加自动生成选项
   - 添加人物图片上传

### 需要安装的依赖
```bash
# Edge TTS（免费）
pip install edge-tts

# 或 Azure TTS
npm install microsoft-cognitiveservices-speech-sdk

# 或 Google TTS
npm install @google-cloud/text-to-speech
```

---

## 五、总结

**现状**: 已有数字人生成功能，但缺少 TTS

**方案**: 集成 Edge TTS（免费）+ 复用现有逻辑

**工作量**: 1-2 小时（核心功能）

**效果**: 完全解决 P0 问题，实现自动化

---

**文档生成时间**: 2026-04-02  
**状态**: 待实施
