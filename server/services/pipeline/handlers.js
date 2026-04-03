const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const { spawnSync } = require('child_process');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function calculateTextSimilarity(text1, text2) {
  /**
   * 计算两段文本的相似度（0-1）
   * 使用简单的字符级别相似度算法
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

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeSourceUrl(req, inputUrl) {
  const raw = String(inputUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    return `${req.protocol}://${req.get('host')}${raw}`;
  }
  throw new Error('仅支持 http/https 或站内相对路径素材地址');
}

async function downloadInputVideo(url, destinationPath) {
  ensureParentDir(destinationPath);
  const response = await axios({
    method: 'get',
    url,
    responseType: 'stream',
    maxRedirects: 5,
    timeout: 120000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    httpsAgent: insecureHttpsAgent
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function runPipelineScript(scriptArgs, options) {
  const { sse, progress, msg, cwd, sendProgressEvent, runPythonScript } = options;
  if (sse) sendProgressEvent(sse, { type: 'progress', percent: progress, msg });

  return runPythonScript(scriptArgs[0], scriptArgs.slice(1), {
    cwd,
    onStdout: (chunk) => {
      const lastLine = chunk.toString().trim().split('\n').pop();
      if (sse && lastLine) sendProgressEvent(sse, { type: 'status', msg: lastLine });
    },
    onStderr: (chunk) => {
      const errStr = chunk.toString();
      console.error(`[${scriptArgs[0]} stderr]: ${errStr}`);
      if (sse) sendProgressEvent(sse, { type: 'status', msg: `⚠️ ${errStr.trim().split('\n').pop()}` });
    }
  });
}

function normalizeSpeechText(text) {
  return String(text || '')
    .replace(/[，。！？；：、""'',.!?;:()[\]{}"'…·\-\s]/g, '')
    .trim()
    .toLowerCase();
}

function getMediaDurationSeconds(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ], { encoding: 'utf8' });
  if (probe.status !== 0) return 0;
  return Number.parseFloat(String(probe.stdout || '').trim()) || 0;
}

function pickBestSequentialWindow(expectedText, audioSegments, startIndex) {
  const normalizedExpected = normalizeSpeechText(expectedText);
  if (!normalizedExpected || !Array.isArray(audioSegments) || startIndex >= audioSegments.length) {
    return null;
  }

  let best = null;
  for (let i = startIndex; i < audioSegments.length; i += 1) {
    let candidateText = '';
    for (let j = i; j < Math.min(audioSegments.length, i + 3); j += 1) {
      candidateText += normalizeSpeechText(audioSegments[j]?.text || '');
      if (!candidateText) continue;
      const similarity = calculateTextSimilarity(normalizedExpected, candidateText);
      if (!best || similarity > best.similarity) {
        best = { similarity, startIndex: i, endIndex: j, text: candidateText };
      }
      if (similarity >= 0.92) return best;
    }
    if (best && best.similarity >= 0.82) return best;
  }
  return best;
}

function analyzeGeneratedAvatarQuality({ bridgeTexts, aimanAudio, aimanPath }) {
  const audioSegments = Array.isArray(aimanAudio) ? aimanAudio : [];
  const recognizedText = audioSegments.map(seg => String(seg.text || '').trim()).filter(Boolean).join('。');
  const expectedText = bridgeTexts.join('。');
  const duration = getMediaDurationSeconds(aimanPath);

  const sentenceReports = [];
  let searchIndex = 0;
  for (const text of bridgeTexts) {
    const best = pickBestSequentialWindow(text, audioSegments, searchIndex);
    if (best) {
      sentenceReports.push({
        expected: text,
        similarity: Number(best.similarity.toFixed(3)),
        startIndex: best.startIndex,
        endIndex: best.endIndex
      });
      searchIndex = Math.max(searchIndex, best.endIndex + 1);
    } else {
      sentenceReports.push({
        expected: text,
        similarity: 0,
        startIndex: -1,
        endIndex: -1
      });
    }
  }

  let leadingSilence = 0;
  let trailingSilence = 0;
  let maxInternalGap = 0;
  if (audioSegments.length > 0) {
    leadingSilence = Math.max(0, Number(audioSegments[0].start || 0));
    trailingSilence = Math.max(0, duration - Number(audioSegments[audioSegments.length - 1].end || 0));
    for (let i = 1; i < audioSegments.length; i += 1) {
      const prevEnd = Number(audioSegments[i - 1].end || 0);
      const currStart = Number(audioSegments[i].start || prevEnd);
      maxInternalGap = Math.max(maxInternalGap, Math.max(0, currStart - prevEnd));
    }
  } else {
    trailingSilence = duration;
  }

  const overallSimilarity = calculateTextSimilarity(expectedText, recognizedText);
  const minSentenceSimilarity = sentenceReports.length
    ? Math.min(...sentenceReports.map(item => item.similarity))
    : 0;

  const shouldRetry =
    audioSegments.length === 0 ||
    overallSimilarity < 0.72 ||
    minSentenceSimilarity < 0.5 ||
    maxInternalGap > 0.8;

  const shouldTrim =
    audioSegments.length > 0 &&
    (leadingSilence > 0.12 || trailingSilence > 0.25);

  return {
    expectedText,
    recognizedText,
    overallSimilarity: Number(overallSimilarity.toFixed(3)),
    minSentenceSimilarity: Number(minSentenceSimilarity.toFixed(3)),
    sentenceReports,
    duration: Number(duration.toFixed(3)),
    leadingSilence: Number(leadingSilence.toFixed(3)),
    trailingSilence: Number(trailingSilence.toFixed(3)),
    maxInternalGap: Number(maxInternalGap.toFixed(3)),
    shouldRetry,
    shouldTrim
  };
}

function trimAvatarSilence({ aimanPath, aimanAudio }) {
  const audioSegments = Array.isArray(aimanAudio) ? aimanAudio : [];
  if (!fs.existsSync(aimanPath) || audioSegments.length === 0) {
    return { trimmed: false, reason: 'missing_input' };
  }

  const duration = getMediaDurationSeconds(aimanPath);
  const trimStart = Math.max(0, Number(audioSegments[0].start || 0) - 0.02);
  const trimEnd = Math.min(duration, Number(audioSegments[audioSegments.length - 1].end || duration) + 0.06);
  if (trimEnd - trimStart < 0.8) {
    return { trimmed: false, reason: 'too_short_after_trim' };
  }
  if (trimStart <= 0.05 && duration - trimEnd <= 0.12) {
    return { trimmed: false, reason: 'no_meaningful_silence' };
  }

  const tempPath = aimanPath.replace(/\.mp4$/i, '.trimmed.mp4');
  const result = spawnSync('ffmpeg', [
    '-y',
    '-ss', trimStart.toFixed(3),
    '-to', trimEnd.toFixed(3),
    '-i', aimanPath,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    tempPath
  ], { encoding: 'utf8' });

  if (result.status !== 0 || !fs.existsSync(tempPath)) {
    return {
      trimmed: false,
      reason: 'ffmpeg_failed',
      error: (result.stderr || '').trim().split('\n').pop()
    };
  }

  fs.copyFileSync(tempPath, aimanPath);
  fs.unlinkSync(tempPath);
  return {
    trimmed: true,
    trimStart: Number(trimStart.toFixed(3)),
    trimEnd: Number(trimEnd.toFixed(3))
  };
}

function createPipelineHandlers(deps) {
  const {
    baseDir,
    pipelineDir,
    defaultComfyBaseUrl,
    getProgressClient,
    sendProgressEvent,
    uploadToComfyUI,
    listenComfyUIProgress,
    waitForCompletion,
    applyWorkflowConfig,
    readWorkflow,
    workflowPath,
    createRuntimeJobDir,
    readJsonIfExists,
    writeMediaMetadata,
    buildFallbackTitleFromSubtitles,
    generateHotTitle,
    writeJsonFile,
    runPythonScript,
    triggerAutoReview
  } = deps;

  const runtimeJobsRoot = path.join(baseDir, 'data', 'uploads', 'runtime_jobs');

  function resolveSafeTaskDir(taskDir) {
    const resolvedRuntimeRoot = path.resolve(runtimeJobsRoot);
    const resolvedTaskDir = path.resolve(String(taskDir || ''));
    if (!resolvedTaskDir.startsWith(resolvedRuntimeRoot + path.sep) && resolvedTaskDir !== resolvedRuntimeRoot) {
      return null;
    }
    return resolvedTaskDir;
  }

  function readPlanTaskPayload(taskDir) {
    if (!taskDir || !fs.existsSync(taskDir)) return null;
    const outline = readJsonIfExists(path.join(taskDir, 'content_outline.json'), null);
    const narrationPlan = readJsonIfExists(path.join(taskDir, 'narration_plan.json'), null);
    const videoScript = readJsonIfExists(path.join(taskDir, 'video_script.json'), null);
    if (!outline || !narrationPlan || !videoScript) return null;
    return {
      success: true,
      outline,
      narrationPlan,
      videoScript,
      narrationText: String(narrationPlan?.full_text || '').trim(),
      taskDir
    };
  }

  function findLatestSuccessfulPlanTask() {
    if (!fs.existsSync(runtimeJobsRoot)) return null;
    const entries = fs.readdirSync(runtimeJobsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('plan_'))
      .map((entry) => {
        const fullPath = path.join(runtimeJobsRoot, entry.name);
        const stats = fs.statSync(fullPath);
        return {
          fullPath,
          mtimeMs: stats.mtimeMs
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const entry of entries) {
      const payload = readPlanTaskPayload(entry.fullPath);
      if (payload) return payload;
    }
    return null;
  }

  async function handleGenerate(req, res) {
    let ws = null;
    try {
      const text = req.body.text;
      const clientId = req.body.clientId;
      const baseUrl = req.body.serverUrl || defaultComfyBaseUrl;
      const trimSeconds = parseFloat(req.body.trimSeconds || 0);
      const maxDuration = parseFloat(req.body.maxDuration || 10);

      const useAudioPreset = req.body.useAudioPreset === 'true';
      const useImagePreset = req.body.useImagePreset === 'true';

      let audioPath;
      let imagePath;

      if (useAudioPreset) {
        if (!req.body.audioPreset) return res.status(400).json({ error: '未选择音频预设' });
        audioPath = path.join(baseDir, 'public/presets/audio', req.body.audioPreset);
        if (!fs.existsSync(audioPath)) return res.status(400).json({ error: '音频预设文件不存在，请检查 /public/presets/audio 目录' });
      } else {
        if (!req.files.audio) return res.status(400).json({ error: '请上传音频文件' });
        audioPath = req.files.audio[0].path;
      }

      if (useImagePreset) {
        if (!req.body.imagePreset) return res.status(400).json({ error: '未选择人物照片预设' });
        imagePath = path.join(baseDir, 'public/presets/image', req.body.imagePreset);
        if (!fs.existsSync(imagePath)) return res.status(400).json({ error: '人物预设文件不存在，请检查 /public/presets/image 目录' });
      } else {
        if (!req.files.image) return res.status(400).json({ error: '请上传人物图片' });
        imagePath = req.files.image[0].path;
      }

      if (!text || !clientId) {
        return res.status(400).json({ error: '请提供完整的文字内容' });
      }

      const sse = getProgressClient(clientId);
      if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在把照片和声音上传到云端...' });

      const remoteAudioName = await uploadToComfyUI(audioPath, baseUrl);
      const remoteImageName = await uploadToComfyUI(imagePath, baseUrl);

      ws = listenComfyUIProgress({
        clientId,
        baseUrl,
        onProgress: (percent) => {
          const sseClient = getProgressClient(clientId);
          if (sseClient) sendProgressEvent(sseClient, { type: 'progress', percent, msg: '正在努力渲染视频帧...' });
        },
        onStatus: (message) => {
          const sseClient = getProgressClient(clientId);
          if (sseClient) sendProgressEvent(sseClient, { type: 'status', msg: message });
        }
      });

      if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在组装AI指令，准备开始施法...' });
      const workflow = readWorkflow(workflowPath);
      const workflowConfig = req.body.workflowConfig ? JSON.parse(req.body.workflowConfig) : null;
      if (workflowConfig) {
        applyWorkflowConfig(workflow, workflowConfig);
      }

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

      const promptRes = await axios.post(`${baseUrl}/prompt`, {
        prompt: workflow,
        client_id: clientId
      }, {
        httpsAgent: insecureHttpsAgent
      });

      const promptId = promptRes.data.prompt_id;
      const videoUrl = await waitForCompletion(promptId, baseUrl);
      const taskDir = createRuntimeJobDir('generate');
      const localSourcePath = path.join(taskDir, 'generated_avatar.mp4');
      const publicDir = path.join(baseDir, 'public', 'generated_avatar');
      const publicFileName = `generated_avatar_${path.basename(taskDir)}.mp4`;
      const publicVideoPath = path.join(publicDir, publicFileName);
      const publicVideoUrl = `/generated_avatar/${publicFileName}`;

      if (sse) sendProgressEvent(sse, {
        type: 'status',
        msg: '正在把数字人口播结果下载到本地，避免远端链接失效...'
      });

      await downloadInputVideo(videoUrl, localSourcePath);
      ensureParentDir(publicVideoPath);
      fs.copyFileSync(localSourcePath, publicVideoPath);
      writeMediaMetadata(publicVideoPath, {
        taskType: 'generate',
        taskDir,
        remoteVideoUrl: videoUrl,
        text: String(text || '').trim(),
        audioSource: useAudioPreset ? req.body.audioPreset : path.basename(audioPath || ''),
        imageSource: useImagePreset ? req.body.imagePreset : path.basename(imagePath || ''),
        trimSeconds,
        maxDuration,
        updatedAt: new Date().toISOString()
      });

      if (ws) ws.close();
      res.json({ success: true, videoUrl: publicVideoUrl });
    } catch (error) {
      if (ws) ws.close();
      console.error('执行失败:', error.details || error.message);
      res.status(500).json({ error: error.details || error.message });
    }
  }

  async function handlePlanPipeline(req, res) {
    const clientId = req.body.clientId;
    const sse = clientId ? getProgressClient(clientId) : null;

    try {
      const taskDir = createRuntimeJobDir('plan');
      console.log(`[PlanPipeline] 开始策划任务，目录: ${taskDir}, clientId: ${clientId || '无'}`);

      const runAsrScript = path.join(pipelineDir, 'run_asr.py');
      const videoVlmScript = path.join(pipelineDir, 'video_vlm.py');
      const buildOutlineScript = path.join(pipelineDir, 'build_outline.py');
      const generateNarrationScript = path.join(pipelineDir, 'generate_narration.py');
      const materialPath = path.join(taskDir, 'material.mp4');
      const materialUrl = normalizeSourceUrl(req, req.body.materialUrl);
      const materialFile = req.files?.material?.[0] || null;
      const sourceLabel = String(req.body.sourceLabel || '').trim();
      const sourceSummary = String(req.body.sourceSummary || '').trim();
      const targetDurationSec = Math.max(20, Math.min(180, Number(req.body.targetDurationSec || 45)));

      if (!materialFile && !materialUrl) {
        return res.status(400).json({ error: '请先提供素材视频，才能生成内容大纲与口播' });
      }

      console.log('[PlanPipeline] 准备素材视频...');
      if (sse) sendProgressEvent(sse, { type: 'status', msg: '准备素材视频...' });
      if (materialFile) {
        fs.renameSync(materialFile.path, materialPath);
        console.log('[PlanPipeline] 素材已上传');
      } else {
        console.log(`[PlanPipeline] 下载素材: ${materialUrl}`);
        await downloadInputVideo(materialUrl, materialPath);
        console.log('[PlanPipeline] 素材下载完成');
      }

      console.log('[PlanPipeline] 步骤 1/5: 开始 ASR 识别...');
      await runPipelineScript([runAsrScript, '--input', 'material.mp4', '--allow-no-audio'], {
        sse,
        progress: 15,
        msg: '1/5: 正在提取素材字幕与语言信息...',
        cwd: taskDir,
        sendProgressEvent,
        runPythonScript
      });
      console.log('[PlanPipeline] 步骤 1/5: ASR 识别完成');

      console.log('[PlanPipeline] 步骤 2/5: 开始 VLM 画面分析...');
      await runPipelineScript([videoVlmScript], {
        sse,
        progress: 35,
        msg: '2/5: 正在理解素材画面结构...',
        cwd: taskDir,
        sendProgressEvent,
        runPythonScript
      });
      console.log('[PlanPipeline] 步骤 2/5: VLM 画面分析完成');

      console.log('[PlanPipeline] 步骤 3/5: 开始生成内容大纲...');
      await runPipelineScript([
        buildOutlineScript,
        '--title', sourceLabel,
        '--summary', sourceSummary,
        '--target-duration', String(targetDurationSec)
      ], {
        sse,
        progress: 60,
        msg: '3/5: 正在生成内容大纲...',
        cwd: taskDir,
        sendProgressEvent,
        runPythonScript
      });
      console.log('[PlanPipeline] 步骤 3/5: 内容大纲生成完成');

      console.log('[PlanPipeline] 步骤 4/5: 开始生成口播文案...');
      await runPipelineScript([generateNarrationScript], {
        sse,
        progress: 80,
        msg: '4/5: 正在生成口播文案...',
        cwd: taskDir,
        sendProgressEvent,
        runPythonScript
      });
      console.log('[PlanPipeline] 步骤 4/5: 口播文案生成完成');

      console.log('[PlanPipeline] 步骤 5/5: 开始整合视频脚本...');
      const buildVideoScriptScript = path.join(pipelineDir, 'build_video_script.py');
      await runPipelineScript([buildVideoScriptScript], {
        sse,
        progress: 90,
        msg: '5/5: 正在整合视频脚本...',
        cwd: taskDir,
        sendProgressEvent,
        runPythonScript
      });
      console.log('[PlanPipeline] 步骤 5/5: 视频脚本整合完成');

      const outline = readJsonIfExists(path.join(taskDir, 'content_outline.json'), {});
      const narrationPlan = readJsonIfExists(path.join(taskDir, 'narration_plan.json'), {});
      const videoScript = readJsonIfExists(path.join(taskDir, 'video_script.json'), {});
      const narrationText = String(narrationPlan?.full_text || '').trim();

      console.log(`[PlanPipeline] 任务完成！大纲段数: ${outline?.segments?.length || 0}, 口播字数: ${narrationText.length}, 视频脚本段数: ${videoScript?.segments?.length || 0}`);

      res.json({
        success: true,
        outline,
        narrationPlan,
        videoScript,
        narrationText,
        taskDir
      });
    } catch (error) {
      console.error('[PlanPipeline] 任务失败:', error);
      res.status(500).json({ error: error.details || error.message });
    }
  }

  async function handleGetPlanPipelineResult(req, res) {
    try {
      const requestedTaskDir = String(req.query.taskDir || '').trim();
      let payload = null;
      if (requestedTaskDir) {
        const safeTaskDir = resolveSafeTaskDir(requestedTaskDir);
        if (!safeTaskDir) {
          return res.status(400).json({ error: '非法 taskDir' });
        }
        payload = readPlanTaskPayload(safeTaskDir);
      } else {
        payload = findLatestSuccessfulPlanTask();
      }

      if (!payload) {
        return res.status(404).json({ error: '未找到可恢复的策划结果' });
      }

      res.json(payload);
    } catch (error) {
      console.error('读取策划恢复结果失败:', error);
      res.status(500).json({ error: error.message || '读取策划恢复结果失败' });
    }
  }

  async function handleRunPipeline(req, res) {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    const sse = getProgressClient(clientId);

    try {
      const taskDir = createRuntimeJobDir('pipeline');
      const planTaskDir = String(req.body.planTaskDir || '').trim();
      const runAsrScript = path.join(pipelineDir, 'run_asr.py');
      const videoVlmScript = path.join(pipelineDir, 'video_vlm.py');
      const buildVideoScript = path.join(pipelineDir, 'build_video.py');
      const makeVerticalScript = path.join(pipelineDir, 'make_vertical_video.py');
      const aimanPath = path.join(taskDir, 'aiman.mp4');
      const materialPath = path.join(taskDir, 'material.mp4');
      const publicOutputPath = path.join(baseDir, 'public', 'output_final.mp4');
      const materialUrl = normalizeSourceUrl(req, req.body.materialUrl);
      const materialFile = req.files?.material?.[0] || null;
      const autoGenerateAiman = req.body.autoGenerateAiman === 'true';
      const reuseExistingAiman = req.body.reuseExistingAiman === 'true';
      const existingAimanTaskDirRaw = String(req.body.existingAimanTaskDir || '').trim();
      const existingAimanTaskDir = resolveSafeTaskDir(existingAimanTaskDirRaw);
      const comfyServerUrl = req.body.comfyServerUrl || defaultComfyBaseUrl;
      const avatarImage = req.body.avatarImage;
      const avatarAudio = req.body.avatarAudio;

      if (!materialFile && !materialUrl) {
        return res.status(400).json({ error: '请上传空镜头素材视频，或提供可访问的素材地址' });
      }
      if (!autoGenerateAiman) {
        return res.status(400).json({ error: '当前流程仅支持自动生成补位数字人，请启用 autoGenerateAiman' });
      }
      if (!reuseExistingAiman && !String(avatarImage || '').trim()) {
        return res.status(400).json({ error: '请先选择人物图像预设，系统才能自动生成补位数字人' });
      }

      const reusableMaterialPath = planTaskDir ? path.join(planTaskDir, 'material.mp4') : '';
      if (reusableMaterialPath && fs.existsSync(reusableMaterialPath)) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到策划阶段已下载素材，正在复用本地 material.mp4...' });
        console.log(`[RunPipeline] 复用策划阶段素材文件: ${reusableMaterialPath}`);
        fs.copyFileSync(reusableMaterialPath, materialPath);
        console.log(`[RunPipeline] 素材已复制到当前任务目录: ${materialPath}`);
      } else if (materialFile) {
        console.log('[RunPipeline] 使用本次上传的素材文件');
        fs.renameSync(materialFile.path, materialPath);
        console.log(`[RunPipeline] 素材已移动到当前任务目录: ${materialPath}`);
      } else {
        console.log(`[RunPipeline] 未命中本地复用，开始下载素材: ${materialUrl}`);
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在拉取空镜头素材...' });
        await downloadInputVideo(materialUrl, materialPath);
        console.log(`[RunPipeline] 素材下载完成: ${materialPath}`);
      }

      // Phase 1: 复用 plan-pipeline 的识别结果
      let shouldSkipAsr = false;
      let shouldSkipVlm = false;
      if (planTaskDir && fs.existsSync(planTaskDir)) {
        console.log(`[RunPipeline] 检测到 planTaskDir: ${planTaskDir}，尝试复用识别结果`);
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到策划任务目录，正在检查可复用的素材分析结果...' });
        const reuseMap = [
          { src: 'audio.json', dest: 'material_audio.json' },
          { src: 'result.json', dest: 'result.json' },
          { src: 'subtitles.json', dest: 'subtitles.json' },
          { src: 'speaker_scene.json', dest: 'speaker_scene.json' }
        ];
        let reuseCount = 0;
        for (const filePair of reuseMap) {
          const srcPath = path.join(planTaskDir, filePair.src);
          const destPath = path.join(taskDir, filePair.dest);
          if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`[RunPipeline] 复用文件: ${filePair.src}${filePair.src !== filePair.dest ? ` -> ${filePair.dest}` : ''}`);
            if (sse) sendProgressEvent(sse, { type: 'status', msg: `已复用 ${filePair.dest}` });
            reuseCount++;
          } else {
            console.log(`[RunPipeline] 缺少可复用文件: ${filePair.src}`);
          }
        }
        if (reuseCount > 0) {
          shouldSkipAsr = fs.existsSync(path.join(taskDir, 'material_audio.json'));
          shouldSkipVlm = fs.existsSync(path.join(taskDir, 'result.json'));
          if (sse) sendProgressEvent(sse, { type: 'status', msg: `已复用 ${reuseCount} 个素材分析结果文件` });
          console.log(`[RunPipeline] 复用了 ${reuseCount} 个文件，shouldSkipAsr=${shouldSkipAsr}, shouldSkipVlm=${shouldSkipVlm}`);
        } else {
          console.log('[RunPipeline] 未找到可复用的分析结果，将走完整素材分析链路');
          if (sse) sendProgressEvent(sse, { type: 'status', msg: '未找到可复用分析结果，将重新进行素材分析' });
        }
      } else if (planTaskDir) {
        console.log(`[RunPipeline] planTaskDir 不存在或不可访问: ${planTaskDir}`);
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '策划任务目录不可用，将重新准备素材和分析结果' });
      }

      if (!shouldSkipAsr) {
        // 素材优先方案：只对 material.mp4 做 ASR，并单独写入 material_audio.json
        console.log('[RunPipeline] 开始素材 ASR 识别（material.mp4）');
        await runPipelineScript([
          runAsrScript,
          '--input', 'material.mp4',
          '--audio-json', 'material_audio.json',
          '--subtitles-json', 'subtitles.json',
          '--speaker-scene-json', 'speaker_scene.json'
        ], {
          sse,
          progress: 10,
          msg: '1/9: 正在识别素材音频...',
          cwd: taskDir,
          sendProgressEvent,
          runPythonScript
        });
      } else {
        console.log('[RunPipeline] 跳过素材 ASR，使用复用的 material_audio.json');
        if (sse) sendProgressEvent(sse, { type: 'progress', percent: 10, msg: '1/9: 已跳过素材 ASR（复用策划结果）' });
      }

      if (!shouldSkipVlm) {
        console.log('[RunPipeline] 开始 VLM 分析（material.mp4）');
        await runPipelineScript([videoVlmScript], { sse, progress: 30, msg: '2/9: 正在 VLM 分析画面...', cwd: taskDir, sendProgressEvent, runPythonScript });
      } else {
        console.log('[RunPipeline] 跳过 VLM 分析，使用复用结果');
        if (sse) sendProgressEvent(sse, { type: 'progress', percent: 30, msg: '2/9: 已跳过 VLM（复用策划结果）' });
      }

      // 【重要】在新链路里，只保留轻量策划上下文
      // 不再把旧的长口播/旧视频脚本回灌到素材优先链路
      const sourceLabel = String(req.body.sourceLabel || '').trim();
      const sourceSummary = String(req.body.sourceSummary || '').trim();
      const targetDurationSec = Math.max(20, Math.min(180, Number(req.body.targetDurationSec || 45)));
      const contentOutlinePath = path.join(taskDir, 'content_outline.json');
      writeJsonFile(contentOutlinePath, {
        title: sourceLabel,
        summary: sourceSummary,
        topic: sourceLabel || '素材优先混剪',
        angle: sourceSummary || '优先从素材中选主体片段，再生成极短 bridge 文案',
        target_duration_sec: targetDurationSec
      });
      console.log(`[RunPipeline] 已保存轻量策划上下文到: ${contentOutlinePath}`);

      // Phase 2: 素材优先链路
      const segmentMaterialScript = path.join(pipelineDir, 'segment_material.py');
      const scoreMaterialScript = path.join(pipelineDir, 'score_material_segments.py');
      const selectMaterialScript = path.join(pipelineDir, 'select_material_segments.py');
      const buildBridgeScript = path.join(pipelineDir, 'build_bridge_script.py');
      const composeTimelineScript = path.join(pipelineDir, 'compose_timeline.py');

      console.log('[RunPipeline] 开始素材优先链路');
      if (sse) sendProgressEvent(sse, { type: 'status', msg: '开始素材优先链路：切片 -> 评分 -> 选片 -> bridge 文案' });

      await runPipelineScript([segmentMaterialScript], { sse, progress: 35, msg: '3/9: 正在切分素材片段...', cwd: taskDir, sendProgressEvent, runPythonScript });
      console.log('[RunPipeline] 素材切片完成');
      await runPipelineScript([scoreMaterialScript], { sse, progress: 45, msg: '4/9: 正在评估素材质量...', cwd: taskDir, sendProgressEvent, runPythonScript });
      console.log('[RunPipeline] 素材片段评分完成');
      await runPipelineScript([selectMaterialScript], { sse, progress: 55, msg: '5/9: 正在选择素材片段...', cwd: taskDir, sendProgressEvent, runPythonScript });
      console.log('[RunPipeline] 素材片段选择完成');
      await runPipelineScript([buildBridgeScript], { sse, progress: 65, msg: '6/9: 正在生成补位文案...', cwd: taskDir, sendProgressEvent, runPythonScript });
      console.log('[RunPipeline] 补位文案生成完成');

      // Phase 3: 数字人生成（使用补位文案）/ 或复用已有数字人
      // 读取补位文案
      const bridgeScriptPath = path.join(taskDir, 'bridge_script.json');
      const bridgeScript = readJsonIfExists(bridgeScriptPath, {});

      // 将补位文案合并为完整文本供数字人生成
      const bridgeTexts = [
        bridgeScript.intro || '',
        ...(bridgeScript.bridges || []),
        bridgeScript.outro || ''
      ].filter(t => t);
      const bridgeFullText = bridgeTexts.join('。');

      console.log(`[RunPipeline] 补位文案: ${bridgeFullText.substring(0, 100)}...`);
      if (sse) sendProgressEvent(sse, { type: 'status', msg: `补位文案已生成（${bridgeTexts.length}句）` });

      const reusableAimanCandidates = [];
      if (existingAimanTaskDir) reusableAimanCandidates.push(existingAimanTaskDir);
      if (planTaskDir) reusableAimanCandidates.push(planTaskDir);
      const reusableAimanTaskDir = reusableAimanCandidates.find((dir) => {
        if (!dir || !fs.existsSync(dir)) return false;
        return fs.existsSync(path.join(dir, 'aiman.mp4'));
      }) || null;

      try {
        if (reuseExistingAiman && reusableAimanTaskDir) {
          console.log(`[RunPipeline] 复用已有数字人视频: ${reusableAimanTaskDir}`);
          if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到已有补位数字人，正在跳过重新生成...' });

          fs.copyFileSync(path.join(reusableAimanTaskDir, 'aiman.mp4'), aimanPath);
          console.log(`[RunPipeline] 已复制 aiman.mp4 -> ${aimanPath}`);

          const aimanReuseFiles = [
            'aiman_audio.json',
            'aiman_subtitles.json',
            'aiman_speaker_scene.json'
          ];
          let reusedAimanAudio = false;
          for (const fileName of aimanReuseFiles) {
            const src = path.join(reusableAimanTaskDir, fileName);
            const dest = path.join(taskDir, fileName);
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, dest);
              console.log(`[RunPipeline] 复用数字人文件: ${fileName}`);
              if (fileName === 'aiman_audio.json') reusedAimanAudio = true;
            }
          }

          if (!reusedAimanAudio) {
            console.log('[RunPipeline] 未找到可复用的 aiman_audio.json，开始重新识别当前数字人音频');
            await runPipelineScript([
              runAsrScript,
              '--input', 'aiman.mp4',
              '--audio-json', 'aiman_audio.json',
              '--subtitles-json', 'aiman_subtitles.json',
              '--speaker-scene-json', 'aiman_speaker_scene.json'
            ], {
              sse,
              progress: 70,
              msg: '6.5/9: 正在识别已复用数字人音频...',
              cwd: taskDir,
              sendProgressEvent,
              runPythonScript
            });
          } else if (sse) {
            sendProgressEvent(sse, { type: 'status', msg: '已复用数字人音频识别结果' });
          }
        } else {
          console.log('[RunPipeline] 开始自动生成数字人视频');
          if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在生成数字人视频...' });

        let imagePath;
        if (avatarImage.startsWith('preset:')) {
          const presetName = avatarImage.replace('preset:', '');
          imagePath = path.join(baseDir, 'public/presets/image', presetName);
        } else {
          imagePath = avatarImage;
        }

        let audioPath = null;
        if (avatarAudio) {
          if (avatarAudio.startsWith('preset:')) {
            const presetName = avatarAudio.replace('preset:', '');
            audioPath = path.join(baseDir, 'public/presets/audio', presetName);
          } else {
            audioPath = avatarAudio;
          }
        }

        const remoteImageName = await uploadToComfyUI(imagePath, comfyServerUrl);

        let remoteAudioName = null;
        if (audioPath && fs.existsSync(audioPath)) {
          remoteAudioName = await uploadToComfyUI(audioPath, comfyServerUrl);
        }

        const expectedSentenceCount = bridgeTexts.length;
        let generationAccepted = false;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const workflow = readWorkflow(workflowPath);
          workflow['278'].inputs.text = bridgeFullText;
          workflow['180'].inputs.image = remoteImageName;
          if (remoteAudioName) {
            workflow['6'].inputs.audio = remoteAudioName;
          }

          const randomSeed = Math.floor(Math.random() * 2147483647);
          workflow['27'].inputs.seed = randomSeed;
          workflow['278'].inputs.seed = randomSeed;

          const estimatedDuration = Math.ceil(bridgeFullText.length * 0.4);
          const maxDuration = Math.max(10, Math.min(120, estimatedDuration));
          const m = Math.floor(maxDuration / 60);
          const s = Math.floor(maxDuration % 60);
          workflow['7'].inputs.end_time = `${m}:${s.toString().padStart(2, '0')}`;

          console.log(`[RunPipeline] 数字人生成尝试 ${attempt}/2，seed=${randomSeed}，预计时长=${maxDuration}s，句子数=${expectedSentenceCount}`);
          if (sse) sendProgressEvent(sse, { type: 'status', msg: `数字人生成尝试 ${attempt}/2...` });

          const promptRes = await axios.post(`${comfyServerUrl}/prompt`, {
            prompt: workflow,
            client_id: clientId
          }, {
            httpsAgent: insecureHttpsAgent
          });

          const promptId = promptRes.data.prompt_id;
          console.log(`[RunPipeline] ComfyUI 任务已提交: ${promptId}`);

          const videoUrl = await waitForCompletion(promptId, comfyServerUrl);
          console.log(`[RunPipeline] 数字人视频生成完成: ${videoUrl}`);

          if (fs.existsSync(aimanPath)) {
            fs.unlinkSync(aimanPath);
          }
          await downloadInputVideo(videoUrl, aimanPath);
          console.log('[RunPipeline] 数字人视频已保存');

          if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在识别数字人音频...' });
          await runPipelineScript([
            runAsrScript,
            '--input', 'aiman.mp4',
            '--audio-json', 'aiman_audio.json',
            '--subtitles-json', 'aiman_subtitles.json',
            '--speaker-scene-json', 'aiman_speaker_scene.json'
          ], {
            sse,
            progress: 70,
            msg: '6.5/9: 正在识别数字人音频...',
            cwd: taskDir,
            sendProgressEvent,
            runPythonScript
          });

          const currentAimanAudio = readJsonIfExists(path.join(taskDir, 'aiman_audio.json'), []);
          const qualityReport = analyzeGeneratedAvatarQuality({
            bridgeTexts,
            aimanAudio: currentAimanAudio,
            aimanPath
          });

          console.log('[RunPipeline] 数字人质量报告:', JSON.stringify(qualityReport));
          if (sse) {
            sendProgressEvent(sse, {
              type: 'status',
              msg: `数字人复核: 相似度=${qualityReport.overallSimilarity}, 末尾静音=${qualityReport.trailingSilence}s, 内部停顿=${qualityReport.maxInternalGap}s`
            });
          }

          if (qualityReport.shouldRetry && attempt < 2) {
            console.warn('[RunPipeline] 数字人质量未达标，准备自动重生成一次');
            if (sse) sendProgressEvent(sse, { type: 'status', msg: '数字人质量未达标，正在自动重生成一次...' });
            continue;
          }

          if (qualityReport.shouldRetry && attempt >= 2) {
            console.warn('[RunPipeline] 数字人质量仍不理想，继续使用当前结果但会执行静音裁剪');
          }

          const trimResult = trimAvatarSilence({
            aimanPath,
            aimanAudio: currentAimanAudio
          });
          console.log('[RunPipeline] 数字人静音裁剪结果:', trimResult);

          if (trimResult.trimmed) {
            if (sse) sendProgressEvent(sse, { type: 'status', msg: '数字人已裁掉头尾静音，正在重新识别...' });
            await runPipelineScript([
              runAsrScript,
              '--input', 'aiman.mp4',
              '--audio-json', 'aiman_audio.json',
              '--subtitles-json', 'aiman_subtitles.json',
              '--speaker-scene-json', 'aiman_speaker_scene.json'
            ], {
              sse,
              progress: 72,
              msg: '6.7/9: 正在复核裁剪后的数字人音频...',
              cwd: taskDir,
              sendProgressEvent,
              runPythonScript
            });
          }

          generationAccepted = true;
          break;
        }

        if (!generationAccepted) {
          throw new Error('数字人生成未能产出可用结果');
        }
        }

      } catch (error) {
        console.error('[RunPipeline] 数字人生成失败:', error);
        if (sse) sendProgressEvent(sse, {
          type: 'error',
          msg: `数字人生成失败: ${error.message}`
        });
        throw error;
      }

      // Phase 4: 时间线编排
      await runPipelineScript([composeTimelineScript], { sse, progress: 75, msg: '7/9: 正在编排时间线...', cwd: taskDir, sendProgressEvent, runPythonScript });
      console.log('[RunPipeline] 时间线编排完成');

      // Phase 5: 视频合成（使用 timeline.json）
      const buildArgs = [buildVideoScript, '--timeline', path.join(taskDir, 'timeline.json')];
      if (req.body.withSubtitles === 'false') {
        buildArgs.push('--no-subs');
      }
      console.log(`[RunPipeline] 开始视频合成，参数: ${buildArgs.join(' ')}`);
      await runPipelineScript(buildArgs, { sse, progress: 85, msg: '8/9: FFmpeg 正在合成视频...', cwd: taskDir, sendProgressEvent, runPythonScript });
      console.log('[RunPipeline] 视频合成完成，准备写入产物元数据');

      const finalSourcePath = path.join(taskDir, 'output_final.mp4');
      const subtitlesPath = path.join(taskDir, 'subtitles.json');
      const timelinePath = path.join(taskDir, 'timeline.json');
      const lightOutline = readJsonIfExists(path.join(taskDir, 'content_outline.json'), null);
      const selectedSegments = readJsonIfExists(path.join(taskDir, 'selected_segments.json'), null);
      const bridgeScriptOutput = readJsonIfExists(path.join(taskDir, 'bridge_script.json'), null);
      const pipelineSubtitles = readJsonIfExists(subtitlesPath, []);
      const timeline = readJsonIfExists(timelinePath, []);

      // 策划上下文已在 Agent 运行前写入，这里直接使用
      fs.copyFileSync(finalSourcePath, publicOutputPath);
      writeMediaMetadata(publicOutputPath, {
        taskType: 'pipeline',
        taskDir,
        title: sourceLabel || buildFallbackTitleFromSubtitles(subtitlesPath),
        subtitles: pipelineSubtitles,
        sourceSummary,
        contentOutline: lightOutline,
        selectedSegments,
        bridgeScript: bridgeScriptOutput,
        timeline,
        updatedAt: new Date().toISOString()
      });
      let finalUrl = '/output_final.mp4';

      if (req.body.generateVertical === 'true') {
        const contentJsonPath = path.join(taskDir, 'content.json');
        let verticalTitle = (req.body.verticalTitle || '').trim();
        if (!verticalTitle) {
          if (sse) sendProgressEvent(sse, { type: 'status', msg: '未填写竖屏标题，正在自动生成热点标题...' });
          verticalTitle = await generateHotTitle(taskDir, 'subtitles.json');
          if (sse) sendProgressEvent(sse, { type: 'status', msg: `自动标题：${verticalTitle}` });
        }
        writeJsonFile(contentJsonPath, { title: verticalTitle });
        const verticalOutputName = 'output_final_vertical.mp4';
        await runPipelineScript([
          makeVerticalScript,
          '--input', finalSourcePath,
          '--content', contentJsonPath,
          '--subtitles', subtitlesPath,
          '--plan', timelinePath,
          '--output', path.join(taskDir, verticalOutputName),
          '--background', path.join(taskDir, 'background_generated.png'),
          '--sub-dir', path.join(taskDir, 'subtitle_cards')
        ], { sse, progress: 95, msg: '9/9: 生成动态竖屏...', cwd: taskDir, sendProgressEvent, runPythonScript });
        const publicVerticalPath = path.join(baseDir, 'public', verticalOutputName);
        fs.copyFileSync(path.join(taskDir, verticalOutputName), publicVerticalPath);
        writeMediaMetadata(publicVerticalPath, {
          taskType: 'pipeline',
          taskDir,
          title: verticalTitle,
          subtitles: pipelineSubtitles,
          sourceSummary,
          contentOutline: lightOutline,
          selectedSegments,
          bridgeScript: bridgeScriptOutput,
          timeline,
          updatedAt: new Date().toISOString()
        });
        finalUrl = `/${verticalOutputName}`;
      }

      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 100, msg: '🎉 视频生成完毕！' });

      // 自动触发AI审核（如果启用）
      if (typeof triggerAutoReview === 'function') {
        try {
          const autoReview = req.body.autoReview !== 'false'; // 默认启用
          if (autoReview) {
            if (sse) sendProgressEvent(sse, { type: 'progress', percent: 100, msg: '🔍 正在进行AI审核...' });
            const reviewResult = await triggerAutoReview(publicOutputPath, path.basename(publicOutputPath));
            if (reviewResult && !reviewResult.passed) {
              if (sse) sendProgressEvent(sse, {
                type: 'warning',
                msg: `⚠️ AI审核未通过（得分：${reviewResult.overall_score}），请查看修复建议`
              });
            } else if (reviewResult && reviewResult.passed) {
              if (sse) sendProgressEvent(sse, {
                type: 'success',
                msg: `✓ AI审核通过（得分：${reviewResult.overall_score}）`
              });
            }
          }
        } catch (err) {
          console.warn('自动审核失败，不影响视频生成:', err.message);
          if (sse) sendProgressEvent(sse, {
            type: 'warning',
            msg: '⚠️ AI审核失败，但视频已生成'
          });
        }
      }

      res.json({
        success: true,
        videoUrl: `${finalUrl}?t=${Date.now()}`,
        timeline: Array.isArray(timeline) ? timeline : [],
        taskDir
      });
    } catch (error) {
      console.error('Pipeline failed:', error);
      res.status(500).json({ error: error.details || error.message });
    }
  }

  return { handleGenerate, handlePlanPipeline, handleGetPlanPipelineResult, handleRunPipeline };
}

module.exports = { createPipelineHandlers };
