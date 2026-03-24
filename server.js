const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(express.static('public')); // 提供前端页面
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// 存储全局的 SSE (Server-Sent Events) 客户端连接，用于给前端推进度条
const clients = new Map();
const WORKFLOW_PATH = path.join(__dirname, 'workflow_api.json');
const PIPELINE_DIR = path.join(__dirname, 'pipeline_scripts');
const XAI_TOP10_DIR = path.join(__dirname, 'xai_top10');
const XAI_TOP10_SCRIPT = path.join(XAI_TOP10_DIR, 'run_xai_top10.py');
const XAI_TOP10_RESULT = path.join(XAI_TOP10_DIR, 'result.json');
const XAI_TOP10_PARTIAL = path.join(XAI_TOP10_DIR, 'result.partial.json');
const XAI_TOP10_LOG = path.join(XAI_TOP10_DIR, 'run_log.txt');
const XAI_TOP10_ERROR_LOG = path.join(XAI_TOP10_DIR, 'run_error.log');
const XAI_TOP10_ACCOUNTS = path.join(XAI_TOP10_DIR, 'xai_accounts.json');
const VERTICAL_QUEUE_ROOT = path.join(__dirname, 'uploads', 'xai_vertical_queue');
const VERTICAL_PUBLIC_DIR = path.join(__dirname, 'public', 'xai_vertical_queue');
const PUBLISH_CENTER_DIR = path.join(__dirname, 'publish_center');
const PUBLISH_CONFIG_PATH = path.join(PUBLISH_CENTER_DIR, 'platform_config.json');
const PUBLISH_JOBS_PATH = path.join(PUBLISH_CENTER_DIR, 'publish_jobs.json');
const WECHAT_RPA_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_rpa.py');
const WECHAT_RPA_USER_DATA_DIR = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_user_data');
const WECHAT_RPA_TASK_DIR = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_tasks');
const EDITABLE_JSON_FILES = new Set(['workflow_api.json', 'audio.json', 'result.json', 'director.json']);
let xaiTop10Process = null;
const verticalJobs = new Map();
const verticalJobQueue = [];
let verticalActiveCount = 0;
let verticalJobConcurrency = 2;
const publishRuntimeProcesses = new Map();
let publishAssetsCache = { expiresAt: 0, assets: [] };

function readWorkflow() {
    return JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
}

function writeWorkflow(workflow) {
    fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2), 'utf-8');
}

function extractWorkflowConfig(workflow) {
    return {
        positivePrompt: workflow["114"]?.inputs?.positive_prompt || '',
        negativePrompt: workflow["114"]?.inputs?.negative_prompt || '',
        steps: workflow["27"]?.inputs?.steps ?? 4,
        cfg: workflow["27"]?.inputs?.cfg ?? 1,
        shift: workflow["27"]?.inputs?.shift ?? 11,
        scheduler: workflow["27"]?.inputs?.scheduler || 'dpm++_sde',
        seed: workflow["27"]?.inputs?.seed ?? 1,
        audioSpeed: workflow["278"]?.inputs?.speed ?? 1,
        scaleLength: workflow["186"]?.inputs?.value ?? 1024,
        frameRate: workflow["151"]?.inputs?.frame_rate ?? 25,
        outputCrf: workflow["151"]?.inputs?.crf ?? 19,
        outputFormat: workflow["151"]?.inputs?.format || 'video/h264-mp4',
        videoModel: workflow["176"]?.inputs?.model || '',
        lora: workflow["269"]?.inputs?.lora || '',
        loraStrength: workflow["269"]?.inputs?.strength ?? 0.5
    };
}

function applyWorkflowConfig(workflow, config = {}) {
    if (config.positivePrompt !== undefined) workflow["114"].inputs.positive_prompt = String(config.positivePrompt);
    if (config.negativePrompt !== undefined) workflow["114"].inputs.negative_prompt = String(config.negativePrompt);
    if (config.steps !== undefined) workflow["27"].inputs.steps = Number(config.steps);
    if (config.cfg !== undefined) workflow["27"].inputs.cfg = Number(config.cfg);
    if (config.shift !== undefined) workflow["27"].inputs.shift = Number(config.shift);
    if (config.scheduler !== undefined) workflow["27"].inputs.scheduler = String(config.scheduler);
    if (config.seed !== undefined) {
        const seed = Number(config.seed);
        workflow["27"].inputs.seed = seed;
        workflow["278"].inputs.seed = seed;
    }
    if (config.audioSpeed !== undefined) workflow["278"].inputs.speed = Number(config.audioSpeed);
    if (config.scaleLength !== undefined) workflow["186"].inputs.value = Number(config.scaleLength);
    if (config.frameRate !== undefined) workflow["151"].inputs.frame_rate = Number(config.frameRate);
    if (config.outputCrf !== undefined) workflow["151"].inputs.crf = Number(config.outputCrf);
    if (config.outputFormat !== undefined) workflow["151"].inputs.format = String(config.outputFormat);
    if (config.videoModel !== undefined) workflow["176"].inputs.model = String(config.videoModel);
    if (config.lora !== undefined) workflow["269"].inputs.lora = String(config.lora);
    if (config.loraStrength !== undefined) workflow["269"].inputs.strength = Number(config.loraStrength);
    return workflow;
}

function resolveEditableJsonPath(fileName) {
    if (!EDITABLE_JSON_FILES.has(fileName)) {
        return null;
    }
    if (fileName === 'workflow_api.json') {
        return WORKFLOW_PATH;
    }
    return path.join(PIPELINE_DIR, fileName);
}

function buildFallbackTitleFromSubtitles(subtitlesPath) {
    try {
        if (!fs.existsSync(subtitlesPath)) return "这条消息可能正在改变支付格局";
        const subtitles = JSON.parse(fs.readFileSync(subtitlesPath, "utf-8"));
        const joined = (Array.isArray(subtitles) ? subtitles : [])
            .map((item) => String(item?.zh || item?.text || "").trim())
            .filter(Boolean)
            .join("");
        if (!joined) return "这条消息可能正在改变支付格局";
        return joined.slice(0, 18) + (joined.length > 18 ? "..." : "");
    } catch (_err) {
        return "这条消息可能正在改变支付格局";
    }
}

function readJsonIfExists(filePath, fallback = null) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (_err) {
        return fallback;
    }
}

function readTextIfExists(filePath) {
    try {
        if (!fs.existsSync(filePath)) return '';
        return fs.readFileSync(filePath, 'utf-8');
    } catch (_err) {
        return '';
    }
}

function tailLines(text, limit = 12) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(-limit);
}

function getXaiTop10Status() {
    const partial = readJsonIfExists(XAI_TOP10_PARTIAL, null);
    const hasResult = fs.existsSync(XAI_TOP10_RESULT);
    return {
        running: !!xaiTop10Process,
        stage: partial?.stage || null,
        partial,
        hasResult,
        resultUpdatedAt: hasResult ? fs.statSync(XAI_TOP10_RESULT).mtime.toISOString() : null,
        logTail: tailLines(readTextIfExists(XAI_TOP10_LOG)),
        errorTail: tailLines(readTextIfExists(XAI_TOP10_ERROR_LOG))
    };
}

