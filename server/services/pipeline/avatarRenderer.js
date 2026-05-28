const https = require('https');
const axios = require('axios');
const { uploadToComfyUI, waitForCompletion } = require('./comfy');
const { createRunningHubClient, DEFAULT_RUNNINGHUB_BASE_URL, RUNNINGHUB_SUBMITTED_ERROR_CODE } = require('./runningHub');
const { prepareAvatarExternalAudioWorkflow } = require('../materialDriven/avatarWorkflow');
const { RUNNINGHUB_INFINITETALK_3INPUT } = require('../../config/runningHub');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });
const NATIVE_PROVIDER = 'comfyui';
const RUNNINGHUB_PROVIDER = 'runninghub';

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000
};

const VRAM_ERROR_PATTERNS = [
  /torch\.OutOfMemoryError/i,
  /out\s*of\s*memory/i,
  /oom/i,
  /vram/i,
  /显存不足告警/,
  /显存耗尽/,
  /显存不足/,
  /显存/,
  /CUDA\s+out\s+of\s+memory/i,
  /gpu\s*memory/i,
  /allocation\s+failed/i,
  /device.*memory.*exhausted/i,
  /insufficient.*memory/i,
  /内存不足/i,
  /not\s+enough\s+memory/i
];

function isRetryableError(err) {
  const message = String(err?.message || err || '');
  return VRAM_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRetryConfig(overrides = {}) {
  return {
    maxRetries: Number(overrides.maxRetries ?? RETRY_CONFIG.maxRetries),
    baseDelayMs: Number(overrides.baseDelayMs ?? RETRY_CONFIG.baseDelayMs),
    maxDelayMs: Number(overrides.maxDelayMs ?? RETRY_CONFIG.maxDelayMs)
  };
}

async function withRetry(fn, { label = 'render', maxRetries, baseDelayMs, maxDelayMs, onRetry, shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !shouldRetry(err) || !isRetryableError(err)) throw err;
      const delay = Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs);
      if (onRetry) {
        onRetry({ attempt, maxRetries, delay, error: err.message });
      }
      console.warn(`[AvatarRenderer] ${label} 失败 (${attempt}/${maxRetries})，${delay}ms 后重试: ${err.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function sanitizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/u, '');
}

function resolveAvatarRenderProvider(config = {}) {
  const rawProvider = String(
    config.renderProvider ||
    config.avatarRenderProvider ||
    config.provider ||
    ''
  ).trim().toLowerCase();

  if (['runninghub', 'runninghub-workflow', 'runninghub_api', 'runninghub-api'].includes(rawProvider)) {
    return RUNNINGHUB_PROVIDER;
  }
  return NATIVE_PROVIDER;
}

function resolveRunningHubWorkflowId(config = {}) {
  return String(
    config.runningHubWorkflowId ||
    process.env.RUNNINGHUB_WORKFLOW_ID ||
    ''
  ).trim();
}

function createDefaultNativeClient(deps = {}) {
  const axiosClient = deps.axiosClient || axios;

  return {
    async render(options = {}) {
      const cfg = options.avatarConfig || {};
      const baseUrl = sanitizeUrl(cfg.serverUrl || options.defaultComfyBaseUrl || '');
      if (!baseUrl) throw new Error('未配置 ComfyUI 地址');

      const remoteAudioName = await uploadToComfyUI(options.audioPath, baseUrl);
      const remoteImageName = await uploadToComfyUI(options.imagePath, baseUrl);
      const poseNodeId = String(cfg.poseNodeId || process.env.AVATAR_POSE_NODE_ID || '').trim();
      const remotePoseName = options.posePath && poseNodeId
        ? await uploadToComfyUI(options.posePath, baseUrl)
        : '';
      const preparedWorkflow = prepareAvatarExternalAudioWorkflow(options.workflow, {
        audioName: remoteAudioName,
        imageName: remoteImageName,
        poseName: remotePoseName || undefined,
        poseNodeId,
        poseFieldName: cfg.poseFieldName || process.env.AVATAR_POSE_FIELD_NAME || 'pose'
      });

      let promptRes;
      try {
        promptRes = await axiosClient.post(`${baseUrl}/prompt`, {
          prompt: preparedWorkflow
        }, { httpsAgent: insecureHttpsAgent });
      } catch (err) {
        const status = err.response ? err.response.status : 'N/A';
        throw new Error(`[ComfyUI 提交失败] URL: ${baseUrl}/prompt, Status: ${status}, Message: ${err.message}`);
      }

      const promptId = promptRes.data.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI 未返回 prompt_id: ${JSON.stringify(promptRes.data)}`);
      }

      const videoUrl = await waitForCompletion(promptId, baseUrl);
      return {
        provider: NATIVE_PROVIDER,
        baseUrl,
        promptId,
        videoUrl,
        remoteAudioName,
        remoteImageName,
        remotePoseName,
        preparedWorkflow,
        seed: preparedWorkflow['27']?.inputs?.seed
      };
    }
  };
}

