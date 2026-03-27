const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

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
    headers: { 'User-Agent': 'Mozilla/5.0' }
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
    runPythonScript
  } = deps;

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

      if (ws) ws.close();
      res.json({ success: true, videoUrl });
    } catch (error) {
      if (ws) ws.close();
      console.error('执行失败:', error.details || error.message);
      res.status(500).json({ error: error.details || error.message });
    }
  }

  async function handleRunPipeline(req, res) {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    const sse = getProgressClient(clientId);

    try {
      const taskDir = createRuntimeJobDir('pipeline');
      const runAsrScript = path.join(pipelineDir, 'run_asr.py');
      const videoVlmScript = path.join(pipelineDir, 'video_vlm.py');
      const runDirectorScript = path.join(pipelineDir, 'run_director.py');
      const buildVideoScript = path.join(pipelineDir, 'build_video.py');
      const makeVerticalScript = path.join(pipelineDir, 'make_vertical_video.py');
      const aimanPath = path.join(taskDir, 'aiman.mp4');
      const materialPath = path.join(taskDir, 'material.mp4');
      const publicOutputPath = path.join(baseDir, 'public', 'output_final.mp4');
      const aimanUrl = normalizeSourceUrl(req, req.body.aimanUrl);
      const materialUrl = normalizeSourceUrl(req, req.body.materialUrl);
      const aimanFile = req.files?.aiman?.[0] || null;
      const materialFile = req.files?.material?.[0] || null;

      if (!aimanFile && !aimanUrl) {
        return res.status(400).json({ error: '请上传数字人视频，或提供可访问的数字人视频地址' });
      }
      if (!materialFile && !materialUrl) {
        return res.status(400).json({ error: '请上传空镜头素材视频，或提供可访问的素材地址' });
      }

      if (aimanFile) {
        fs.renameSync(aimanFile.path, aimanPath);
      } else {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在拉取数字人主轨素材...' });
        await downloadInputVideo(aimanUrl, aimanPath);
      }

      if (materialFile) {
        fs.renameSync(materialFile.path, materialPath);
      } else {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '正在拉取空镜头素材...' });
        await downloadInputVideo(materialUrl, materialPath);
      }

      await runPipelineScript([runAsrScript], { sse, progress: 10, msg: '1/5: 正在 ASR 识别与翻译...', cwd: taskDir, sendProgressEvent, runPythonScript });
      await runPipelineScript([videoVlmScript], { sse, progress: 30, msg: '2/5: 正在 VLM 分析画面...', cwd: taskDir, sendProgressEvent, runPythonScript });
      await runPipelineScript([runDirectorScript], { sse, progress: 50, msg: '3/5: AI 导演思考剧本...', cwd: taskDir, sendProgressEvent, runPythonScript });

      const buildArgs = [buildVideoScript];
      if (req.body.withSubtitles === 'false') {
        buildArgs.push('--no-subs');
      }
      await runPipelineScript(buildArgs, { sse, progress: 70, msg: '4/5: FFmpeg 正在合成视频...', cwd: taskDir, sendProgressEvent, runPythonScript });

      const finalSourcePath = path.join(taskDir, 'output_final.mp4');
      const subtitlesPath = path.join(taskDir, 'subtitles.json');
      const pipelineSubtitles = readJsonIfExists(subtitlesPath, []);
      fs.copyFileSync(finalSourcePath, publicOutputPath);
      writeMediaMetadata(publicOutputPath, {
        taskType: 'pipeline',
        taskDir,
        title: buildFallbackTitleFromSubtitles(subtitlesPath),
        subtitles: pipelineSubtitles,
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
          '--plan', path.join(taskDir, 'director.json'),
          '--output', path.join(taskDir, verticalOutputName),
          '--background', path.join(taskDir, 'background_generated.png'),
          '--sub-dir', path.join(taskDir, 'subtitle_cards')
        ], { sse, progress: 90, msg: '5/5: 生成动态竖屏...', cwd: taskDir, sendProgressEvent, runPythonScript });
        fs.copyFileSync(path.join(taskDir, verticalOutputName), path.join(baseDir, 'public', verticalOutputName));
        writeMediaMetadata(publicOutputPath, {
          taskType: 'pipeline',
          taskDir,
          title: verticalTitle,
          subtitles: pipelineSubtitles,
          updatedAt: new Date().toISOString()
        });
        finalUrl = `/${verticalOutputName}`;
      }

      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 100, msg: '🎉 视频生成完毕！' });
      res.json({ success: true, videoUrl: `${finalUrl}?t=${Date.now()}` });
    } catch (error) {
      console.error('Pipeline failed:', error);
      res.status(500).json({ error: error.details || error.message });
    }
  }

  return { handleGenerate, handleRunPipeline };
}

module.exports = { createPipelineHandlers };
