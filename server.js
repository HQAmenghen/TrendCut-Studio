const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const { loadProjectEnv } = require('./env');
const { sendError } = require('./server/core/http');
const {
    ensureDir,
    formatElapsedSeconds,
    makeJobId,
    readJsonIfExists,
    readTextIfExists,
    removeDirIfExists,
    sanitizeProcessLogLines,
    slugifyText,
    stopProcessTree,
    tailLines,
    writeJsonFile
} = require('./server/core/runtime');
const {
    attachProgressRoute,
    getClient: getProgressClient,
    sendEvent: sendProgressEvent
} = require('./server/core/progress');
const {
    applyWorkflowConfig,
    extractWorkflowConfig,
    readWorkflow,
    writeWorkflow
} = require('./server/services/pipeline/workflow');
const {
    listenComfyUIProgress,
    uploadToComfyUI,
    waitForCompletion
} = require('./server/services/pipeline/comfy');
const { createPipelineHandlers } = require('./server/services/pipeline/handlers');
const { registerPipelineRoutes } = require('./server/routes/pipeline');
const { createXaiService } = require('./server/services/xai/service');
const { registerXaiRoutes } = require('./server/routes/xai');
const { createVerticalQueueService } = require('./server/services/vertical/queue');
const { registerVerticalRoutes } = require('./server/routes/vertical');
const { createStandaloneHandler } = require('./server/services/vertical/standalone');
const { registerStandaloneRoute } = require('./server/routes/standalone');
const { createPublishHandlers } = require('./server/services/publish/handlers');
const { createPublishAssetsService } = require('./server/services/publish/assets');
const { createPublishStore } = require('./server/services/publish/store');
const { createWechatRpaService } = require('./server/services/publish/wechatRpa');
const { createSystemHandlers } = require('./server/services/system/handlers');
const { createSelfCheckService } = require('./server/services/system/selfCheck');
const { registerPublishRoutes } = require('./server/routes/publish');
const { registerSystemRoutes } = require('./server/routes/system');

loadProjectEnv(__dirname);

const app = express();
const DEFAULT_COMFYUI_BASE_URL = process.env.COMFYUI_BASE_URL || 'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443';
const PUBLIC_DIR = path.join(__dirname, 'public');
const FRONTEND_DIST_DIR = path.join(__dirname, 'frontend-dist');
const FRONTEND_INDEX_PATH = path.join(FRONTEND_DIST_DIR, 'index.html');
const LEGACY_INDEX_PATH = path.join(PUBLIC_DIR, 'index_legacy.html');
const HAS_BUILT_FRONTEND = fs.existsSync(FRONTEND_INDEX_PATH);
const CONFIG_DIR = path.join(__dirname, 'config');
const PYTHON_DIR = path.join(__dirname, 'python');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (HAS_BUILT_FRONTEND) {
    app.use(express.static(FRONTEND_DIST_DIR));
}
app.use(express.static(PUBLIC_DIR)); // 提供静态产物和旧版兜底页面
app.use(express.json());

app.get('/index_legacy.html', (_req, res) => {
    res.sendFile(LEGACY_INDEX_PATH);
});

app.get('/', (_req, res) => {
    if (HAS_BUILT_FRONTEND) {
        return res.sendFile(FRONTEND_INDEX_PATH);
    }
    return res.sendFile(LEGACY_INDEX_PATH);
});

const upload = multer({ dest: UPLOADS_DIR });