function createDefaultRunningHubClient() {
  const client = createRunningHubClient();
  return {
    async render(options = {}) {
      const cfg = options.avatarConfig || {};
      return client.renderExternalAudio({
        apiKey: cfg.runningHubApiKey,
        baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
        workflowId: resolveRunningHubWorkflowId(cfg),
        runPath: cfg.runningHubRunPath,
        accessPassword: cfg.runningHubAccessPassword,
        instanceType: cfg.runningHubInstanceType,
        usePersonalQueue: cfg.runningHubUsePersonalQueue === true || cfg.runningHubUsePersonalQueue === 'true',
        retainSeconds: cfg.runningHubRetainSeconds,
        audioNodeId: cfg.runningHubAudioNodeId || RUNNINGHUB_INFINITETALK_3INPUT.audioNodeId,
        audioFieldName: cfg.runningHubAudioFieldName || RUNNINGHUB_INFINITETALK_3INPUT.audioFieldName,
        imageNodeId: cfg.runningHubImageNodeId || RUNNINGHUB_INFINITETALK_3INPUT.imageNodeId,
        imageFieldName: cfg.runningHubImageFieldName || RUNNINGHUB_INFINITETALK_3INPUT.imageFieldName,
        poseNodeId: cfg.runningHubPoseNodeId || process.env.RUNNINGHUB_POSE_NODE_ID || RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId,
        poseFieldName: cfg.runningHubPoseFieldName || process.env.RUNNINGHUB_POSE_FIELD_NAME || RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName,
        outputNodeId: cfg.runningHubOutputNodeId || RUNNINGHUB_INFINITETALK_3INPUT.outputNodeId,
        audioPath: options.audioPath,
        imagePath: options.imagePath,
        posePath: options.posePath,
        resumeTaskId: options.runningHubTaskId || options.resumeTaskId,
        remoteAudioName: options.runningHubRemoteAudioName || options.remoteAudioName,
        remoteImageName: options.runningHubRemoteImageName || options.remoteImageName,
        remotePoseName: options.runningHubRemotePoseName || options.remotePoseName,
        nodeInfoList: options.runningHubNodeInfoList || options.nodeInfoList,
        onSubmitted: options.onRunningHubSubmitted,
        maxAttempts: options.runningHubMaxAttempts,
        pollIntervalMs: options.runningHubPollIntervalMs
      });
    }
  };
}

function createAvatarRenderer(deps = {}) {
  const nativeClient = deps.nativeClient || createDefaultNativeClient(deps);
  const runningHubClient = deps.runningHubClient || createDefaultRunningHubClient(deps);

  async function render(options = {}) {
    const provider = resolveAvatarRenderProvider(options.avatarConfig || {});
    const retryCfg = resolveRetryConfig(options.retryConfig || {});
    const providerLabel = provider === RUNNINGHUB_PROVIDER ? 'RunningHub' : 'ComfyUI';
    const onRetry = options.onRetry;

    if (provider === RUNNINGHUB_PROVIDER) {
      const speechAudioPath = options.speechAudioPath || options.audioPath;
      const cfg = options.avatarConfig || {};
      const runningHubOptions = {
        ...options,
        poseNodeId: options.poseNodeId || cfg.runningHubPoseNodeId || process.env.RUNNINGHUB_POSE_NODE_ID || RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId,
        poseFieldName: options.poseFieldName || cfg.runningHubPoseFieldName || process.env.RUNNINGHUB_POSE_FIELD_NAME || RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName
      };
      if (!speechAudioPath) {
        throw new Error('缺少 QwenTTS 合成口播音频');
      }
      if (options.runningHubTaskId || options.resumeTaskId) {
        return runningHubClient.render({
          ...runningHubOptions,
          audioPath: speechAudioPath
        });
      }
      return withRetry(
        () => runningHubClient.render({
          ...runningHubOptions,
          audioPath: speechAudioPath
        }),
        {
          label: providerLabel,
          ...retryCfg,
          onRetry,
          shouldRetry: (err) => String(err?.code || '') !== RUNNINGHUB_SUBMITTED_ERROR_CODE && !err?.submitted
        }
      );
    }
    return withRetry(
      () => nativeClient.render(options),
      { label: providerLabel, ...retryCfg, onRetry }
    );
  }

  return {
    render
  };
}

module.exports = {
  NATIVE_PROVIDER,
  RUNNINGHUB_PROVIDER,
  RETRY_CONFIG,
  createAvatarRenderer,
  isRetryableError,
  resolveAvatarRenderProvider,
  resolveRetryConfig,
  resolveRunningHubWorkflowId,
  withRetry
};
