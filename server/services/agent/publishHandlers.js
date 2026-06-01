const fs = require('fs');

const {
  PUBLISH_CONFIRMATION_PHRASE,
  createHttpError,
  normalizeText,
  pickString,
  stableHash
} = require('./helpers');
const {
  buildQrCodeImagePayload,
  normalizePublishJobSummary,
  resolvePublicAssetUrlFromPath,
  sanitizeLoginStatus,
  toReviewVideoPathFromJobStatus
} = require('./summaries');

function createPublishAgentHandlers(deps) {
  const {
    paths,
    publishStore,
    loginStatusService,
    accountDashboardService,
    publishAssetsService,
    materialDrivenStarter,
    generatePublishDescription,
    buildPublishTask,
    buildShortTitle,
    resetPublishAssetsCache,
    startWechatRpa,
    startPlatformRpa,
    buildPublishSchedulePayload,
    sendNormalizedError
  } = deps;

  async function createPublishJobFromAsset({ asset, platforms, title, description, tags, platformSelections, scheduledTime }) {
    const config = publishStore.readPublishConfig();
    const selectedPlatforms = Array.isArray(platforms) && platforms.length
      ? platforms.map((value) => String(value).trim()).filter(Boolean)
      : ['wechatChannels'];
    const publishTitle = pickString(title, asset?.metadata?.suggestedTitle, asset?.compactLabel, asset?.label, '热点视频');
    let finalDescription = String(description || '').trim();
    const tagStrategy = Array.isArray(tags) && tags.length ? 'system' : 'model';

    if (!finalDescription && typeof generatePublishDescription === 'function') {
      finalDescription = await generatePublishDescription(
        asset?.metadata?.sourceSummary || asset?.metadata?.suggestedDescription || publishTitle,
        {
          includeTags: tagStrategy === 'model',
          title: publishTitle,
          allowFallback: true,
          timeoutMs: 180000
        }
      );
    }
    if (!finalDescription) {
      finalDescription = publishTitle;
    }

    const publishData = {
      title: publishTitle,
      shortTitle: typeof buildShortTitle === 'function' ? buildShortTitle(publishTitle, '热点速递') : publishTitle.slice(0, 16),
      description: finalDescription,
      tags: Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      coverUrl: '',
      tagStrategy
    };
    const platformTasks = [];
    const platformErrors = [];
    const selections = platformSelections && typeof platformSelections === 'object' ? platformSelections : {};

    for (const platformKey of selectedPlatforms) {
      const platformConfig = config?.[platformKey] || null;
      if (!platformConfig) {
        platformErrors.push({ platform: platformKey, error: '未知平台' });
        continue;
      }
      if (!platformConfig.enabled) {
        platformErrors.push({ platform: platformKey, error: '该平台尚未启用' });
      }
      const selection = selections[platformKey] && typeof selections[platformKey] === 'object'
        ? selections[platformKey]
        : {};
      const task = buildPublishTask(platformKey, publishData, asset.url, platformConfig, {
        accountId: selection.accountId || '',
        accountLabel: selection.accountLabel || '',
        sauAccountName: selection.sauAccountName || ''
      });
      task.status = scheduledTime ? 'scheduled_wait' : task.status;
      platformTasks.push(task);
    }

    if (!platformTasks.length) {
      throw createHttpError(
        400,
        'AGENT_PUBLISH_TASKS_EMPTY',
        'agent.publish.draft',
        '没有可创建的发布平台任务',
        JSON.stringify(platformErrors),
        '请检查发布平台是否已启用，或指定有效 platforms'
      );
    }

    const payload = publishStore.readPublishJobs();
    const now = new Date().toISOString();
    const job = {
      id: typeof publishStore.makeJobId === 'function' ? publishStore.makeJobId() : `job_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      archived: false,
      archivedAt: null,
      status: scheduledTime ? 'scheduled_wait' : (platformErrors.length > 0 ? 'partial_ready' : 'ready'),
      scheduledAt: scheduledTime ? new Date(scheduledTime).toISOString() : null,
      asset,
      publishData,
      selectedPlatforms,
      platformSelections: selections,
      platformTasks,
      platformErrors,
      agentCreated: true
    };
    payload.jobs = [job, ...(payload.jobs || [])].slice(0, 50);
    publishStore.writePublishJobs(payload);
    return job;
  }

  function findAssetForJob(jobId, outputPath = '') {
    if (typeof resetPublishAssetsCache === 'function') resetPublishAssetsCache();
    const assets = typeof publishAssetsService?.collectPublishAssets === 'function'
      ? publishAssetsService.collectPublishAssets()
      : [];
    if (!jobId && !outputPath) return null;
    const jobText = String(jobId || '').trim();
    const outputText = String(outputPath || '').trim();
    return assets.find((asset) => {
      const haystack = [asset.id, asset.url, asset.path, asset.label].map((value) => String(value || '')).join(' ');
      return (jobText && haystack.includes(jobText)) || (outputText && haystack.includes(outputText));
    }) || null;
  }

  return {
    listPublishAssets: (req, res) => {
      try {
        if (!publishAssetsService || typeof publishAssetsService.collectPublishAssets !== 'function') {
          throw createHttpError(500, 'AGENT_PUBLISH_ASSETS_UNAVAILABLE', 'agent.publish.assets', '发布素材服务未初始化');
        }
        if (typeof resetPublishAssetsCache === 'function') resetPublishAssetsCache();
        const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 20) || 20));
        const sourceType = String(req.query?.sourceType || '').trim();
        const query = normalizeText(req.query?.query || '').toLowerCase();
        const assets = publishAssetsService.collectPublishAssets()
          .filter((asset) => !sourceType || asset.sourceType === sourceType)
          .filter((asset) => {
            if (!query) return true;
            const haystack = [
              asset.id,
              asset.label,
              asset.displayLabel,
              asset.compactLabel,
              asset.typeLabel,
              asset.metadata?.suggestedTitle,
              asset.metadata?.sourceSummary
            ].map((value) => String(value || '')).join(' ').toLowerCase();
            return haystack.includes(query);
          })
          .slice(0, limit);
        res.json({
          success: true,
          total: assets.length,
          assets
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_ASSETS_FAILED',
          stage: 'agent.publish.assets',
          error: '读取可发布素材失败'
        });
      }
    },

    listPublishDrafts: (req, res) => {
      try {
        if (!publishStore || typeof publishStore.readPublishJobs !== 'function') {
          throw createHttpError(500, 'AGENT_PUBLISH_JOBS_UNAVAILABLE', 'agent.publish.jobs', '发布任务服务未初始化');
        }
        const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 20) || 20));
        const includeArchived = req.query?.includeArchived === 'true' || req.query?.includeArchived === '1';
        const statusFilter = String(req.query?.status || '').trim();
        const payload = publishStore.readPublishJobs();
        const jobs = (payload.jobs || [])
          .filter((job) => includeArchived || !job.archived)
          .filter((job) => !statusFilter || String(job.status || '') === statusFilter)
          .slice(0, limit);
        res.json({
          success: true,
          total: jobs.length,
          jobs
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_JOBS_FAILED',
          stage: 'agent.publish.jobs',
          error: '读取发布草稿失败'
        });
      }
    },

    getPublishScheduleSummary: (req, res) => {
      try {
        res.json(buildPublishSchedulePayload({
          ...req.query,
          scheduledOnly: req.query?.scheduledOnly === undefined ? false : req.query.scheduledOnly
        }));
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_SCHEDULE_FAILED',
          stage: 'agent.publish.schedule',
          error: '查询定时发布任务失败'
        });
      }
    },

    listScheduledPublishTasks: (req, res) => {
      try {
        res.json(buildPublishSchedulePayload({
          ...req.query,
          scheduledOnly: true
        }));
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_SCHEDULE_LIST_FAILED',
          stage: 'agent.publish.schedule',
          error: '列出定时发布任务失败'
        });
      }
    },

    getPublishTaskStatus: (req, res) => {
      try {
        const publishJobId = String(req.params.publishJobId || req.params.jobId || '').trim();
        if (!publishJobId) {
          throw createHttpError(400, 'AGENT_PUBLISH_JOB_ID_MISSING', 'agent.publish.task', '缺少发布任务 ID');
        }
        const payload = buildPublishSchedulePayload({ includeArchived: true, limit: 100 });
        const job = (payload.jobs || []).find((item) => item.id === publishJobId) || null;
        if (!job) {
          throw createHttpError(404, 'AGENT_PUBLISH_JOB_NOT_FOUND', 'agent.publish.task', '发布任务不存在');
        }
        res.json({
          success: true,
          job
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_TASK_FAILED',
          stage: 'agent.publish.task',
          error: '查询发布任务失败'
        });
      }
    },

    getPublishAccountDashboard: async (_req, res) => {
      try {
        if (!accountDashboardService || typeof accountDashboardService.getAccountDashboard !== 'function') {
          throw createHttpError(500, 'AGENT_ACCOUNT_DASHBOARD_UNAVAILABLE', 'agent.publish.accounts', '账号看板服务未初始化');
        }
        const dashboard = await accountDashboardService.getAccountDashboard();
        res.json({
          success: true,
          summary: dashboard.summary || {},
          accounts: dashboard.accounts || []
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ACCOUNT_DASHBOARD_FAILED',
          stage: 'agent.publish.accounts',
          error: '查询发布账号看板失败'
        });
      }
    },

    listPublishAccountJobs: (req, res) => {
      try {
        if (!accountDashboardService || typeof accountDashboardService.getAccountJobs !== 'function') {
          throw createHttpError(500, 'AGENT_ACCOUNT_JOBS_UNAVAILABLE', 'agent.publish.accounts', '账号任务服务未初始化');
        }
        const accountId = String(req.params.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.publish.accounts', '缺少账号 ID');
        }
        const platform = String(req.query?.platform || 'wechatChannels').trim();
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50) || 50));
        const status = String(req.query?.status || '').trim() || undefined;
        const jobs = accountDashboardService.getAccountJobs(accountId, { platform, status, limit });
        res.json({
          success: true,
          accountId,
          platform,
          total: jobs.length,
          jobs: jobs.map((job) => normalizePublishJobSummary(job))
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ACCOUNT_JOBS_FAILED',
          stage: 'agent.publish.accounts',
          error: '查询账号发布任务失败'
        });
      }
    },

    listPublishAccountFailures: (req, res) => {
      try {
        if (!accountDashboardService || typeof accountDashboardService.getAccountFailedJobs !== 'function') {
          throw createHttpError(500, 'AGENT_ACCOUNT_FAILURES_UNAVAILABLE', 'agent.publish.accounts', '账号失败任务服务未初始化');
        }
        const accountId = String(req.params.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.publish.accounts', '缺少账号 ID');
        }
        const platform = String(req.query?.platform || 'wechatChannels').trim();
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20) || 20));
        const jobs = accountDashboardService.getAccountFailedJobs(accountId, limit, platform);
        res.json({
          success: true,
          accountId,
          platform,
          total: jobs.length,
          jobs: jobs.map((job) => normalizePublishJobSummary(job))
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ACCOUNT_FAILURES_FAILED',
          stage: 'agent.publish.accounts',
          error: '查询账号失败任务失败'
        });
      }
    },

    listLoginStatuses: (req, res) => {
      try {
        if (!loginStatusService || typeof loginStatusService.getAllStatus !== 'function') {
          throw createHttpError(500, 'AGENT_LOGIN_STATUS_UNAVAILABLE', 'agent.login.status', '登录状态服务未初始化');
        }
        const statuses = loginStatusService.getAllStatus().map((status) => sanitizeLoginStatus(status));
        const statusFilter = String(req.query?.status || '').trim();
        const filtered = statuses.filter((status) => !statusFilter || status.status === statusFilter);
        res.json({
          success: true,
          summary: {
            total: filtered.length,
            loggedIn: filtered.filter((item) => item.status === 'logged_in').length,
            needLogin: filtered.filter((item) => item.status === 'need_login').length,
            error: filtered.filter((item) => item.status === 'error').length
          },
          statuses: filtered
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_LOGIN_STATUS_FAILED',
          stage: 'agent.login.status',
          error: '查询登录状态失败'
        });
      }
    },

    getLoginStatus: (req, res) => {
      try {
        if (!loginStatusService || typeof loginStatusService.getAccountStatus !== 'function') {
          throw createHttpError(500, 'AGENT_LOGIN_STATUS_UNAVAILABLE', 'agent.login.status', '登录状态服务未初始化');
        }
        const accountId = String(req.params.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.login.status', '缺少账号 ID');
        }
        const status = loginStatusService.getAccountStatus(accountId);
        if (!status) {
          throw createHttpError(404, 'AGENT_LOGIN_STATUS_NOT_FOUND', 'agent.login.status', '未找到该账号的登录状态缓存');
        }
        res.json({
          success: true,
          accountId,
          status: sanitizeLoginStatus({ accountId, ...status })
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_LOGIN_STATUS_GET_FAILED',
          stage: 'agent.login.status',
          error: '查询账号登录状态失败'
        });
      }
    },

    getLoginQrCode: async (req, res) => {
      try {
        if (!loginStatusService || typeof loginStatusService.requestLatestQrCode !== 'function') {
          throw createHttpError(500, 'AGENT_LOGIN_QRCODE_UNAVAILABLE', 'agent.login.qrcode', '登录二维码服务未初始化');
        }
        const accountId = String(req.params.accountId || req.body?.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.login.qrcode', '缺少账号 ID');
        }
        const result = await loginStatusService.requestLatestQrCode(accountId, {
          notifyFeishu: false,
          trigger: 'agent_qrcode_request'
        });
        const image = buildQrCodeImagePayload(result, paths);
        const status = result.status || (image.hasQrCode ? 'need_login' : '');
        res.json({
          success: true,
          accountId,
          status,
          message: status === 'logged_in'
            ? '账号已登录，不需要扫码'
            : '已刷新登录二维码截图，请扫码完成登录',
          refreshQrUrl: result.refreshQrUrl || '',
          image,
          requiresScan: status !== 'logged_in' && image.hasQrCode,
          note: '该接口只刷新/读取二维码截图，不会发布内容，也不会发送飞书通知。'
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_LOGIN_QRCODE_FAILED',
          stage: 'agent.login.qrcode',
          error: '获取登录二维码失败',
          hint: '请确认账号 ID 存在，且当前账号没有正在执行的发布任务。'
        });
      }
    },

    createPublishDraft: async (req, res) => {
      try {
        if (!publishStore || !publishAssetsService) {
          throw createHttpError(500, 'AGENT_PUBLISH_UNAVAILABLE', 'agent.publish.draft', '发布服务未初始化');
        }
        const assetId = String(req.body?.assetId || '').trim();
        const jobId = String(req.body?.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || '').trim();
        const assets = typeof publishAssetsService.collectPublishAssets === 'function'
          ? publishAssetsService.collectPublishAssets()
          : [];
        let asset = assetId ? assets.find((item) => item.id === assetId) : null;
        if (!asset) asset = findAssetForJob(jobId, outputPath);
        if (!asset && jobId) {
          const status = materialDrivenStarter.getStatus(jobId, outputPath);
          const videoPath = status ? toReviewVideoPathFromJobStatus(status, paths.PROJECT_ROOT) : '';
          if (videoPath && fs.existsSync(videoPath)) {
            asset = {
              id: stableHash({ videoPath }),
              label: `素材驱动成片 ${jobId}`,
              compactLabel: `素材驱动成片 ${jobId}`,
              typeLabel: '素材驱动成片',
              sourceType: 'material_driven',
              path: videoPath,
              url: resolvePublicAssetUrlFromPath(videoPath, paths.PROJECT_ROOT),
              metadata: {
                suggestedTitle: status?.task?.sourcePost?.title || status?.task?.sourceMeta?.sourceAuthor || '热点视频',
                suggestedDescription: status?.task?.sourcePost?.body || '',
                sourceSummary: status?.task?.sourcePost?.body || '',
                sourceUrl: status?.task?.sourcePost?.postUrl || status?.task?.sourceMeta?.postUrl || '',
                author: status?.task?.sourcePost?.author || status?.task?.sourceMeta?.sourceAuthor || ''
              }
            };
          }
        }
        if (!asset) {
          throw createHttpError(404, 'AGENT_PUBLISH_ASSET_NOT_FOUND', 'agent.publish.draft', '未找到可发布的视频素材', '', '请确认视频任务已完成，或传入 /api/publish/assets 中存在的 assetId');
        }

        const publishJob = await createPublishJobFromAsset({
          asset,
          platforms: req.body?.platforms,
          title: req.body?.title,
          description: req.body?.description,
          tags: req.body?.tags,
          platformSelections: req.body?.platformSelections,
          scheduledTime: req.body?.scheduledTime
        });

        res.json({
          success: true,
          message: '发布草稿已创建，尚未执行真实发布',
          publishJob,
          requiresConfirmation: true,
          confirmationPhrase: PUBLISH_CONFIRMATION_PHRASE
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_DRAFT_FAILED',
          stage: 'agent.publish.draft',
          error: '创建发布草稿失败'
        });
      }
    },

    confirmPublish: async (req, res) => {
      try {
        const publishJobId = String(req.body?.publishJobId || req.body?.jobId || '').trim();
        const platformKey = String(req.body?.platform || req.body?.platformKey || 'wechatChannels').trim();
        const confirmation = String(req.body?.confirmation || '').trim();
        const allowRealPublish = process.env.AGENT_ENABLE_REAL_PUBLISH === 'true' || req.body?.allowRealPublish === true;
        if (!publishJobId) {
          throw createHttpError(400, 'AGENT_PUBLISH_JOB_ID_MISSING', 'agent.publish.confirm', '缺少发布任务 ID');
        }
        if (confirmation !== PUBLISH_CONFIRMATION_PHRASE) {
          throw createHttpError(
            409,
            'AGENT_PUBLISH_CONFIRMATION_REQUIRED',
            'agent.publish.confirm',
            '真实发布需要显式确认',
            '',
            `请先人工核对草稿，再使用 confirmation="${PUBLISH_CONFIRMATION_PHRASE}"`
          );
        }
        if (!allowRealPublish) {
          throw createHttpError(
            403,
            'AGENT_REAL_PUBLISH_DISABLED',
            'agent.publish.confirm',
            'V0 默认禁用真实发布',
            '',
            '如确需本地自测真实发布，请设置 AGENT_ENABLE_REAL_PUBLISH=true 后再确认'
          );
        }

        const starter = platformKey === 'wechatChannels' ? startWechatRpa : startPlatformRpa;
        if (typeof starter !== 'function') {
          throw createHttpError(500, 'AGENT_PUBLISH_STARTER_UNAVAILABLE', 'agent.publish.confirm', '发布执行服务未初始化');
        }
        if (platformKey === 'wechatChannels') {
          await starter(publishJobId, 'publish');
        } else {
          await starter(publishJobId, platformKey, 'publish');
        }
        const payload = publishStore.readPublishJobs();
        const publishJob = (payload.jobs || []).find((job) => job.id === publishJobId) || null;
        res.json({
          success: true,
          message: '已启动真实发布流程',
          publishJob
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_CONFIRM_FAILED',
          stage: 'agent.publish.confirm',
          error: '确认发布失败'
        });
      }
    }
  };
}

module.exports = {
  createPublishAgentHandlers
};
