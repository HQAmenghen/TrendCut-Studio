import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, '..', '..');

function readProjectEnvValue(key) {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return '';
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (!match || match[1] !== key) continue;
    return match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function getBaseUrl() {
  return String(process.env.COMFY_PANEL_AGENT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getAgentToken() {
  return String(process.env.AGENT_API_TOKEN || readProjectEnvValue('AGENT_API_TOKEN') || '').trim();
}

function createToolErrorPayload(error) {
  const payload = error?.payload || {};
  return {
    success: false,
    error: payload.error || error.message || 'MCP tool request failed',
    code: payload.code || 'MCP_AGENT_REQUEST_FAILED',
    stage: payload.stage || 'mcp.agent',
    details: payload.details || '',
    hint: payload.hint || ''
  };
}

async function requestAgent(path, options = {}) {
  const token = getAgentToken();
  if (!token) {
    throw new Error('AGENT_API_TOKEN is required for video-assistant-agent-mcp');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(options.headers || {})
  };
  let body = options.body;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: options.method || 'GET',
    headers,
    body
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_err) {
    payload = { success: false, error: text || response.statusText };
  }

  if (!response.ok || payload?.success === false) {
    const err = new Error(payload?.error || response.statusText);
    err.payload = payload;
    err.status = response.status;
    throw err;
  }
  return payload;
}

function jsonContent(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function errorContent(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(createToolErrorPayload(error), null, 2)
      }
    ]
  };
}

function loginQrCodeContent(payload) {
  const image = payload?.image || {};
  const textPayload = {
    ...payload,
    image: {
      ...image,
      qrCodeBase64: image.qrCodeBase64 ? '[omitted: returned as MCP image content]' : '',
      qrCodeDataUrl: image.qrCodeDataUrl ? '[omitted: returned as MCP image content]' : ''
    }
  };
  const content = [
    {
      type: 'text',
      text: JSON.stringify(textPayload, null, 2)
    }
  ];
  if (image.qrCodeBase64) {
    content.push({
      type: 'image',
      data: image.qrCodeBase64,
      mimeType: image.mimeType || 'image/png'
    });
  }
  return { content };
}

function createTool(handler) {
  return async (args = {}) => {
    try {
      return jsonContent(await handler(args));
    } catch (error) {
      return errorContent(error);
    }
  };
}

function normalizePartitionId(value) {
  const text = String(value || '').trim().toLowerCase();
  const aliases = {
    crypto: 'crypto',
    '加密': 'crypto',
    '币圈': 'crypto',
    web3: 'crypto',
    finance: 'finance',
    '金融': 'finance',
    tech: 'tech',
    '科技': 'tech',
    ai: 'ai',
    '人工智能': 'ai'
  };
  return aliases[text] || text || 'crypto';
}

function searchPostsPayload(args = {}, overrides = {}) {
  return {
    partitionId: normalizePartitionId(overrides.partitionId || args.partitionId || args.partition),
    query: overrides.query ?? args.query ?? '',
    limit: overrides.limit || args.limit || 10,
    requireVideo: overrides.requireVideo ?? args.requireVideo ?? false
  };
}

async function searchPosts(args = {}, overrides = {}) {
  return requestAgent('/api/agent/v1/posts/search', {
    method: 'POST',
    body: searchPostsPayload(args, overrides)
  });
}

function postReferenceFromArgs(args = {}) {
  const ref = {};
  for (const key of ['post', 'id', 'postId', 'postUrl', 'rank', 'partitionId', 'useSmartClip', 'useCache', 'autoGenerate', 'avatarConfig']) {
    if (args[key] !== undefined) ref[key] = args[key];
  }
  ref.partitionId = normalizePartitionId(ref.partitionId || args.partition);
  return ref;
}

async function generateFromPostReference(args = {}, options = {}) {
  let ref = postReferenceFromArgs(args);
  if (!ref.post && !ref.id && !ref.postId && !ref.postUrl && ref.rank) {
    const result = await searchPosts(args, {
      partitionId: ref.partitionId,
      limit: Math.max(Number(ref.rank) || 1, Number(args.limit || 10) || 10),
      requireVideo: true
    });
    const post = (result.posts || []).find((item) => Number(item.rank) === Number(ref.rank)) ||
      (result.posts || [])[Number(args.index || 1) - 1];
    if (post) ref = { ...ref, post };
  }
  return requestAgent(options.endpoint || '/api/agent/v1/videos/generate-from-post', {
    method: 'POST',
    body: {
      ...ref,
      ...(options.body || {})
    }
  });
}

