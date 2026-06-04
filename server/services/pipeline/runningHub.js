const fs = require('fs');
const https = require('https');
const axios = require('axios');
const FormData = require('form-data');
const { RUNNINGHUB_INFINITETALK_3INPUT } = require('../../config/runningHub');

const DEFAULT_RUNNINGHUB_BASE_URL = 'https://www.runninghub.cn/openapi/v2';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 720; // 1 hour (720 * 5s)
const SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'FINISHED', 'TASK_END']);
const FAILURE_STATUSES = new Set(['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED']);
const VIDEO_FILE_TYPES = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'video']);
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });
const TRANSIENT_QUERY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 554]);
const TRANSIENT_QUERY_ERROR_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const RUNNINGHUB_SUBMITTED_ERROR_CODE = 'RUNNINGHUB_TASK_SUBMITTED_POLLING_FAILED';

function sanitizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/u, '');
}

function normalizeRunningHubBaseUrl(baseUrl) {
  const cleanUrl = sanitizeUrl(baseUrl || DEFAULT_RUNNINGHUB_BASE_URL);
  if (!cleanUrl) return DEFAULT_RUNNINGHUB_BASE_URL;
  if (/\/openapi\/v2$/u.test(cleanUrl)) return cleanUrl;
  return `${cleanUrl}/openapi/v2`;
}