function sanitizeAccounts(accounts) {
    if (!Array.isArray(accounts)) return [];
    const seen = new Set();
    return accounts
        .map((account) => String(account || '').trim().replace(/^@+/, ''))
        .filter((account) => {
            if (!account) return false;
            if (seen.has(account)) return false;
            seen.add(account);
            return true;
        });
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readPublishConfig() {
    return readJsonIfExists(PUBLISH_CONFIG_PATH, {
        wechatChannels: { enabled: false, displayName: '', finderUserName: '', helperAccount: '', openPlatformAppId: '', appId: '', appSecret: '', refreshToken: '', accountId: '', notes: '' },
        douyin: { enabled: false, displayName: '', clientKey: '', clientSecret: '', accessToken: '', openId: '', notes: '' },
        xiaohongshu: { enabled: false, displayName: '', appId: '', appSecret: '', accessToken: '', accountId: '', notes: '' },
        x: { enabled: false, displayName: '', apiKey: '', apiSecret: '', accessToken: '', accessSecret: '', bearerToken: '', notes: '' },
        youtube: { enabled: false, displayName: '', clientId: '', clientSecret: '', refreshToken: '', channelId: '', notes: '' }
    });
}

function writePublishConfig(config) {
    fs.writeFileSync(PUBLISH_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function sanitizePublishDescriptionText(text) {
    return String(text || '')
        .replace(/\n*\s*更多内容发布与分发由 AI 中台自动整理。\s*$/g, '')
        .trim();
}

function sanitizePublishJobPayload(payload) {
    const next = deepClone(payload || { jobs: [] });
    let changed = false;
    next.jobs = Array.isArray(next.jobs) ? next.jobs : [];
    for (const job of next.jobs) {
        const assetDescription = job?.asset?.metadata?.suggestedDescription;
        const nextAssetDescription = sanitizePublishDescriptionText(assetDescription);
        if (assetDescription !== undefined && nextAssetDescription !== assetDescription) {
            job.asset.metadata.suggestedDescription = nextAssetDescription;
            changed = true;
        }

        const publishDescription = job?.publishData?.description;
        const nextPublishDescription = sanitizePublishDescriptionText(publishDescription);
        if (publishDescription !== undefined && nextPublishDescription !== publishDescription) {
            job.publishData.description = nextPublishDescription;
            changed = true;
        }

        for (const task of Array.isArray(job?.platformTasks) ? job.platformTasks : []) {
            const taskDescription = task?.description;
            const nextTaskDescription = sanitizePublishDescriptionText(taskDescription);
            if (taskDescription !== undefined && nextTaskDescription !== taskDescription) {
                task.description = nextTaskDescription;
                changed = true;
            }
        }
    }
    return { payload: next, changed };
}

function readPublishJobs() {
    const raw = readJsonIfExists(PUBLISH_JOBS_PATH, { jobs: [] }) || { jobs: [] };
    const { payload, changed } = sanitizePublishJobPayload(raw);
    if (changed) {
        fs.writeFileSync(PUBLISH_JOBS_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    }
    return payload;
}

function writePublishJobs(payload) {
    fs.writeFileSync(PUBLISH_JOBS_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

function updatePublishJob(jobId, updater) {
    const payload = readPublishJobs();
    const index = (payload.jobs || []).findIndex((job) => job.id === jobId);
    if (index === -1) {
        throw new Error('发布任务不存在');
    }
    const current = payload.jobs[index];
    const next = updater ? updater(deepClone(current)) || current : current;
    next.updatedAt = new Date().toISOString();
    payload.jobs[index] = next;
    writePublishJobs(payload);
    return next;
}

function updatePublishPlatformTask(jobId, platformKey, patch) {
    return updatePublishJob(jobId, (job) => {
        const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
        const task = tasks.find((item) => item.platform === platformKey);
        if (!task) throw new Error(`发布任务中不存在平台 ${platformKey}`);
        Object.assign(task, patch);
        return job;
    });
}

function maskSecretValue(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 6) return '*'.repeat(text.length);
    return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

function maskPlatformConfig(config) {
    const payload = deepClone(config);
    const secretKeys = new Set(['appSecret', 'refreshToken', 'clientSecret', 'accessToken', 'apiKey', 'apiSecret', 'accessSecret', 'bearerToken']);
    for (const platform of Object.keys(payload)) {
        for (const key of Object.keys(payload[platform] || {})) {
            if (secretKeys.has(key)) {
                payload[platform][`${key}Masked`] = maskSecretValue(payload[platform][key]);
            }
        }
    }
    return payload;
}

const PLATFORM_FIELD_LABELS = {
    wechatChannels: {
        finderUserName: '视频号 ID / Finder User Name',
        helperAccount: '视频号助手账号 / Helper Account',
        openPlatformAppId: '开放平台 AppID / Open Platform App ID',
        appId: '应用 ID / App ID',
        appSecret: '应用密钥 / App Secret',
        refreshToken: '刷新令牌 / Refresh Token',
        accountId: '账号 ID / Account ID'
    },
    douyin: {
        clientKey: '客户端 Key / Client Key',
        clientSecret: '客户端密钥 / Client Secret',
        accessToken: '访问令牌 / Access Token',
        openId: '用户 OpenID / Open ID'
    },
    xiaohongshu: {
        appId: '应用 ID / App ID',
        appSecret: '应用密钥 / App Secret',
        accessToken: '访问令牌 / Access Token',
        accountId: '账号 ID / Account ID'
    },
    x: {
        apiKey: 'API Key / API Key',
        apiSecret: 'API Secret / API Secret',
        accessToken: '访问令牌 / Access Token',
        accessSecret: '访问密钥 / Access Secret',
        bearerToken: 'Bearer Token / Bearer Token'
    },
    youtube: {
        clientId: '客户端 ID / Client ID',
        clientSecret: '客户端密钥 / Client Secret',
        refreshToken: '刷新令牌 / Refresh Token',
        channelId: '频道 ID / Channel ID'
    }
};

function formatPlatformFieldLabel(platformKey, fieldKey) {
    return PLATFORM_FIELD_LABELS?.[platformKey]?.[fieldKey] || fieldKey;
}

function collectPlatformValidation(platformKey, platformConfig, requiredFields = []) {
    const missingFields = (requiredFields || []).filter((field) => !String(platformConfig?.[field] || '').trim());
    return {
        missingFields,
        missingFieldLabels: missingFields.map((field) => formatPlatformFieldLabel(platformKey, field))
    };
}

function sanitizePlatformConfigInput(input) {
    const current = readPublishConfig();
    const next = deepClone(current);
    for (const platform of Object.keys(next)) {
        const source = input?.[platform];
        if (!source || typeof source !== 'object') continue;
        for (const key of Object.keys(next[platform])) {
            if (source[key] === undefined) continue;
            next[platform][key] = typeof next[platform][key] === 'boolean'
                ? Boolean(source[key])
                : String(source[key] ?? '').trim();
        }
    }
    return next;
}

function collectPublishAssets() {
    const assets = [];
    const addAsset = (label, fullPath, publicUrl, sourceType, metadata = {}) => {
        if (!fs.existsSync(fullPath)) return;
        const stat = fs.statSync(fullPath);
        assets.push({
            id: crypto.createHash('md5').update(fullPath).digest('hex').slice(0, 12),
            label,
            sourceType,
            path: fullPath,
            url: publicUrl ? `${publicUrl}?t=${stat.mtimeMs}` : '',
            sizeBytes: stat.size,
            updatedAt: stat.mtime.toISOString(),
            metadata
        });
    };

    const pipelineContent = readJsonIfExists(path.join(PIPELINE_DIR, 'content.json'), {});
    const pipelineSubs = readJsonIfExists(path.join(PIPELINE_DIR, 'subtitles.json'), []);
    addAsset(
        '全链路混剪成片',
        path.join(__dirname, 'public', 'output_final.mp4'),
        '/output_final.mp4',
        'pipeline',
        buildPublishMetadata({
            title: pipelineContent?.title,
            subtitles: pipelineSubs,
            sourceType: 'pipeline'
        })
    );
    addAsset(
        '独立竖屏成片',
        path.join(__dirname, 'public', 'standalone_output_vertical.mp4'),
        '/standalone_output_vertical.mp4',
        'standalone',
        buildPublishMetadata({
            title: pipelineContent?.title,
            subtitles: pipelineSubs,
            sourceType: 'standalone'
        })
    );

    if (fs.existsSync(VERTICAL_PUBLIC_DIR)) {
        const dirs = fs.readdirSync(VERTICAL_PUBLIC_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
        for (const dir of dirs) {
            const filePath = path.join(VERTICAL_PUBLIC_DIR, dir.name, 'vertical_output.mp4');
            const jobDir = path.join(VERTICAL_QUEUE_ROOT, dir.name);
            const content = readJsonIfExists(path.join(jobDir, 'content.json'), {});
            const subtitles = readJsonIfExists(path.join(jobDir, 'subtitles.json'), []);
            const runtimeJob = verticalJobs.get(dir.name);
            addAsset(
                `XAI 批量竖屏 ${dir.name}`,
                filePath,
                `/xai_vertical_queue/${dir.name}/vertical_output.mp4`,
                'xai_queue',
                buildPublishMetadata({
                    title: content?.title || runtimeJob?.title,
                    subtitles,
                    summary: runtimeJob?.summary,
                    sourceType: 'xai_queue',
                    sourceUrl: runtimeJob?.postUrl,
                    author: runtimeJob?.author
                })
            );
        }
    }

    return assets.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function getCachedPublishAssets(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && publishAssetsCache.expiresAt > now && Array.isArray(publishAssetsCache.assets)) {
        return publishAssetsCache.assets;
    }
    const assets = collectPublishAssets();
    publishAssetsCache = {
        assets,
        expiresAt: now + 10000
    };
    return assets;
}

function extractSubtitleSnippet(subtitles, limit = 90) {
    if (!Array.isArray(subtitles)) return '';
    const joined = subtitles
        .map((item) => String(item?.zh || item?.text || '').trim())
        .filter(Boolean)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    if (!joined) return '';
    return joined.length > limit ? `${joined.slice(0, limit)}...` : joined;
}

function sanitizePublishTitle(title, fallback = '今日热点速递') {
    const normalized = String(title || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || fallback;
}

function buildShortTitle(title, fallback = '热点速递') {
    const normalized = sanitizePublishTitle(title, fallback)
        .replace(/[？?！!。，“”"'‘’：:、]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return fallback;
    if (normalized.length <= 16) return normalized;
    return normalized.slice(0, 16).trim();
}

function buildPublishTags({ title = '', summary = '', sourceType = '' }) {
    const text = `${title} ${summary}`.toLowerCase();
    const tags = new Set();
    if (sourceType === 'xai_queue') tags.add('热点视频');
    if (text.includes('比特币') || text.includes('bitcoin')) tags.add('比特币');
    if (text.includes('稳定币') || text.includes('stable')) tags.add('稳定币');
    if (text.includes('支付')) tags.add('支付');
    if (text.includes('华尔街')) tags.add('华尔街');
    if (text.includes('ai')) tags.add('AI');
    tags.add('财经');
    tags.add('短视频');
    return Array.from(tags).slice(0, 6);
}

function buildPublishMetadata({ title = '', subtitles = [], summary = '', sourceType = '', sourceUrl = '', author = '' }) {
    const normalizedTitle = sanitizePublishTitle(title, sourceType === 'xai_queue' ? '热点视频速递' : '今日内容速递');
    const subtitleSnippet = extractSubtitleSnippet(subtitles);
    const summaryText = String(summary || '').replace(/^@[^-]+ -\s*/, '').trim();
    const descriptionParts = [
        normalizedTitle,
        summaryText || subtitleSnippet,
        author ? `来源账号：@${author}` : '',
        sourceUrl ? `原始链接：${sourceUrl}` : ''
    ].filter(Boolean);

    return {
        suggestedTitle: normalizedTitle,
        suggestedShortTitle: buildShortTitle(normalizedTitle, sourceType === 'xai_queue' ? '热点速递' : '内容速递'),
        suggestedDescription: sanitizePublishDescriptionText(descriptionParts.join('\n\n')),
        suggestedTags: buildPublishTags({ title: normalizedTitle, summary: summaryText || subtitleSnippet, sourceType }),
        sourceSummary: summaryText || subtitleSnippet,
        sourceUrl,
        author
    };
}

function buildPublishTask(platformKey, publishData, assetUrl, platformConfig) {
    const common = {
        platform: platformKey,
        title: publishData.title,
        description: publishData.description,
        tags: publishData.tags || [],
        coverUrl: publishData.coverUrl || '',
        videoUrl: assetUrl,
        status: 'pending_integration'
    };
    switch (platformKey) {
        case 'wechatChannels':
            return {
                ...common,
                status: 'rpa_available',
                guide: '当前基于视频号助手 Web 端的 RPA 自动化实现扫码登录、自动上传、自动填写文案。公开文档未提供通用直发 API，因此这里走浏览器自动化而非官方内容发布接口。首次运行前需要安装 Playwright Chromium 浏览器。',
                requiredFields: ['finderUserName', 'helperAccount'],
                docLinks: [
                    'https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/channels-live.html',
                    'https://developers.weixin.qq.com/doc/store/shop/'
                ],
                automationModes: ['draft', 'publish'],
                runtime: {
                    state: 'idle',
                    lastMessage: '',
                    updatedAt: null
                }
            };
        case 'douyin':
            return {
                ...common,
                guide: '需要抖音开放平台 clientKey / clientSecret / openId / accessToken，并按视频发布接口上传素材。',
                requiredFields: ['clientKey', 'clientSecret', 'openId', 'accessToken']
            };
        case 'xiaohongshu':
            return {
                ...common,
                guide: '需要小红书企业或合作接口的应用配置与发布凭证，当前先保留配置和发布文案。',
                requiredFields: ['appId', 'appSecret', 'accessToken']
            };
        case 'x':
            return {
                ...common,
                guide: '需要 X API 媒体上传和发帖凭证，当前可复用现有 X 认证信息补全自动发布。',
                requiredFields: ['apiKey', 'apiSecret', 'accessToken', 'accessSecret']
            };
        case 'youtube':
            return {
                ...common,
                guide: '需要 YouTube Data API OAuth 凭证和 channelId，按 resumable upload 流程发布视频。',
                requiredFields: ['clientId', 'clientSecret', 'refreshToken', 'channelId']
            };
        default:
            return {
                ...common,
                guide: '待补充平台发布适配器。',
                requiredFields: []
            };
    }
}

function reconcilePlatformTask(platformKey, existingTask, publishData, assetUrl, platformConfig) {
    const rebuiltTask = buildPublishTask(platformKey, publishData, assetUrl, platformConfig);
    const validation = collectPlatformValidation(platformKey, platformConfig, rebuiltTask.requiredFields || []);
    const activeStatuses = new Set(['draft_preparing', 'publishing', 'need_login', 'uploading', 'processing', 'ready_to_publish', 'success']);

    if (validation.missingFields.length > 0) {
        rebuiltTask.status = 'config_missing';
    } else if (existingTask?.status && activeStatuses.has(existingTask.status)) {
        rebuiltTask.status = existingTask.status;
    }

    rebuiltTask.runtime = existingTask?.runtime || rebuiltTask.runtime || null;
    rebuiltTask.validation = validation;
    return rebuiltTask;
}

function reconcilePublishJob(job, config) {
    const platformTasks = [];
    const platformErrors = [];
    const selectedPlatforms = Array.isArray(job.selectedPlatforms) ? job.selectedPlatforms : [];

    for (const platformKey of selectedPlatforms) {
        const platformConfig = config?.[platformKey];
        const existingTask = (job.platformTasks || []).find((item) => item.platform === platformKey);

        if (!platformConfig) {
            platformErrors.push({ platform: platformKey, error: '未知平台', missingFields: [], missingFieldLabels: [] });
            continue;
        }

        if (!platformConfig.enabled) {
            platformErrors.push({ platform: platformKey, error: '该平台尚未启用', missingFields: [], missingFieldLabels: [] });
            if (existingTask) {
                platformTasks.push({ ...existingTask, status: 'disabled' });
            }
            continue;
        }

        const task = reconcilePlatformTask(platformKey, existingTask, job.publishData || {}, job.asset?.url || '', platformConfig);
        if (task.validation?.missingFields?.length) {
            platformErrors.push({
                platform: platformKey,
                error: `缺少配置字段：${task.validation.missingFieldLabels.join('，')}`,
                missingFields: task.validation.missingFields,
                missingFieldLabels: task.validation.missingFieldLabels
            });
        }
        platformTasks.push(task);
    }

    return {
        ...job,
        updatedAt: new Date().toISOString(),
        status: platformErrors.length > 0 ? 'partial_ready' : 'ready',
        platformTasks,
        platformErrors
    };
}

function reconcileAndPersistPublishJobs(config) {
    const payload = readPublishJobs();
    payload.jobs = (payload.jobs || []).map((job) => reconcilePublishJob(job, config));
    writePublishJobs(payload);
    return payload;
}

function buildWechatPublishPayload(job) {
    const config = readPublishConfig().wechatChannels || {};
    const tags = Array.isArray(job.publishData?.tags) ? job.publishData.tags : [];
    return {
        title: job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布',
        shortTitle: job.publishData?.shortTitle || job.asset?.metadata?.suggestedShortTitle || buildShortTitle(job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布'),
        description: job.publishData?.description || job.asset?.metadata?.suggestedDescription || '',
        tags,
        publishMode: 'draft',
        videoPath: job.asset?.path,
        userDataDir: WECHAT_RPA_USER_DATA_DIR,
        loginTimeoutSec: 240,
        headless: false,
        finderUserName: config.finderUserName || '',
        helperAccount: config.helperAccount || ''
    };
}

function parseWechatRpaLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('STATUS|')) return null;
    const parts = text.split('|');
    if (parts.length < 4) return null;
    let extra = {};
    try {
        extra = JSON.parse(parts.slice(3).join('|'));
    } catch (_err) {}
    return {
        state: parts[1],
        message: parts[2],
        extra
    };
}

function parseWechatLogLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('LOG|')) return null;
    return text.slice(4).trim();
}

function getWechatStateProgress(state) {
    const map = {
        starting: 3,
        navigating: 8,
        need_login: 15,
        login_ready: 25,
        uploading: 40,
        processing: 48,
        uploaded: 58,
        editing: 72,
        edited: 86,
        ready_for_manual_publish: 100,
        publishing: 94,
        success: 100,
        failed: 100
    };
    return map[state] ?? 0;
}

function startWechatRpa(jobId, publishMode = 'draft') {
    const runtimeKey = `${jobId}:wechatChannels`;
    if (publishRuntimeProcesses.has(runtimeKey)) {
        throw new Error('视频号自动发布任务已在运行');
    }

    const payload = readPublishJobs();
    const job = (payload.jobs || []).find((item) => item.id === jobId);
    if (!job) throw new Error('发布任务不存在');
    const task = (job.platformTasks || []).find((item) => item.platform === 'wechatChannels');
    if (!task) throw new Error('该任务未选择微信视频号');
    const publishConfig = readPublishConfig();
    const wechatConfig = publishConfig.wechatChannels || {};
    const validation = collectPlatformValidation('wechatChannels', wechatConfig, ['finderUserName', 'helperAccount']);
    const missingFields = validation.missingFields;
    if (missingFields.length > 0) {
        throw new Error(`微信视频号配置不完整，缺少：${validation.missingFieldLabels.join('，')}`);
    }
    if (!job.asset?.path || !fs.existsSync(job.asset.path)) {
        throw new Error('待发布视频文件不存在');
    }
    if (!fs.existsSync(WECHAT_RPA_SCRIPT)) {
        throw new Error('视频号 RPA 脚本不存在');
    }

    const rpaPayload = {
        ...buildWechatPublishPayload(job),
        publishMode
    };
    const payloadFile = path.join(WECHAT_RPA_TASK_DIR, `${jobId}_wechatChannels.json`);
    fs.writeFileSync(payloadFile, JSON.stringify(rpaPayload, null, 2), 'utf-8');

    updatePublishPlatformTask(jobId, 'wechatChannels', {
        status: publishMode === 'publish' ? 'publishing' : 'draft_preparing',
        runtime: {
            state: 'starting',
            lastMessage: '正在启动视频号自动化浏览器...',
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 3,
            logs: ['启动视频号自动化任务']
        }
    });

    const proc = spawn('python', [WECHAT_RPA_SCRIPT, '--payload', payloadFile], {
        cwd: PUBLISH_CENTER_DIR,
        env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8'
        }
    });
    publishRuntimeProcesses.set(runtimeKey, proc);
    let latestRuntimeState = 'starting';
    let latestRuntimeMessage = '正在启动视频号自动化浏览器...';
    let latestRuntimeProgress = 3;
    const appendLog = (line) => {
        if (!line) return;
        updatePublishPlatformTask(jobId, 'wechatChannels', {
            runtime: {
                state: latestRuntimeState,
                lastMessage: latestRuntimeMessage,
                updatedAt: new Date().toISOString(),
                publishMode,
                progress: latestRuntimeProgress,
                logs: (() => {
                    const payload = readPublishJobs();
                    const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
                    const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
                    const existingLogs = Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
                    return [...existingLogs, line].slice(-80);
                })()
            }
        });
    };

    const handleOutput = (chunk) => {
        const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
            const logLine = parseWechatLogLine(line);
            if (logLine) {
                appendLog(logLine);
                continue;
            }
            const parsed = parseWechatRpaLine(line);
            if (!parsed) {
                appendLog(line);
                continue;
            }
            latestRuntimeState = parsed.state;
            latestRuntimeMessage = parsed.message;
            latestRuntimeProgress = Number.isFinite(Number(parsed.extra?.percent)) ? Number(parsed.extra.percent) : getWechatStateProgress(parsed.state);
            updatePublishPlatformTask(jobId, 'wechatChannels', {
                status: parsed.state === 'success' ? 'success' : parsed.state,
                runtime: {
                    state: parsed.state,
                    lastMessage: parsed.message,
                    updatedAt: new Date().toISOString(),
                    publishMode,
                    progress: latestRuntimeProgress,
                    logs: (() => {
                        const payload = readPublishJobs();
                        const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
                        const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
                        const existingLogs = Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
                        return [...existingLogs, `[${parsed.state}] ${parsed.message}`].slice(-80);
                    })(),
                    ...parsed.extra
                }
            });
        }
    };

    proc.stdout.on('data', (data) => handleOutput(data.toString()));
    proc.stderr.on('data', (data) => handleOutput(data.toString()));
    proc.on('error', (error) => {
        publishRuntimeProcesses.delete(runtimeKey);
        updatePublishPlatformTask(jobId, 'wechatChannels', {
            status: 'failed',
            runtime: {
                state: 'failed',
                lastMessage: error.message,
                updatedAt: new Date().toISOString(),
                publishMode,
                progress: 100,
                logs: (() => {
                    const payload = readPublishJobs();
                    const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
                    const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
                    const existingLogs = Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
                    return [...existingLogs, `[error] ${error.message}`].slice(-80);
                })()
            }
        });
    });
    proc.on('close', (code) => {
        publishRuntimeProcesses.delete(runtimeKey);
        if (code !== 0) {
            updatePublishPlatformTask(jobId, 'wechatChannels', {
                status: 'failed',
                runtime: {
                    state: 'failed',
                    lastMessage: latestRuntimeState === 'failed' ? latestRuntimeMessage : `视频号自动化任务异常结束（退出码 ${code}）`,
                    updatedAt: new Date().toISOString(),
                    publishMode,
                    progress: 100,
                    logs: (() => {
                        const payload = readPublishJobs();
                        const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
                        const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
                        const existingLogs = Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
                        return [...existingLogs, `[close] 任务以退出码 ${code} 结束`].slice(-80);
                    })()
                }
            });
        } else {
            const payload = readPublishJobs();
            const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
            const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
            const existingLogs = Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
            updatePublishPlatformTask(jobId, 'wechatChannels', {
                status: publishMode === 'publish' ? 'success' : 'ready_for_manual_publish',
                runtime: {
                    state: publishMode === 'publish' ? 'success' : 'ready_for_manual_publish',
                    lastMessage: publishMode === 'publish' ? '视频号自动发表流程已完成' : '内容已自动填好，等待你在浏览器里确认发布',
                    updatedAt: new Date().toISOString(),
                    publishMode,
                    progress: 100,
                    logs: [...existingLogs, publishMode === 'publish' ? '[success] 视频号自动发表流程已完成' : '[ready_for_manual_publish] 内容已自动填好，等待人工确认发布'].slice(-80)
                }
            });
        }
    });
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function slugifyText(value, fallback = 'video') {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return normalized || fallback;
}

function makeJobId() {
    return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function listVerticalJobs() {
    return Array.from(verticalJobs.values())
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 50);
}

function getVerticalQueueStatus() {
    return {
        concurrency: verticalJobConcurrency,
        running: verticalActiveCount,
        queued: verticalJobQueue.length,
        jobs: listVerticalJobs()
    };
}

function spawnScript(scriptPath, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn('python', [scriptPath, ...args], { cwd: options.cwd });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
            if (typeof options.onStdout === 'function') options.onStdout(data.toString());
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            if (typeof options.onStderr === 'function') options.onStderr(data.toString());
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(scriptPath)} failed`));
        });
    });
}

async function downloadRemoteFile(url, destinationPath) {
    ensureDir(path.dirname(destinationPath));
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await axios({
                method: 'get',
                url,
                responseType: 'stream',
                maxRedirects: 5,
                timeout: 120000,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(destinationPath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            return;
        } catch (error) {
            lastError = error;
            try {
                if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
            } catch (_err) {}
            if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
            }
        }
    }

    throw new Error(`远程视频下载失败，已重试 ${maxAttempts} 次: ${lastError?.message || 'unknown error'}`);
}

async function runVerticalQueueJob(job) {
    const scriptsDir = PIPELINE_DIR;
    const runAsrPath = path.join(scriptsDir, 'run_asr.py');
    const makeVerticalPath = path.join(scriptsDir, 'make_vertical_video.py');
    const generateTitlePath = path.join(scriptsDir, 'generate_title.py');

    const jobDir = path.join(VERTICAL_QUEUE_ROOT, job.id);
    const publicOutputDir = path.join(VERTICAL_PUBLIC_DIR, job.id);
    ensureDir(jobDir);
    ensureDir(publicOutputDir);

    const sourceVideoPath = path.join(jobDir, 'source.mp4');
    const subtitlesPath = path.join(jobDir, 'subtitles.json');
    const contentPath = path.join(jobDir, 'content.json');
    const outputPath = path.join(jobDir, 'vertical_output.mp4');
    const publicOutputPath = path.join(publicOutputDir, 'vertical_output.mp4');

    const updateJob = (patch) => Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    const renderOptions = job.renderOptions || {};

    updateJob({ status: 'downloading', progress: 10, message: '正在下载远程视频...' });
    await downloadRemoteFile(job.videoUrl, sourceVideoPath);

    updateJob({ status: 'transcribing', progress: 35, message: '正在执行 ASR 自动打轴...' });
    await spawnScript(runAsrPath, ['--input', sourceVideoPath], {
        cwd: jobDir
    });

    let finalTitle = String(job.title || '').trim();
    if (!finalTitle) {
        updateJob({ status: 'titling', progress: 55, message: '正在生成竖屏标题...' });
        try {
            const { stdout } = await spawnScript(generateTitlePath, ['--subtitles', subtitlesPath], {
                cwd: jobDir
            });
            finalTitle = stdout.trim();
        } catch (_err) {
            finalTitle = buildFallbackTitleFromSubtitles(subtitlesPath);
        }
        finalTitle = finalTitle || '热点视频速递\n正在发酵？';
    }

    fs.writeFileSync(contentPath, JSON.stringify({ title: finalTitle }, null, 2), 'utf-8');
    updateJob({ status: 'rendering', progress: 75, message: '正在渲染竖屏视频...' });
    await spawnScript(makeVerticalPath, [
        '--input', sourceVideoPath,
        '--content', contentPath,
        '--subtitles', subtitlesPath,
        '--output', outputPath,
        '--background', path.join(jobDir, 'background_generated.png'),
        '--sub-dir', path.join(jobDir, 'subtitle_cards'),
        '--title-font-size', String(renderOptions.titleFontSize || 104),
        '--title-min-size', String(renderOptions.titleMinSize || 52),
        '--title-max-lines', String(renderOptions.titleMaxLines || 2),
        '--subtitle-font-size', String(renderOptions.subtitleFontSize || 50),
        '--subtitle-min-size', String(renderOptions.subtitleMinSize || 28),
        '--subtitle-max-lines', String(renderOptions.subtitleMaxLines || 2),
        '--subtitle-offset-y', String(
            Number.isFinite(Number(renderOptions.subtitleOffsetY))
                ? Number(renderOptions.subtitleOffsetY)
                : 20
        ),
        '--english-font-size', String(renderOptions.englishFontSize || 52),
        '--english-min-size', String(renderOptions.englishMinSize || 30),
        '--english-max-lines', String(renderOptions.englishMaxLines || 2)
    ], {
        cwd: jobDir
    });

    fs.copyFileSync(outputPath, publicOutputPath);
    updateJob({
        status: 'completed',
        progress: 100,
        title: finalTitle,
        message: '竖屏视频已完成',
        resultVideoUrl: `/xai_vertical_queue/${job.id}/vertical_output.mp4?t=${Date.now()}`
    });
}

async function processVerticalQueue() {
    while (verticalActiveCount < verticalJobConcurrency && verticalJobQueue.length > 0) {
        const job = verticalJobQueue.shift();
        if (!job) return;
        verticalActiveCount += 1;
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        job.updatedAt = job.startedAt;

        runVerticalQueueJob(job)
            .catch((error) => {
                job.status = 'failed';
                job.progress = 100;
                job.message = error.message;
                job.error = error.message;
                job.updatedAt = new Date().toISOString();
            })
            .finally(() => {
                verticalActiveCount = Math.max(0, verticalActiveCount - 1);
                processVerticalQueue();
            });
    }
}

function enqueueVerticalJob(item) {
    const id = makeJobId();
    const job = {
        id,
        status: 'queued',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceType: item.sourceType || 'xai_top10',
        author: item.author || '',
        postId: item.postId || '',
        postUrl: item.postUrl || '',
        title: String(item.title || '').trim(),
        summary: String(item.summary || '').trim(),
        videoUrl: item.videoUrl,
        videoLabel: slugifyText(item.author || item.postId || item.title || 'video'),
        renderOptions: item.renderOptions || {}
    };
    verticalJobs.set(id, job);
    verticalJobQueue.push(job);
    processVerticalQueue();
    return job;
}

async function generateHotTitle(pipelineDir, subtitlesFileName = "subtitles.json") {
    const subtitlesPath = path.join(pipelineDir, subtitlesFileName);
    return new Promise((resolve) => {
        const proc = spawn("python", ["generate_title.py", "--subtitles", subtitlesFileName], { cwd: pipelineDir });
        let output = "";
        let errorOutput = "";
        proc.stdout.on("data", (data) => {
            output += data.toString();
        });
        proc.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });
        proc.on("close", (code) => {
            if (code === 0 && output.trim()) {
                resolve(output.trim());
            } else {
                console.error(`generate_title.py failed: ${errorOutput.trim()}`);
                resolve(buildFallbackTitleFromSubtitles(subtitlesPath));
            }
        });
    });
}

// 给前端提供获取本地预设列表的接口
app.get('/api/presets', (req, res) => {
    try {
        const audioDir = path.join(__dirname, 'public/presets/audio');
        const imageDir = path.join(__dirname, 'public/presets/image');
        
        const audioFiles = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3')) : [];
        const imageFiles = fs.existsSync(imageDir) ? fs.readdirSync(imageDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i)) : [];
        
        res.json({ success: true, audio: audioFiles, image: imageFiles });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/workflow-config', (req, res) => {
    try {
        const workflow = readWorkflow();
        res.json({ success: true, config: extractWorkflowConfig(workflow) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/workflow-config', (req, res) => {
    try {
        const workflow = readWorkflow();
        const updated = applyWorkflowConfig(workflow, req.body || {});
        writeWorkflow(updated);
        res.json({ success: true, config: extractWorkflowConfig(updated) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/json-files', (req, res) => {
    try {
        const files = Array.from(EDITABLE_JSON_FILES).map((fileName) => {
            const fullPath = resolveEditableJsonPath(fileName);
            return {
                fileName,
                exists: !!(fullPath && fs.existsSync(fullPath))
            };
        });
        res.json({ success: true, files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/json-files/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return res.status(400).json({ error: '不支持的文件类型' });
        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '文件不存在' });
        const content = fs.readFileSync(fullPath, 'utf-8');
        res.json({ success: true, fileName, content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/json-files/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return res.status(400).json({ error: '不支持的文件类型' });
        if (typeof req.body.content !== 'string') return res.status(400).json({ error: '缺少内容' });
        JSON.parse(req.body.content);
        fs.writeFileSync(fullPath, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 前端连接这个接口来监听进度条事件
app.get('/api/progress', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).send('Missing clientId');

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    clients.set(clientId, res);
    
    req.on('close', () => {
        clients.delete(clientId);
    });
});

// 上传文件到云端
async function uploadToComfyUI(filePath, baseUrl) {
    const form = new FormData();
    form.append('image', fs.createReadStream(filePath)); 
    form.append('type', 'input');
    form.append('subfolder', '');
    
    const res = await axios.post(`${baseUrl}/upload/image`, form, {
        headers: { ...form.getHeaders() },
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
    return res.data.name; 
}

// 轮询视频生成结果 (兜底)
async function waitForCompletion(promptId, baseUrl) {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            try {
                const res = await axios.get(`${baseUrl}/history/${promptId}`, {
                    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
                });
                const history = res.data[promptId];
                if (history) {
                    clearInterval(interval);
                    
                    const outputs = history.outputs;
                    if (outputs && outputs["151"]) {
                        const mediaList = outputs["151"].videos || outputs["151"].gifs;
                        if (mediaList && mediaList.length > 0) {
                            const videoInfo = mediaList[0];
                            const videoUrl = `${baseUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type}&subfolder=${videoInfo.subfolder}`;
                            resolve(videoUrl);
                            return;
                        }
                    }
                    reject(new Error("任务完成，但未找到视频输出"));
                }
            } catch (e) {
                // 忽略网络波动
            }
        }, 3000); 
    });
}

// 监听云端 ComfyUI 的 WebSocket 获取真实进度
function listenComfyUIProgress(clientId, baseUrl) {
    try {
        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;
        const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });

        ws.on('open', () => console.log(`已连接 ComfyUI 进度通道: ${clientId}`));

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            const sse = clients.get(clientId);

            if (msg.type === 'progress' && sse) {
                const percent = Math.round((msg.data.value / msg.data.max) * 100);
                sse.write(`data: ${JSON.stringify({ type: 'progress', percent: percent, msg: '正在努力渲染视频帧...' })}\n\n`);
            } else if (msg.type === 'executing' && sse) {
                if (msg.data.node) {
                    sse.write(`data: ${JSON.stringify({ type: 'status', msg: `当前运行节点ID: ${msg.data.node}` })}\n\n`);
                }
            }
        });

        ws.on('close', () => console.log(`WebSocket 断开: ${clientId}`));
        ws.on('error', () => {}); 
        
        return ws;
    } catch(err) {
        console.error("WS 连接失败:", err);
    }
}

// 核心生成接口
app.post('/api/generate', upload.fields([{ name: 'audio' }, { name: 'image' }]), async (req, res) => {
    let ws = null;
    try {
        const text = req.body.text;
        const clientId = req.body.clientId;
        const baseUrl = req.body.serverUrl || 'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443';
        const trimSeconds = parseFloat(req.body.trimSeconds || 0);
        const maxDuration = parseFloat(req.body.maxDuration || 10);
        
        const useAudioPreset = req.body.useAudioPreset === 'true';
        const useImagePreset = req.body.useImagePreset === 'true';

        // 决定使用上传文件还是本地预设文件
        let audioPath, imagePath;

        if (useAudioPreset) {
            if (!req.body.audioPreset) return res.status(400).json({ error: '未选择音频预设' });
            audioPath = path.join(__dirname, 'public/presets/audio', req.body.audioPreset);
            if (!fs.existsSync(audioPath)) return res.status(400).json({ error: '音频预设文件不存在，请检查 /public/presets/audio 目录' });
        } else {
            if (!req.files['audio']) return res.status(400).json({ error: '请上传音频文件' });
            audioPath = req.files['audio'][0].path;
        }

        if (useImagePreset) {
            if (!req.body.imagePreset) return res.status(400).json({ error: '未选择人物照片预设' });
            imagePath = path.join(__dirname, 'public/presets/image', req.body.imagePreset);
            if (!fs.existsSync(imagePath)) return res.status(400).json({ error: '人物预设文件不存在，请检查 /public/presets/image 目录' });
        } else {
            if (!req.files['image']) return res.status(400).json({ error: '请上传人物图片' });
            imagePath = req.files['image'][0].path;
        }

        if (!text || !clientId) {
            return res.status(400).json({ error: '请提供完整的文字内容' });
        }

        const sse = clients.get(clientId);
        if(sse) sse.write(`data: ${JSON.stringify({ type: 'status', msg: '正在把照片和声音上传到云端...' })}\n\n`);

        const remoteAudioName = await uploadToComfyUI(audioPath, baseUrl);
        const remoteImageName = await uploadToComfyUI(imagePath, baseUrl);
        
        ws = listenComfyUIProgress(clientId, baseUrl);

        if(sse) sse.write(`data: ${JSON.stringify({ type: 'status', msg: '正在组装AI指令，准备开始施法...' })}\n\n`);
        const workflowData = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
        const workflow = JSON.parse(workflowData);
        const workflowConfig = req.body.workflowConfig ? JSON.parse(req.body.workflowConfig) : null;
        if (workflowConfig) {
            applyWorkflowConfig(workflow, workflowConfig);
        }

        workflow["278"]["inputs"]["text"] = text;
        workflow["6"]["inputs"]["audio"] = remoteAudioName;
        workflow["180"]["inputs"]["image"] = remoteImageName;

        const randomSeed = Math.floor(Math.random() * 2147483647);
        workflow["27"]["inputs"]["seed"] = randomSeed;
        workflow["278"]["inputs"]["seed"] = randomSeed;

        workflow["50"]["inputs"]["expression"] = `max(1, (a + (${trimSeconds})) * 25 + 1)`;

        // 修改节点 7 (AudioCrop) 的最大时长，以防原版的 0:10 限制
        const m = Math.floor(maxDuration / 60);
        const s = Math.floor(maxDuration % 60);
        workflow["7"]["inputs"]["end_time"] = `${m}:${s.toString().padStart(2, '0')}`;

        const promptRes = await axios.post(`${baseUrl}/prompt`, { 
            prompt: workflow,
            client_id: clientId 
        }, {
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });
        
        const promptId = promptRes.data.prompt_id;
        
        const videoUrl = await waitForCompletion(promptId, baseUrl);
        
        if (ws) ws.close();
        res.json({ success: true, videoUrl: videoUrl });

    } catch (error) {
        if (ws) ws.close();
        console.error('执行失败:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 优雅地重构 runScript，使其更健壮
function runPipelineScript(scriptArgs, options) {
    return new Promise((resolve, reject) => {
        const { sse, progress, msg } = options;
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: progress, msg })}\n\n`);
        
        const proc = spawn("python", scriptArgs, { cwd: options.cwd });
        let errorOutput = "";

        proc.stdout.on("data", (data) => {
            const lastLine = data.toString().trim().split("\n").pop();
            if(sse && lastLine) sse.write(`data: ${JSON.stringify({ type: "status", msg: lastLine })}\n\n`);
        });
        
        proc.stderr.on("data", (data) => {
            const errStr = data.toString();
            errorOutput += errStr;
            console.error(`[${scriptArgs[0]} stderr]: ${errStr}`);
            if(sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "⚠️ " + errStr.trim().split("\n").pop() })}\n\n`);
        });
        
        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${scriptArgs[0]} 失败: ${errorOutput.split("\n").slice(-2).join(" ")}`));
            }
        });
    });
}

