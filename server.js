// 日志记录（必须在最开始引入）
require('./server/core/logger');

const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const { loadProjectEnv, readProjectEnv, updateProjectEnv } = require('./scripts/utils/env');
const { sendError } = require('./server/core/http');
const { createError } = require('./server/core/errorCodes');
const { TaskStore } = require('./server/core/taskStore');
const { createUnifiedTaskView } = require('./server/core/taskView');
const { createRecoveryService } = require('./server/core/recovery');
const { runPythonScript, runPythonScriptSync, runPythonScriptCancellable, summarizePythonError, stopProcessTree: stopPythonProcessTree } = require('./server/core/python');
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
const { createXApiPublisher } = require('./server/services/publish/xApi');
const { createAccountDashboardService } = require('./server/services/publish/accountDashboard');
const { createSystemHandlers } = require('./server/services/system/handlers');
const { createSelfCheckService } = require('./server/services/system/selfCheck');
const { createRuntimeCapabilityChecks } = require('./server/services/system/runtimeCapabilities');
const { registerPublishRoutes } = require('./server/routes/publish');
const { registerSystemRoutes } = require('./server/routes/system');
const { startScheduler } = require('./server/services/system/scheduler');
const { createReviewHandlers } = require('./server/services/review');
const { registerReviewRoutes } = require('./server/routes/review');
const { registerMaterialDrivenRoutes } = require('./server/routes/materialDriven');
const { createMaterialDrivenTaskRegistry } = require('./server/services/materialDriven/taskRegistry');
const { createAvatarGenerationService } = require('./server/services/materialDriven/avatarGeneration');
const { createMaterialDrivenPipelineRunner } = require('./server/services/materialDriven/pipelineProcess');
const { startMaterialDrivenFromUrl, getTaskStatus } = require('./server/services/materialDriven/autoStart');
const { createAgentHandlers } = require('./server/services/agent/handlers');
const { registerAgentRoutes } = require('./server/routes/agent');
const { readReviewConfig } = require('./server/services/review/store');
const { createFeishuService } = require('./server/services/notification/feishu');
const { createLoginStatusService } = require('./server/services/notification/loginStatus');
const { registerLoginStatusRoutes } = require('./server/routes/loginStatus');
const paths = require('./server/config/paths');
const runtime = require('./server/config/runtime');
const utils = require('./server/config/utils');

loadProjectEnv(__dirname);

const app = express();

const SUPPORTED_LLM_PROVIDERS = new Set(['gemini', 'qwen', 'vertex', 'deepseek']);

function normalizeLlmProvider(value, fallback = 'gemini') {
    const provider = String(value || '').trim().toLowerCase();
    return SUPPORTED_LLM_PROVIDERS.has(provider) ? provider : fallback;
}

function getConfiguredLlmProviders() {
    const globalProvider = normalizeLlmProvider(process.env.LLM_PROVIDER, 'gemini');
    const textProvider = normalizeLlmProvider(
        process.env.TEXT_LLM_PROVIDER || process.env.SCRIPT_LLM_PROVIDER,
        globalProvider
    );
    return Array.from(new Set([globalProvider, textProvider]));
}

