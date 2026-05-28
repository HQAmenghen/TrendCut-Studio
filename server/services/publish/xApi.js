const defaultAxios = require('axios');
const DefaultFormData = require('form-data');

const {
  createFailureSummaryFromError
} = require('../../core/failureSummary');

const X_API_BASE_URL = 'https://api.x.com/2';
const X_POST_TEXT_MAX_CHARS = 280;
const X_VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_STATUS_POLLS = 24;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => cleanText(tag).replace(/^#+/, ''))
    .filter(Boolean)
    .map((tag) => `#${tag}`);
}

function compactPostText(text, maxChars = X_POST_TEXT_MAX_CHARS) {
  const normalized = String(text || '').replace(/[ \t]+\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function buildXPostText(job, maxChars = X_POST_TEXT_MAX_CHARS) {
  const title = cleanText(job?.publishData?.title || job?.asset?.metadata?.suggestedTitle || job?.asset?.label || '');
  const description = String(job?.publishData?.description || job?.asset?.metadata?.suggestedDescription || '').trim();
  const tagLine = normalizeTags(job?.publishData?.tags || []).join(' ');
  const parts = [];
  if (title) parts.push(title);
  if (description && description !== title) parts.push(description);
  if (tagLine && !description.includes(tagLine)) parts.push(tagLine);
  return compactPostText(parts.join('\n\n'), maxChars);
}

function detectMediaType(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function parseXApiError(error) {
  const response = error?.response;
  const payload = response?.data;
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const firstError = errors[0] || null;
  const status = String(response?.status || firstError?.status || '');
  const detail = firstError?.detail || payload?.detail || payload?.title || error?.message || 'X API request failed';
  const code = status === '429'
    ? 'RATE_LIMIT'
    : (status === '401' || status === '403' ? 'LOGIN_REQUIRED' : 'API_ERROR');
  const next = new Error(detail);
  next.code = code;
  next.details = JSON.stringify(payload || {}, null, 0);
  next.status = status;
  return next;
}

function getUploadChunkBytes(value) {
  const parsed = parseInt(value || process.env.X_MEDIA_UPLOAD_CHUNK_BYTES || DEFAULT_UPLOAD_CHUNK_BYTES, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_UPLOAD_CHUNK_BYTES;
  return Math.max(256 * 1024, Math.min(parsed, 16 * 1024 * 1024));
}

function createXApiPublisher(deps) {
  const {
    fs,
    path,
    axios = defaultAxios,
    FormData = DefaultFormData,
    readPublishJobs,
    readPublishConfig,
    writePublishConfig,
    updatePublishPlatformTask,
    uploadChunkBytes
  } = deps;

  if (!fs || !path || typeof readPublishJobs !== 'function' || typeof readPublishConfig !== 'function' || typeof updatePublishPlatformTask !== 'function') {
    throw new Error('createXApiPublisher missing required dependencies');
  }

  const runtimeProcesses = new Map();

  function safeUpdatePublishPlatformTask(jobId, patch) {
    try {
      updatePublishPlatformTask(jobId, 'x', patch);
    } catch (_err) {}
  }

  function getCurrentTask(jobId) {
    const payload = readPublishJobs();
    const job = (payload.jobs || []).find((item) => item.id === jobId) || null;
    const task = (job?.platformTasks || []).find((item) => item.platform === 'x') || null;
    return { job, task };
  }

  function getCurrentRuntime(jobId) {
    const { task } = getCurrentTask(jobId);
    return task?.runtime && typeof task.runtime === 'object' ? task.runtime : {};
  }

  function getRuntimeLogs(jobId) {
    const runtime = getCurrentRuntime(jobId);
    return Array.isArray(runtime.logs) ? runtime.logs : [];
  }

  function updateRuntime(jobId, patch) {
    const currentRuntime = getCurrentRuntime(jobId);
    safeUpdatePublishPlatformTask(jobId, {
      runtime: {
        ...currentRuntime,
        updatedAt: new Date().toISOString(),
        ...patch,
        logs: patch.logs || currentRuntime.logs || []
      }
    });
  }

  function appendLog(jobId, line, state, progress, extra = {}) {
    const message = String(line || '').trim();
    if (!message) return;
    updateRuntime(jobId, {
      state,
      lastMessage: message,
      progress,
      ...extra,
      logs: [...getRuntimeLogs(jobId), `[${state}] ${message}`].slice(-120)
    });
  }

  function resolveStandaloneRuntimeVideoPath(job) {
    const taskDir = String(job?.asset?.metadata?.taskDir || '').trim();
    if (!taskDir) return '';
    const candidate = path.resolve(taskDir, 'standalone_output_vertical.mp4');
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : '';
    } catch (_err) {
      return '';
    }
  }

  function resolveJobVideoPath(job) {
    return resolveStandaloneRuntimeVideoPath(job) || String(job?.asset?.path || '').trim();
  }

  function getXAccounts(config = readPublishConfig()) {
    return Array.isArray(config?.x?.accounts) ? config.x.accounts : [];
  }

  function resolveXAccount(task, config = readPublishConfig()) {
    const accountId = String(task?.accountId || '').trim();
    const accounts = getXAccounts(config);
    if (accountId) {
      return accounts.find((account) => String(account.id || '').trim() === accountId) || null;
    }
    return accounts[0] || null;
  }

  function buildRefreshTokenHeaders(account) {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const clientId = String(account?.clientId || '').trim();
    const clientSecret = String(account?.clientSecret || '').trim();
    if (clientId && clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    }
    return headers;
  }

  function persistRefreshedXAccount(accountId, tokenPayload) {
    if (typeof writePublishConfig !== 'function') return;
    const config = readPublishConfig();
    const accounts = getXAccounts(config).map((account) => {
      if (String(account.id || '').trim() !== accountId) return account;
      return {
        ...account,
        accessToken: tokenPayload.access_token || account.accessToken || '',
        refreshToken: tokenPayload.refresh_token || account.refreshToken || '',
        scopes: tokenPayload.scope || account.scopes || ''
      };
    });
    writePublishConfig({
      ...config,
      x: {
        ...(config.x || {}),
        accounts
      }
    });
  }

  async function refreshXAccessToken(account) {
    const refreshToken = String(account?.refreshToken || '').trim();
    const clientId = String(account?.clientId || '').trim();
    if (!refreshToken || !clientId) {
      return null;
    }
    const form = new URLSearchParams();
    form.set('refresh_token', refreshToken);
    form.set('grant_type', 'refresh_token');
    form.set('client_id', clientId);
    try {
      const response = await axios.post(`${X_API_BASE_URL}/oauth2/token`, form.toString(), {
        timeout: 60000,
        headers: buildRefreshTokenHeaders(account)
      });
      const payload = response.data || {};
      if (!payload.access_token) {
        throw new Error('X refresh token response did not include access token');
      }
      persistRefreshedXAccount(String(account.id || '').trim(), payload);
      return payload.access_token;
    } catch (error) {
      throw parseXApiError(error);
    }
  }

  function getAuthHeaders(accessToken) {
    return {
      Authorization: `Bearer ${String(accessToken || '').trim()}`
    };
  }

  async function requestJson(method, url, accessToken, data = undefined, options = {}) {
    try {
      const response = method === 'post'
        ? await axios.post(url, data, {
          signal: options.signal,
          params: options.params,
          timeout: options.timeout || 120000,
          maxBodyLength: Infinity,
          headers: {
            ...getAuthHeaders(accessToken),
            ...(data ? { 'Content-Type': 'application/json' } : {})
          }
        })
        : await axios({
          method,
          url,
          data,
          signal: options.signal,
          params: options.params,
          timeout: options.timeout || 120000,
          maxBodyLength: Infinity,
          headers: {
            ...getAuthHeaders(accessToken),
            ...(data ? { 'Content-Type': 'application/json' } : {})
          }
        });
      return response.data || {};
    } catch (error) {
      throw parseXApiError(error);
    }
  }

  async function initializeMediaUpload(accessToken, videoPath, totalBytes, signal) {
    const payload = {
      media_category: 'tweet_video',
      media_type: detectMediaType(videoPath),
      total_bytes: totalBytes
    };
    const response = await requestJson('post', `${X_API_BASE_URL}/media/upload/initialize`, accessToken, payload, { signal });
    const mediaId = String(response?.data?.id || '').trim();
    if (!mediaId) {
      throw new Error('X media initialize did not return media id');
    }
    return { mediaId, response };
  }

  async function appendMediaChunk(accessToken, mediaId, videoPath, segmentIndex, start, end, signal) {
    const form = new FormData();
    form.append('segment_index', String(segmentIndex));
    form.append('media', fs.createReadStream(videoPath, { start, end }), {
      filename: path.basename(videoPath),
      contentType: detectMediaType(videoPath)
    });
    try {
      await axios.post(`${X_API_BASE_URL}/media/upload/${mediaId}/append`, form, {
        signal,
        timeout: 180000,
        maxBodyLength: Infinity,
        headers: {
          ...getAuthHeaders(accessToken),
          ...form.getHeaders()
        }
      });
    } catch (error) {
      throw parseXApiError(error);
    }
  }

  async function finalizeMediaUpload(accessToken, mediaId, signal) {
    return requestJson('post', `${X_API_BASE_URL}/media/upload/${mediaId}/finalize`, accessToken, undefined, { signal });
  }

  async function getMediaUploadStatus(accessToken, mediaId, signal) {
    return requestJson('get', `${X_API_BASE_URL}/media/upload`, accessToken, undefined, {
      signal,
      params: {
        media_id: mediaId,
        command: 'STATUS'
      }
    });
  }

  async function waitForMediaProcessing(accessToken, mediaId, initialResponse, signal, onProgress) {
    let response = initialResponse || {};
    for (let attempt = 0; attempt < MAX_MEDIA_STATUS_POLLS; attempt += 1) {
      const info = response?.data?.processing_info || {};
      const state = String(info.state || '').toLowerCase();
      if (state === 'failed') {
        const error = new Error(info.error?.message || 'X media processing failed');
        error.code = 'UPLOAD_FAILED';
        error.details = JSON.stringify(info.error || info, null, 0);
        throw error;
      }
      if (state === 'succeeded' || (!state && attempt > 0) || (!info.check_after_secs && !info.progress_percent)) {
        return response;
      }
      const progress = Number.isFinite(Number(info.progress_percent)) ? Number(info.progress_percent) : null;
      if (typeof onProgress === 'function') onProgress(progress);
      const waitSeconds = process.env.NODE_ENV === 'test'
        ? 0
        : Math.max(1, Math.min(30, Number(info.check_after_secs || 2)));
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      response = await getMediaUploadStatus(accessToken, mediaId, signal);
    }
    const error = new Error('X media processing did not finish before timeout');
    error.code = 'TIMEOUT';
    throw error;
  }

  async function uploadVideo(accessToken, videoPath, signal, onProgress) {
    const stat = fs.statSync(videoPath);
    if (!stat.isFile()) {
      const error = new Error('待发布视频文件不存在');
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }
    if (stat.size > X_VIDEO_MAX_BYTES) {
      const error = new Error('X 视频上传上限为 512MB，请压缩后再发布');
      error.code = 'INVALID_INPUT';
      throw error;
    }

    const { mediaId } = await initializeMediaUpload(accessToken, videoPath, stat.size, signal);
    const chunkBytes = getUploadChunkBytes(uploadChunkBytes);
    const totalSegments = Math.ceil(stat.size / chunkBytes);
    for (let segmentIndex = 0; segmentIndex < totalSegments; segmentIndex += 1) {
      const start = segmentIndex * chunkBytes;
      const end = Math.min(start + chunkBytes - 1, stat.size - 1);
      await appendMediaChunk(accessToken, mediaId, videoPath, segmentIndex, start, end, signal);
      if (typeof onProgress === 'function') {
        onProgress(Math.round(((segmentIndex + 1) / totalSegments) * 70));
      }
    }

    const finalizeResponse = await finalizeMediaUpload(accessToken, mediaId, signal);
    await waitForMediaProcessing(accessToken, mediaId, finalizeResponse, signal, (progress) => {
      if (typeof onProgress === 'function' && progress !== null) {
        onProgress(70 + Math.round(progress * 0.2));
      }
    });
    return mediaId;
  }

  async function createPost(accessToken, job, account, mediaId, signal) {
    const text = buildXPostText(job);
    if (!text) {
      const error = new Error('X 发帖正文为空，请补充标题或描述');
      error.code = 'INVALID_INPUT';
      throw error;
    }
    const body = {
      text,
      media: {
        media_ids: [mediaId]
      }
    };
    if (account?.markMadeWithAi !== false && account?.markMadeWithAi !== 'false') {
      body.made_with_ai = true;
    }
    const response = await requestJson('post', `${X_API_BASE_URL}/tweets`, accessToken, body, { signal });
    const postId = String(response?.data?.id || '').trim();
    if (!postId) {
      throw new Error('X post response did not include post id');
    }
    const username = String(account?.username || '').replace(/^@+/, '').trim();
    return {
      postId,
      text: response?.data?.text || text,
      url: username ? `https://x.com/${username}/status/${postId}` : `https://x.com/i/web/status/${postId}`,
      raw: response
    };
  }

  async function startXPublish(jobId, publishMode = 'publish') {
    const mode = String(publishMode || 'publish').trim();
    if (mode !== 'publish') {
      throw new Error('X API 暂不支持草稿模式，请使用自动发表');
    }

    const runtimeKey = `${jobId}:x`;
    if (runtimeProcesses.has(runtimeKey)) {
      throw new Error('X 自动发布任务已在运行');
    }

    const { job, task } = getCurrentTask(jobId);
    if (!job) throw new Error('发布任务不存在');
    if (!task) throw new Error('该任务未选择 X');

    const config = readPublishConfig();
    if (!config?.x?.enabled) {
      throw new Error('X 尚未启用');
    }
    const account = resolveXAccount(task, config);
    if (!account) {
      throw new Error('未找到 X 授权账号，请先在发布中心添加账号');
    }
    let accessToken = String(account.accessToken || account.oauth2AccessToken || '').trim();
    if (!accessToken) {
      accessToken = await refreshXAccessToken(account);
    }
    if (!accessToken) {
      throw new Error('X 账号缺少 OAuth2 Access Token，且无法通过 Refresh Token 刷新');
    }

    const videoPath = resolveJobVideoPath(job);
    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error('待发布视频文件不存在');
    }

    const abortController = new AbortController();
    const runtimeEntry = {
      jobId,
      publishMode: mode,
      cancelledByUser: false,
      abortController
    };
    runtimeProcesses.set(runtimeKey, runtimeEntry);

    safeUpdatePublishPlatformTask(jobId, {
      status: 'publishing',
      lastRunAt: new Date().toISOString(),
      lastRunMode: mode,
      retryCount: Number(task?.retryCount || 0),
      runtime: {
        state: 'starting',
        lastMessage: '正在启动 X API 自动发布...',
        updatedAt: new Date().toISOString(),
        publishMode: mode,
        progress: 3,
        adapter: 'x-api-v2',
        logs: ['启动 X API v2 自动发布任务']
      }
    });

    const publishPromise = (async () => {
      appendLog(jobId, '正在上传视频到 X', 'uploading', 10);
      const mediaId = await uploadVideo(accessToken, videoPath, abortController.signal, (progress) => {
        appendLog(jobId, `视频上传进度 ${progress}%`, 'uploading', Math.max(10, Math.min(82, progress)));
      });

      appendLog(jobId, '视频处理完成，正在创建 X Post', 'publishing', 88, { mediaId });
      const result = await createPost(accessToken, job, account, mediaId, abortController.signal);

      runtimeProcesses.delete(runtimeKey);
      safeUpdatePublishPlatformTask(jobId, {
        status: 'published',
        publishResult: {
          platform: 'x',
          postId: result.postId,
          postUrl: result.url,
          text: result.text,
          publishedAt: new Date().toISOString()
        },
        runtime: {
          state: 'success',
          lastMessage: `X 已发布：${result.url}`,
          updatedAt: new Date().toISOString(),
          publishMode: mode,
          progress: 100,
          adapter: 'x-api-v2',
          mediaId,
          postId: result.postId,
          postUrl: result.url,
          logs: [...getRuntimeLogs(jobId), `[success] X 已发布：${result.url}`].slice(-120)
        }
      });
      return result;
    })();

    runtimeEntry.promise = publishPromise;
    publishPromise.catch((error) => {
      runtimeProcesses.delete(runtimeKey);
      if (runtimeEntry.cancelledByUser) return null;
      const normalizedError = error?.response ? parseXApiError(error) : error;
      const failureSummary = createFailureSummaryFromError(
        normalizedError,
        'publish_x',
        'x_api',
        {
          context: {
            jobId,
            accountId: account.id || '',
            username: account.username || ''
          }
        }
      );
      safeUpdatePublishPlatformTask(jobId, {
        status: 'failed',
        lastFailureAt: new Date().toISOString(),
        failureSummary,
        runtime: {
          state: 'failed',
          lastMessage: normalizedError.message || 'X 自动发布失败',
          updatedAt: new Date().toISOString(),
          publishMode: mode,
          progress: 100,
          adapter: 'x-api-v2',
          logs: [...getRuntimeLogs(jobId), `[error] ${normalizedError.message || 'X 自动发布失败'}`].slice(-120)
        }
      });
      return null;
    });

    return {
      success: true,
      started: true,
      platform: 'x',
      jobId
    };
  }

  function retryXPublish(jobId, mode = '') {
    const { task } = getCurrentTask(jobId);
    if (!task) throw new Error('该任务未选择 X');
    safeUpdatePublishPlatformTask(jobId, {
      retryCount: Number(task?.retryCount || 0) + 1,
      runtime: {
        state: 'starting',
        lastMessage: '准备重新执行 X 自动发布...',
        updatedAt: new Date().toISOString(),
        publishMode: 'publish',
        progress: 2,
        adapter: 'x-api-v2',
        logs: [...(Array.isArray(task?.runtime?.logs) ? task.runtime.logs : []), '[retry] 正在重试 X 自动发布'].slice(-120)
      }
    });
    startXPublish(jobId, mode || 'publish').catch((err) => {
      console.error(`Failed to retry X publish: ${err.message}`);
    });
  }

  function cancelXPublish(jobId) {
    const runtimeKey = `${jobId}:x`;
    const runtimeEntry = runtimeProcesses.get(runtimeKey);
    if (!runtimeEntry) {
      throw new Error('当前没有可取消的 X 发布任务');
    }
    runtimeEntry.cancelledByUser = true;
    runtimeEntry.abortController.abort();
    runtimeProcesses.delete(runtimeKey);
    safeUpdatePublishPlatformTask(jobId, {
      status: 'cancelled',
      lastCancelledAt: new Date().toISOString(),
      runtime: {
        state: 'cancelled',
        lastMessage: '用户已取消当前 X 发布任务',
        updatedAt: new Date().toISOString(),
        publishMode: runtimeEntry.publishMode,
        progress: 100,
        adapter: 'x-api-v2',
        logs: [...getRuntimeLogs(jobId), '[cancelled] 用户手动取消了 X API 发布任务'].slice(-120)
      }
    });
  }

  return {
    startXPublish,
    retryXPublish,
    cancelXPublish,
    getRuntimeProcess: (jobId) => runtimeProcesses.get(`${jobId}:x`) || null,
    buildXPostText
  };
}

module.exports = {
  createXApiPublisher,
  buildXPostText
};
