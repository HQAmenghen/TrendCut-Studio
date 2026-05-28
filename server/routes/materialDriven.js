/**
 * 素材驱动工作流 API 路由
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { makeJobId, ensureDir } = require('../core/runtime');
const { resolveAvatarRenderProvider } = require('../services/pipeline/avatarRenderer');
const { activeTasks } = require('../services/materialDriven/sharedState');
const { createMaterialDrivenTaskRegistry } = require('../services/materialDriven/taskRegistry');
const { createAvatarGenerationService, probeRunningHubConfig, readAvatarConfigFromBody } = require('../services/materialDriven/avatarGeneration');
const { createMaterialDrivenPipelineRunner } = require('../services/materialDriven/pipelineProcess');
const { downloadMaterialFromUrl, probeComfyUI } = require('../services/materialDriven/materialDownload');
const { addTaskLog } = require('../services/materialDriven/events');
const { normalizeSourceMeta } = require('../services/materialDriven/taskState');
const { formatBytes, nowIso } = require('../services/materialDriven/utils');
const runtime = require('../config/runtime');

function parseObjectPayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function readSourceMetaFromBody(body = {}) {
  const sourceMetaPayload = parseObjectPayload(body.sourceMeta);
  return normalizeSourceMeta({
    ...sourceMetaPayload,
    sourceAuthor: body.sourceAuthor || body.source_author || body.author || body.postAuthor || sourceMetaPayload.sourceAuthor,
    sourcePostId: body.sourcePostId || body.source_post_id || body.postId || body.post_id || sourceMetaPayload.sourcePostId,
    sourcePartitionId: body.sourcePartitionId || body.source_partition_id || sourceMetaPayload.sourcePartitionId,
    sourcePartitionLabel: body.sourcePartitionLabel || body.source_partition_label || sourceMetaPayload.sourcePartitionLabel,
    sourceRank: body.sourceRank || body.source_rank || sourceMetaPayload.sourceRank,
    videoUrl: body.materialUrl || body.videoUrl || sourceMetaPayload.videoUrl,
    postUrl: body.sourcePostUrl || body.postUrl || body.post_url || sourceMetaPayload.postUrl
  });
}

/**
 * 注册素材驱动工作流路由
 */