const WORKFLOW_PATH = path.join(CONFIG_DIR, 'workflow_api.json');
const PIPELINE_DIR = path.join(PYTHON_DIR, 'pipeline');
const XAI_TOP10_DIR = path.join(PYTHON_DIR, 'xai');
const XAI_TOP10_SCRIPT = path.join(XAI_TOP10_DIR, 'run_xai_top10.py');
const XAI_TOP10_TRANSLATE_SCRIPT = path.join(XAI_TOP10_DIR, 'translate_result_summaries.py');
const XAI_TOP10_RESULT = path.join(XAI_TOP10_DIR, 'result.json');
const XAI_TOP10_PARTIAL = path.join(XAI_TOP10_DIR, 'result.partial.json');
const XAI_TOP10_LOG = path.join(XAI_TOP10_DIR, 'run_log.txt');
const XAI_TOP10_ERROR_LOG = path.join(XAI_TOP10_DIR, 'run_error.log');
const XAI_TOP10_ACCOUNTS = path.join(XAI_TOP10_DIR, 'xai_accounts.json');
const XAI_TOP10_FIXED_ACCOUNTS = [
    'BitcoinMagazine',
    'AltcoinDaily',
    'TrendingBitcoin',
    'Vivek4real_',
    'BinanceUS',
    'ABTC',
    'coinspace_',
    'WatcherGuru',
    'CoinDesk',
    'BitcoinNews21M',
    'DocumentingBTC',
    'BitcoinArchive',
    'cz_binance',
    'TomLeeTracker',
    'BMNRBullz',
    'web3bannie',
    'fiatarchive',
    'SimplyBitcoin',
    'WOLF_Bitcoin_',
    'KevinWSHPod',
    'elonmusk'
];
const VERTICAL_QUEUE_ROOT = path.join(UPLOADS_DIR, 'xai_vertical_queue');
const VERTICAL_PUBLIC_DIR = path.join(__dirname, 'public', 'xai_vertical_queue');
const RUNTIME_ROOT = path.join(UPLOADS_DIR, 'runtime_jobs');
const RUNTIME_RETENTION_MS = 48 * 60 * 60 * 1000;
const PUBLISH_CENTER_DIR = path.join(PYTHON_DIR, 'publish');
const PUBLISH_CONFIG_PATH = path.join(PUBLISH_CENTER_DIR, 'platform_config.json');
const PUBLISH_JOBS_PATH = path.join(PUBLISH_CENTER_DIR, 'publish_jobs.json');
const PUBLISH_DESCRIPTION_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'generate_publish_description.py');
const WECHAT_RPA_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_rpa.py');
const WECHAT_RPA_PROFILE_ROOT = path.join(PUBLISH_CENTER_DIR, 'browser_profiles', 'wechatChannels');
const WECHAT_RPA_TASK_DIR = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_tasks');
const EDITABLE_JSON_FILES = new Set(['workflow_api.json', 'audio.json', 'result.json', 'director.json']);
const publishDescriptionCache = new Map();
const WECHAT_ACCOUNT_FIELDS = ['displayName', 'finderUserName', 'helperAccount', 'openPlatformAppId', 'appId', 'appSecret', 'refreshToken', 'accountId', 'notes'];

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

function createRuntimeJobDir(prefix) {
    const dirPath = path.join(RUNTIME_ROOT, `${prefix}_${makeJobId()}`);
    ensureDir(dirPath);
    cleanupRuntimeJobDirs({ currentDir: dirPath });
    return dirPath;
}

function writeMediaMetadata(videoPath, payload) {
    writeJsonFile(`${videoPath}.meta.json`, payload || {});
}

function readMediaMetadata(videoPath) {
    return readJsonIfExists(`${videoPath}.meta.json`, null);
}

function listProtectedRuntimeDirs() {
    const protectedDirs = new Set();
    for (const videoPath of [
        path.join(__dirname, 'public', 'output_final.mp4'),
        path.join(__dirname, 'public', 'standalone_output_vertical.mp4')
    ]) {
        const meta = readMediaMetadata(videoPath);
        const taskDir = String(meta?.taskDir || '').trim();
        if (taskDir) {
            protectedDirs.add(path.resolve(taskDir));
        }
    }
    return protectedDirs;
}