function buildLlmEnvRequirements() {
    const checks = [
        {
            key: 'LLM_PROVIDER',
            label: '全局 LLM Provider',
            level: 'warn',
            exposeValue: true,
            hint: '未配置时默认使用 gemini；当前支持 gemini / qwen / vertex / deepseek'
        },
        {
            key: 'TEXT_LLM_PROVIDER',
            label: '文本 LLM Provider',
            level: 'warn',
            exposeValue: true,
            hint: '未配置时文本链路跟随 LLM_PROVIDER'
        }
    ];

    for (const provider of getConfiguredLlmProviders()) {
        if (provider === 'qwen') {
            checks.push({
                key: 'QWEN_API_KEY',
                label: 'Qwen/DashScope API Key',
                anyOf: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
                level: 'warn',
                hint: '当前 LLM provider 使用 qwen，请配置 QWEN_API_KEY 或 DASHSCOPE_API_KEY'
            });
        } else if (provider === 'deepseek') {
            checks.push({
                key: 'DEEPSEEK_API_KEY',
                label: 'DeepSeek API Key',
                level: 'warn',
                hint: '当前文本 LLM provider 使用 deepseek，请配置 DEEPSEEK_API_KEY'
            });
        } else if (provider === 'vertex') {
            checks.push({
                key: 'VERTEX_AUTH',
                label: 'Vertex AI 认证',
                anyOf: ['VERTEX_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
                level: 'warn',
                hint: '当前 LLM provider 使用 vertex，请配置 VERTEX_AI_API_KEY，或确保 ADC/Google 凭据可用'
            });
        } else if (provider === 'gemini') {
            checks.push({
                key: 'GEMINI_API_KEY',
                label: 'Gemini API Key',
                anyOf: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
                level: 'warn',
                hint: '当前 LLM provider 使用 gemini，请配置 GEMINI_API_KEY 或 GOOGLE_API_KEY'
            });
        }
    }

    return checks;
}

// 初始化统一任务存储
const taskStore = new TaskStore(paths.TASK_STORE_DB_PATH);
let unifiedTaskView = null;
const deferredUnifiedTaskView = {
    listTasks: (options) => unifiedTaskView?.listTasks(options) || []
};
const materialDrivenTaskRegistry = createMaterialDrivenTaskRegistry(paths, { taskStore });
const materialDrivenAvatarGeneration = createAvatarGenerationService({
    paths,
    persistTaskStateSnapshot: materialDrivenTaskRegistry.persistTaskStateSnapshot,
    taskStore
});
const materialDrivenPipelineRunner = createMaterialDrivenPipelineRunner({
    autoGenerateAvatar: materialDrivenAvatarGeneration.autoGenerateAvatar,
    taskStore
});

app.use(express.static(paths.FRONTEND_DIST_DIR));
app.use(express.static(paths.PUBLIC_DIR));
app.use('/projects', express.static(paths.PROJECTS_DIR));
app.use(express.json());

app.get('/runtime_jobs/:jobId/standalone_output_vertical.mp4', (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!/^standalone_[a-zA-Z0-9_-]+$/.test(jobId)) {
        return sendError(res, {
            status: 400,
            code: 'RUNTIME_JOB_ID_INVALID',
            stage: 'runtime.assets',
            error: '运行时任务 ID 无效'
        });
    }

    const videoPath = path.join(paths.RUNTIME_ROOT, jobId, 'standalone_output_vertical.mp4');
    if (!fs.existsSync(videoPath)) {
        return sendError(res, {
            status: 404,
            code: 'RUNTIME_VIDEO_NOT_FOUND',
            stage: 'runtime.assets',
            error: '竖屏成片不存在'
        });
    }

    res.sendFile(videoPath);
});

app.get("/", (_req, res) => {
    res.sendFile(paths.FRONTEND_INDEX_PATH);
});

const upload = multer({ dest: paths.UPLOADS_DIR });

const publishDescriptionCache = new Map();

function buildFallbackPublishDescription(sourceText, title = '') {
    const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim();
    const normalizedSource = String(sourceText || '').replace(/\s+/g, ' ').trim();
    if (normalizedTitle) {
        return utils.sanitizePublishDescriptionText(`${normalizedTitle}，更多内容请看视频。`);
    }
    if (normalizedSource) {
        const compact = normalizedSource.slice(0, 72).trim();
        return utils.sanitizePublishDescriptionText(`热点内容整理如下：${compact}`);
    }
    return '';
}