function registerMaterialDrivenRoutes(app, paths, deps = {}) {
  const upload = multer({ dest: paths.UPLOADS_DIR });
  const taskStore = deps.taskStore || null;
  const taskRegistry = deps.taskRegistry || createMaterialDrivenTaskRegistry(paths, { taskStore });
  const avatarGeneration = deps.avatarGeneration || createAvatarGenerationService({
    paths,
    persistTaskStateSnapshot: taskRegistry.persistTaskStateSnapshot,
    taskStore
  });
  const pipelineRunner = deps.pipelineRunner || createMaterialDrivenPipelineRunner({
    autoGenerateAvatar: avatarGeneration.autoGenerateAvatar,
    taskStore
  });

  app.post('/api/material-driven/test-comfy', async (req, res) => {
    try {
      const cfg = readAvatarConfigFromBody(req.body || {});
      const provider = resolveAvatarRenderProvider(cfg);
      const result = provider === 'runninghub'
        ? probeRunningHubConfig(cfg)
        : await probeComfyUI(String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL || '').trim());
      res.json({
        success: true,
        ...result,
        message: provider === 'runninghub' ? 'RunningHub 配置有效' : 'ComfyUI 连通正常'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error?.message || '渲染服务连通性检测失败'
      });
    }
  });

  // 启动素材驱动工作流
  app.post('/api/material-driven/start', upload.fields([
    { name: 'material', maxCount: 1 },
    { name: 'audioFile', maxCount: 1 },
    { name: 'imageFile', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const materialFile = req.files?.material?.[0];
      const audioUploadFile = req.files?.audioFile?.[0];
      const imageUploadFile = req.files?.imageFile?.[0];
      const materialUrl = req.body.materialUrl;

      if (!materialFile && !materialUrl) {
        return res.status(400).json({ error: '未上传素材文件或外部链接' });
      }

      const jobId = makeJobId();
      const useSmartClip = req.body.useSmartClip === 'true';
      const useCache = req.body.useCache !== 'false';
      const manualScript = String(req.body.manualScript || '').trim();
      const autoGenerate = req.body.autoGenerate === 'true';
      const outputDir = req.body.outputDir || `material_${jobId}`;
      const sourceTitle = String(req.body.sourceTitle || req.body.title || req.body.postTitle || '').trim();
      const sourceBody = String(
        req.body.sourceBody
          || req.body.sourceSummary
          || req.body.summary
          || req.body.postText
          || req.body.text
          || ''
      ).trim();
      const sourceAuthor = String(req.body.sourceAuthor || req.body.author || req.body.postAuthor || '').trim();
      const sourcePostId = String(req.body.sourcePostId || req.body.postId || req.body.post_id || '').trim();
      const sourcePostUrl = String(req.body.sourcePostUrl || '').trim();
      const sourceMeta = readSourceMetaFromBody(req.body || {});

      const outputPath = path.join(paths.PROJECTS_DIR, outputDir);
      await ensureDir(outputPath);

      if (manualScript) {
        fs.writeFileSync(path.join(outputPath, 'manual_narration.txt'), manualScript, 'utf-8');
      }

      const sourcePostPayload = {
        title: sourceTitle,
        body: sourceBody,
        author: sourceAuthor,
        postId: sourcePostId,
        postUrl: sourcePostUrl,
        materialUrl: String(materialUrl || '').trim(),
        sourcePartitionId: sourceMeta.sourcePartitionId,
        sourcePartitionLabel: sourceMeta.sourcePartitionLabel,
        sourceRank: sourceMeta.sourceRank,
        sourceMeta,
        savedAt: nowIso()
      };
      try {
        fs.writeFileSync(
          path.join(outputPath, 'source_post.json'),
          JSON.stringify(sourcePostPayload, null, 2),
          'utf8'
        );
      } catch (_err) {
        // ignore source post persistence errors
      }

      const materialPath = path.join(outputPath, 'material.mp4');
      if (materialFile) {
        console.log(`[material-driven] ${jobId} received upload: ${materialFile.originalname} (${formatBytes(materialFile.size)})`);
        fs.renameSync(materialFile.path, materialPath);
      } else if (materialUrl) {
        console.log(`[material-driven] ${jobId} downloading material from URL: ${materialUrl}`);
        await downloadMaterialFromUrl({
          url: materialUrl,
          outputPath: materialPath,
          jobId
        });
      }

      const task = {
        id: jobId,
        process: null,
        outputPath,
        useSmartClip,
        useCache,
        autoGenerate,
        allowRuleFallback: true,
        status: 'running',
        currentStep: 1,
        progress: 2,
        statusText: '素材已接收，准备启动工作流',
        logs: [],
        startedAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: null,
        error: '',
        videoUrl: '',
        outputDir,
        lastStdout: '',
        lastStderr: '',
        sourceMeta,
        avatarConfig: {
          ...readAvatarConfigFromBody(req.body),
          audioUploadPath: audioUploadFile?.path || '',
          imageUploadPath: imageUploadFile?.path || ''
        },
        sourcePost: sourcePostPayload
      };

      taskRegistry.persistTaskStateSnapshot(task);
      addTaskLog(task, '工作流已启动');
      addTaskLog(task, `任务目录: ${outputDir}`, 'info');
      addTaskLog(task, `素材文件已就位: ${path.basename(materialPath)} (${formatBytes(fs.statSync(materialPath).size)})`, 'success');
      addTaskLog(task, `启动参数: smartClip=${useSmartClip ? 'on' : 'off'}, cache=${useCache ? 'on' : 'off'}, autoGenerate=${autoGenerate ? 'on' : 'off'}, manualScript=${manualScript ? 'on' : 'off'}`, 'info');
      if (sourceTitle) {
        addTaskLog(task, `素材来源标题: ${sourceTitle.slice(0, 80)}`, 'info');
      }
      if (sourcePostUrl) {
        addTaskLog(task, `素材来源链接: ${sourcePostUrl}`, 'info');
      }
      activeTasks.set(jobId, task);

      try {
        pipelineRunner.startInitialPipeline(jobId, task);
      } catch (spawnError) {
        activeTasks.delete(jobId);
        throw spawnError;
      }

      res.json({
        jobId,
        outputPath: outputDir,
        message: '工作流已启动'
      });
    } catch (error) {
      console.error('启动工作流失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 查询任务状态（支持刷新后恢复）
  app.get('/api/material-driven/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const task = taskRegistry.resolveTask(jobId, req.query?.outputPath);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }
    res.json(taskRegistry.buildStatusPayload(task));
  });

  app.get('/api/material-driven/active', (_req, res) => {
    res.json({
      success: true,
      tasks: taskRegistry.listActiveStatusPayloads()
    });
  });

  app.get('/api/material-driven/latest-completed', (_req, res) => {
    res.json({
      success: true,
      task: taskRegistry.getLatestCompletedStatusPayload()
    });
  });

  // SSE进度监听
  app.get('/api/material-driven/progress/:jobId', (req, res) => {
    taskRegistry.attachProgressClient(req.params.jobId, req, res);
  });

  // 继续工作流（从步骤6开始，确保先生成 avatar_segments / execution_plan）
  app.post('/api/material-driven/continue/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const task = taskRegistry.resolveTask(jobId, req.body?.outputPath);

      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }

      const runState = pipelineRunner.continueFromAvatarStep(jobId, task) || {};

      res.json({
        success: true,
        reused: Boolean(runState.reused),
        alreadyRunning: Boolean(runState.alreadyRunning),
        message: runState.message || '继续执行',
        task: taskRegistry.buildStatusPayload(task).task
      });
    } catch (error) {
      console.error('继续工作流失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 重试步骤
  app.post('/api/material-driven/retry/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const { step } = req.body;
      const task = taskRegistry.resolveTask(jobId, req.body?.outputPath);

      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }

      if (req.body.avatarConfig) {
        task.avatarConfig = { ...(task.avatarConfig || {}), ...req.body.avatarConfig };
        taskRegistry.persistTaskStateSnapshot(task);
        addTaskLog(task, `重试配置已更新: ${req.body.avatarConfig.serverUrl || '保持原地址'}`, 'info');
      }

      const runState = pipelineRunner.startRetryPipeline(jobId, task, step) || {};

      res.json({
        success: true,
        reused: Boolean(runState.reused),
        alreadyRunning: Boolean(runState.alreadyRunning),
        message: runState.message || '重试已启动',
        task: taskRegistry.buildStatusPayload(task).task
      });
    } catch (error) {
      console.error('重试失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/material-driven/rebuild/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const task = taskRegistry.resolveTask(jobId, req.body?.outputPath);
      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }
      task.useCache = req.body?.useCache !== false && req.body?.useCache !== 'false';
      const runState = pipelineRunner.spawnPipeline(jobId, task, 5, {
        step: 5,
        progressValue: 76,
        statusText: '正在从口播脚本开始重建剪辑计划',
        startLog: '手动触发：从步骤5重建脚本、映射与执行计划',
        stepMessage: '步骤5: 重建脚本与执行计划'
      }) || {};
      res.json({
        success: true,
        reused: Boolean(runState.reused),
        alreadyRunning: Boolean(runState.alreadyRunning),
        message: runState.message || '已开始重建剪辑计划',
        task: taskRegistry.buildStatusPayload(task).task
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/material-driven/rerender/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const task = taskRegistry.resolveTask(jobId, req.body?.outputPath);
      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }
      task.useCache = req.body?.useCache !== false && req.body?.useCache !== 'false';
      const runState = pipelineRunner.spawnPipeline(jobId, task, 7, {
        step: 7,
        progressValue: 90,
        statusText: '正在根据当前执行计划重新渲染',
        startLog: '手动触发：重新渲染成片',
        stepMessage: '步骤7: 重新渲染成片'
      }) || {};
      res.json({
        success: true,
        reused: Boolean(runState.reused),
        alreadyRunning: Boolean(runState.alreadyRunning),
        message: runState.message || '已开始重新渲染成片',
        task: taskRegistry.buildStatusPayload(task).task
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerMaterialDrivenRoutes };
