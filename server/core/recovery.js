/**
 * 任务恢复服务
 *
 * 职责：
 * - 服务启动时扫描中断的任务
 * - 检查进程是否存活
 * - 标记中断任务
 * - 自动或手动恢复任务
 */

const fs = require('fs');
const path = require('path');

function createRecoveryService(deps) {
  const {
    taskStore,
    verticalQueueService,
    materialDrivenStarter
  } = deps;

  // 恢复配置
  const config = {
    enabled: true,
    autoRecovery: {
      enabled: true,
      maxRetries: 3,
      retryDelay: 5000, // 5 秒后重试
      taskTypes: ['vertical_queue', 'xai_top10', 'avatar_generation']
    },
    manualRecovery: {
      taskTypes: ['material_driven', 'avatar_generation', 'standalone_vertical', 'wechat_rpa', 'publish', 'publish_platform']
    },
    heartbeatTimeout: 300000 // 5 分钟无心跳视为死亡
  };

  // 存储所有未完成的定时器，用于清理
  const pendingTimers = new Set();

  /**
   * 扫描中断的任务
   * 查找所有 running/in_progress 状态的任务
   */
  function scanInterruptedTasks() {
    try {
      const activeTasks = taskStore.listActiveTasks();
      let storedInterrupted = [];
      if (taskStore.db && typeof taskStore.db.prepare === 'function') {
        storedInterrupted = taskStore.db.prepare(`
          SELECT * FROM tasks WHERE status = 'interrupted' ORDER BY updatedAt DESC LIMIT 100
        `).all().map((row) => taskStore.rowToTask(row));
      }
      const byId = new Map();
      for (const task of [...activeTasks, ...storedInterrupted]) {
        if (task?.id) byId.set(task.id, task);
      }
      const interrupted = Array.from(byId.values()).filter(task =>
        task.status === 'running' || task.status === 'in_progress' || task.status === 'interrupted'
      );
      return interrupted;
    } catch (err) {
      console.error('[Recovery] 扫描中断任务失败:', err);
      return [];
    }
  }

  /**
   * 检查进程是否存活
   * 基于心跳时间判断
   */
  function isProcessAlive(task) {
    if (!task.updatedAt) return false;

    const lastUpdate = new Date(task.updatedAt).getTime();
    const now = Date.now();
    const elapsed = now - lastUpdate;

    // 如果超过心跳超时时间，认为进程已死亡
    return elapsed < config.heartbeatTimeout;
  }

  /**
   * 获取恢复策略
   */
  function getRecoveryStrategy(task) {
    const taskType = task.type || '';

    // 检查是否在自动恢复列表中
    if (config.autoRecovery.taskTypes.includes(taskType)) {
      return 'auto';
    }

    // 检查是否在手动恢复列表中
    if (config.manualRecovery.taskTypes.includes(taskType)) {
      return 'manual';
    }

    // 默认手动恢复
    return 'manual';
  }

  /**
   * 标记任务为中断
   */
  function markAsInterrupted(task, reason = 'service_restart') {
    try {
      const strategy = getRecoveryStrategy(task);

      taskStore.updateTask(task.id, {
        status: 'interrupted',
        message: `任务中断: ${reason}`,
        metadata: {
          ...task.metadata,
          interruptedAt: new Date().toISOString(),
          interruptReason: reason,
          recoveryStrategy: strategy,
          retryCount: task.metadata?.retryCount || 0
        }
      });

      taskStore.appendLog(task.id, `[Recovery] 任务被标记为中断 (原因: ${reason}, 策略: ${strategy})`);

      return { success: true, strategy };
    } catch (err) {
      console.error(`[Recovery] 标记任务 ${task.id} 为中断失败:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 自动恢复任务
   */
  async function autoRecoverTask(task) {
    const retryCount = task.metadata?.retryCount || 0;

    // 检查是否超过最大重试次数
    if (retryCount >= config.autoRecovery.maxRetries) {
      taskStore.updateTask(task.id, {
        status: 'failed',
        message: `任务恢复失败: 已达到最大重试次数 (${config.autoRecovery.maxRetries})`,
        metadata: {
          ...task.metadata,
          recoveryFailed: true,
          recoveryFailedAt: new Date().toISOString()
        }
      });

      taskStore.appendLog(task.id, '[Recovery] 自动恢复失败: 已达到最大重试次数');

      return { success: false, action: 'max_retries_exceeded' };
    }

    if (task.type === 'avatar_generation') {
      return recoverAvatarGenerationTask(task, retryCount);
    }

    // 重置任务状态为 pending
    taskStore.updateTask(task.id, {
      status: 'pending',
      progress: 0,
      message: '任务已自动恢复，等待重新执行',
      metadata: {
        ...task.metadata,
        retryCount: retryCount + 1,
        lastRecoveryAt: new Date().toISOString(),
        recoveryAttempt: (task.metadata?.recoveryAttempt || 0) + 1
      }
    });

    taskStore.appendLog(task.id, `[Recovery] 任务已自动恢复 (重试次数: ${retryCount + 1}/${config.autoRecovery.maxRetries})`);

    // 根据任务类型重新入队
    if (task.type === 'vertical_queue' && verticalQueueService) {
      try {
        if (typeof verticalQueueService.recoverPersistedJobs === 'function') {
          const timerId = setTimeout(() => {
            pendingTimers.delete(timerId);
            try {
              verticalQueueService.recoverPersistedJobs({ includeCompletedArtifacts: false });
              console.log(`[Recovery] 任务 ${task.id} 已按原任务 ID 恢复竖屏队列`);
            } catch (err) {
              console.error('[Recovery] 竖屏队列恢复失败:', err);
            }
          }, config.autoRecovery.retryDelay);
          pendingTimers.add(timerId);
        } else {
          taskStore.updateTask(task.id, {
            status: 'interrupted',
            message: '竖屏任务缺少原地恢复能力，等待手动恢复',
            metadata: {
              ...task.metadata,
              awaitingManualRecovery: true,
              manualRecoveryRequiredAt: new Date().toISOString()
            }
          });
          return { success: true, action: 'awaiting_manual_recovery' };
        }
      } catch (err) {
        console.error(`[Recovery] 自动恢复任务 ${task.id} 失败:`, err);
        return { success: false, action: 'requeue_failed', error: err.message };
      }
    }

    if (task.type === 'standalone_vertical') {
      taskStore.updateTask(task.id, {
        status: 'interrupted',
        message: '单条竖屏任务在服务重启时中断，请从面板恢复或重试',
        metadata: {
          ...task.metadata,
          awaitingManualRecovery: true,
          manualRecoveryRequiredAt: new Date().toISOString()
        }
      });
      return { success: true, action: 'awaiting_manual_recovery' };
    }

    return { success: true, action: 'auto_recovered' };
  }

  function getMaterialJobIdFromTask(task) {
    const outputDir = String(task.metadata?.outputDir || '').trim();
    if (outputDir) return outputDir.replace(/^material_/, '');
    const outputPath = String(task.metadata?.outputPath || '').trim();
    if (outputPath) return path.basename(outputPath).replace(/^material_/, '');
    const sourceKey = String(task.metadata?.sourceMaterialTaskKey || '').trim();
    return sourceKey.replace(/^material:/, '').replace(/^material_/, '');
  }

  function ensureRunningHubStateFile(task) {
    const metadata = task.metadata || {};
    const provider = String(metadata.provider || '').trim().toLowerCase();
    const providerTaskId = String(metadata.providerTaskId || '').trim();
    const outputPath = String(metadata.outputPath || '').trim();
    if (provider !== 'runninghub' || !providerTaskId || !outputPath) return false;

    const statePath = path.join(outputPath, 'avatar_render_state.json');
    let existing = {};
    try {
      if (fs.existsSync(statePath)) {
        existing = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      }
    } catch (_err) {
      existing = {};
    }

    const state = {
      ...existing,
      provider: 'runninghub',
      status: String(existing.status || metadata.stage || 'polling_interrupted').trim(),
      resumeKey: existing.resumeKey || metadata.resumeKey || '',
      taskId: providerTaskId,
      videoUrl: existing.videoUrl || metadata.videoUrl || '',
      remoteAudioName: existing.remoteAudioName || metadata.remoteAudioName || '',
      remoteImageName: existing.remoteImageName || metadata.remoteImageName || '',
      remotePoseName: existing.remotePoseName || metadata.remotePoseName || '',
      nodeInfoList: Array.isArray(existing.nodeInfoList) ? existing.nodeInfoList : [],
      error: ''
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    return true;
  }

  async function recoverAvatarGenerationTask(task, retryCount) {
    if (!materialDrivenStarter || typeof materialDrivenStarter.continueOneClick !== 'function') {
      return manualRecoverTask(task);
    }

    const jobId = getMaterialJobIdFromTask(task);
    const outputDir = String(task.metadata?.outputDir || '').trim();
    if (!jobId || !outputDir || !ensureRunningHubStateFile(task)) {
      taskStore.updateTask(task.id, {
        status: 'interrupted',
        message: '数字人任务缺少恢复信息，等待手动恢复',
        metadata: {
          ...task.metadata,
          awaitingManualRecovery: true,
          manualRecoveryRequiredAt: new Date().toISOString()
        }
      });
      taskStore.appendLog(task.id, '[Recovery] 数字人任务缺少 RunningHub taskId 或输出目录，无法自动恢复');
      return { success: true, action: 'awaiting_manual_recovery' };
    }

    taskStore.updateTask(task.id, {
      status: 'running',
      progress: Math.max(Number(task.progress || 0), 86),
      message: '正在恢复未完成的数字人合成任务...',
      metadata: {
        ...task.metadata,
        retryCount: retryCount + 1,
        lastRecoveryAt: new Date().toISOString(),
        recoveryAttempt: (task.metadata?.recoveryAttempt || 0) + 1,
        recoveryStrategy: 'auto'
      }
    });
    taskStore.appendLog(task.id, '[Recovery] 已恢复未完成数字人任务，将继续查询 RunningHub 并接续混剪');

    await materialDrivenStarter.continueOneClick(jobId, outputDir, { useCache: true });
    return { success: true, action: 'avatar_continue_started' };
  }

  /**
   * 手动恢复任务（标记为等待用户操作）
   */
  function manualRecoverTask(task) {
    taskStore.updateTask(task.id, {
      status: 'interrupted',
      message: '任务中断，等待手动恢复',
      metadata: {
        ...task.metadata,
        awaitingManualRecovery: true,
        manualRecoveryRequiredAt: new Date().toISOString()
      }
    });

    taskStore.appendLog(task.id, '[Recovery] 任务需要手动恢复');

    return { success: true, action: 'awaiting_manual_recovery' };
  }

  /**
   * 恢复单个任务
   */
  async function recoverTask(task) {
    const strategy = task.metadata?.recoveryStrategy || getRecoveryStrategy(task);

    if (strategy === 'auto' && config.autoRecovery.enabled) {
      return await autoRecoverTask(task);
    } else {
      return manualRecoverTask(task);
    }
  }

  /**
   * 启动时恢复所有中断的任务
   */
  async function recoverOnStartup() {
    if (!config.enabled) {
      console.log('[Recovery] 恢复服务已禁用');
      return [];
    }

    console.log('[Recovery] 开始扫描中断的任务...');

    const interrupted = scanInterruptedTasks();

    if (interrupted.length === 0) {
      console.log('[Recovery] 未发现中断的任务');
      return [];
    }

    console.log(`[Recovery] 发现 ${interrupted.length} 个中断的任务`);

    const results = [];

    for (const task of interrupted) {
      if (task.status === 'interrupted') {
        const recoverResult = await recoverTask(task);
        results.push({
          taskId: task.id,
          type: task.type,
          strategy: task.metadata?.recoveryStrategy || getRecoveryStrategy(task),
          ...recoverResult
        });
        continue;
      }

      const isAlive = isProcessAlive(task);

      if (!isAlive) {
        console.log(`[Recovery] 任务 ${task.id} (${task.type}) 进程已死亡，开始恢复...`);

        // 标记为中断
        const markResult = markAsInterrupted(task, 'service_restart');

        if (markResult.success) {
          // 尝试恢复
          const recoverResult = await recoverTask(task);
          results.push({
            taskId: task.id,
            type: task.type,
            strategy: markResult.strategy,
            ...recoverResult
          });
        } else {
          results.push({
            taskId: task.id,
            type: task.type,
            success: false,
            action: 'mark_failed',
            error: markResult.error
          });
        }
      } else {
        console.log(`[Recovery] 任务 ${task.id} (${task.type}) 进程仍在运行，跳过恢复`);
        results.push({
          taskId: task.id,
          type: task.type,
          success: true,
          action: 'still_alive'
        });
      }
    }

    return results;
  }

  /**
   * 手动重试中断的任务
   */
  async function manualRetry(taskId) {
    const task = taskStore.getTask(taskId);

    if (!task) {
      throw new Error('任务不存在');
    }

    if (task.status !== 'interrupted') {
      throw new Error('只能重试中断的任务');
    }

    if (task.type === 'avatar_generation') {
      taskStore.appendLog(taskId, '[Recovery] 用户手动恢复数字人任务');
      const result = await recoverAvatarGenerationTask(task, task.metadata?.retryCount || 0);
      return {
        success: true,
        message: '数字人任务已恢复执行',
        action: result.action
      };
    }

    // 重置状态并恢复
    taskStore.updateTask(taskId, {
      status: 'pending',
      progress: 0,
      message: '任务已手动重试',
      metadata: {
        ...task.metadata,
        manualRetryAt: new Date().toISOString(),
        retryCount: (task.metadata?.retryCount || 0) + 1
      }
    });

    taskStore.appendLog(taskId, '[Recovery] 任务已手动重试');

    // 根据任务类型重新入队
    if (task.type === 'vertical_queue' && verticalQueueService) {
      if (typeof verticalQueueService.recoverPersistedJobs === 'function') {
        verticalQueueService.recoverPersistedJobs({ includeCompletedArtifacts: false });
      } else {
        taskStore.updateTask(taskId, {
          status: 'interrupted',
          message: '竖屏任务缺少原地恢复能力，等待手动恢复',
          metadata: {
            ...task.metadata,
            awaitingManualRecovery: true,
            manualRecoveryRequiredAt: new Date().toISOString()
          }
        });
        return { success: true, message: '任务等待手动恢复', action: 'awaiting_manual_recovery' };
      }
    }

    return { success: true, message: '任务已按原 ID 重新入队' };
  }

  /**
   * 取消中断的任务
   */
  function cancelInterrupted(taskId) {
    const task = taskStore.getTask(taskId);

    if (!task) {
      throw new Error('任务不存在');
    }

    if (task.status !== 'interrupted') {
      throw new Error('只能取消中断的任务');
    }

    taskStore.updateTask(taskId, {
      status: 'cancelled',
      message: '用户已取消中断的任务',
      completedAt: new Date().toISOString()
    });

    taskStore.appendLog(taskId, '[Recovery] 任务已取消');

    return { success: true, message: '任务已取消' };
  }

  /**
   * 获取恢复状态
   */
  function getRecoveryStatus() {
    const interrupted = scanInterruptedTasks();
    const interruptedTasks = interrupted.map(task => ({
      id: task.id,
      type: task.type,
      status: task.status,
      progress: task.progress,
      message: task.message,
      interruptedAt: task.metadata?.interruptedAt,
      recoveryStrategy: task.metadata?.recoveryStrategy,
      retryCount: task.metadata?.retryCount || 0,
      maxRetries: config.autoRecovery.maxRetries
    }));

    return {
      enabled: config.enabled,
      interruptedCount: interrupted.length,
      tasks: interruptedTasks
    };
  }

  /**
   * 清理所有未完成的定时器
   * 用于测试清理和服务关闭
   */
  function cleanup() {
    for (const timerId of pendingTimers) {
      clearTimeout(timerId);
    }
    pendingTimers.clear();
  }

  return {
    scanInterruptedTasks,
    markAsInterrupted,
    recoverTask,
    recoverOnStartup,
    manualRetry,
    cancelInterrupted,
    getRecoveryStatus,
    cleanup
  };
}

module.exports = { createRecoveryService };