function jobQuery(args = {}) {
  return args.outputPath ? `?outputPath=${encodeURIComponent(args.outputPath)}` : '';
}

function jobPath(args = {}, suffix = '') {
  return `/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}${suffix}${jobQuery(args)}`;
}

function verticalJobPath(args = {}) {
  return `/api/agent/v1/vertical/jobs/${encodeURIComponent(args.verticalJobId || args.jobId)}`;
}

function avatarConfigFromArgs(args = {}, overrides = {}) {
  const config = args.avatarConfig && typeof args.avatarConfig === 'object'
    ? { ...args.avatarConfig }
    : {};
  for (const key of [
    'renderProvider',
    'provider',
    'serverUrl',
    'runningHubBaseUrl',
    'runningHubWorkflowId',
    'runningHubRunPath',
    'runningHubAccessPassword',
    'runningHubInstanceType',
    'runningHubUsePersonalQueue',
    'runningHubRetainSeconds',
    'runningHubAudioNodeId',
    'runningHubAudioFieldName',
    'runningHubImageNodeId',
    'runningHubImageFieldName',
    'runningHubOutputNodeId',
    'audioPreset',
    'imagePreset',
    'genText'
  ]) {
    if (args[key] !== undefined) config[key] = args[key];
  }
  return {
    ...config,
    ...overrides
  };
}

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const tools = [
  {
    name: 'health_check',
    description: 'Check local video assistant health and runtime dependencies.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: createTool(() => requestAgent('/api/agent/v1/health'))
  },
  {
    name: 'list_capabilities',
    description: 'List the local video assistant V0 capabilities.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: createTool(() => requestAgent('/api/agent/v1/capabilities'))
  },
  {
    name: 'search_posts',
    description: 'Search the local video assistant xAI/X hotspot leaderboard results for candidate posts/materials. Use this for local requests like “加密分区榜单”, “当前加密榜单”, “crypto partition leaderboard”, or “热点素材”; do not use web search for those local leaderboard requests.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword to filter posts inside the local leaderboard.' },
        partitionId: {
          type: 'string',
          description: 'Local leaderboard partition id. Use crypto for 加密, finance for 金融, tech for 科技, ai for AI.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        limit: { type: 'number', description: 'Maximum number of posts to return.' },
        requireVideo: { type: 'boolean', description: 'When true, only return posts that already have a video URL.' }
      }
    },
    handler: createTool((args) => searchPosts(args))
  },
  {
    name: 'list_hotspot_partitions',
    description: 'List available local hotspot leaderboard partitions and account counts. Use when the user asks “有哪些榜单分区”, “支持哪些分区”, or is unsure whether crypto/finance/tech/AI exists.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: createTool(() => requestAgent('/api/agent/v1/hotspots/partitions'))
  },
  {
    name: 'get_hotspot_refresh_status',
    description: 'Check whether a local hotspot leaderboard refresh is running and show stage/result freshness. Use for “榜单刷新好了没”, “加密榜单更新到哪了”, or after refresh_hotspot_leaderboard.',
    inputSchema: {
      type: 'object',
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/hotspots/status${queryString({
      partitionId: normalizePartitionId(args.partitionId || args.partition)
    })}`))
  },
  {
    name: 'refresh_hotspot_leaderboard',
    description: 'Refresh/regenerate the local hotspot leaderboard for a partition. Use when the user says “刷新加密分区榜单”, “重新拉取 AI 榜单”, or “更新当前热点榜单”. This may take time; follow with get_hotspot_refresh_status or list_hotspot_leaderboard.',
    inputSchema: {
      type: 'object',
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/hotspots/refresh', {
      method: 'POST',
      body: {
        partitionId: normalizePartitionId(args.partitionId || args.partition)
      }
    }))
  },
  {
    name: 'list_hotspot_leaderboard',
    description: 'List the current local hotspot leaderboard for a partition. This is the preferred tool when the user asks to view “加密分区榜单”, “金融分区榜单”, “科技分区榜单”, “AI 分区榜单”, or the current local ranking contents. It reads local Comfy Panel/video assistant results and should be used instead of Google/Bing/browser search.',
    inputSchema: {
      type: 'object',
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition to list: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        query: { type: 'string', description: 'Optional keyword filter inside the leaderboard.' },
        limit: { type: 'number', description: 'Maximum number of posts to return. Default is 10.' },
        requireVideo: { type: 'boolean', description: 'When true, only return posts with video URLs. Default false for browsing the leaderboard.' }
      }
    },
    handler: createTool((args) => searchPosts(args, {
      partitionId: args.partitionId || 'crypto',
      query: args.query || '',
      limit: args.limit || 10,
      requireVideo: args.requireVideo === true
    }))
  },
  {
    name: 'list_video_ready_posts',
    description: 'List local hotspot leaderboard posts that already have video URLs and are ready for material-driven video generation. Use when the user asks “哪些素材可以生成视频”, “可生成视频的加密榜单”, or “找一个能生成的视频素材”.',
    inputSchema: {
      type: 'object',
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition to list: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        query: { type: 'string', description: 'Optional keyword filter.' },
        limit: { type: 'number', description: 'Maximum number of posts to return. Default is 10.' }
      }
    },
    handler: createTool((args) => searchPosts(args, {
      partitionId: args.partitionId || 'crypto',
      query: args.query || '',
      limit: args.limit || 10,
      requireVideo: true
    }))
  },
  {
    name: 'find_post_by_rank',
    description: 'Get one specific local leaderboard post by rank within a partition. Use before generation when the user says “第 1 条”, “榜单第 3 个”, or “选排名 2”.',
    inputSchema: {
      type: 'object',
      required: ['rank'],
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        rank: { type: 'number', description: 'Leaderboard rank to select.' },
        requireVideo: { type: 'boolean', description: 'When true, only select if the post has a video URL.' }
      }
    },
    handler: createTool(async (args) => {
      const result = await searchPosts(args, {
        partitionId: args.partitionId || 'crypto',
        limit: Math.max(Number(args.rank) || 1, 10),
        requireVideo: args.requireVideo === true
      });
      const post = (result.posts || []).find((item) => Number(item.rank) === Number(args.rank));
      return {
        success: !!post,
        partition: result.partition,
        post: post || null,
        hint: post ? '' : '未找到该排名；可先调用 list_hotspot_leaderboard 查看当前榜单'
      };
    })
  },
  {
    name: 'generate_video_from_post',
    description: 'Start material-driven video generation from a selected post returned by search_posts.',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'object' },
        id: { type: 'string' },
        postId: { type: 'string' },
        postUrl: { type: 'string' },
        rank: { type: 'number' },
        partitionId: { type: 'string' },
        idempotencyKey: { type: 'string' },
        useSmartClip: { type: 'boolean' },
        useCache: { type: 'boolean' },
        autoGenerate: { type: 'boolean' },
        avatarConfig: { type: 'object' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/videos/generate-from-post', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'generate_video_from_rank',
    description: 'Start video generation directly from a local leaderboard rank. Use when the user says “把加密榜单第 2 条生成视频” or “用第 1 条热点生成视频”. This still creates a job only; publishing remains draft/confirm gated.',
    inputSchema: {
      type: 'object',
      required: ['rank'],
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        rank: { type: 'number', description: 'Leaderboard rank to generate from.' },
        useSmartClip: { type: 'boolean' },
        useCache: { type: 'boolean' },
        autoGenerate: { type: 'boolean' },
        avatarConfig: { type: 'object' }
      }
    },
    handler: createTool((args) => generateFromPostReference(args))
  },
  {
    name: 'generate_narration_from_post',
    description: 'Start the material workflow but stop after the narration/script draft. Use when the user says “先生成口播稿”, “先出稿我看看”, or wants to review/correct the script before avatar generation.',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'object' },
        id: { type: 'string' },
        postId: { type: 'string' },
        postUrl: { type: 'string' },
        rank: { type: 'number' },
        partitionId: { type: 'string' },
        idempotencyKey: { type: 'string' },
        useSmartClip: { type: 'boolean' },
        useCache: { type: 'boolean' },
        avatarConfig: { type: 'object' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/videos/generate-narration-from-post', {
      method: 'POST',
      body: {
        ...args,
        autoGenerate: false
      }
    }))
  },
  {
    name: 'generate_narration_from_rank',
    description: 'Start narration/script generation from a local leaderboard rank and stop there for user review. Preferred for “用加密榜第 1 条先生成口播稿”.',
    inputSchema: {
      type: 'object',
      required: ['rank'],
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        rank: { type: 'number', description: 'Leaderboard rank to generate narration from.' },
        useSmartClip: { type: 'boolean' },
        useCache: { type: 'boolean' },
        avatarConfig: { type: 'object' }
      }
    },
    handler: createTool((args) => generateFromPostReference(args, {
      endpoint: '/api/agent/v1/videos/generate-narration-from-post',
      body: { autoGenerate: false }
    }))
  },
  {
    name: 'get_job_status',
    description: 'Get status for a material-driven generation job.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool((args) => {
      return requestAgent(jobPath(args));
    })
  },
  {
    name: 'list_vertical_jobs',
    description: 'List local vertical composition jobs, including queued/running/completed/failed status and output artifacts. Use when the user asks “竖屏合成到哪了”, “昨天竖屏任务失败了吗”, “有哪些竖屏任务”, or wants to inspect WeChat-triggered vertical rendering.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional exact vertical job status filter, such as queued, running, completed, failed.' },
        sourceType: { type: 'string', description: 'Optional source type filter, such as agent_material_job or agent_hotspot.' },
        materialTaskDir: { type: 'string', description: 'Optional material task directory, outputPath, or local path to match.' },
        outputPath: { type: 'string', description: 'Alias for materialTaskDir.' },
        limit: { type: 'number', description: 'Maximum jobs to return. Default 50.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/vertical/jobs${queryString({
      status: args.status,
      sourceType: args.sourceType,
      materialTaskDir: args.materialTaskDir,
      outputPath: args.outputPath,
      limit: args.limit || 50
    })}`))
  },
  {
    name: 'list_material_tasks',
    description: 'List completed material-driven project tasks under projects/ that can be imported for vertical rendering or publishing. Use when the user asks “有哪些素材任务”, “昨天生成了哪些任务”, “找可导入竖屏的任务”, or needs an outputPath/material_* value.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional text filter over task id/title/source/script preview.' },
        limit: { type: 'number', description: 'Maximum tasks to return. Default 50.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/material/tasks${queryString({
      query: args.query,
      limit: args.limit || 50
    })}`))
  },
  {
    name: 'get_vertical_job_status',
    description: 'Get one vertical composition job status, recent logs, failure summary, and output video URL. Use after create_vertical_video_from_material_job or create_vertical_video_from_rank.',
    inputSchema: {
      type: 'object',
      required: ['verticalJobId'],
      properties: {
        verticalJobId: { type: 'string', description: 'Vertical queue job id.' }
      }
    },
    handler: createTool((args) => requestAgent(verticalJobPath(args)))
  },
  {
    name: 'create_vertical_video_from_material_job',
    description: 'Create a vertical composition job from an existing material-driven generation job. This is the preferred tool when the user says “把这个任务做成竖屏”, “从昨天微信视频任务继续竖屏合成”, or gives a material jobId/outputPath. It passes sourceTaskDir/materialTaskDir so the backend imports the correct task context and reference subtitles instead of guessing paths.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string', description: 'Material-driven job id.' },
        outputPath: { type: 'string', description: 'Material output dir such as material_xxx, or a Windows/WSL path inside that task.' },
        sourceVideoFile: { type: 'string', description: 'Video file inside the material task dir. Default output_final.mp4.' },
        title: { type: 'string' },
        summary: { type: 'string' },
        renderOptions: { type: 'object' },
        referenceSubtitles: { type: 'array', items: { type: 'object' } },
        forceNew: { type: 'boolean', description: 'When true, create a distinct vertical job even if a matching active job exists.' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/vertical/from-material-job', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'create_vertical_video_from_post',
    description: 'Create a vertical composition job from a selected local hotspot post returned by search_posts/list_hotspot_leaderboard. Use for “把这条热点做成竖屏”.',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'object' },
        id: { type: 'string' },
        postId: { type: 'string' },
        postUrl: { type: 'string' },
        rank: { type: 'number' },
        partitionId: { type: 'string', enum: ['crypto', 'finance', 'tech', 'ai'] },
        renderOptions: { type: 'object' },
        forceNew: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/vertical/from-post', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'create_direct_vertical_video',
    description: 'Create a direct no-avatar vertical composition job from a video URL or a local video file. Use when the user says “直接接入竖屏”, “不加数字人直接竖屏”, “原视频转竖屏”, or “只做竖屏合成”. This branch does not generate narration or a digital human.',
    inputSchema: {
      type: 'object',
      properties: {
        videoUrl: { type: 'string', description: 'Remote video URL. Use this for direct vertical composition from a URL.' },
        videoPath: { type: 'string', description: 'Local Windows/WSL/file path inside the project/data/public workspace.' },
        localVideoPath: { type: 'string', description: 'Alias for videoPath.' },
        outputPath: { type: 'string', description: 'Optional material_* task dir or path for importing reference context.' },
        sourceTaskDir: { type: 'string', description: 'Optional task dir for reference subtitle import.' },
        materialTaskDir: { type: 'string', description: 'Optional material task dir for reference subtitle import.' },
        title: { type: 'string' },
        summary: { type: 'string' },
        author: { type: 'string' },
        postUrl: { type: 'string' },
        renderOptions: { type: 'object' },
        referenceSubtitles: { type: 'array', items: { type: 'object' } },
        forceNew: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/vertical/direct', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'create_no_avatar_vertical_video',
    description: 'Alias for direct vertical composition without digital-human generation. Prefer this when the user explicitly says “不要数字人” or “不加数字人”.',
    inputSchema: {
      type: 'object',
      properties: {
        videoUrl: { type: 'string' },
        videoPath: { type: 'string' },
        localVideoPath: { type: 'string' },
        outputPath: { type: 'string' },
        sourceTaskDir: { type: 'string' },
        materialTaskDir: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        renderOptions: { type: 'object' },
        referenceSubtitles: { type: 'array', items: { type: 'object' } },
        forceNew: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/vertical/direct', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'create_vertical_video_from_rank',
    description: 'Create a vertical composition job directly from a local leaderboard rank. Use when the user says “把加密榜第 1 条做成竖屏” or “用榜单第 3 条生成竖屏”.',
    inputSchema: {
      type: 'object',
      required: ['rank'],
      properties: {
        partitionId: {
          type: 'string',
          description: 'Partition: crypto=加密, finance=金融, tech=科技, ai=AI. Default is crypto.',
          enum: ['crypto', 'finance', 'tech', 'ai']
        },
        rank: { type: 'number', description: 'Leaderboard rank.' },
        renderOptions: { type: 'object' },
        forceNew: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/vertical/from-post', {
      method: 'POST',
      body: {
        ...args,
        partitionId: normalizePartitionId(args.partitionId || args.partition)
      }
    }))
  },
  {
    name: 'get_workflow_next_actions',
    description: 'Ask the video assistant what the natural next choices are for a job. Use after each checkpoint so the assistant can ask the user: review narration, generate avatar, preview avatar, render final, or create a publish draft.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(jobPath(args, '/next-actions')))
  },
  {
    name: 'get_narration_draft',
    description: 'Get the generated narration/script draft for a job. Use when the user asks to “看看口播稿”, “脚本写得怎么样”, or wants to suggest edits before avatar generation.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(jobPath(args, '/narration')))
  },
  {
    name: 'revise_narration_draft',
    description: 'Replace the narration draft with the user-approved text and rebuild script structure. This invalidates downstream avatar/final video artifacts so they are regenerated from the new script.',
    inputSchema: {
      type: 'object',
      required: ['jobId', 'narrationText'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        narrationText: { type: 'string', description: 'The full revised narration text approved or requested by the user.' },
        useCache: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}/narration/revise`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        narrationText: args.narrationText,
        useCache: args.useCache
      }
    }))
  },
  {
    name: 'generate_avatar_video',
    description: 'Generate only the digital human/avatar video from an approved narration draft. This step is slow; after calling it, use get_avatar_status rather than assuming it is complete. Accepts avatarConfig or top-level renderProvider/runningHub* fields.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        avatarConfig: { type: 'object' },
        renderProvider: { type: 'string', enum: ['comfyui', 'runninghub'] },
        serverUrl: { type: 'string' },
        runningHubBaseUrl: { type: 'string' },
        runningHubWorkflowId: { type: 'string' },
        runningHubRunPath: { type: 'string' },
        runningHubInstanceType: { type: 'string' },
        runningHubUsePersonalQueue: { type: 'boolean' },
        runningHubRetainSeconds: { type: 'number' },
        runningHubAudioNodeId: { type: 'string' },
        runningHubAudioFieldName: { type: 'string' },
        runningHubImageNodeId: { type: 'string' },
        runningHubImageFieldName: { type: 'string' },
        runningHubOutputNodeId: { type: 'string' },
        audioPreset: { type: 'string' },
        imagePreset: { type: 'string' },
        force: { type: 'boolean', description: 'When true, remove an existing avatar video and regenerate it.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}/avatar/generate`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        avatarConfig: avatarConfigFromArgs(args),
        force: args.force
      }
    }))
  },
  {
    name: 'update_avatar_render_config',
    description: 'Update the avatar/digital-human render config for an existing job without starting generation. Use before generation when the user says “切到 RunningHub”, “改用 ComfyUI”, or wants to save audio/image/render presets.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        avatarConfig: { type: 'object' },
        renderProvider: { type: 'string', enum: ['comfyui', 'runninghub'] },
        serverUrl: { type: 'string' },
        runningHubBaseUrl: { type: 'string' },
        runningHubWorkflowId: { type: 'string' },
        runningHubRunPath: { type: 'string' },
        runningHubInstanceType: { type: 'string' },
        runningHubUsePersonalQueue: { type: 'boolean' },
        runningHubRetainSeconds: { type: 'number' },
        runningHubAudioNodeId: { type: 'string' },
        runningHubAudioFieldName: { type: 'string' },
        runningHubImageNodeId: { type: 'string' },
        runningHubImageFieldName: { type: 'string' },
        runningHubOutputNodeId: { type: 'string' },
        audioPreset: { type: 'string' },
        imagePreset: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}/avatar/config`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        avatarConfig: avatarConfigFromArgs(args)
      }
    }))
  },
  {
    name: 'generate_avatar_video_with_runninghub',
    description: 'Force an existing job to use RunningHub for avatar generation, save renderProvider=runninghub into task_state.json, clear stale avatar render state when force=true, and start avatar generation. Use this when the user says “用 RunningHub 重新生成数字人” or ComfyUI failed and they want RunningHub.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        avatarConfig: { type: 'object' },
        runningHubBaseUrl: { type: 'string' },
        runningHubWorkflowId: { type: 'string' },
        runningHubRunPath: { type: 'string' },
        runningHubInstanceType: { type: 'string' },
        runningHubUsePersonalQueue: { type: 'boolean' },
        runningHubRetainSeconds: { type: 'number' },
        runningHubAudioNodeId: { type: 'string' },
        runningHubAudioFieldName: { type: 'string' },
        runningHubImageNodeId: { type: 'string' },
        runningHubImageFieldName: { type: 'string' },
        runningHubOutputNodeId: { type: 'string' },
        audioPreset: { type: 'string' },
        imagePreset: { type: 'string' },
        force: { type: 'boolean', description: 'Default true. Clears stale avatar state/video before regenerating.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}/avatar/generate`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        avatarConfig: avatarConfigFromArgs(args, { renderProvider: 'runninghub' }),
        force: args.force !== false
      }
    }))
  },
  {
    name: 'get_avatar_status',
    description: 'Check digital human/avatar generation progress and whether aiman.mp4 is ready. Use for “数字人到哪了”, “合成完了吗”, or “查一下 RunningHub/ComfyUI 进度”.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(jobPath(args, '/avatar')))
  },
  {
    name: 'preview_avatar_video',
    description: 'Return the preview URL/path for the digital human/avatar video before final editing. Use when the user wants to inspect the avatar effect first.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(jobPath(args, '/avatar/preview')))
  },
  {
    name: 'render_final_video',
    description: 'Render the final edited vertical video after the avatar is ready. Use when the user chooses “剪辑出片”, “生成竖屏成片”, or approves the avatar.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        useCache: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}/render-final`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        useCache: args.useCache
      }
    }))
  },
  {
    name: 'continue_workflow_one_click',
    description: 'Continue from the current checkpoint all the way through avatar generation and final render, but never publish. Use only when the user explicitly chooses “一步到位” or “直接出片”.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        avatarConfig: { type: 'object' },
        useCache: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/jobs/${encodeURIComponent(args.jobId)}/continue-one-click`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        avatarConfig: args.avatarConfig,
        useCache: args.useCache
      }
    }))
  },
  {
    name: 'summarize_job_status',
    description: 'Get a concise status summary for a video generation job. Use when the user asks “任务怎么样了”, “进度到哪了”, or “有没有生成完”.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool(async (args) => {
      const payload = await requestAgent(jobPath(args));
      const job = payload.job || {};
      return {
        success: true,
        jobId: args.jobId,
        status: job.status || job.state || '',
        stage: job.stage || job.currentStage || '',
        progress: job.progress ?? job.percent ?? null,
        outputPath: job.outputPath || job.outputDir || args.outputPath || '',
        videoPath: job.videoPath || job.finalVideoPath || '',
        message: job.message || job.lastMessage || '',
        raw: job
      };
    })
  },
  {
    name: 'preview_generated_video',
    description: 'Return preview information for a generated video job, including the local/public video path when available. Use when the user asks to preview, inspect, or open the generated video.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' }
      }
    },
    handler: createTool(async (args) => {
      const payload = await requestAgent(jobPath(args));
      const job = payload.job || {};
      const outputPath = job.outputPath || job.outputDir || args.outputPath || '';
      return {
        success: true,
        jobId: args.jobId,
        status: job.status || job.state || '',
        outputPath,
        publicUrl: outputPath ? `/projects/${encodeURIComponent(outputPath)}/output_final.mp4` : '',
        localHint: outputPath ? `projects/${outputPath}/output_final.mp4` : '',
        raw: job
      };
    })
  },
  {
    name: 'review_video',
    description: 'Run AI review for a completed material-driven video job.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        videoPath: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/videos/${encodeURIComponent(args.jobId)}/review`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        videoPath: args.videoPath
      }
    }))
  },
  {
    name: 'review_generated_video',
    description: 'Run AI review for a generated video job and return the review result. Use after generation completes when the user asks “审核这个视频”, “看能不能发”, or “质检成片”.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        videoPath: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/videos/${encodeURIComponent(args.jobId)}/review`, {
      method: 'POST',
      body: {
        outputPath: args.outputPath,
        videoPath: args.videoPath
      }
    }))
  },
  {
    name: 'list_review_history',
    description: 'List AI video review history with status, scores, and fix suggestion summaries. Use when the user asks “审核历史”, “最近哪些视频没过审”, “质检记录”, or wants to inspect past review results.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum review records. Default 50.' },
        offset: { type: 'number', description: 'Pagination offset. Default 0.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/reviews${queryString({
      limit: args.limit || 50,
      offset: args.offset || 0
    })}`))
  },
  {
    name: 'get_review_record',
    description: 'Get one AI review record by reviewId, including raw detail and summarized scores/suggestions.',
    inputSchema: {
      type: 'object',
      required: ['reviewId'],
      properties: {
        reviewId: { type: 'string', description: 'Review id from list_review_history or review_video.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/reviews/${encodeURIComponent(args.reviewId)}`))
  },
  {
    name: 'create_publish_draft',
    description: 'Create a publish draft for a generated video or existing publish asset. Does not publish.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        assetId: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        platformSelections: { type: 'object' },
        scheduledTime: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/publish/draft', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'list_publish_assets',
    description: 'List videos/assets that can be used to create a publish draft. Use when the user asks “有哪些可发布视频”, “找刚生成的成片”, or wants to create a draft but has not specified an asset/job.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional text filter for title/label/summary.' },
        sourceType: { type: 'string', description: 'Optional source type filter, such as material_driven, xai_queue, standalone_runtime, pipeline.' },
        limit: { type: 'number', description: 'Maximum assets to return. Default 20.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/assets${queryString({
      query: args.query,
      sourceType: args.sourceType,
      limit: args.limit || 20
    })}`))
  },
  {
    name: 'list_publish_drafts',
    description: 'List publish drafts/jobs and their statuses. Use after creating a draft, when the user asks “草稿在哪”, “发布任务状态”, or wants to inspect pending/scheduled/published jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional exact job status filter.' },
        includeArchived: { type: 'boolean', description: 'Whether to include archived jobs. Default false.' },
        limit: { type: 'number', description: 'Maximum drafts/jobs to return. Default 20.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/drafts${queryString({
      status: args.status,
      includeArchived: args.includeArchived === true ? 'true' : '',
      limit: args.limit || 20
    })}`))
  },
  {
    name: 'get_publish_schedule_summary',
    description: 'Summarize publish jobs created by the frontend UI or agent: total count, scheduled count, due count, and status/platform distribution. Use when the user asks “前端手动创建了多少定时任务”, “定时发布情况”, “发布队列概览”, or “发布任务数量”.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional exact job status filter.' },
        platform: { type: 'string', description: 'Optional platform filter, such as wechatChannels, douyin, xiaohongshu, x.' },
        includeArchived: { type: 'boolean', description: 'Whether to include archived jobs. Default false.' },
        limit: { type: 'number', description: 'Maximum jobs to include. Default 50.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/schedule${queryString({
      status: args.status,
      platform: args.platform,
      includeArchived: args.includeArchived === true ? 'true' : '',
      limit: args.limit || 50
    })}`))
  },
  {
    name: 'list_scheduled_publish_tasks',
    description: 'List scheduled publish tasks with scheduledAt, platforms, accounts, and platform task statuses. Use when the user asks “列出定时任务”, “有哪些还没发的定时发布”, or “查看前端 UI 创建的定时发布”.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Optional platform filter, such as wechatChannels, douyin, xiaohongshu, x.' },
        includeArchived: { type: 'boolean', description: 'Whether to include archived jobs. Default false.' },
        limit: { type: 'number', description: 'Maximum jobs to return. Default 50.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/scheduled${queryString({
      platform: args.platform,
      includeArchived: args.includeArchived === true ? 'true' : '',
      limit: args.limit || 50
    })}`))
  },
  {
    name: 'get_publish_task_status',
    description: 'Get one publish/scheduled task detail by publish job id, including platform statuses and runtime result. Use when the user asks about a specific publish task.',
    inputSchema: {
      type: 'object',
      required: ['publishJobId'],
      properties: {
        publishJobId: { type: 'string', description: 'Publish job id from list_publish_drafts or list_scheduled_publish_tasks.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/tasks/${encodeURIComponent(args.publishJobId)}`))
  },
  {
    name: 'get_publish_account_dashboard',
    description: 'Get publish account dashboard summary: account counts, login status, running tasks, 7-day successes and failures. Use when the user asks “账号发布情况”, “微信账号状态”, “哪个账号失败多”, or “发布账号看板”.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: createTool(() => requestAgent('/api/agent/v1/publish/accounts/dashboard'))
  },
  {
    name: 'list_publish_account_jobs',
    description: 'List publish jobs for a specific account and platform. Use after get_publish_account_dashboard or when the user names an account id.',
    inputSchema: {
      type: 'object',
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', description: 'Account id from the publish account dashboard.' },
        platform: { type: 'string', description: 'Platform key. Default wechatChannels.' },
        status: { type: 'string', description: 'Optional exact task status filter, such as failed, published, scheduled_wait.' },
        limit: { type: 'number', description: 'Maximum jobs. Default 50.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/accounts/${encodeURIComponent(args.accountId)}/jobs${queryString({
      platform: args.platform || 'wechatChannels',
      status: args.status,
      limit: args.limit || 50
    })}`))
  },
  {
    name: 'list_publish_account_failures',
    description: 'List failed publish jobs for a specific account. Use to diagnose repeated failures for a WeChat/Douyin/Xiaohongshu account.',
    inputSchema: {
      type: 'object',
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', description: 'Account id from the publish account dashboard.' },
        platform: { type: 'string', description: 'Platform key. Default wechatChannels.' },
        limit: { type: 'number', description: 'Maximum failed jobs. Default 20.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/publish/accounts/${encodeURIComponent(args.accountId)}/failures${queryString({
      platform: args.platform || 'wechatChannels',
      limit: args.limit || 20
    })}`))
  },
  {
    name: 'list_login_statuses',
    description: 'Read cached login statuses for publishing accounts without triggering browser login checks. Use when the user asks “当前哪些账号需要登录”, “登录状态”, or “微信账号登录情况”.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter: logged_in, need_login, error.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/login-statuses${queryString({
      status: args.status
    })}`))
  },
  {
    name: 'get_login_status',
    description: 'Read cached login status for one account without triggering a browser/login check.',
    inputSchema: {
      type: 'object',
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', description: 'Account id.' }
      }
    },
    handler: createTool((args) => requestAgent(`/api/agent/v1/login-statuses/${encodeURIComponent(args.accountId)}`))
  },
  {
    name: 'get_login_qrcode',
    description: 'Refresh and return a login QR-code screenshot for a publishing account. Use when the user asks for a WeChat/video-account login QR code to scan. Does not publish content or send Feishu notifications.',
    inputSchema: {
      type: 'object',
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', description: 'Publishing account id, for example a WeChat Channels account id from list_login_statuses or get_publish_account_dashboard.' }
      }
    },
    handler: async (args = {}) => {
      try {
        const payload = await requestAgent(`/api/agent/v1/login-statuses/${encodeURIComponent(args.accountId)}/qrcode`, {
          method: 'POST',
          body: { accountId: args.accountId }
        });
        return loginQrCodeContent(payload);
      } catch (error) {
        return errorContent(error);
      }
    }
  },
  {
    name: 'create_wechat_publish_draft',
    description: 'Create a WeChat Channels publish draft for a generated video or existing asset. This never publishes directly; it only creates a draft requiring human confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        assetId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        platformSelections: { type: 'object' },
        scheduledTime: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/publish/draft', {
      method: 'POST',
      body: {
        ...args,
        platforms: ['wechatChannels']
      }
    }))
  },
  {
    name: 'create_multi_platform_publish_draft',
    description: 'Create a publish draft for selected platforms. This is still draft-only and will not perform real publishing.',
    inputSchema: {
      type: 'object',
      required: ['platforms'],
      properties: {
        jobId: { type: 'string' },
        outputPath: { type: 'string' },
        assetId: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        platformSelections: { type: 'object' },
        scheduledTime: { type: 'string' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/publish/draft', {
      method: 'POST',
      body: args
    }))
  },
  {
    name: 'confirm_publish',
    description: 'Confirm a publish job. Requires confirmation phrase and real publishing enabled on the server.',
    inputSchema: {
      type: 'object',
      required: ['publishJobId', 'confirmation'],
      properties: {
        publishJobId: { type: 'string' },
        platform: { type: 'string' },
        confirmation: { type: 'string' },
        allowRealPublish: { type: 'boolean' }
      }
    },
    handler: createTool((args) => requestAgent('/api/agent/v1/publish/confirm', {
      method: 'POST',
      body: args
    }))
  }
];

export {
  tools
};
