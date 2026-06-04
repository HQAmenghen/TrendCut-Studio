function createSystemHandlers(deps) {
  const {
    fs,
    path,
    sendError,
    baseDir,
    pipelineDir,
    selfCheckService,
    editableJsonFiles,
    resolveEditableJsonPath,
    workflowPath,
    readWorkflow,
    extractWorkflowConfig,
    applyWorkflowConfig,
    writeWorkflow,
    runPythonScript,
    readProjectEnv,
    updateProjectEnv,
    taskStore,
    unifiedTaskView
  } = deps;
  const REMOVABLE_TASK_STATUSES = new Set(['queued', 'completed', 'failed', 'cancelled', 'canceled', 'interrupted', 'published']);

  const getEnvValue = (values, key, fallback = '') => values[key] ?? process.env[key] ?? fallback;
  const normalizeProvider = (value, fallback = 'gemini') => {
    const provider = String(value || '').toLowerCase();
    return ['gemini', 'qwen', 'vertex', 'deepseek'].includes(provider) ? provider : fallback;
  };
  const normalizeVertexAuthMode = (value) => {
    const mode = String(value || '').toLowerCase();
    return ['api_key', 'apikey', 'key', 'express'].includes(mode) ? 'api_key' : 'adc';
  };

  return {
    getPresets: (_req, res) => {
      try {
        const audioDir = path.join(baseDir, 'public/presets/audio');
        const imageDir = path.join(baseDir, 'public/presets/image');

        const audioFiles = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter((f) => f.endsWith('.wav') || f.endsWith('.mp3')) : [];
        const imageFiles = fs.existsSync(imageDir) ? fs.readdirSync(imageDir).filter((f) => f.match(/\.(png|jpg|jpeg)$/i)) : [];

        res.json({ success: true, audio: audioFiles, image: imageFiles });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'PRESETS_READ_FAILED',
          stage: 'system.presets',
          error: '读取预设素材失败',
          details: err.message,
          hint: '请检查 public/presets 目录是否存在且可访问'
        });
      }
    },
    getSelfCheck: (_req, res) => {
      try {
        res.json({ success: true, report: selfCheckService.run() });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'SELF_CHECK_FAILED',
          stage: 'system.self_check',
          error: '启动自检执行失败',
          details: err.message,
          hint: '请检查 Python、FFmpeg 与关键脚本路径配置'
        });
      }
    },
    getUnifiedTasks: (req, res) => {
      try {
        const tasks = unifiedTaskView && typeof unifiedTaskView.listTasks === 'function'
          ? unifiedTaskView.listTasks({ limit: req.query?.limit })
          : [];
        res.json({ success: true, tasks });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'SYSTEM_TASKS_READ_FAILED',
          stage: 'system.tasks',
          error: '读取统一任务视图失败',
          details: err.message
        });
      }
    },
    deleteUnifiedTask: (req, res) => {
      try {
        const taskId = String(req.params.taskId || '').trim();
        if (!taskId || !taskStore || typeof taskStore.getTask !== 'function' || typeof taskStore.deleteTask !== 'function') {
          return sendError(res, {
            status: 404,
            code: 'SYSTEM_TASK_DELETE_FAILED',
            stage: 'system.tasks',
            error: '任务不存在'
          });
        }
        const task = taskStore.getTask(taskId);
        if (!task) {
          return sendError(res, {
            status: 404,
            code: 'SYSTEM_TASK_DELETE_FAILED',
            stage: 'system.tasks',
            error: '任务不存在'
          });
        }
        const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
        const hasFailureSignal = Boolean(metadata.error);
        const status = hasFailureSignal
          ? 'failed'
          : String(task.status || '').trim().toLowerCase();
        if (!REMOVABLE_TASK_STATUSES.has(status)) {
          return sendError(res, {
            status: 409,
            code: 'SYSTEM_TASK_DELETE_FAILED',
            stage: 'system.tasks',
            error: '仅失败、中断、取消或已完成的任务允许删除'
          });
        }
        taskStore.deleteTask(taskId);
        const tasks = unifiedTaskView && typeof unifiedTaskView.listTasks === 'function'
          ? unifiedTaskView.listTasks({ limit: req.query?.limit })
          : [];
        res.json({ success: true, tasks });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'SYSTEM_TASK_DELETE_FAILED',
          stage: 'system.tasks',
          error: '删除统一任务记录失败',
          details: err.message
        });
      }
    },
    getWorkflowConfig: (_req, res) => {
      try {
        const workflow = readWorkflow(workflowPath);
        res.json({ success: true, config: extractWorkflowConfig(workflow) });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'WORKFLOW_READ_FAILED',
          stage: 'system.workflow',
          error: '读取工作流配置失败',
          details: err.message,
          hint: '请检查 workflow_api.json 是否存在且 JSON 格式正确'
        });
      }
    },
    postWorkflowConfig: (req, res) => {
      try {
        const workflow = readWorkflow(workflowPath);
        const updated = applyWorkflowConfig(workflow, req.body || {});
        writeWorkflow(workflowPath, updated);
        res.json({ success: true, config: extractWorkflowConfig(updated) });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'WORKFLOW_WRITE_FAILED',
          stage: 'system.workflow',
          error: '保存工作流配置失败',
          details: err.message,
          hint: '请检查工作流字段和值是否合法'
        });
      }
    },
    listJsonFiles: (_req, res) => {
      try {
        const files = Array.from(editableJsonFiles).map((fileName) => {
          const fullPath = resolveEditableJsonPath(fileName);
          return {
            fileName,
            exists: !!(fullPath && fs.existsSync(fullPath))
          };
        });
        res.json({ success: true, files });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'JSON_LIST_FAILED',
          stage: 'system.json_files',
          error: '读取 JSON 文件列表失败',
          details: err.message
        });
      }
    },
    getJsonFile: (req, res) => {
      try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return sendError(res, { status: 400, code: 'JSON_FILE_UNSUPPORTED', stage: 'system.json_files', error: '不支持的文件类型' });
        if (!fs.existsSync(fullPath)) return sendError(res, { status: 404, code: 'JSON_FILE_NOT_FOUND', stage: 'system.json_files', error: '文件不存在' });
        const content = fs.readFileSync(fullPath, 'utf-8');
        res.json({ success: true, fileName, content });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'JSON_READ_FAILED',
          stage: 'system.json_files',
          error: '读取 JSON 文件失败',
          details: err.message
        });
      }
    },
    postJsonFile: (req, res) => {
      try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return sendError(res, { status: 400, code: 'JSON_FILE_UNSUPPORTED', stage: 'system.json_files', error: '不支持的文件类型' });
        if (typeof req.body.content !== 'string') return sendError(res, { status: 400, code: 'JSON_CONTENT_MISSING', stage: 'system.json_files', error: '缺少内容' });
        JSON.parse(req.body.content);
        fs.writeFileSync(fullPath, req.body.content, 'utf-8');
        res.json({ success: true });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'JSON_WRITE_FAILED',
          stage: 'system.json_files',
          error: '保存 JSON 文件失败',
          details: err.message,
          hint: '请确认内容是合法 JSON 且目标文件可写'
        });
      }
    },
    optimizeText: async (req, res) => {
      const text = req.body.text;
      if (!text) return sendError(res, { status: 400, code: 'TEXT_MISSING', stage: 'system.optimize_text', error: '缺少待优化文本' });
      const scriptPath = path.join(pipelineDir, 'optimize_text.py');
      try {
        const result = await runPythonScript(scriptPath, ['--text', text]);
        res.json({ text: String(result.protocol?.result?.text || result.stdout || '').trim() });
      } catch (err) {
        sendError(res, { status: 500, code: err.code || 'OPTIMIZE_TEXT_FAILED', stage: err.stage || 'system.optimize_text', error: '文案优化失败', details: err.details || err.message, hint: err.hint || '' });
      }
    },
    convertVideo: async (req, res) => {
      const ratio = req.body.ratio;
      if (!ratio) return sendError(res, { status: 400, code: 'RATIO_MISSING', stage: 'system.convert_video', error: '缺少目标比例' });
      const inputFile = path.join(baseDir, 'public', 'output_final.mp4');
      const outputName = ratio === '9:16' ? 'output_9_16.mp4' : 'output_16_9.mp4';
      const outputFile = path.join(baseDir, 'public', outputName);

      try {
        await runPythonScript(path.join(pipelineDir, 'convert_ratio.py'), ['--ratio', ratio, '--input', inputFile, '--output', outputFile], { cwd: pipelineDir });
        res.json({ videoUrl: `/${outputName}?t=${Date.now()}` });
      } catch (err) {
        sendError(res, { status: 500, code: err.code || 'CONVERT_VIDEO_FAILED', stage: err.stage || 'system.convert_video', error: '视频转比例失败', details: err.details || err.message, hint: err.hint || '' });
      }
    },
    getFeishuConfig: (_req, res) => {
      try {
        const { values } = readProjectEnv(baseDir);
        const config = {
          webhookUrl: values.FEISHU_WEBHOOK_URL || process.env.FEISHU_WEBHOOK_URL || '',
          notifyLoginStatus: (values.FEISHU_NOTIFY_LOGIN_STATUS ?? process.env.FEISHU_NOTIFY_LOGIN_STATUS) === 'true',
          notifyAutoPilot: (values.FEISHU_NOTIFY_AUTOPILOT ?? process.env.FEISHU_NOTIFY_AUTOPILOT) === 'true',
          notifyReview: (values.FEISHU_NOTIFY_REVIEW ?? process.env.FEISHU_NOTIFY_REVIEW) === 'true'
        };
        res.json({ success: true, config });
      } catch (err) {
        sendError(res, { status: 500, code: 'FEISHU_CONFIG_READ_FAILED', stage: 'system.feishu_config', error: '读取飞书配置失败', details: err.message });
      }
    },
    postFeishuConfig: (req, res) => {
      try {
        const { webhookUrl, notifyLoginStatus, notifyAutoPilot, notifyReview } = req.body;
        updateProjectEnv(baseDir, {
          FEISHU_WEBHOOK_URL: webhookUrl || '',
          FEISHU_NOTIFY_LOGIN_STATUS: notifyLoginStatus ? 'true' : 'false',
          FEISHU_NOTIFY_AUTOPILOT: notifyAutoPilot ? 'true' : 'false',
          FEISHU_NOTIFY_REVIEW: notifyReview ? 'true' : 'false'
        });

        res.json({ success: true, message: '配置已保存' });
      } catch (err) {
        sendError(res, { status: 500, code: 'FEISHU_CONFIG_WRITE_FAILED', stage: 'system.feishu_config', error: '保存飞书配置失败', details: err.message });
      }
    },
    getLoginCheckConfig: (_req, res) => {
      try {
        const { values } = readProjectEnv(baseDir);
        const config = {
          enabled: (values.LOGIN_CHECK_ENABLED ?? process.env.LOGIN_CHECK_ENABLED) !== 'false',
          intervalMinutes: parseInt(values.LOGIN_CHECK_INTERVAL_MINUTES ?? process.env.LOGIN_CHECK_INTERVAL_MINUTES, 10) || 30,
          retryTimes: parseInt(values.LOGIN_CHECK_RETRY_TIMES ?? process.env.LOGIN_CHECK_RETRY_TIMES, 10) || 3
        };
        res.json({ success: true, config });
      } catch (err) {
        sendError(res, { status: 500, code: 'LOGIN_CHECK_CONFIG_READ_FAILED', stage: 'system.login_check_config', error: '读取登录检测配置失败', details: err.message });
      }
    },
    postLoginCheckConfig: (req, res) => {
      try {
        const { enabled, intervalMinutes, retryTimes } = req.body;
        updateProjectEnv(baseDir, {
          LOGIN_CHECK_ENABLED: enabled ? 'true' : 'false',
          LOGIN_CHECK_INTERVAL_MINUTES: String(intervalMinutes || 30),
          LOGIN_CHECK_RETRY_TIMES: String(retryTimes || 3)
        });

        res.json({ success: true, message: '配置已保存，定时任务将在下次执行时生效' });
      } catch (err) {
        sendError(res, { status: 500, code: 'LOGIN_CHECK_CONFIG_WRITE_FAILED', stage: 'system.login_check_config', error: '保存登录检测配置失败', details: err.message });
      }
    },
    getLlmConfig: (_req, res) => {
      try {
        const { values } = readProjectEnv(baseDir);
        const provider = normalizeProvider(getEnvValue(values, 'LLM_PROVIDER', 'gemini'));
        const textProvider = normalizeProvider(
          getEnvValue(values, 'TEXT_LLM_PROVIDER', getEnvValue(values, 'SCRIPT_LLM_PROVIDER', provider)),
          provider
        );
        const config = {
          provider,
          textProvider,
          gemini: {
            apiKey: getEnvValue(values, 'GEMINI_API_KEY', ''),
            googleApiKey: getEnvValue(values, 'GOOGLE_API_KEY', ''),
            baseUrl: getEnvValue(values, 'GEMINI_API_BASE_URL', ''),
            model: getEnvValue(values, 'GEMINI_MODEL', 'gemini-2.5-flash'),
            reviewModel: getEnvValue(values, 'AI_REVIEW_GEMINI_MODEL', getEnvValue(values, 'GEMINI_MODEL', 'gemini-2.5-flash')),
            publishDescriptionModel: getEnvValue(values, 'PUBLISH_DESCRIPTION_GEMINI_MODEL', getEnvValue(values, 'GEMINI_MODEL', 'gemini-2.5-flash'))
          },
          qwen: {
            apiKey: getEnvValue(values, 'QWEN_API_KEY', getEnvValue(values, 'DASHSCOPE_API_KEY', '')),
            baseUrl: getEnvValue(values, 'QWEN_API_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
            vlModel: getEnvValue(values, 'QWEN_VL_MODEL', 'qwen3-vl-flash'),
            asrModel: getEnvValue(values, 'QWEN_ASR_MODEL', 'qwen3-asr-flash-filetrans'),
            textModel: getEnvValue(values, 'QWEN_TEXT_MODEL', 'qwen3.6-plus')
          },
          vertex: {
            authMode: normalizeVertexAuthMode(getEnvValue(values, 'VERTEX_AI_AUTH_MODE', 'adc')),
            apiKey: getEnvValue(values, 'VERTEX_AI_API_KEY', ''),
            project: getEnvValue(values, 'VERTEX_AI_PROJECT', getEnvValue(values, 'GCP_PROJECT', '')),
            location: getEnvValue(values, 'VERTEX_AI_LOCATION', 'us-central1')
          },
          deepseek: {
            apiKey: getEnvValue(values, 'DEEPSEEK_API_KEY', ''),
            baseUrl: getEnvValue(values, 'DEEPSEEK_API_BASE_URL', 'https://api.deepseek.com/v1'),
            textModel: getEnvValue(values, 'DEEPSEEK_TEXT_MODEL', 'deepseek-v4-pro')
          }
        };
        res.json({ success: true, config });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'LLM_CONFIG_READ_FAILED',
          stage: 'system.llm_config',
          error: '读取模型配置失败',
          details: err.message
        });
      }
    },
    postLlmConfig: (req, res) => {
      try {
        const { values } = readProjectEnv(baseDir);
        const provider = normalizeProvider(req.body?.provider || getEnvValue(values, 'LLM_PROVIDER', 'gemini'));
        const textProvider = normalizeProvider(
          req.body?.textProvider || getEnvValue(values, 'TEXT_LLM_PROVIDER', getEnvValue(values, 'SCRIPT_LLM_PROVIDER', provider)),
          provider
        );
        const gemini = req.body?.gemini || {};
        const qwen = req.body?.qwen || {};
        const vertex = req.body?.vertex || {};
        const deepseek = req.body?.deepseek || {};
        updateProjectEnv(baseDir, {
          LLM_PROVIDER: provider,
          TEXT_LLM_PROVIDER: textProvider,
          SCRIPT_LLM_PROVIDER: textProvider,
          GEMINI_API_KEY: gemini.apiKey || '',
          GOOGLE_API_KEY: gemini.googleApiKey || gemini.apiKey || '',
          GEMINI_API_BASE_URL: gemini.baseUrl || '',
          GEMINI_MODEL: gemini.model || 'gemini-2.5-flash',
          AI_REVIEW_GEMINI_MODEL: gemini.reviewModel || gemini.model || 'gemini-2.5-flash',
          PUBLISH_DESCRIPTION_GEMINI_MODEL: gemini.publishDescriptionModel || gemini.model || 'gemini-2.5-flash',
          QWEN_API_KEY: qwen.apiKey || '',
          DASHSCOPE_API_KEY: qwen.apiKey || '',
          QWEN_API_BASE_URL: qwen.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          QWEN_VL_MODEL: qwen.vlModel || 'qwen3-vl-flash',
          QWEN_ASR_MODEL: qwen.asrModel || 'qwen3-asr-flash-filetrans',
          QWEN_TEXT_MODEL: qwen.textModel || 'qwen3.6-plus',
          VERTEX_AI_AUTH_MODE: normalizeVertexAuthMode(vertex.authMode || getEnvValue(values, 'VERTEX_AI_AUTH_MODE', 'adc')),
          VERTEX_AI_API_KEY: vertex.apiKey || getEnvValue(values, 'VERTEX_AI_API_KEY', ''),
          VERTEX_AI_PROJECT: vertex.project || getEnvValue(values, 'VERTEX_AI_PROJECT', getEnvValue(values, 'GCP_PROJECT', '')),
          VERTEX_AI_LOCATION: vertex.location || getEnvValue(values, 'VERTEX_AI_LOCATION', 'us-central1'),
          DEEPSEEK_API_KEY: deepseek.apiKey || '',
          DEEPSEEK_API_BASE_URL: deepseek.baseUrl || 'https://api.deepseek.com/v1',
          DEEPSEEK_TEXT_MODEL: deepseek.textModel || 'deepseek-v4-pro'
        });

        res.json({
          success: true,
          message: '模型配置已保存，重启服务后将完全生效'
        });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'LLM_CONFIG_WRITE_FAILED',
          stage: 'system.llm_config',
          error: '保存模型配置失败',
          details: err.message
        });
      }
    }
  };
}

module.exports = {
  createSystemHandlers
};