app.post("/api/run-pipeline", upload.fields([{ name: "aiman" }, { name: "material" }]), async (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });
    const sse = clients.get(clientId);
    try {
        const pipelineDir = path.join(__dirname, "pipeline_scripts");
        if (!req.files["aiman"] || !req.files["material"]) {
            return res.status(400).json({ error: "请上传数字人视频和空镜头素材视频" });
        }
        const aimanPath = path.join(pipelineDir, "aiman.mp4");
        const materialPath = path.join(pipelineDir, "material.mp4");
        const outputPath = path.join(__dirname, "public/output_final.mp4");
        // ... (file cleanup)
        fs.renameSync(req.files["aiman"][0].path, aimanPath);
        fs.renameSync(req.files["material"][0].path, materialPath);
        
        await runPipelineScript(["run_asr.py"], { sse, progress: 10, msg: "1/5: 正在 ASR 识别与翻译...", cwd: pipelineDir });
        await runPipelineScript(["video_vlm.py"], { sse, progress: 30, msg: "2/5: 正在 VLM 分析画面...", cwd: pipelineDir });
        await runPipelineScript(["run_director.py"], { sse, progress: 50, msg: "3/5: AI 导演思考剧本...", cwd: pipelineDir });
        
        const buildArgs = ["build_video.py"];
        if (req.body.withSubtitles === "false") {
            buildArgs.push("--no-subs");
        }
        await runPipelineScript(buildArgs, { sse, progress: 70, msg: "4/5: FFmpeg 正在合成视频...", cwd: pipelineDir });

        const finalSourcePath = path.join(pipelineDir, "output_final.mp4");
        let finalUrl = "/output_final.mp4";
        
        if (req.body.generateVertical === "true") {
             const contentJsonPath = path.join(pipelineDir, "content.json");
             let verticalTitle = (req.body.verticalTitle || "").trim();
             if (!verticalTitle) {
                 if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "未填写竖屏标题，正在自动生成热点标题..." })}\n\n`);
                 verticalTitle = await generateHotTitle(pipelineDir, "subtitles.json");
                 if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: `自动标题：${verticalTitle}` })}\n\n`);
             }
             fs.writeFileSync(contentJsonPath, JSON.stringify({ title: verticalTitle }, null, 2), "utf-8");
             const verticalOutputName = "output_final_vertical.mp4";
             await runPipelineScript(["make_vertical_video.py", "--input", "output_final.mp4", "--output", verticalOutputName], { sse, progress: 90, msg: "5/5: 生成动态竖屏...", cwd: pipelineDir });
             fs.copyFileSync(path.join(pipelineDir, verticalOutputName), path.join(__dirname, "public", verticalOutputName));
             finalUrl = "/" + verticalOutputName;
        } else {
             fs.copyFileSync(finalSourcePath, outputPath);
        }
        
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 100, msg: "🎉 视频生成完毕！" })}\n\n`);
        res.json({ success: true, videoUrl: finalUrl + "?t=" + Date.now() });

    } catch (error) {
        console.error("Pipeline failed:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/xai-top10/result', (req, res) => {
    try {
        if (!fs.existsSync(XAI_TOP10_RESULT)) {
            return res.status(404).json({ error: '结果文件不存在，请先运行一次榜单任务' });
        }
        const result = JSON.parse(fs.readFileSync(XAI_TOP10_RESULT, 'utf-8'));
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/xai-top10/status', (req, res) => {
    try {
        res.json({ success: true, status: getXaiTop10Status() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/xai-top10/config', (req, res) => {
    try {
        const payload = readJsonIfExists(XAI_TOP10_ACCOUNTS, { accounts: [] }) || { accounts: [] };
        res.json({ success: true, config: { accounts: sanitizeAccounts(payload.accounts || []) } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/xai-top10/config', (req, res) => {
    try {
        const accounts = sanitizeAccounts(req.body?.accounts || []);
        if (accounts.length === 0) {
            return res.status(400).json({ error: '账号池不能为空' });
        }
        fs.writeFileSync(XAI_TOP10_ACCOUNTS, JSON.stringify({ accounts }, null, 2), 'utf-8');
        res.json({ success: true, config: { accounts } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/xai-top10/vertical-jobs', (req, res) => {
    try {
        res.json({ success: true, status: getVerticalQueueStatus() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/xai-top10/vertical-jobs', (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const requestedConcurrency = Number(req.body?.concurrency);
        if (Number.isFinite(requestedConcurrency) && requestedConcurrency > 0) {
            verticalJobConcurrency = Math.max(1, Math.min(4, Math.floor(requestedConcurrency)));
        }
        const validItems = items
            .map((item) => ({
                sourceType: 'xai_top10',
                author: item.author,
                postId: item.post_id || item.postId,
                postUrl: item.post_url || item.postUrl,
                title: item.title,
                summary: item.author_summary || item.summary,
                videoUrl: item.video_url || item.videoUrl,
                renderOptions: item.renderOptions || {}
            }))
            .filter((item) => item.videoUrl);

        if (validItems.length === 0) {
            return res.status(400).json({ error: '没有可入队的视频链接' });
        }

        const jobs = validItems.map((item) => enqueueVerticalJob(item));
        res.json({
            success: true,
            queued: jobs.length,
            jobs,
            status: getVerticalQueueStatus()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/xai-top10/run', async (req, res) => {
    const clientId = req.body?.clientId;
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    if (xaiTop10Process) return res.status(409).json({ error: '榜单任务正在运行，请稍后再试' });
    if (!fs.existsSync(XAI_TOP10_SCRIPT)) {
        return res.status(500).json({ error: 'run_xai_top10.py 不存在，无法启动榜单任务' });
    }

    const sse = clients.get(clientId);
    const pushEvent = (payload) => {
        if (sse) sse.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
        pushEvent({ type: 'progress', percent: 5, msg: '正在启动 XAI Top10 榜单任务...' });
        xaiTop10Process = spawn('python', [XAI_TOP10_SCRIPT], { cwd: XAI_TOP10_DIR });

        let stdout = '';
        let stderr = '';

        xaiTop10Process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        xaiTop10Process.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                const lower = line.toLowerCase();
                const percent = lower.includes('candidate scan complete')
                    ? 35
                    : lower.includes('starting enrich stage')
                        ? 45
                        : lower.includes('enrich ')
                            ? 60
                            : lower.includes('starting followers stage')
                                ? 80
                                : lower.includes('run finished')
                                    ? 100
                                    : null;
                if (percent !== null) {
                    pushEvent({ type: 'progress', percent, msg: line });
                } else {
                    pushEvent({ type: 'status', msg: line });
                }
            }
        });

        xaiTop10Process.on('error', (error) => {
            xaiTop10Process = null;
            console.error('xai top10 spawn error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        });

        xaiTop10Process.on('close', (code) => {
            xaiTop10Process = null;
            if (code !== 0) {
                console.error('xai top10 failed:', stderr || stdout);
                if (!res.headersSent) {
                    res.status(500).json({ error: stderr.trim() || stdout.trim() || 'xai top10 执行失败' });
                }
                return;
            }

            try {
                const result = JSON.parse(fs.readFileSync(XAI_TOP10_RESULT, 'utf-8'));
                pushEvent({ type: 'progress', percent: 100, msg: '🎉 Top10 榜单已生成完成！' });
                if (!res.headersSent) {
                    res.json({ success: true, result, status: getXaiTop10Status() });
                }
            } catch (err) {
                if (!res.headersSent) {
                    res.status(500).json({ error: `任务完成但读取结果失败: ${err.message}` });
                }
            }
        });
    } catch (error) {
        xaiTop10Process = null;
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/publish/config', (req, res) => {
    try {
        const config = readPublishConfig();
        res.json({ success: true, config, maskedConfig: maskPlatformConfig(config) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publish/config', (req, res) => {
    try {
        const config = sanitizePlatformConfigInput(req.body || {});
        writePublishConfig(config);
        const payload = reconcileAndPersistPublishJobs(config);
        res.json({ success: true, config, maskedConfig: maskPlatformConfig(config), jobs: payload.jobs || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/publish/assets', (req, res) => {
    try {
        const forceRefresh = String(req.query.refresh || '').trim() === '1';
        res.json({ success: true, assets: getCachedPublishAssets(forceRefresh) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/publish/jobs', (req, res) => {
    try {
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/publish/jobs/:jobId', (req, res) => {
    try {
        const jobId = String(req.params.jobId || '').trim();
        if (!jobId) return res.status(400).json({ error: '缺少任务 ID' });
        const payload = readPublishJobs();
        const beforeCount = (payload.jobs || []).length;
        payload.jobs = (payload.jobs || []).filter((job) => job.id !== jobId);
        if (payload.jobs.length === beforeCount) {
            return res.status(404).json({ error: '发布任务不存在' });
        }
        writePublishJobs(payload);
        res.json({ success: true, jobs: payload.jobs || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/publish/jobs', (req, res) => {
    try {
        writePublishJobs({ jobs: [] });
        res.json({ success: true, jobs: [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publish/jobs', (req, res) => {
    try {
        const config = readPublishConfig();
        const assets = collectPublishAssets();
        const assetId = String(req.body?.assetId || '').trim();
        const selectedPlatforms = Array.isArray(req.body?.platforms) ? req.body.platforms.map((value) => String(value).trim()).filter(Boolean) : [];
        const title = String(req.body?.title || '').trim();
        const description = String(req.body?.description || '').trim();
        const tags = Array.isArray(req.body?.tags) ? req.body.tags : String(req.body?.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
        const coverUrl = String(req.body?.coverUrl || '').trim();

        if (!assetId) return res.status(400).json({ error: '请选择要发布的视频素材' });
        if (!title) return res.status(400).json({ error: '请填写发布标题' });
        if (selectedPlatforms.length === 0) return res.status(400).json({ error: '请至少选择一个平台' });

        const asset = assets.find((item) => item.id === assetId);
        if (!asset) return res.status(404).json({ error: '所选视频素材不存在' });

        const shortTitle = buildShortTitle(title, '热点速递');
        const publishData = { title, shortTitle, description, tags, coverUrl };
        const platformTasks = [];
        const platformErrors = [];

        for (const platformKey of selectedPlatforms) {
            const platformConfig = config[platformKey];
            if (!platformConfig) {
                platformErrors.push({ platform: platformKey, error: '未知平台', missingFields: [], missingFieldLabels: [] });
                continue;
            }
            if (!platformConfig.enabled) {
                platformErrors.push({ platform: platformKey, error: '该平台尚未启用', missingFields: [], missingFieldLabels: [] });
                continue;
            }
            const task = buildPublishTask(platformKey, publishData, asset.url, platformConfig);
            const validation = collectPlatformValidation(platformKey, platformConfig, task.requiredFields || []);
            task.validation = validation;
            if (validation.missingFields.length > 0) {
                platformErrors.push({
                    platform: platformKey,
                    error: `缺少配置字段：${validation.missingFieldLabels.join('，')}`,
                    missingFields: validation.missingFields,
                    missingFieldLabels: validation.missingFieldLabels
                });
                task.status = 'config_missing';
            }
            platformTasks.push(task);
        }

        if (platformTasks.length === 0) {
            return res.status(400).json({ error: '没有可创建的发布任务，请检查平台启用状态', platformErrors });
        }

        const payload = readPublishJobs();
        const job = {
            id: makeJobId(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: platformErrors.length > 0 ? 'partial_ready' : 'ready',
            asset,
            publishData,
            selectedPlatforms,
            platformTasks,
            platformErrors
        };
        payload.jobs = [job, ...(payload.jobs || [])].slice(0, 50);
        writePublishJobs(payload);
        res.json({ success: true, job, jobs: payload.jobs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publish/jobs/:jobId/wechat-channels', (req, res) => {
    try {
        const jobId = String(req.params.jobId || '').trim();
        const mode = String(req.body?.mode || 'draft').trim();
        if (!['draft', 'publish'].includes(mode)) {
            return res.status(400).json({ error: 'mode 仅支持 draft 或 publish' });
        }
        startWechatRpa(jobId, mode);
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ================= 新增：文案润色接口 =================
app.post("/api/optimize-text", express.json(), (req, res) => {
    const text = req.body.text;
    if (!text) return res.status(400).json({ error: "Missing text" });
    const scriptPath = path.join(__dirname, "pipeline_scripts", "optimize_text.py");
    const proc = spawn("python", [scriptPath, "--text", text]);
    let output = "";
    let err = "";
    proc.stdout.on("data", (data) => output += data.toString());
    proc.stderr.on("data", (data) => err += data.toString());
    proc.on("close", (code) => {
        if (code === 0) res.json({ text: output.trim() });
        else res.status(500).json({ error: err });
    });
});

// ================= 新增：比例转换接口 =================
app.post("/api/convert-video", express.json(), (req, res) => {
    const ratio = req.body.ratio;
    if (!ratio) return res.status(400).json({ error: "Missing ratio" });
    const pipelineDir = path.join(__dirname, "pipeline_scripts");
    const inputFile = path.join(pipelineDir, "output_final.mp4");
    const outputName = ratio === "9:16" ? "output_9_16.mp4" : "output_16_9.mp4";
    const outputFile = path.join(__dirname, "public", outputName);
    
    const proc = spawn("python", ["convert_ratio.py", "--ratio", ratio, "--input", inputFile, "--output", outputFile], { cwd: pipelineDir });
    let err = "";
    proc.stderr.on("data", (data) => err += data.toString());
    proc.on("close", (code) => {
        if (code === 0) res.json({ videoUrl: "/" + outputName + "?t=" + Date.now() });
        else res.status(500).json({ error: err });
    });
});


// ================= 新增：独立竖屏生成接口 =================
app.post("/api/generate-vertical-standalone", upload.fields([{ name: "video" }, { name: "srt" }]), async (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });
    const sse = clients.get(clientId);

    try {
        const pipelineDir = path.join(__dirname, "pipeline_scripts");
        const renderOptions = req.body.renderOptions ? JSON.parse(req.body.renderOptions) : {};
        if (!req.files["video"]) {
            return res.status(400).json({ error: "请上传需要转换的视频" });
        }
        
        // --- Prepare files ---
        const inputVideoPath = path.join(pipelineDir, "standalone_input.mp4");
        fs.renameSync(req.files["video"][0].path, inputVideoPath);
        
        const contentJsonPath = path.join(pipelineDir, "content.json");

        const subsJsonPath = path.join(pipelineDir, "subtitles.json");
        const shouldUseASR = req.body.useASR === "true" || (!req.files["srt"] && req.body.useASR !== "false");

        if (shouldUseASR) {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "自动 ASR 打轴已开启，正在识别视频语音..." })}\n\n`);
            await new Promise((resolve, reject) => {
                const proc = spawn("python", ["run_asr.py", "--input", "standalone_input.mp4"], { cwd: pipelineDir });
                let errorOutput = "";
                proc.stdout.on("data", (data) => {
                    const lastLine = data.toString().trim().split("\n").pop();
                    if (sse && lastLine) sse.write(`data: ${JSON.stringify({ type: "status", msg: lastLine })}\n\n`);
                });
                proc.stderr.on("data", (data) => {
                    const errStr = data.toString();
                    errorOutput += errStr;
                    console.error(`[run_asr.py stderr]: ${errStr}`);
                });
                proc.on("close", (code) => {
                    code === 0 ? resolve() : reject(new Error(`run_asr.py failed: ${errorOutput.trim()}`));
                });
            });
        } else if (req.files["srt"]) {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "检测到 SRT 文件，正在转换为 JSON..." })}\n\n`);
            const srtPath = path.join(pipelineDir, "uploaded.srt");
            fs.renameSync(req.files["srt"][0].path, srtPath);
            await new Promise((resolve, reject) => {
                const proc = spawn("python", ["convert_srt_to_json.py", srtPath, subsJsonPath], { cwd: pipelineDir });
                let errorOutput = "";
                proc.stderr.on("data", (data) => {
                    errorOutput += data.toString();
                });
                proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`SRT to JSON conversion failed: ${errorOutput.trim()}`)));
            });
        } else {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "未提供字幕文件，将生成无字幕视频。" })}\n\n`);
            fs.writeFileSync(subsJsonPath, "[]");
        }

        let finalTitle = (req.body.title || "").trim();
        if (!finalTitle) {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "未填写标题，正在根据字幕自动生成热点标题..." })}\n\n`);
            finalTitle = await generateHotTitle(pipelineDir, "subtitles.json");
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: `自动标题：${finalTitle}` })}\n\n`);
        }
        fs.writeFileSync(contentJsonPath, JSON.stringify({ title: finalTitle }, null, 2), "utf-8");

        // --- Run script ---
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 50, msg: "正在渲染动态竖屏视频..." })}\n\n`);
        const outputName = "standalone_output_vertical.mp4";
        const outputPath = path.join(pipelineDir, outputName);
        
        await new Promise((resolve, reject) => {
            const proc = spawn("python", [
                "make_vertical_video.py",
                "--input", inputVideoPath,
                "--output", outputPath,
                "--title-font-size", String(renderOptions.titleFontSize || 104),
                "--title-min-size", String(renderOptions.titleMinSize || 52),
                "--title-max-lines", String(renderOptions.titleMaxLines || 2),
                "--subtitle-font-size", String(renderOptions.subtitleFontSize || 50),
                "--subtitle-min-size", String(renderOptions.subtitleMinSize || 28),
                "--subtitle-max-lines", String(renderOptions.subtitleMaxLines || 2),
                "--subtitle-offset-y", String(
                    Number.isFinite(Number(renderOptions.subtitleOffsetY))
                        ? Number(renderOptions.subtitleOffsetY)
                        : 20
                ),
                "--english-font-size", String(renderOptions.englishFontSize || 52),
                "--english-min-size", String(renderOptions.englishMinSize || 30),
                "--english-max-lines", String(renderOptions.englishMaxLines || 2)
            ], { cwd: pipelineDir });
            proc.stderr.on("data", (data) => console.error(`[standalone_vertical stderr]: ${data}`));
            proc.on("close", (code) => code === 0 ? resolve() : reject(new Error('make_vertical_video.py failed')));
        });

        // --- Return result ---
        const finalUrlPath = path.join(__dirname, "public", outputName);
        fs.copyFileSync(outputPath, finalUrlPath);
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 100, msg: "🎉 动态竖屏生成完毕！" })}\n\n`);
        res.json({ success: true, videoUrl: "/" + outputName + "?t=" + Date.now(), title: finalTitle });

    } catch (error) {
        console.error("Standalone vertical failed:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
const HOST = "0.0.0.0";

ensureDir(VERTICAL_QUEUE_ROOT);
ensureDir(VERTICAL_PUBLIC_DIR);
ensureDir(PUBLISH_CENTER_DIR);
ensureDir(WECHAT_RPA_USER_DATA_DIR);
ensureDir(WECHAT_RPA_TASK_DIR);
if (!fs.existsSync(PUBLISH_JOBS_PATH)) {
    writePublishJobs({ jobs: [] });
}

app.listen(PORT, HOST, () => {
    console.log(`🚀 AI面板服务端启动成功: http://${HOST}:${PORT}`);
});