function cleanupRuntimeJobDirs(options = {}) {
    if (!fs.existsSync(RUNTIME_ROOT)) return;
    const now = Date.now();
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : RUNTIME_RETENTION_MS;
    const protectedDirs = options.protectedDirs instanceof Set ? options.protectedDirs : listProtectedRuntimeDirs();
    const currentDir = options.currentDir ? path.resolve(options.currentDir) : '';
    if (currentDir) {
        protectedDirs.add(currentDir);
    }

    const entries = fs.readdirSync(RUNTIME_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of entries) {
        const dirPath = path.join(RUNTIME_ROOT, entry.name);
        const resolvedPath = path.resolve(dirPath);
        if (protectedDirs.has(resolvedPath)) continue;

        let stat = null;
        try {
            stat = fs.statSync(dirPath);
        } catch (_err) {
            continue;
        }
        if (!stat) continue;
        const ageMs = now - stat.mtimeMs;
        if (ageMs < maxAgeMs) continue;
        removeDirIfExists(dirPath);
    }
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function sanitizePublishDescriptionText(text, options = {}) {
    const preserveTags = options?.preserveTags === true;
    return String(text || '')
        .replace(preserveTags ? /$^/g : /\s*#[^\s#]+/g, '')
        .replace(/\n*\s*更多内容发布与分发由 AI 中台自动整理。\s*$/g, '')
        .trim();
}

function containsChineseText(text) {
    return /[\u3400-\u9fff]/.test(String(text || ''));
}

function generatePublishDescription(sourceText, options = {}) {
    const normalized = String(sourceText || '').replace(/\s+/g, ' ').trim();
    const normalizedTitle = String(options?.title || '').replace(/\s+/g, ' ').trim();
    if (!normalized || !containsChineseText(normalized)) {
        return '';
    }

    const includeTags = options?.includeTags === true;
    const cacheKey = crypto.createHash('md5').update(`${includeTags ? 'with-tags' : 'plain'}:${normalizedTitle}:${normalized}`).digest('hex');
    if (publishDescriptionCache.has(cacheKey)) {
        return publishDescriptionCache.get(cacheKey);
    }

    let result = '';
    try {
        if (fs.existsSync(PUBLISH_DESCRIPTION_SCRIPT)) {
            const args = [PUBLISH_DESCRIPTION_SCRIPT, '--source-text', normalized];
            if (normalizedTitle) {
                args.push('--title', normalizedTitle);
            }
            if (includeTags) {
                args.push('--include-tags');
            }
            const proc = spawnSync('python', args, {
                cwd: PUBLISH_CENTER_DIR,
                encoding: 'utf-8',
                timeout: 30000
            });
            if (proc.status === 0) {
                result = sanitizePublishDescriptionText(proc.stdout || '', { preserveTags: includeTags });
            } else {
                if (proc.error?.code === 'ETIMEDOUT') {
                    console.warn('generate publish description timed out, using fallback');
                } else {
                    console.warn('generate publish description failed:', proc.stderr || proc.stdout || proc.error?.message || 'unknown error');
                }
            }
        }
    } catch (err) {
        console.warn('generate publish description error:', err.message);
    }

    if (result) {
        publishDescriptionCache.set(cacheKey, result);
    }
    return result;
}

function buildPublishTask(platformKey, publishData, assetUrl, platformConfig, platformOptions = {}) {
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
            const accountId = String(platformOptions?.accountId || '').trim();
            return {
                ...common,
                status: 'rpa_available',
                guide: '当前基于视频号助手 Web 端的 RPA 自动化实现扫码登录、自动上传、自动填写文案。公开文档未提供通用直发 API，因此这里走浏览器自动化而非官方内容发布接口。首次运行前需要安装 Playwright Chromium 浏览器。',
                accountId,
                accountLabel: String(platformOptions?.accountLabel || '').trim(),
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

let verticalQueueService = null;

const publishAssetsService = createPublishAssetsService({
    fs,
    path,
    crypto,
    projectRoot: __dirname,
    verticalPublicDir: VERTICAL_PUBLIC_DIR,
    verticalQueueRoot: VERTICAL_QUEUE_ROOT,
    getVerticalJobById: (jobId) => verticalQueueService?.getJob(jobId) || null,
    readJsonIfExists,
    readMediaMetadata,
    sanitizePublishDescriptionText
});

const {
    buildShortTitle,
    collectPublishAssets,
    getCachedPublishAssets,
    resetPublishAssetsCache
} = publishAssetsService;

const publishStore = createPublishStore({
    publishConfigPath: PUBLISH_CONFIG_PATH,
    publishJobsPath: PUBLISH_JOBS_PATH,
    wechatAccountFields: WECHAT_ACCOUNT_FIELDS,
    readJsonIfExists,
    writeJsonFile,
    deepClone,
    makeJobId,
    buildPublishTask
});

const {
    getWechatAccountMap,
    readPublishConfig,
    writePublishConfig,
    readPublishJobs,
    writePublishJobs,
    updatePublishJob,
    updatePublishPlatformTask,
    archivePublishJob,
    archiveCompletedPublishJobs,
    maskPlatformConfig,
    collectPlatformValidation,
    sanitizePlatformConfigInput,
    validateWechatTaskConfig,
    reconcileAndPersistPublishJobs
} = publishStore;

const wechatRpaService = createWechatRpaService({
    fs,
    path,
    spawn,
    stopProcessTree,
    slugifyText,
    publishCenterDir: PUBLISH_CENTER_DIR,
    wechatRpaScript: WECHAT_RPA_SCRIPT,
    wechatRpaTaskDir: WECHAT_RPA_TASK_DIR,
    wechatRpaProfileRoot: WECHAT_RPA_PROFILE_ROOT,
    buildShortTitle,
    readPublishJobs,
    readPublishConfig,
    validateWechatTaskConfig,
    updatePublishPlatformTask
});

const {
    startWechatRpa,
    retryWechatRpa,
    cancelWechatRpa
} = wechatRpaService;

const systemHandlers = createSystemHandlers({
    fs,
    path,
    spawn,
    sendError,
    baseDir: __dirname,
    pipelineDir: PIPELINE_DIR,
    selfCheckService: createSelfCheckService({
        fs,
        spawnSync,
        envRequirements: [
            { key: 'COMFYUI_BASE_URL', label: 'ComfyUI 地址', level: 'warn', hint: '未配置时数字人生成链路不可用' },
            { key: 'GEMINI_API_KEY', label: 'Gemini API Key', level: 'warn', hint: '若只配置 GOOGLE_API_KEY 可忽略此项' },
            { key: 'GOOGLE_API_KEY', label: 'Google API Key', level: 'warn', hint: '若已配置 GEMINI_API_KEY 可忽略此项' },
            { key: 'XAI_API_KEY', label: 'xAI API Key', level: 'warn', hint: '未配置时 xai 榜单链路不可用' }
        ],
        directoryChecks: [
            { key: 'public', label: 'public 目录', path: PUBLIC_DIR },
            { key: 'uploads', label: 'uploads 目录', path: UPLOADS_DIR },
            { key: 'runtime', label: 'runtime_jobs 目录', path: RUNTIME_ROOT, level: 'warn' },
            { key: 'publish', label: 'publish 目录', path: PUBLISH_CENTER_DIR }
        ],
        fileChecks: [
            { key: 'workflow', label: '工作流配置', path: WORKFLOW_PATH },
            { key: 'run_asr', label: 'ASR 脚本', path: path.join(PIPELINE_DIR, 'run_asr.py') },
            { key: 'generate_title', label: '标题生成脚本', path: path.join(PIPELINE_DIR, 'generate_title.py') },
            { key: 'publish_description', label: '发布描述脚本', path: PUBLISH_DESCRIPTION_SCRIPT },
            { key: 'wechat_rpa', label: '微信发布脚本', path: WECHAT_RPA_SCRIPT },
            { key: 'xai_runner', label: 'xAI 榜单脚本', path: XAI_TOP10_SCRIPT }
        ],
        commandChecks: [
            { key: 'python', label: 'Python', command: 'python', args: ['--version'], hint: '请确认 python 已加入 PATH' },
            { key: 'ffmpeg', label: 'FFmpeg', command: 'ffmpeg', args: ['-version'], hint: '请确认 ffmpeg 已加入 PATH' },
            {
                key: 'playwright_python',
                label: 'Playwright Python',
                command: 'python',
                args: ['-c', 'from playwright.sync_api import sync_playwright; print("playwright-ok")'],
                level: 'warn',
                hint: '未安装时微信视频号自动发布不可用'
            }
        ]
    }),
    editableJsonFiles: EDITABLE_JSON_FILES,
    resolveEditableJsonPath,
    workflowPath: WORKFLOW_PATH,
    readWorkflow,
    extractWorkflowConfig,
    applyWorkflowConfig,
    writeWorkflow
});

function spawnScript(scriptPath, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn('python', [scriptPath, ...args], { cwd: options.cwd });
        if (typeof options.onSpawn === 'function') options.onSpawn(proc);
        let stdout = '';
        let stderr = '';
        const heartbeatStartedAt = Date.now();
        let heartbeatHandle = null;

        if (typeof options.onHeartbeat === 'function') {
            heartbeatHandle = setInterval(() => {
                options.onHeartbeat(Math.max(0, Math.floor((Date.now() - heartbeatStartedAt) / 1000)), proc);
            }, Number(options.heartbeatMs) || 15000);
        }

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
            if (typeof options.onStdout === 'function') options.onStdout(data.toString());
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            if (typeof options.onStderr === 'function') options.onStderr(data.toString());
        });
        proc.on('error', (err) => {
            if (heartbeatHandle) clearInterval(heartbeatHandle);
            reject(err);
        });
        proc.on('close', (code) => {
            if (heartbeatHandle) clearInterval(heartbeatHandle);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(scriptPath)} failed`));
        });
    });
}

async function generateHotTitle(pipelineDir, subtitlesFileName = "subtitles.json") {
    const subtitlesPath = path.join(pipelineDir, subtitlesFileName);
    const scriptPath = path.join(PIPELINE_DIR, 'generate_title.py');
    return new Promise((resolve, reject) => {
        const proc = spawn("python", [scriptPath, "--subtitles", subtitlesPath], { cwd: PIPELINE_DIR });
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
                const reason = errorOutput.trim() || 'generate_title.py 未输出有效标题';
                console.error(`generate_title.py failed: ${reason}`);
                reject(new Error(`自动标题生成失败: ${reason}`));
            }
        });
    });
}

attachProgressRoute(app);
const pipelineHandlers = createPipelineHandlers({
    baseDir: __dirname,
    pipelineDir: PIPELINE_DIR,
    defaultComfyBaseUrl: DEFAULT_COMFYUI_BASE_URL,
    getProgressClient,
    sendProgressEvent,
    uploadToComfyUI,
    listenComfyUIProgress,
    waitForCompletion,
    applyWorkflowConfig,
    readWorkflow,
    workflowPath: WORKFLOW_PATH,
    createRuntimeJobDir,
    readJsonIfExists,
    writeMediaMetadata,
    buildFallbackTitleFromSubtitles,
    generateHotTitle,
    writeJsonFile
});

registerPipelineRoutes(app, upload, pipelineHandlers);
const xaiService = createXaiService({
    sendError,
    resultPath: XAI_TOP10_RESULT,
    partialPath: XAI_TOP10_PARTIAL,
    logPath: XAI_TOP10_LOG,
    errorLogPath: XAI_TOP10_ERROR_LOG,
    accountsPath: XAI_TOP10_ACCOUNTS,
    scriptPath: XAI_TOP10_SCRIPT,
    translateScriptPath: XAI_TOP10_TRANSLATE_SCRIPT,
    scriptCwd: XAI_TOP10_DIR,
    fixedAccounts: XAI_TOP10_FIXED_ACCOUNTS,
    readJsonIfExists,
    readTextIfExists,
    tailLines,
    getProgressClient,
    sendProgressEvent
});

registerXaiRoutes(app, {
    getResult: (req, res) => {
        try {
            if (!fs.existsSync(XAI_TOP10_RESULT)) {
                return sendError(res, { status: 404, code: 'XAI_RESULT_NOT_FOUND', stage: 'xai.result', error: '结果文件不存在，请先运行一次榜单任务' });
            }
            const result = xaiService.ensureTranslatedResult();
            res.json({ success: true, result });
        } catch (err) {
            sendError(res, { status: 500, code: 'XAI_RESULT_READ_FAILED', stage: 'xai.result', error: '读取榜单结果失败', details: err.message });
        }
    },
    getStatus: (_req, res) => {
        try {
            res.json({ success: true, status: xaiService.getStatus() });
        } catch (err) {
            sendError(res, { status: 500, code: 'XAI_STATUS_READ_FAILED', stage: 'xai.status', error: '读取榜单状态失败', details: err.message });
        }
    },
    getConfig: (_req, res) => {
        try {
            res.json({ success: true, config: xaiService.readConfig() });
        } catch (err) {
            sendError(res, { status: 500, code: 'XAI_CONFIG_READ_FAILED', stage: 'xai.config', error: '读取账号池配置失败', details: err.message });
        }
    },
    postConfig: (req, res) => {
        try {
            const config = xaiService.writeConfig(req.body?.accounts || []);
            res.json({ success: true, config });
        } catch (err) {
            const status = err.message === '账号池不能为空' ? 400 : 500;
            sendError(res, { status, code: status === 400 ? 'XAI_ACCOUNTS_EMPTY' : 'XAI_CONFIG_WRITE_FAILED', stage: 'xai.config', error: err.message, details: err.message });
        }
    },
    run: (req, res) => xaiService.run(req.body?.clientId, res)
});
verticalQueueService = createVerticalQueueService({
    baseDir: __dirname,
    pipelineDir: PIPELINE_DIR,
    verticalQueueRoot: VERTICAL_QUEUE_ROOT,
    verticalPublicDir: VERTICAL_PUBLIC_DIR,
    ensureDir,
    makeJobId,
    slugifyText,
    sanitizeProcessLogLines,
    formatElapsedSeconds,
    stopProcessTree,
    removeDirIfExists,
    buildFallbackTitleFromSubtitles,
    spawnScript,
    writeJsonFile,
    spawnPython: (scriptName, args, cwd) => spawn('python', [scriptName, ...args], { cwd })
});

registerVerticalRoutes(app, {
    getStatus: (_req, res) => {
        try {
            res.json({ success: true, status: verticalQueueService.getStatus() });
        } catch (err) {
            sendError(res, { status: 500, code: 'VERTICAL_STATUS_FAILED', stage: 'vertical.queue', error: '读取竖屏队列状态失败', details: err.message });
        }
    },
    enqueue: (req, res) => {
        try {
            const items = Array.isArray(req.body?.items) ? req.body.items : [];
            verticalQueueService.setConcurrency(req.body?.concurrency);
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
                return sendError(res, { status: 400, code: 'VERTICAL_VIDEO_URLS_EMPTY', stage: 'vertical.queue', error: '没有可入队的视频链接' });
            }

            const jobs = validItems.map((item) => verticalQueueService.enqueue(item));
            resetPublishAssetsCache();
            res.json({
                success: true,
                queued: jobs.length,
                jobs,
                status: verticalQueueService.getStatus()
            });
        } catch (err) {
            sendError(res, { status: 500, code: 'VERTICAL_ENQUEUE_FAILED', stage: 'vertical.queue', error: '创建竖屏队列任务失败', details: err.message });
        }
    },
    cancel: (req, res) => {
        try {
            verticalQueueService.cancel(req.params.jobId);
            res.json({ success: true, status: verticalQueueService.getStatus() });
        } catch (err) {
            sendError(res, { status: err.status || 500, code: 'VERTICAL_CANCEL_FAILED', stage: 'vertical.queue', error: err.message, details: err.message });
        }
    },
    remove: (req, res) => {
        try {
            verticalQueueService.remove(req.params.jobId);
            resetPublishAssetsCache();
            res.json({ success: true, status: verticalQueueService.getStatus() });
        } catch (err) {
            sendError(res, { status: err.status || 500, code: 'VERTICAL_REMOVE_FAILED', stage: 'vertical.queue', error: err.message, details: err.message });
        }
    }
});

const standaloneHandler = createStandaloneHandler({
    sendError,
    baseDir: __dirname,
    pipelineDir: PIPELINE_DIR,
    upload,
    getProgressClient,
    sendProgressEvent,
    createRuntimeJobDir,
    generateHotTitle,
    writeJsonFile,
    writeMediaMetadata,
    readJsonIfExists,
    spawnPython: (scriptPath, args, cwd) => spawn('python', [scriptPath, ...args], { cwd })
});

registerStandaloneRoute(app, standaloneHandler);
registerSystemRoutes(app, systemHandlers);

const publishHandlers = createPublishHandlers({
    sendError,
    readPublishConfig,
    maskPlatformConfig,
    sanitizePlatformConfigInput,
    writePublishConfig,
    reconcileAndPersistPublishJobs,
    getCachedPublishAssets,
    readPublishJobs,
    writePublishJobs,
    updatePublishJob,
    archivePublishJob,
    archiveCompletedPublishJobs,
    collectPublishAssets,
    makeJobId,
    buildShortTitle,
    generatePublishDescription,
    getWechatAccountMap,
    buildPublishTask,
    validateWechatTaskConfig,
    collectPlatformValidation,
    startWechatRpa,
    retryWechatRpa,
    cancelWechatRpa
});

registerPublishRoutes(app, publishHandlers);



const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";

ensureDir(VERTICAL_QUEUE_ROOT);
ensureDir(VERTICAL_PUBLIC_DIR);
ensureDir(RUNTIME_ROOT);
ensureDir(PUBLISH_CENTER_DIR);
ensureDir(WECHAT_RPA_PROFILE_ROOT);
ensureDir(WECHAT_RPA_TASK_DIR);
cleanupRuntimeJobDirs();
if (!fs.existsSync(PUBLISH_JOBS_PATH)) {
    writePublishJobs({ jobs: [] });
}

app.listen(PORT, HOST, () => {
    console.log(`🚀 AI面板服务端启动成功: http://${HOST}:${PORT}`);
});
