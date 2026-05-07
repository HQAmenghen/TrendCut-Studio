const https = require('https');
const axios = require('axios');
const { uploadToComfyUI, waitForCompletion } = require('./comfy');
const { createRunningHubClient, DEFAULT_RUNNINGHUB_BASE_URL } = require('./runningHub');
const { prepareAvatarExternalAudioWorkflow } = require('../materialDriven/avatarWorkflow');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });
const NATIVE_PROVIDER = 'comfyui';
const RUNNINGHUB_PROVIDER = 'runninghub';

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
      const preparedWorkflow = prepareAvatarExternalAudioWorkflow(options.workflow, {
        audioName: remoteAudioName,
        imageName: remoteImageName
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
        audioNodeId: cfg.runningHubAudioNodeId || '6',
        audioFieldName: cfg.runningHubAudioFieldName || 'audio',
        imageNodeId: cfg.runningHubImageNodeId || '180',
        imageFieldName: cfg.runningHubImageFieldName || 'image',
        outputNodeId: cfg.runningHubOutputNodeId || '',
        audioPath: options.audioPath,
        imagePath: options.imagePath
      });
    }
  };
}

function createAvatarRenderer(deps = {}) {
  const nativeClient = deps.nativeClient || createDefaultNativeClient(deps);
  const runningHubClient = deps.runningHubClient || createDefaultRunningHubClient(deps);

  async function render(options = {}) {
    const provider = resolveAvatarRenderProvider(options.avatarConfig || {});
    if (provider === RUNNINGHUB_PROVIDER) {
      const speechAudioPath = options.speechAudioPath || options.audioPath;
      if (!speechAudioPath) {
        throw new Error('缺少 QwenTTS 合成口播音频');
      }
      return runningHubClient.render({
        ...options,
        audioPath: speechAudioPath
      });
    }
    return nativeClient.render(options);
  }

  return {
    render
  };
}

module.exports = {
  NATIVE_PROVIDER,
  RUNNINGHUB_PROVIDER,
  createAvatarRenderer,
  resolveAvatarRenderProvider,
  resolveRunningHubWorkflowId
};