function compactPublishDescriptionSourceText(sourceText, maxChars = 220) {
    const normalized = String(sourceText || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    const sentences = normalized
        .split(/(?<=[。！？!?；;])/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (sentences.length === 0) {
        return normalized.slice(0, maxChars).trim();
    }
    let result = '';
    for (const sentence of sentences) {
        if ((result + sentence).length > maxChars) break;
        result += sentence;
    }
    return (result || normalized.slice(0, maxChars)).trim();
}

async function generatePublishDescription(sourceText, options = {}) {
    const normalized = compactPublishDescriptionSourceText(sourceText);
    const normalizedTitle = String(options?.title || '').replace(/\s+/g, ' ').trim();
    if (!normalized && !normalizedTitle) {
        return '';
    }

    const includeTags = options?.includeTags === true;
    const allowFallback = options?.allowFallback !== false;
    const timeoutMs = Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;
    const cacheKey = crypto.createHash('md5').update(`${includeTags ? 'with-tags' : 'plain'}:${normalizedTitle}:${normalized}`).digest('hex');
    if (publishDescriptionCache.has(cacheKey)) {
        return publishDescriptionCache.get(cacheKey);
    }

    let result = '';
    try {
        if (normalized && fs.existsSync(paths.PUBLISH_DESCRIPTION_SCRIPT)) {
            const args = ['--source-text', normalized];
            if (normalizedTitle) {
                args.push('--title', normalizedTitle);
            }
            if (includeTags) {
                args.push('--include-tags');
            }
            const proc = await runPythonScript(paths.PUBLISH_DESCRIPTION_SCRIPT, args, {
                cwd: paths.PUBLISH_CENTER_DIR,
                timeout: timeoutMs
            });
            result = utils.sanitizePublishDescriptionText(proc.stdout || '', { preserveTags: includeTags });
        }
    } catch (err) {
        if (String(err?.details || err?.message || '').includes('timed out')) {
            console.warn('generate publish description timed out, using fallback');
        } else {
            console.warn('generate publish description error:', err.details || err.message);
        }
    }

    if (!result && allowFallback) {
        result = buildFallbackPublishDescription(normalized, normalizedTitle);
    }

    if (result) publishDescriptionCache.set(cacheKey, result);
    return result;
}

function buildPublishTask(platformKey, publishData, assetUrl, platformConfig, platformOptions = {}) {
    const selectedAccountId = String(platformOptions?.accountId || '').trim();
    const selectedAccountLabel = String(platformOptions?.accountLabel || '').trim();
    const selectedSauAccountName = String(platformOptions?.sauAccountName || '').trim();
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
                accountId: selectedAccountId,
                accountLabel: selectedAccountLabel,
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
                status: 'rpa_available',
                guide: '当前通过抖音创作者服务平台的浏览器 RPA 路径打开上传页并尝试填充视频、标题和文案；如页面结构变化，任务会停在浏览器中供人工确认。',
                accountId: selectedAccountId,
                accountLabel: selectedAccountLabel,
                sauAccountName: selectedSauAccountName,
                requiredFields: ['sauAccountName'],
                automationModes: ['draft', 'publish'],
                runtime: {
                    state: 'idle',
                    lastMessage: '',
                    updatedAt: null
                }
            };
        case 'xiaohongshu':
            return {
                ...common,
                status: 'rpa_available',
                guide: '当前通过小红书创作服务平台的浏览器 RPA 路径打开发布页并尝试填充视频、标题和文案；如页面结构变化，任务会停在浏览器中供人工确认。',
                accountId: selectedAccountId,
                accountLabel: selectedAccountLabel,
                sauAccountName: selectedSauAccountName,
                requiredFields: ['sauAccountName'],
                automationModes: ['draft', 'publish'],
                runtime: {
                    state: 'idle',
                    lastMessage: '',
                    updatedAt: null
                }
            };
        case 'x':
            return {
                ...common,
                status: 'rpa_available',
                guide: '通过 X API v2 上传视频并创建 Post。X 没有远程草稿箱接口，当前只支持自动发表；首次使用前需完成 OAuth2 用户授权，并授予 tweet.write、media.write、offline.access 等 scopes。',
                accountId: selectedAccountId,
                accountLabel: selectedAccountLabel,
                username: String(platformOptions?.username || '').trim(),
                requiredFields: ['accessToken'],
                automationModes: ['publish'],
                runtime: {
                    state: 'idle',
                    lastMessage: '',
                    updatedAt: null
                }
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
    projectRoot: paths.PROJECT_ROOT,
    verticalPublicDir: paths.VERTICAL_PUBLIC_DIR,
    verticalQueueRoot: paths.VERTICAL_QUEUE_ROOT,
    getVerticalJobById: (jobId) => verticalQueueService?.getJob(jobId) || null,
    readJsonIfExists,
    readMediaMetadata: utils.readMediaMetadata,
    sanitizePublishDescriptionText: utils.sanitizePublishDescriptionText
});

const {
    buildShortTitle,
    collectPublishAssets,
    getCachedPublishAssets,
    deletePublishAsset,
    resetPublishAssetsCache
} = publishAssetsService;

const publishStore = createPublishStore({
    publishConfigPath: paths.PUBLISH_CONFIG_PATH,
    publishJobsPath: paths.PUBLISH_JOBS_PATH,
    wechatAccountFields: runtime.WECHAT_ACCOUNT_FIELDS,
    readJsonIfExists,
    writeJsonFile,
    deepClone: utils.deepClone,
    makeJobId,
    buildPublishTask
});

const {
    getWechatAccountMap,
    getSauAccountMap,
    getXAccountMap,
    getSauPlatformAccounts,
    getXAccounts,
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
    validateSauTaskConfig,
    validateXTaskConfig,
    reconcileAndPersistPublishJobs
} = publishStore;

const selfCheckService = createSelfCheckService({
    fs,
    spawnSync,
    envRequirements: () => [
        { key: 'COMFYUI_BASE_URL', label: 'ComfyUI 地址', level: 'warn', hint: '未配置时数字人生成链路不可用' },
        ...buildLlmEnvRequirements(),
        { key: 'XAI_API_KEY', label: 'xAI API Key', level: 'warn', hint: '未配置时 xai 榜单链路不可用' },
        { key: 'AGENT_API_TOKEN', label: 'Agent API Token', level: 'warn', hint: '未配置时 /api/agent/v1 会拒绝访问' }
    ],
    directoryChecks: [
        { key: 'public', label: 'public 目录', path: paths.PUBLIC_DIR },
        { key: 'uploads', label: 'uploads 目录', path: paths.UPLOADS_DIR },
        { key: 'runtime', label: 'runtime_jobs 目录', path: paths.RUNTIME_ROOT, level: 'warn' },
        { key: 'publish', label: 'publish 目录', path: paths.PUBLISH_CENTER_DIR },
        { key: 'social_auto_upload', label: '项目内 social-auto-upload vendor', path: paths.SOCIAL_AUTO_UPLOAD_VENDOR_DIR, level: 'warn' }
    ],
    fileChecks: [
        { key: 'workflow', label: '工作流配置', path: paths.WORKFLOW_PATH },
        { key: 'run_asr', label: 'ASR 脚本', path: path.join(paths.PIPELINE_DIR, 'run_asr.py') },
        { key: 'generate_title', label: '标题生成脚本', path: path.join(paths.PIPELINE_DIR, 'generate_title.py') },
        { key: 'publish_description', label: '发布描述脚本', path: paths.PUBLISH_DESCRIPTION_SCRIPT },
        { key: 'wechat_rpa', label: '微信发布脚本', path: paths.WECHAT_RPA_SCRIPT },
        { key: 'social_auto_upload_adapter', label: 'social-auto-upload 适配脚本', path: paths.SOCIAL_AUTO_UPLOAD_ADAPTER_SCRIPT },
        { key: 'xai_runner', label: 'xAI 榜单脚本', path: paths.XAI_TOP10_SCRIPT }
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
    ],
    capabilityChecks: createRuntimeCapabilityChecks()
});

const xApiPublisher = createXApiPublisher({
    fs,
    path,
    readPublishJobs,
    readPublishConfig,
    writePublishConfig,
    updatePublishPlatformTask
});

const wechatRpaService = createWechatRpaService({
    fs,
    path,
    spawn,
    stopProcessTree,
    runPythonScriptCancellable,
    slugifyText,
    publishCenterDir: paths.PUBLISH_CENTER_DIR,
    wechatRpaScript: paths.WECHAT_RPA_SCRIPT,
    wechatRpaTaskDir: paths.WECHAT_RPA_TASK_DIR,
    wechatRpaProfileRoot: paths.WECHAT_RPA_PROFILE_ROOT,
    platformRpaScript: paths.PLATFORM_RPA_SCRIPT,
    socialAutoUploadAdapterScript: paths.SOCIAL_AUTO_UPLOAD_ADAPTER_SCRIPT,
    platformRpaTaskDir: paths.PLATFORM_RPA_TASK_DIR,
    platformRpaProfileRoot: paths.PLATFORM_RPA_PROFILE_ROOT,
    socialAutoUploadDir: process.env.SOCIAL_AUTO_UPLOAD_DIR || paths.SOCIAL_AUTO_UPLOAD_VENDOR_DIR,
    socialAutoUploadRuntimeDir: paths.SOCIAL_AUTO_UPLOAD_RUNTIME_DIR,
    socialAutoUploadPython: process.env.SOCIAL_AUTO_UPLOAD_PYTHON || '',
    xApiPublisher,
    buildShortTitle,
    readPublishJobs,
    readPublishConfig,
    validateWechatTaskConfig,
    updatePublishPlatformTask
});

const {
    startWechatRpa,
    retryWechatRpa,
    cancelWechatRpa,
    startPlatformRpa,
    retryPlatformRpa,
    cancelPlatformRpa,
    checkWechatLogin,
    openWechatContentManager,
    checkPlatformLogin,
    openPlatformContentManager,
    checkPlatformLoginStatus
} = wechatRpaService;

    const systemHandlers = createSystemHandlers({
        fs,
        path,
        spawn,
        sendError,
        baseDir: paths.PROJECT_ROOT,
        pipelineDir: paths.PIPELINE_DIR,
        selfCheckService,
        editableJsonFiles: runtime.EDITABLE_JSON_FILES,
        resolveEditableJsonPath: utils.resolveEditableJsonPath,
        workflowPath: paths.WORKFLOW_PATH,
        readWorkflow,
        extractWorkflowConfig,
        applyWorkflowConfig,
        writeWorkflow,
        runPythonScript,
        readProjectEnv,
        updateProjectEnv,
        unifiedTaskView: deferredUnifiedTaskView
    });

    function spawnScript(scriptPath, args, options = {}) {
        return runPythonScript(scriptPath, args, options);
    }

    function spawnScriptCancellable(scriptPath, args, options = {}) {
        return runPythonScriptCancellable(scriptPath, args, options);
    }

    async function generateHotTitle(pipelineDir, subtitlesFileName = "subtitles.json", options = {}) {
        const subtitlesPath = path.join(pipelineDir, subtitlesFileName);
        const scriptPath = path.join(paths.PIPELINE_DIR, 'generate_title.py');
        const args = ['--subtitles', subtitlesPath];
        if (options.contextPath) {
            args.push('--context', options.contextPath);
        }
        if (options.scriptPath) {
            args.push('--script', options.scriptPath);
        }
        try {
            const result = await runPythonScript(scriptPath, args, { cwd: paths.PIPELINE_DIR });
            const title = String(result.protocol?.result?.title || result.stdout || '').trim();
            if (title) {
                return title;
            }
            throw new Error('generate_title.py 未输出有效标题');
        } catch (err) {
            const reason = err?.details || err?.message || 'generate_title.py 未输出有效标题';
            console.error(`generate_title.py failed: ${reason}`);
            throw new Error(`自动标题生成失败: ${reason}`);
        }
    }

    attachProgressRoute(app);

    // 创建自动审核触发函数
    async function triggerAutoReview(videoPath, assetId) {
        const maxAttempts = 2;
        const retryDelayMs = 3000;
        try {
            const { readReviewConfig } = require('./server/services/review/store');
            const { executeReviewScript } = require('./server/services/review/executor');

            const config = readReviewConfig();
            if (!config.enabled) {
                return null; // 审核未启用
            }

            const metadataPath = `${videoPath}.meta.json`;
            if (!fs.existsSync(metadataPath)) {
                console.warn('元数据文件不存在，跳过自动审核');
                return null;
            }

            let result = null;
            let lastError = null;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                try {
                    console.log(`[Auto Review] 开始审核视频: ${videoPath}（第 ${attempt}/${maxAttempts} 次）`);
                    result = await executeReviewScript(videoPath, metadataPath, config);
                    break;
                } catch (err) {
                    lastError = err;
                    const summary = err?.details || err?.message || 'unknown error';
                    if (attempt < maxAttempts) {
                        console.warn(`[Auto Review] 第 ${attempt} 次审核失败，${Math.round(retryDelayMs / 1000)} 秒后重试: ${summary}`);
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                        continue;
                    }
                }
            }

            if (!result) {
                throw lastError || new Error('自动审核未返回结果');
            }

            // 更新元数据
            const metadata = utils.readMediaMetadata(videoPath);
            metadata.aiReview = {
                reviewId: `auto_${Date.now()}`,
                status: result.status,
                overallScore: result.overall_score,
                scores: {
                    contentQuality: result.scores.content,
                    subtitleAccuracy: result.scores.subtitle,
                    titleAppeal: result.scores.title,
                    editingQuality: result.scores.editing
                },
                reviewedAt: new Date().toISOString(),
                fixSuggestions: result.fix_suggestions,
                manuallySkipped: false
            };
            utils.writeMediaMetadata(videoPath, metadata);

            console.log(`[Auto Review] 审核完成，得分: ${result.overall_score}, 状态: ${result.status}`);
            return result;
        } catch (err) {
            console.error('[Auto Review] 自动审核失败:', err);
            return null;
        }
    }

    const xaiService = createXaiService({
        sendError,
        resultPath: paths.XAI_TOP10_RESULT,
        partialPath: paths.XAI_TOP10_PARTIAL,
        logPath: paths.XAI_TOP10_LOG,
        errorLogPath: paths.XAI_TOP10_ERROR_LOG,
        accountsPath: paths.XAI_TOP10_ACCOUNTS,
        scriptPath: paths.XAI_TOP10_SCRIPT,
        translateScriptPath: paths.XAI_TOP10_TRANSLATE_SCRIPT,
        scriptCwd: paths.XAI_TOP10_DIR,
        fixedAccounts: runtime.XAI_TOP10_FIXED_ACCOUNTS,
        readJsonIfExists,
        readTextIfExists,
        tailLines,
        getProgressClient,
        sendProgressEvent,
        runPythonScript,
        runPythonScriptSync
    });
    unifiedTaskView = createUnifiedTaskView({
        taskStore,
        publishStore,
        xaiService
    });

    registerXaiRoutes(app, {
        getResult: (req, res) => {
            try {
                const partitionId = req.query?.partitionId || req.query?.partition || '';
                const partitionPaths = xaiService.getPathsForPartition(partitionId || xaiService.readConfig().activePartitionId);
                if (!fs.existsSync(partitionPaths.resultPath)) {
                    return sendError(res, { status: 404, code: 'XAI_RESULT_NOT_FOUND', stage: 'xai.result', error: '结果文件不存在，请先运行一次榜单任务' });
                }
                const result = xaiService.ensureTranslatedResult(partitionId);
                res.json({ success: true, result });
            } catch (err) {
                sendError(res, { status: 500, code: 'XAI_RESULT_READ_FAILED', stage: 'xai.result', error: '读取榜单结果失败', details: err.message });
            }
        },
        getStatus: (req, res) => {
            try {
                res.json({ success: true, status: xaiService.getStatus(req.query?.partitionId || req.query?.partition || '') });
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
                const config = xaiService.writeConfig(req.body || {});
                res.json({ success: true, config });
            } catch (err) {
                const status = err.message === '账号池不能为空' ? 400 : 500;
                sendError(res, { status, code: status === 400 ? 'XAI_ACCOUNTS_EMPTY' : 'XAI_CONFIG_WRITE_FAILED', stage: 'xai.config', error: err.message, details: err.message });
            }
        },
        run: (req, res) => xaiService.run(req.body?.clientId, res, req.body?.partitionId || req.body?.partition || '')
    });
    verticalQueueService = createVerticalQueueService({
        baseDir: paths.PROJECT_ROOT,
        pipelineDir: paths.PIPELINE_DIR,
        projectsDir: paths.PROJECTS_DIR,
        verticalQueueRoot: paths.VERTICAL_QUEUE_ROOT,
        verticalPublicDir: paths.VERTICAL_PUBLIC_DIR,
        taskStore,
        ensureDir,
        makeJobId,
        slugifyText,
        sanitizeProcessLogLines,
        formatElapsedSeconds,
        stopProcessTree,
        removeDirIfExists,
        buildFallbackTitleFromSubtitles: utils.buildFallbackTitleFromSubtitles,
        spawnScript,
        spawnScriptCancellable,
        writeJsonFile,
        runPythonScript,
        summarizePythonError,
        writeMediaMetadata: utils.writeMediaMetadata,
        readMediaMetadata: utils.readMediaMetadata,
        triggerAutoReview
    });

    registerVerticalRoutes(app, {
        getStatus: (_req, res) => {
            try {
                res.json({ success: true, status: verticalQueueService.getStatus() });
            } catch (err) {
                sendError(res, err.status ? err : createError('VERTICAL_QUEUE_STATUS_READ_FAILED', err.message));
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
                        sourcePartitionId: item.sourcePartitionId || item.partitionId || item.partition?.id || '',
                        sourcePartitionLabel: item.sourcePartitionLabel || item.partitionLabel || item.partition?.label || '',
                        renderOptions: item.renderOptions || {}
                    }))
                    .filter((item) => item.videoUrl);

                if (validItems.length === 0) {
                    return sendError(res, createError('VERTICAL_QUEUE_VIDEO_URLS_EMPTY'));
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
                sendError(res, err.status ? err : createError('VERTICAL_QUEUE_ENQUEUE_FAILED', err.message));
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
        baseDir: paths.PROJECT_ROOT,
        pipelineDir: paths.PIPELINE_DIR,
        projectsDir: paths.PROJECTS_DIR,
        upload,
        getProgressClient,
        sendProgressEvent,
        createRuntimeJobDir: (prefix) => utils.createRuntimeJobDir(prefix, makeJobId),
        generateHotTitle,
        writeJsonFile,
        writeMediaMetadata: utils.writeMediaMetadata,
        readJsonIfExists,
        runPythonScript,
        taskStore
    });

    registerStandaloneRoute(app, standaloneHandler);
    registerSystemRoutes(app, systemHandlers);

    let schedulerService = null;

    // 初始化飞书通知服务
    const feishuWebhookUrl = process.env.FEISHU_WEBHOOK_URL || '';
    const feishuAppId = process.env.FEISHU_APP_ID || '';
    const feishuAppSecret = process.env.FEISHU_APP_SECRET || '';

    const feishuService = createFeishuService({
        webhookUrl: feishuWebhookUrl,
        appId: feishuAppId,
        appSecret: feishuAppSecret
    });

    if (feishuAppId && feishuAppSecret) {
        console.log('[Feishu] 飞书通知服务已启用（应用模式，支持发送图片）');
    } else if (feishuWebhookUrl) {
        console.log('[Feishu] 飞书通知服务已启用（Webhook模式，不支持发送图片）');
    } else {
        console.log('[Feishu] 飞书通知服务未配置');
    }

    // 初始化登录状态检测服务
    const loginStatusService = createLoginStatusService({
        checkWechatLogin,
        feishuService,
        readPublishConfig,
        feishuReceiveIdType: process.env.FEISHU_RECEIVE_ID_TYPE || 'chat_id',
        feishuReceiveId: process.env.FEISHU_RECEIVE_ID || ''
    });

    console.log('[LoginStatus] 登录状态检测服务已初始化');

    // 创建账号看板服务
    const accountDashboardService = createAccountDashboardService({
        readPublishConfig,
        readPublishJobs,
        loginStatusService,
        getSauPlatformAccounts,
        checkPlatformLoginStatus
    });

    console.log('[AccountDashboard] 账号看板服务已初始化');

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
        deletePublishAsset,
        makeJobId,
        buildShortTitle,
        generatePublishDescription,
        getWechatAccountMap,
        getSauAccountMap,
        getXAccountMap,
        buildPublishTask,
        validateWechatTaskConfig,
        validateSauTaskConfig,
        validateXTaskConfig,
        collectPlatformValidation,
        startWechatRpa,
        retryWechatRpa,
        cancelWechatRpa,
        startPlatformRpa,
        retryPlatformRpa,
        cancelPlatformRpa,
        checkWechatLogin,
        openWechatContentManager,
        checkPlatformLogin,
        openPlatformContentManager,
        triggerAutoPilotNow: (...args) => schedulerService?.triggerAutoPilotNow?.(...args),
        accountDashboardService
    });

    registerPublishRoutes(app, publishHandlers);

    // 注册审核路由
    const reviewHandlers = createReviewHandlers({
        sendError,
        readMediaMetadata: utils.readMediaMetadata,
        writeMediaMetadata: utils.writeMediaMetadata,
        verticalQueueService,
        resetPublishAssetsCache
    });
    registerReviewRoutes(app, reviewHandlers);
    registerLoginStatusRoutes(app, loginStatusService, feishuService);
    registerMaterialDrivenRoutes(app, paths, {
        taskStore,
        taskRegistry: materialDrivenTaskRegistry,
        avatarGeneration: materialDrivenAvatarGeneration,
        pipelineRunner: materialDrivenPipelineRunner
    });

    const agentHandlers = createAgentHandlers({
        sendError,
        paths,
        selfCheckService,
        xaiService,
        materialDrivenStarter: {
            start: (params) => startMaterialDrivenFromUrl(paths, { ...params, taskStore }),
            getStatus: (jobId, outputPath = '') => {
                const runtimeStatus = getTaskStatus(jobId);
                if (runtimeStatus) {
                    return { success: true, task: runtimeStatus };
                }
                const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
                return task ? materialDrivenTaskRegistry.buildStatusPayload(task) : null;
            },
            retryStep: async (jobId, outputPath = '', step = 5, options = {}) => {
                const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
                if (!task) {
                    throw new Error('任务不存在');
                }
                if (typeof options.autoGenerate === 'boolean') {
                    task.autoGenerate = options.autoGenerate;
                }
                if (typeof options.useCache === 'boolean') {
                    task.useCache = options.useCache;
                }
                materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
                materialDrivenPipelineRunner.startRetryPipeline(jobId, task, step);
                return materialDrivenTaskRegistry.buildStatusPayload(task);
            },
            updateAvatarConfig: async (jobId, outputPath = '', options = {}) => {
                const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
                if (!task) {
                    throw new Error('任务不存在');
                }
                if (options.avatarConfig && typeof options.avatarConfig === 'object') {
                    task.avatarConfig = { ...(task.avatarConfig || {}), ...options.avatarConfig };
                }
                task.updatedAt = new Date().toISOString();
                materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
                return materialDrivenTaskRegistry.buildStatusPayload(task);
            },
            generateAvatarOnly: async (jobId, outputPath = '', options = {}) => {
                const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
                if (!task) {
                    throw new Error('任务不存在');
                }
                if (options.avatarConfig && typeof options.avatarConfig === 'object') {
                    task.avatarConfig = { ...(task.avatarConfig || {}), ...options.avatarConfig };
                }
                task.autoGenerate = false;
                materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
                const aimanPath = path.join(task.outputPath, 'aiman.mp4');
                if (options.force === true && fs.existsSync(aimanPath)) {
                    fs.unlinkSync(aimanPath);
                }
                if (options.force === true) {
                    for (const fileName of ['avatar_render_state.json', 'avatar_manifest.json', 'qwen_tts_metadata.json']) {
                        const filePath = path.join(task.outputPath, fileName);
                        try {
                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        } catch (_err) {}
                    }
                }
                if (task.status !== 'generating_avatar') {
                    (async () => {
                        try {
                            await materialDrivenAvatarGeneration.autoGenerateAvatar(jobId, task);
                            task.status = 'waiting_render';
                            task.currentStep = 6;
                            task.progress = Math.max(Number(task.progress || 0), 90);
                            task.statusText = '数字人已生成，等待预览或剪辑出片';
                            task.updatedAt = new Date().toISOString();
                            materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
                        } catch (err) {
                            task.status = 'failed';
                            task.error = err?.message || '数字人生成失败';
                            task.statusText = task.error;
                            task.completedAt = new Date().toISOString();
                            task.updatedAt = new Date().toISOString();
                        }
                    })();
                }
                return materialDrivenTaskRegistry.buildStatusPayload(task);
            },
            renderFinal: async (jobId, outputPath = '', options = {}) => {
                const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
                if (!task) {
                    throw new Error('任务不存在');
                }
                if (typeof options.useCache === 'boolean') {
                    task.useCache = options.useCache;
                }
                materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
                const executionPlanPath = path.join(task.outputPath, 'execution_plan.json');
                if (fs.existsSync(executionPlanPath)) {
                    materialDrivenPipelineRunner.spawnPipeline(jobId, task, 7, {
                        step: 7,
                        progressValue: 90,
                        statusText: '正在根据当前执行计划剪辑出片',
                        startLog: 'Agent 触发：剪辑并生成竖屏成片',
                        stepMessage: '步骤7: 剪辑出片'
                    });
                } else {
                    materialDrivenPipelineRunner.launchFromAvatarReady(jobId, task);
                }
                return materialDrivenTaskRegistry.buildStatusPayload(task);
            },
            continueOneClick: async (jobId, outputPath = '', options = {}) => {
                const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
                if (!task) {
                    throw new Error('任务不存在');
                }
                if (options.avatarConfig && typeof options.avatarConfig === 'object') {
                    task.avatarConfig = { ...(task.avatarConfig || {}), ...options.avatarConfig };
                }
                if (typeof options.useCache === 'boolean') {
                    task.useCache = options.useCache;
                }
                task.autoGenerate = true;
                materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
                const aimanPath = path.join(task.outputPath, 'aiman.mp4');
                if (fs.existsSync(aimanPath)) {
                    materialDrivenPipelineRunner.launchFromAvatarReady(jobId, task);
                } else if (task.status !== 'generating_avatar') {
                    (async () => {
                        try {
                            await materialDrivenAvatarGeneration.autoGenerateAvatar(jobId, task);
                            materialDrivenPipelineRunner.launchFromAvatarReady(jobId, task);
                        } catch (err) {
                            task.status = 'failed';
                            task.error = err?.message || '一步到位流程生成数字人失败';
                            task.statusText = task.error;
                            task.completedAt = new Date().toISOString();
                            task.updatedAt = new Date().toISOString();
                        }
                    })();
                }
                return materialDrivenTaskRegistry.buildStatusPayload(task);
            }
        },
        reviewHandlers,
        verticalQueueService,
        taskStore,
        publishStore,
        loginStatusService,
        accountDashboardService,
        publishAssetsService,
        generatePublishDescription,
        buildPublishTask,
        buildShortTitle,
        resetPublishAssetsCache,
        startWechatRpa,
        startPlatformRpa
    });
    registerAgentRoutes(app, agentHandlers, {
        auditLogPath: path.join(paths.DATA_DIR, 'logs', 'agent_audit.log')
    });

    const schedulerMaterialDrivenStarter = {
        start: (params) => startMaterialDrivenFromUrl(paths, { ...params, taskStore }),
        getStatus: getTaskStatus,
        continueOneClick: async (jobId, outputPath = '', options = {}) => {
            const task = materialDrivenTaskRegistry.resolveTask(jobId, outputPath);
            if (!task) {
                throw new Error('任务不存在');
            }
            if (options.avatarConfig && typeof options.avatarConfig === 'object') {
                task.avatarConfig = { ...(task.avatarConfig || {}), ...options.avatarConfig };
            }
            if (typeof options.useCache === 'boolean') {
                task.useCache = options.useCache;
            }
            task.autoGenerate = true;
            materialDrivenTaskRegistry.persistTaskStateSnapshot(task);
            materialDrivenPipelineRunner.continueFromAvatarStep(jobId, task);
            return materialDrivenTaskRegistry.buildStatusPayload(task);
        }
    };

    schedulerService = startScheduler({
        publishStore,
        wechatRpaService,
        xaiService,
        verticalQueueService,
        taskStore,
        generatePublishDescription,
        publishAssetsService,
        loginStatusService,
        feishuService,
        materialDrivenStarter: schedulerMaterialDrivenStarter
    });

    // 初始化恢复服务
    const recoveryService = createRecoveryService({
        taskStore,
        verticalQueueService,
        publishStore,
        materialDrivenStarter: schedulerMaterialDrivenStarter
    });

    // 恢复 API 端点
    app.get('/api/system/recovery/status', (_req, res) => {
        try {
            const status = recoveryService.getRecoveryStatus();
            res.json({ success: true, ...status });
        } catch (err) {
            sendError(res, { status: 500, code: 'RECOVERY_STATUS_FAILED', stage: 'recovery', error: '获取恢复状态失败', details: err.message });
        }
    });

    app.post('/api/system/recovery/retry/:taskId', (req, res) => {
        try {
            const result = recoveryService.manualRetry(req.params.taskId);
            res.json({ success: true, ...result });
        } catch (err) {
            sendError(res, { status: 400, code: 'RECOVERY_RETRY_FAILED', stage: 'recovery', error: err.message, details: err.message });
        }
    });

    app.post('/api/system/recovery/cancel/:taskId', (req, res) => {
        try {
            const result = recoveryService.cancelInterrupted(req.params.taskId);
            res.json({ success: true, ...result });
        } catch (err) {
            sendError(res, { status: 400, code: 'RECOVERY_CANCEL_FAILED', stage: 'recovery', error: err.message, details: err.message });
        }
    });

    const PORT = Number(process.env.PORT || 3001);
    const HOST = process.env.HOST || "127.0.0.1";

    ensureDir(paths.VERTICAL_QUEUE_ROOT);
    ensureDir(paths.VERTICAL_PUBLIC_DIR);
    ensureDir(paths.RUNTIME_ROOT);
    ensureDir(paths.PROJECTS_DIR);
    ensureDir(paths.PUBLISH_CENTER_DIR);
    ensureDir(paths.WECHAT_RPA_PROFILE_ROOT);
    ensureDir(paths.WECHAT_RPA_TASK_DIR);
    utils.cleanupRuntimeJobDirs({ projectRoot: paths.PROJECT_ROOT });
    if (!fs.existsSync(paths.PUBLISH_JOBS_PATH)) {
        writePublishJobs({ jobs: [] });
    }

    app.listen(PORT, HOST, () => {
        console.log(`🚀 AI面板服务端启动成功: http://${HOST}:${PORT}`);

        // 启动后执行恢复
        recoveryService.recoverOnStartup().then(results => {
            if (results.length > 0) {
                console.log(`[Recovery] 恢复了 ${results.length} 个中断的任务`);
                for (const result of results) {
                    console.log(`[Recovery] 任务 ${result.taskId} (${result.type}): ${result.action}`);
                }
            }
        }).catch(err => {
            console.error('[Recovery] 启动恢复失败:', err);
        });
    });
