function createPublishHandlers(deps) {
  const {
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
    triggerAutoPilotNow
  } = deps;

  async function startSelectedPlatformRpa(jobId, platformKey, mode) {
    if (typeof startPlatformRpa === 'function') {
      return startPlatformRpa(jobId, platformKey, mode);
    }
    if (platformKey === 'wechatChannels') {
      return startWechatRpa(jobId, mode);
    }
    throw new Error(`平台暂未接入自动化: ${platformKey}`);
  }

  function resolvePublishTitle(inputTitle, asset) {
    return String(
      inputTitle
      || asset?.metadata?.suggestedTitle
      || asset?.metadata?.title
      || asset?.metadata?.suggestedShortTitle
      || asset?.compactLabel
      || asset?.displayLabel
      || asset?.label
      || ''
    ).trim();
  }

  function retrySelectedPlatformRpa(jobId, platformKey, mode) {
    if (typeof retryPlatformRpa === 'function') {
      return retryPlatformRpa(jobId, platformKey, mode);
    }
    if (platformKey === 'wechatChannels') {
      return retryWechatRpa(jobId, mode);
    }
    throw new Error(`平台暂未接入自动化: ${platformKey}`);
  }

  function cancelSelectedPlatformRpa(jobId, platformKey) {
    if (typeof cancelPlatformRpa === 'function') {
      return cancelPlatformRpa(jobId, platformKey);
    }
    if (platformKey === 'wechatChannels') {
      return cancelWechatRpa(jobId);
    }
    throw new Error(`平台暂未接入自动化: ${platformKey}`);
  }

  return {
    getConfig: (_req, res) => {
      try {
        const config = readPublishConfig();
        res.json({ success: true, config, maskedConfig: maskPlatformConfig(config) });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_CONFIG_READ_FAILED', stage: 'publish.config', error: '读取发布配置失败', details: err.message });
      }
    },
    postConfig: (req, res) => {
      try {
        const previousConfig = readPublishConfig();
        const sanitizedConfig = sanitizePlatformConfigInput(req.body || {});
        writePublishConfig(sanitizedConfig);
        const config = readPublishConfig();
        const payload = reconcileAndPersistPublishJobs(config);
        let autoPilotTrigger = null;
        if (config?.global?.autoPilotEnabled && typeof triggerAutoPilotNow === 'function') {
          try {
            if (config?.global?.autoPilotUseCurrentRanking) {
              autoPilotTrigger = triggerAutoPilotNow(config, { reason: 'config_save' });
            } else if (!previousConfig?.global?.autoPilotEnabled && config?.global?.autoPilotEnabled) {
              autoPilotTrigger = Promise.resolve({ triggered: false, reason: 'scheduled_mode_waiting_for_fetch_time' });
            }
          } catch (_err) {}
        }

        Promise.resolve(autoPilotTrigger)
          .then((triggerResult) => {
            res.json({
              success: true,
              config,
              maskedConfig: maskPlatformConfig(config),
              jobs: payload.jobs || [],
              autoPilotTrigger: triggerResult || null
            });
          })
          .catch((triggerErr) => {
            res.json({
              success: true,
              config,
              maskedConfig: maskPlatformConfig(config),
              jobs: payload.jobs || [],
              autoPilotTrigger: {
                triggered: false,
                reason: 'trigger_failed',
                error: triggerErr.message
              }
            });
          });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_CONFIG_WRITE_FAILED', stage: 'publish.config', error: '保存发布配置失败', details: err.message });
      }
    },
    getAssets: (req, res) => {
      try {
        const forceRefresh = String(req.query.refresh || '').trim() === '1';
        res.json({ success: true, assets: getCachedPublishAssets(forceRefresh) });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_ASSETS_READ_FAILED', stage: 'publish.assets', error: '读取发布素材失败', details: err.message });
      }
    },
    deleteAsset: (req, res) => {
      try {
        const assetId = String(req.params.assetId || '').trim();
        if (!assetId) return sendError(res, { status: 400, code: 'PUBLISH_ASSET_ID_MISSING', stage: 'publish.assets', error: '缺少素材 ID' });
        if (typeof deletePublishAsset !== 'function') {
          return sendError(res, { status: 500, code: 'PUBLISH_ASSET_DELETE_UNAVAILABLE', stage: 'publish.assets', error: '成品删除服务未初始化' });
        }

        const result = deletePublishAsset(assetId);
        if (!result) return sendError(res, { status: 404, code: 'PUBLISH_ASSET_NOT_FOUND', stage: 'publish.assets', error: '所选视频素材不存在' });

        res.json({
          success: true,
          deletedAsset: result.asset,
          deletedPath: result.deletedPath,
          deletedMetadata: result.deletedMetadata,
          assets: getCachedPublishAssets(true)
        });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_ASSET_DELETE_FAILED', stage: 'publish.assets', error: '删除成品素材失败', details: err.message });
      }
    },
    generateDescription: async (req, res) => {
      try {
        const assets = collectPublishAssets();
        const assetId = String(req.body?.assetId || '').trim();
        const tagStrategy = String(req.body?.tagStrategy || 'model').trim() === 'system' ? 'system' : 'model';
        if (!assetId) return sendError(res, { status: 400, code: 'PUBLISH_ASSET_MISSING', stage: 'publish.description', error: '请选择要发布的视频素材' });

        const asset = assets.find((item) => item.id === assetId);
        if (!asset) return sendError(res, { status: 404, code: 'PUBLISH_ASSET_NOT_FOUND', stage: 'publish.description', error: '所选视频素材不存在' });
        const title = String(req.body?.title || asset?.metadata?.suggestedTitle || asset?.compactLabel || asset?.label || '').trim();

        const sourceText = String(
          asset?.metadata?.sourceSummary
          || asset?.metadata?.suggestedDescription
          || ''
        ).trim();
        if (!sourceText) {
          return sendError(res, { status: 400, code: 'PUBLISH_SOURCE_SUMMARY_MISSING', stage: 'publish.description', error: '当前素材缺少可用于生成描述的内容摘要' });
        }

        const description = await generatePublishDescription(sourceText, {
          includeTags: tagStrategy === 'model',
          title,
          allowFallback: false,
          timeoutMs: 180000
        });
        if (!description) {
          return sendError(res, { status: 500, code: 'PUBLISH_DESCRIPTION_GENERATE_FAILED', stage: 'publish.description', error: '自动描述生成失败，请稍后重试', hint: '可切换模型或检查 Gemini Key 与网络状态' });
        }

        res.json({ success: true, description });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_DESCRIPTION_REQUEST_FAILED', stage: 'publish.description', error: '生成发布描述失败', details: err.message });
      }
    },
    getJobs: (_req, res) => {
      try {
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_JOBS_READ_FAILED', stage: 'publish.jobs', error: '读取发布任务失败', details: err.message });
      }
    },
    deleteJob: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.jobs', error: '缺少任务 ID' });
        try { cancelWechatRpa(jobId); } catch (_err) {}
        const payload = readPublishJobs();
        const beforeCount = (payload.jobs || []).length;
        payload.jobs = (payload.jobs || []).filter((job) => job.id !== jobId);
        if (payload.jobs.length === beforeCount) {
          return sendError(res, { status: 404, code: 'PUBLISH_JOB_NOT_FOUND', stage: 'publish.jobs', error: '发布任务不存在' });
        }
        writePublishJobs(payload);
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_JOB_DELETE_FAILED', stage: 'publish.jobs', error: '删除发布任务失败', details: err.message });
      }
    },
    deleteAllJobs: (_req, res) => {
      try {
        const payload = readPublishJobs();
        (payload.jobs || []).forEach(job => {
          try { cancelWechatRpa(job.id); } catch (_err) {}
        });
        writePublishJobs({ jobs: [] });
        res.json({ success: true, jobs: [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_JOB_CLEAR_FAILED', stage: 'publish.jobs', error: '清空发布任务失败', details: err.message });
      }
    },
    archiveJob: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.jobs', error: '缺少任务 ID' });
        archivePublishJob(jobId, true);
        try { cancelWechatRpa(jobId); } catch (_err) {}
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_JOB_ARCHIVE_FAILED', stage: 'publish.jobs', error: '归档发布任务失败', details: err.message });
      }
    },
    unarchiveJob: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.jobs', error: '缺少任务 ID' });
        archivePublishJob(jobId, false);
        try { cancelWechatRpa(jobId); } catch (_err) {}
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_JOB_UNARCHIVE_FAILED', stage: 'publish.jobs', error: '取消归档发布任务失败', details: err.message });
      }
    },
    archiveCompleted: (_req, res) => {
      try {
        const result = archiveCompletedPublishJobs();
        res.json({
          success: true,
          jobs: result.jobs || [],
          archivedCount: result.archivedCount || 0
        });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_JOB_ARCHIVE_COMPLETED_FAILED', stage: 'publish.jobs', error: '归档已完成任务失败', details: err.message });
      }
    },
    createJob: async (req, res) => {
      try {
        const config = readPublishConfig();
        const assets = collectPublishAssets();
        const assetId = String(req.body?.assetId || '').trim();
        const selectedPlatforms = Array.isArray(req.body?.platforms) ? req.body.platforms.map((value) => String(value).trim()).filter(Boolean) : [];
        const incomingSelections = req.body?.platformSelections && typeof req.body.platformSelections === 'object' ? req.body.platformSelections : {};
        const incomingTitle = String(req.body?.title || '').trim();
        const description = String(req.body?.description || '').trim();
        const incomingTags = Array.isArray(req.body?.tags) ? req.body.tags : String(req.body?.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
        const coverUrl = String(req.body?.coverUrl || '').trim();
        const scheduledTime = String(req.body?.scheduledTime || '').trim();
        const tagStrategy = String(req.body?.tagStrategy || 'model').trim() === 'system' ? 'system' : 'model';
        const tags = tagStrategy === 'model' ? [] : incomingTags;

        if (!assetId) return sendError(res, { status: 400, code: 'PUBLISH_ASSET_MISSING', stage: 'publish.create_job', error: '请选择要发布的视频素材' });
        if (selectedPlatforms.length === 0) return sendError(res, { status: 400, code: 'PUBLISH_PLATFORM_MISSING', stage: 'publish.create_job', error: '请至少选择一个平台' });

        const asset = assets.find((item) => item.id === assetId);
        if (!asset) return sendError(res, { status: 404, code: 'PUBLISH_ASSET_NOT_FOUND', stage: 'publish.create_job', error: '所选视频素材不存在' });
        const title = resolvePublishTitle(incomingTitle, asset);
        if (!title) {
          return sendError(res, {
            status: 400,
            code: 'PUBLISH_TITLE_MISSING',
            stage: 'publish.create_job',
            error: '请填写发布标题',
            hint: '发布标题可从前序产物元数据自动带入；如果为空，请在发布弹窗手动填写后重试'
          });
        }

        const shortTitle = buildShortTitle(title, '热点速递');
        let finalDescription = description;
        if (!finalDescription) {
          finalDescription = await generatePublishDescription(
            asset?.metadata?.sourceSummary
            || asset?.metadata?.suggestedDescription
            || '',
            {
              includeTags: tagStrategy === 'model',
              title,
              allowFallback: false,
              timeoutMs: 180000
            }
          );
        }
        if (!finalDescription) {
          return sendError(res, {
            status: 500,
            code: 'PUBLISH_DESCRIPTION_GENERATE_FAILED',
            stage: 'publish.create_job',
            error: '模型未返回有效描述，发布任务未创建',
            hint: '请稍后重试，或检查当前 LLM 提供商与网络状态'
          });
        }
        const publishData = { title, shortTitle, description: finalDescription, tags, coverUrl, tagStrategy };
        const platformTasks = [];
        const platformErrors = [];
        const platformSelections = {};
        const wechatAccountMap = getWechatAccountMap(config);
        const sauAccountMaps = {
          douyin: typeof getSauAccountMap === 'function' ? getSauAccountMap('douyin', config) : new Map(),
          xiaohongshu: typeof getSauAccountMap === 'function' ? getSauAccountMap('xiaohongshu', config) : new Map()
        };
        const xAccountMap = typeof getXAccountMap === 'function' ? getXAccountMap(config) : new Map();

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
          const selection = incomingSelections?.[platformKey] && typeof incomingSelections[platformKey] === 'object'
            ? incomingSelections[platformKey]
            : {};
          let normalizedSelection = {};
          if (platformKey === 'wechatChannels') {
            const accountId = String(selection.accountId || '').trim();
            const account = wechatAccountMap.get(accountId) || null;
            normalizedSelection = {
              accountId,
              accountLabel: account?.displayName || account?.helperAccount || account?.finderUserName || ''
            };
          } else if (['douyin', 'xiaohongshu'].includes(platformKey)) {
            const accountId = String(selection.accountId || '').trim();
            const accounts = Array.from(sauAccountMaps[platformKey]?.values?.() || []);
            const account = sauAccountMaps[platformKey]?.get(accountId) || accounts[0] || null;
            normalizedSelection = {
              accountId: account?.id || accountId,
              accountLabel: account?.displayName || account?.sauAccountName || account?.accountId || account?.openId || '',
              sauAccountName: account?.sauAccountName || platformConfig.sauAccountName || ''
            };
          } else if (platformKey === 'x') {
            const accountId = String(selection.accountId || '').trim();
            const accounts = Array.from(xAccountMap?.values?.() || []);
            const account = xAccountMap?.get(accountId) || accounts[0] || null;
            normalizedSelection = {
              accountId: account?.id || accountId,
              accountLabel: account?.displayName || account?.username || account?.userId || '',
              username: account?.username || ''
            };
          }
          platformSelections[platformKey] = normalizedSelection;
          const task = buildPublishTask(platformKey, publishData, asset.url, platformConfig, normalizedSelection);
          if (scheduledTime && ['pending', 'pending_integration', 'ready', 'rpa_available'].includes(String(task.status || ''))) {
            task.status = 'scheduled_wait';
          }
          const validation = platformKey === 'wechatChannels'
            ? validateWechatTaskConfig(platformConfig, task)
            : (['douyin', 'xiaohongshu'].includes(platformKey) && typeof validateSauTaskConfig === 'function'
              ? validateSauTaskConfig(platformKey, platformConfig, task)
              : (platformKey === 'x' && typeof validateXTaskConfig === 'function'
                ? validateXTaskConfig(platformConfig, task)
                : collectPlatformValidation(platformKey, platformConfig, task.requiredFields || [])));
          task.validation = validation;
          if (platformKey === 'wechatChannels' && validation.account) {
            task.accountLabel = validation.account.displayName || validation.account.helperAccount || validation.account.finderUserName || task.accountLabel || '';
          }
          if (['douyin', 'xiaohongshu'].includes(platformKey) && validation.account) {
            task.accountLabel = validation.account.displayName || validation.account.sauAccountName || validation.account.accountId || validation.account.openId || task.accountLabel || '';
            task.sauAccountName = validation.account.sauAccountName || task.sauAccountName || '';
          }
          if (platformKey === 'x' && validation.account) {
            task.accountLabel = validation.account.displayName || validation.account.username || validation.account.userId || task.accountLabel || '';
            task.username = validation.account.username || task.username || '';
          }
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
          return sendError(res, { status: 400, code: 'PUBLISH_TASKS_EMPTY', stage: 'publish.create_job', error: '没有可创建的发布任务，请检查平台启用状态', details: JSON.stringify(platformErrors) });
        }

        const payload = readPublishJobs();
        const job = {
          id: makeJobId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archived: false,
          archivedAt: null,
          status: scheduledTime ? 'scheduled_wait' : (platformErrors.length > 0 ? 'partial_ready' : 'ready'),
          scheduledAt: scheduledTime ? new Date(scheduledTime).toISOString() : null,
          asset,
          publishData,
          selectedPlatforms,
          platformSelections,
          platformTasks,
          platformErrors
        };
        payload.jobs = [job, ...(payload.jobs || [])].slice(0, 50);
        writePublishJobs(payload);
        res.json({ success: true, job, jobs: payload.jobs });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_CREATE_JOB_FAILED', stage: 'publish.create_job', error: '创建发布任务失败', details: err.message });
      }
    },
    regenerateDescription: async (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.regenerate_description', error: '缺少任务 ID' });

        try { cancelWechatRpa(jobId); } catch (_err) {}
        const payload = readPublishJobs();
        const job = (payload.jobs || []).find((item) => item.id === jobId);
        if (!job) return sendError(res, { status: 404, code: 'PUBLISH_JOB_NOT_FOUND', stage: 'publish.regenerate_description', error: '发布任务不存在' });

        const sourceText = String(
          job?.asset?.metadata?.sourceSummary
          || job?.asset?.metadata?.suggestedDescription
          || ''
        ).trim();
        if (!sourceText) {
          return sendError(res, { status: 400, code: 'PUBLISH_SOURCE_SUMMARY_MISSING', stage: 'publish.regenerate_description', error: '当前任务缺少可用于生成描述的内容摘要' });
        }

        const tagStrategy = job?.publishData?.tagStrategy === 'model' ? 'model' : 'system';
        const nextDescription = await generatePublishDescription(sourceText, {
          includeTags: tagStrategy === 'model',
          title: job?.publishData?.title || job?.asset?.metadata?.suggestedTitle || job?.asset?.compactLabel || job?.asset?.label || '',
          allowFallback: false,
          timeoutMs: 180000
        });
        if (!nextDescription) {
          return sendError(res, { status: 500, code: 'PUBLISH_DESCRIPTION_GENERATE_FAILED', stage: 'publish.regenerate_description', error: '自动描述生成失败，请稍后重试', hint: '可切换模型或检查 Gemini Key 与网络状态' });
        }

        updatePublishJob(jobId, (current) => {
          current.publishData = {
            ...(current.publishData || {}),
            description: nextDescription
          };
          current.platformTasks = Array.isArray(current.platformTasks)
            ? current.platformTasks.map((task) => ({
              ...task,
              description: nextDescription
            }))
            : [];
          return current;
        });

        const nextPayload = readPublishJobs();
        res.json({ success: true, jobs: nextPayload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_REGENERATE_DESCRIPTION_FAILED', stage: 'publish.regenerate_description', error: '重新生成描述失败', details: err.message });
      }
    },
    startAllWechat: async (req, res) => {
      try {
        const mode = String(req.body?.mode || 'draft').trim();
        if (!['draft', 'publish'].includes(mode)) {
          return sendError(res, { status: 400, code: 'PUBLISH_MODE_INVALID', stage: 'publish.wechat', error: 'mode 仅支持 draft 或 publish' });
        }
        const payload = readPublishJobs();
        const jobs = payload.jobs || [];
        let startedCount = 0;
        let failedCount = 0;
        const errors = [];

        for (const job of jobs) {
          const task = (job.platformTasks || []).find((item) => item.platform === 'wechatChannels');
          if (!task) continue;
          const status = task.status || 'draft_preparing';
          if (['published', 'publishing', 'starting', 'navigating', 'login_ready', 'need_login', 'uploading', 'uploaded', 'editing', 'edited', 'ready_for_manual_publish'].includes(status)) {
            continue;
          }
          try {
            await startWechatRpa(job.id, mode);
            startedCount++;
          } catch (err) {
            failedCount++;
            errors.push(`[${job.publishData?.title || job.id}]: ${err.message}`);
          }
        }

        const newPayload = readPublishJobs();
        res.json({ success: true, startedCount, failedCount, errors, jobs: newPayload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_WECHAT_START_ALL_FAILED', stage: 'publish.wechat', error: '一键启动所有任务失败', details: err.message });
      }
    },
    runWechat: async (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const mode = String(req.body?.mode || 'draft').trim();
        if (!['draft', 'publish'].includes(mode)) {
          return sendError(res, { status: 400, code: 'PUBLISH_MODE_INVALID', stage: 'publish.wechat', error: 'mode 仅支持 draft 或 publish' });
        }
        await startWechatRpa(jobId, mode);
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_WECHAT_START_FAILED', stage: 'publish.wechat', error: '启动微信视频号任务失败', details: err.message });
      }
    },
    runPlatform: async (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const platformKey = String(req.params.platformKey || '').trim();
        const mode = String(req.body?.mode || 'draft').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.platform', error: '缺少任务 ID' });
        if (!platformKey) return sendError(res, { status: 400, code: 'PUBLISH_PLATFORM_MISSING', stage: 'publish.platform', error: '缺少平台' });
        if (!['draft', 'publish'].includes(mode)) {
          return sendError(res, { status: 400, code: 'PUBLISH_MODE_INVALID', stage: 'publish.platform', error: 'mode 仅支持 draft 或 publish' });
        }
        await startSelectedPlatformRpa(jobId, platformKey, mode);
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_START_FAILED', stage: 'publish.platform', error: '启动平台发布任务失败', details: err.message });
      }
    },
    retryWechat: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const mode = String(req.body?.mode || '').trim();
        retryWechatRpa(jobId, mode);
        try { cancelWechatRpa(jobId); } catch (_err) {}
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_WECHAT_RETRY_FAILED', stage: 'publish.wechat', error: '重试微信视频号任务失败', details: err.message });
      }
    },
    retryPlatform: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const platformKey = String(req.params.platformKey || '').trim();
        const mode = String(req.body?.mode || '').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.platform', error: '缺少任务 ID' });
        if (!platformKey) return sendError(res, { status: 400, code: 'PUBLISH_PLATFORM_MISSING', stage: 'publish.platform', error: '缺少平台' });
        retrySelectedPlatformRpa(jobId, platformKey, mode);
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_RETRY_FAILED', stage: 'publish.platform', error: '重试平台发布任务失败', details: err.message });
      }
    },
    cancelWechat: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        cancelWechatRpa(jobId);
        try { cancelWechatRpa(jobId); } catch (_err) {}
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_WECHAT_CANCEL_FAILED', stage: 'publish.wechat', error: '取消微信视频号任务失败', details: err.message });
      }
    },
    cancelPlatform: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const platformKey = String(req.params.platformKey || '').trim();
        if (!jobId) return sendError(res, { status: 400, code: 'PUBLISH_JOB_ID_MISSING', stage: 'publish.platform', error: '缺少任务 ID' });
        if (!platformKey) return sendError(res, { status: 400, code: 'PUBLISH_PLATFORM_MISSING', stage: 'publish.platform', error: '缺少平台' });
        cancelSelectedPlatformRpa(jobId, platformKey);
        const payload = readPublishJobs();
        res.json({ success: true, jobs: payload.jobs || [] });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_CANCEL_FAILED', stage: 'publish.platform', error: '取消平台发布任务失败', details: err.message });
      }
    },
    testWechatLogin: async (req, res) => {
      try {
        const accountId = String(req.params.accountId || '').trim();
        if (!accountId) return sendError(res, { status: 400, code: 'PUBLISH_ACCOUNT_ID_MISSING', stage: 'publish.wechat', error: '缺少账号 ID' });
        const result = await checkWechatLogin(accountId, {
          poll: req.body?.poll === true
        });
        res.json(result);
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_WECHAT_TEST_LOGIN_FAILED', stage: 'publish.wechat', error: '测试视频号登录状态失败', details: err.message });
      }
    },
    openWechatContentManager: async (req, res) => {
      try {
        const accountId = String(req.params.accountId || '').trim();
        if (!accountId) return sendError(res, { status: 400, code: 'PUBLISH_ACCOUNT_ID_MISSING', stage: 'publish.wechat', error: '缺少账号 ID' });
        const config = readPublishConfig();
        const account = getWechatAccountMap(config).get(accountId) || null;
        if (!account) return sendError(res, { status: 404, code: 'PUBLISH_WECHAT_ACCOUNT_NOT_FOUND', stage: 'publish.wechat', error: '未找到对应的视频号发布账号' });
        if (typeof openWechatContentManager !== 'function') {
          return sendError(res, { status: 500, code: 'PUBLISH_WECHAT_CONTENT_MANAGER_UNAVAILABLE', stage: 'publish.wechat', error: '内容管理打开服务未初始化' });
        }
        const result = await openWechatContentManager(accountId);
        if (result?.success === false) {
          return res.json({
            ...result,
            success: false,
            accountId
          });
        }
        res.json({
          ...result,
          success: true,
          accountId,
          account: {
            id: account.id,
            displayName: account.displayName || account.helperAccount || account.finderUserName || account.id
          }
        });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_WECHAT_CONTENT_MANAGER_FAILED', stage: 'publish.wechat', error: '打开内容管理页失败', details: err.message });
      }
    },
    testPlatformLogin: async (req, res) => {
      try {
        const platformKey = String(req.params.platformKey || '').trim();
        const accountId = String(req.params.accountId || '').trim();
        if (!['douyin', 'xiaohongshu'].includes(platformKey)) {
          return sendError(res, { status: 400, code: 'PUBLISH_PLATFORM_UNSUPPORTED', stage: 'publish.platform_login', error: '该平台暂不支持账号登录检测' });
        }
        if (!accountId) return sendError(res, { status: 400, code: 'PUBLISH_ACCOUNT_ID_MISSING', stage: 'publish.platform_login', error: '缺少账号 ID' });
        if (typeof checkPlatformLogin !== 'function') {
          return sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_LOGIN_UNAVAILABLE', stage: 'publish.platform_login', error: '平台登录检测服务未初始化' });
        }
        const result = await checkPlatformLogin(platformKey, accountId);
        res.json(result);
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_TEST_LOGIN_FAILED', stage: 'publish.platform_login', error: '测试平台登录状态失败', details: err.message });
      }
    },
    openPlatformContentManager: async (req, res) => {
      try {
        const platformKey = String(req.params.platformKey || '').trim();
        const accountId = String(req.params.accountId || '').trim();
        if (!['douyin', 'xiaohongshu'].includes(platformKey)) {
          return sendError(res, { status: 400, code: 'PUBLISH_PLATFORM_UNSUPPORTED', stage: 'publish.platform_manager', error: '该平台暂不支持内容管理入口' });
        }
        if (!accountId) return sendError(res, { status: 400, code: 'PUBLISH_ACCOUNT_ID_MISSING', stage: 'publish.platform_manager', error: '缺少账号 ID' });
        if (typeof openPlatformContentManager !== 'function') {
          return sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_MANAGER_UNAVAILABLE', stage: 'publish.platform_manager', error: '平台内容管理服务未初始化' });
        }
        const result = await openPlatformContentManager(platformKey, accountId);
        res.json({
          ...result,
          success: result?.success !== false,
          platform: platformKey,
          accountId
        });
      } catch (err) {
        sendError(res, { status: 500, code: 'PUBLISH_PLATFORM_CONTENT_MANAGER_FAILED', stage: 'publish.platform_manager', error: '打开平台内容管理页失败', details: err.message });
      }
    },
    getAccountDashboard: async (req, res) => {
      try {
        if (!deps.accountDashboardService) {
          return sendError(res, { status: 500, code: 'ACCOUNT_DASHBOARD_NOT_AVAILABLE', stage: 'publish.accounts', error: '账号看板服务未初始化' });
        }
        const dashboard = await deps.accountDashboardService.getAccountDashboard();
        res.json({ success: true, ...dashboard });
      } catch (err) {
        sendError(res, { status: 500, code: 'ACCOUNT_DASHBOARD_FAILED', stage: 'publish.accounts', error: '获取账号看板失败', details: err.message });
      }
    },
    getAccountJobs: (req, res) => {
      try {
        if (!deps.accountDashboardService) {
          return sendError(res, { status: 500, code: 'ACCOUNT_DASHBOARD_NOT_AVAILABLE', stage: 'publish.accounts', error: '账号看板服务未初始化' });
        }
        const accountId = String(req.params.accountId || '').trim();
        const platform = String(req.query.platform || 'wechatChannels').trim();
        if (!accountId) return sendError(res, { status: 400, code: 'ACCOUNT_ID_MISSING', stage: 'publish.accounts', error: '缺少账号 ID' });
        const status = String(req.query.status || '').trim() || undefined;
        const limit = parseInt(req.query.limit || '50', 10);
        const jobs = deps.accountDashboardService.getAccountJobs(accountId, { status, limit, platform });
        res.json({ success: true, jobs });
      } catch (err) {
        sendError(res, { status: 500, code: 'ACCOUNT_JOBS_FAILED', stage: 'publish.accounts', error: '获取账号任务列表失败', details: err.message });
      }
    },
    getAccountFailures: (req, res) => {
      try {
        if (!deps.accountDashboardService) {
          return sendError(res, { status: 500, code: 'ACCOUNT_DASHBOARD_NOT_AVAILABLE', stage: 'publish.accounts', error: '账号看板服务未初始化' });
        }
        const accountId = String(req.params.accountId || '').trim();
        const platform = String(req.query.platform || 'wechatChannels').trim();
        if (!accountId) return sendError(res, { status: 400, code: 'ACCOUNT_ID_MISSING', stage: 'publish.accounts', error: '缺少账号 ID' });
        const limit = parseInt(req.query.limit || '20', 10);
        const jobs = deps.accountDashboardService.getAccountFailedJobs(accountId, limit, platform);
        res.json({ success: true, jobs });
      } catch (err) {
        sendError(res, { status: 500, code: 'ACCOUNT_FAILURES_FAILED', stage: 'publish.accounts', error: '获取账号失败任务失败', details: err.message });
      }
    }
  };
}

module.exports = {
  createPublishHandlers
};