function joinRunningHubPath(baseUrl, endpointPath) {
  const normalizedBase = normalizeRunningHubBaseUrl(baseUrl);
  const cleanPath = String(endpointPath || '').trim();
  if (/^https?:\/\//iu.test(cleanPath)) return sanitizeUrl(cleanPath);
  return `${normalizedBase}/${cleanPath.replace(/^\/?(?:openapi\/v2\/)?/u, '')}`;
}

function buildRunningHubRunUrl(options = {}) {
  const { baseUrl, runPath } = options;
  const workflowId = String(options.workflowId || '').trim();
  if (runPath) {
    return joinRunningHubPath(baseUrl, runPath);
  }
  if (!workflowId) {
    throw new Error('未配置 RunningHub workflowId');
  }
  return joinRunningHubPath(baseUrl, `/run/workflow/${encodeURIComponent(workflowId)}`);
}

function resolveRunningHubApiKey(options = {}) {
  return String(options.apiKey || process.env.RUNNINGHUB_API_KEY || '').trim();
}

function assertRunningHubSuccess(payload, context) {
  const code = payload?.code;
  if (code !== undefined && Number(code) !== 0) {
    const message = payload?.msg || payload?.message || payload?.error || 'unknown error';
    throw new Error(`[RunningHub ${context}失败] code=${code}, message=${message}`);
  }
}

function getRunningHubData(payload) {
  return payload?.data !== undefined ? payload.data : payload;
}

function extractRunningHubUploadFileName(payload) {
  const data = getRunningHubData(payload);
  return String(
    data?.fileName ||
    data?.filename ||
    payload?.fileName ||
    payload?.filename ||
    ''
  ).trim();
}

function extractRunningHubTaskId(payload) {
  const data = getRunningHubData(payload);
  return String(
    data?.taskId ||
    data?.id ||
    payload?.taskId ||
    payload?.id ||
    ''
  ).trim();
}

function extractRunningHubTaskStatus(payload) {
  const data = getRunningHubData(payload);
  return String(
    data?.taskStatus ||
    data?.status ||
    data?.state ||
    payload?.taskStatus ||
    payload?.status ||
    payload?.state ||
    ''
  ).trim().toUpperCase();
}

function extractRunningHubFailureReason(payload) {
  const data = getRunningHubData(payload);
  const failedReason = data?.failedReason;
  if (!failedReason || typeof failedReason !== 'object') return '';
  const parts = [];
  if (failedReason.exception_type) {
    parts.push(`exception_type=${failedReason.exception_type}`);
  }
  if (failedReason.node_name) {
    parts.push(`node=${failedReason.node_name}`);
  }
  if (failedReason.exception_message) {
    const cleanMsg = String(failedReason.exception_message).replace(/\s+/gu, ' ').trim();
    parts.push(cleanMsg);
  }
  return parts.join(', ');
}

function formatRunningHubErrorMessage(payload, options = {}) {
  const taskId = String(options.taskId || '');
  const status = String(options.status || extractRunningHubTaskStatus(payload));
  const failureReason = extractRunningHubFailureReason(payload);
  const apiMsg = payload?.msg || payload?.message || '';
  const errorCode = getRunningHubData(payload)?.errorCode
    ? `, errorCode=${getRunningHubData(payload).errorCode}`
    : '';
  const errorMessage = getRunningHubData(payload)?.errorMessage
    ? `, errorMessage=${getRunningHubData(payload).errorMessage}`
    : '';

  const detail = failureReason || apiMsg || JSON.stringify(payload);
  return `[RunningHub 任务失败] taskId=${taskId}, status=${status}${errorCode}${errorMessage}, detail=${detail}`;
}

function isTransientRunningHubQueryError(err) {
  const status = Number(err?.response?.status || 0);
  if (TRANSIENT_QUERY_STATUS_CODES.has(status)) return true;

  const code = String(err?.code || '').trim().toUpperCase();
  if (TRANSIENT_QUERY_ERROR_CODES.has(code)) return true;

  const message = String(err?.message || '').trim();
  return /timeout|timed out|socket hang up|network error/iu.test(message);
}

function collectOutputItems(value, items = []) {
  if (!value) return items;
  if (Array.isArray(value)) {
    value.forEach((item) => collectOutputItems(item, items));
    return items;
  }
  if (typeof value !== 'object') return items;

  const hasUrl = value.fileUrl || value.url || value.download_url || value.downloadUrl || value.file_url;
  if (hasUrl) {
    items.push(value);
  }

  for (const key of ['results', 'outputs', 'output', 'files', 'data']) {
    if (value[key] && value[key] !== value) {
      collectOutputItems(value[key], items);
    }
  }
  return items;
}

function getOutputUrl(item) {
  return String(
    item?.fileUrl ||
    item?.url ||
    item?.download_url ||
    item?.downloadUrl ||
    item?.file_url ||
    ''
  ).trim();
}

function isVideoOutput(item) {
  const fileType = String(item?.fileType || item?.type || '').toLowerCase();
  if (VIDEO_FILE_TYPES.has(fileType)) return true;
  const url = getOutputUrl(item).toLowerCase();
  return /\.(mp4|mov|webm|mkv|avi)(?:[?#].*)?$/u.test(url);
}

function extractRunningHubOutputUrl(payload, options = {}) {
  const outputNodeId = String(options.outputNodeId || '').trim();
  const items = collectOutputItems(payload).filter((item) => getOutputUrl(item));
  if (!items.length) return '';

  if (outputNodeId) {
    const matchedNode = items.find((item) => String(item.nodeId || item.node_id || '').trim() === outputNodeId);
    if (matchedNode) return getOutputUrl(matchedNode);
  }

  const videoOutput = items.find(isVideoOutput);
  return getOutputUrl(videoOutput || items[0]);
}

function createAuthHeaders(apiKey, extraHeaders = {}) {
  return {
    ...extraHeaders,
    Authorization: `Bearer ${apiKey}`
  };
}

function hasRunningHubPoseInput(options = {}) {
  const poseNodeId = String(options.poseNodeId || RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId).trim();
  const poseFieldName = String(options.poseFieldName || RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName).trim();
  if (String(options.remotePoseName || '').trim()) return true;
  const nodeInfoList = Array.isArray(options.nodeInfoList) ? options.nodeInfoList : [];
  return nodeInfoList.some((item) => {
    const nodeMatches = !poseNodeId || String(item?.nodeId || '').trim() === poseNodeId;
    const fieldMatches = !poseFieldName || String(item?.fieldName || '').trim() === poseFieldName;
    return nodeMatches && fieldMatches && String(item?.fieldValue || '').trim();
  });
}

function createRunningHubClient(deps = {}) {
  const axiosClient = deps.axiosClient || axios;
  const fsImpl = deps.fsImpl || fs;
  const formDataFactory = deps.formDataFactory || (() => new FormData());
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  async function uploadResource(filePath, options = {}) {
    const apiKey = resolveRunningHubApiKey(options);
    if (!apiKey) throw new Error('未配置 RunningHub API Key');

    const form = formDataFactory();
    form.append('file', fsImpl.createReadStream(filePath));
    form.append('apiKey', apiKey);
    const url = joinRunningHubPath(options.baseUrl, '/media/upload/binary');
    const res = await axiosClient.post(url, form, {
      headers: createAuthHeaders(apiKey, form.getHeaders ? form.getHeaders() : {}),
      httpsAgent: insecureHttpsAgent
    });
    assertRunningHubSuccess(res.data, '资源上传');
    const fileName = extractRunningHubUploadFileName(res.data);
    if (!fileName) {
      throw new Error(`RunningHub 上传未返回 fileName: ${JSON.stringify(res.data)}`);
    }
    return fileName;
  }

  async function submitWorkflow(options = {}) {
    const apiKey = resolveRunningHubApiKey(options);
    if (!apiKey) throw new Error('未配置 RunningHub API Key');

    const workflowId = String(options.workflowId || '').trim();
    const payload = {
      apiKey,
      workflowId,
      addMetadata: options.addMetadata !== false,
      nodeInfoList: Array.isArray(options.nodeInfoList) ? options.nodeInfoList : []
    };

    if (options.accessPassword) payload.accessPassword = String(options.accessPassword);
    if (options.instanceType) payload.instanceType = String(options.instanceType);
    if (options.usePersonalQueue !== undefined) payload.usePersonalQueue = options.usePersonalQueue;
    if (options.retainSeconds !== undefined) payload.retainSeconds = Number(options.retainSeconds);

    const res = await axiosClient.post(buildRunningHubRunUrl(options), payload, {
      headers: createAuthHeaders(apiKey, { 'Content-Type': 'application/json' }),
      httpsAgent: insecureHttpsAgent
    });
    assertRunningHubSuccess(res.data, '任务提交');

    const taskId = extractRunningHubTaskId(res.data);
    if (!taskId) {
      throw new Error(`RunningHub 未返回 taskId: ${JSON.stringify(res.data)}`);
    }

    return {
      taskId,
      status: extractRunningHubTaskStatus(res.data),
      response: res.data
    };
  }

  async function queryTask(options = {}) {
    const apiKey = resolveRunningHubApiKey(options);
    if (!apiKey) throw new Error('未配置 RunningHub API Key');
    const taskId = String(options.taskId || '').trim();
    if (!taskId) throw new Error('未配置 RunningHub taskId');

    const res = await axiosClient.post(joinRunningHubPath(options.baseUrl, '/query'), {
      apiKey,
      taskId
    }, {
      headers: createAuthHeaders(apiKey, { 'Content-Type': 'application/json' }),
      httpsAgent: insecureHttpsAgent
    });
    assertRunningHubSuccess(res.data, '任务查询');
    return res.data;
  }

  async function waitForOutputs(options = {}) {
    const maxAttempts = Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS);
    const pollIntervalMs = Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    let lastTransientError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let payload;
      try {
        payload = await queryTask(options);
        lastTransientError = null;
      } catch (err) {
        if (!isTransientRunningHubQueryError(err)) throw err;
        lastTransientError = err;
        await new Promise((resolve) => setTimeoutFn(resolve, pollIntervalMs));
        continue;
      }
      const status = extractRunningHubTaskStatus(payload);
      const outputUrl = extractRunningHubOutputUrl(payload, options);
      if (outputUrl && (!status || SUCCESS_STATUSES.has(status))) {
        return {
          outputUrl,
          status,
          response: payload
        };
      }
      if (FAILURE_STATUSES.has(status)) {
        throw new Error(formatRunningHubErrorMessage(payload, { taskId: options.taskId, status }));
      }
      await new Promise((resolve) => setTimeoutFn(resolve, pollIntervalMs));
    }

    if (lastTransientError) {
      throw new Error(`等待 RunningHub 结果超时: taskId=${options.taskId}, 最后一次查询失败: ${lastTransientError.message}`);
    }
    throw new Error(`等待 RunningHub 结果超时: taskId=${options.taskId}`);
  }

  async function renderExternalAudio(options = {}) {
    const resumeTaskId = String(options.resumeTaskId || options.taskId || '').trim();
    if (resumeTaskId) {
      if (!hasRunningHubPoseInput(options)) {
        throw new Error('RunningHub 数字人合成缺少动作参考视频节点输入，已停止恢复任务');
      }
      const output = await waitForOutputs({
        ...options,
        taskId: resumeTaskId
      });
      return {
        provider: 'runninghub',
        taskId: resumeTaskId,
        resumed: true,
        status: output.status,
        videoUrl: output.outputUrl,
        remoteAudioName: String(options.remoteAudioName || ''),
        remoteImageName: String(options.remoteImageName || ''),
        remotePoseName: String(options.remotePoseName || ''),
        nodeInfoList: Array.isArray(options.nodeInfoList) ? options.nodeInfoList : [],
        outputResponse: output.response
      };
    }

    const audioFileName = await uploadResource(options.audioPath, options);
    const imageFileName = await uploadResource(options.imagePath, options);
    const poseNodeId = String(options.poseNodeId || RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId).trim();
    if (!options.posePath || !poseNodeId) {
      throw new Error('RunningHub 数字人合成缺少动作参考视频，已停止提交任务');
    }
    const poseFileName = await uploadResource(options.posePath, options);
    if (!poseFileName) {
      throw new Error('RunningHub 数字人合成动作参考视频上传失败，已停止提交任务');
    }
    const nodeInfoList = [
      {
        nodeId: String(options.audioNodeId || RUNNINGHUB_INFINITETALK_3INPUT.audioNodeId),
        fieldName: String(options.audioFieldName || RUNNINGHUB_INFINITETALK_3INPUT.audioFieldName),
        fieldValue: audioFileName
      },
      {
        nodeId: String(options.imageNodeId || RUNNINGHUB_INFINITETALK_3INPUT.imageNodeId),
        fieldName: String(options.imageFieldName || RUNNINGHUB_INFINITETALK_3INPUT.imageFieldName),
        fieldValue: imageFileName
      }
    ];
    nodeInfoList.push({
      nodeId: poseNodeId,
      fieldName: String(options.poseFieldName || RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName),
      fieldValue: poseFileName
    });
    const submission = await submitWorkflow({
      ...options,
      nodeInfoList
    });
    if (typeof options.onSubmitted === 'function') {
      options.onSubmitted({
        provider: 'runninghub',
        taskId: submission.taskId,
        status: submission.status,
        remoteAudioName: audioFileName,
        remoteImageName: imageFileName,
        remotePoseName: poseFileName,
        nodeInfoList,
        submitResponse: submission.response
      });
    }
    let output;
    try {
      output = await waitForOutputs({
        ...options,
        taskId: submission.taskId
      });
    } catch (err) {
      err.runningHubTaskId = submission.taskId;
      err.remoteAudioName = audioFileName;
      err.remoteImageName = imageFileName;
      err.remotePoseName = poseFileName;
      err.nodeInfoList = nodeInfoList;
      err.code = err.code || RUNNINGHUB_SUBMITTED_ERROR_CODE;
      err.submitted = true;
      throw err;
    }

    return {
      provider: 'runninghub',
      taskId: submission.taskId,
      status: output.status || submission.status,
      videoUrl: output.outputUrl,
      remoteAudioName: audioFileName,
      remoteImageName: imageFileName,
      remotePoseName: poseFileName,
      nodeInfoList,
      submitResponse: submission.response,
      outputResponse: output.response
    };
  }

  return {
    queryTask,
    renderExternalAudio,
    submitWorkflow,
    uploadResource,
    waitForOutputs
  };
}

module.exports = {
  DEFAULT_RUNNINGHUB_BASE_URL,
  RUNNINGHUB_SUBMITTED_ERROR_CODE,
  buildRunningHubRunUrl,
  createRunningHubClient,
  extractRunningHubFailureReason,
  extractRunningHubOutputUrl,
  formatRunningHubErrorMessage,
  isTransientRunningHubQueryError,
  normalizeRunningHubBaseUrl,
  resolveRunningHubApiKey
};
