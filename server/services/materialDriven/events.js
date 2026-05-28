const path = require('path');
const { activeTasks, taskClients } = require('./sharedState');
const { nowIso, readJsonSafe } = require('./utils');

const PYTHON_PROTOCOL_PREFIX = '__CODEX_PYTHON__';
const STAGE_PROGRESS_MAP = {
  prepare: { step: 1, percent: 5, message: '步骤1: 准备素材文件' },
  analyze: { step: 2, percent: 18, message: '步骤2: 分析素材内容' },
  segment: { step: 3, percent: 36, message: '步骤3: 素材切片和评分' },
  planning: { step: 4, percent: 56, message: '步骤4: 编排规划' },
  narration: { step: 5, percent: 72, message: '步骤5: 重建脚本与口播稿' },
  avatar: { step: 6, percent: 86, message: '步骤6: 生成数字人' },
  mixing: { step: 7, percent: 92, message: '步骤7: 数字人解说渲染' }
};

function addTaskLog(task, message, type = 'info') {
  if (!task || !message) return;
  const line = {
    time: nowIso(),
    message: String(message).trim(),
    type
  };
  task.logs = Array.isArray(task.logs) ? [...task.logs, line].slice(-200) : [line];
  task.updatedAt = nowIso();
}

function collectStderr(task, chunk) {
  if (!task) return;
  const text = String(chunk || '');
  task.lastStderr = `${String(task.lastStderr || '')}${text}`.slice(-60000);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^chunk:\s*\d+/i.test(line))
    .filter((line) => !/^frame_index:\s*\d+/i.test(line))
    .slice(-6);
  for (const line of lines) {
    addTaskLog(task, line, 'warning');
  }
}

function summarizeFailureMessage(task, code) {
  const stderrTail = String(task?.lastStderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  const exitMsg = `进程退出，代码: ${code}`;
  if (!stderrTail) return exitMsg;
  return `${exitMsg}\n${stderrTail.slice(-3000)}`;
}

function emitTaskEvent(jobId, eventName, payload = {}) {
  const clients = taskClients.get(jobId);
  if (!clients || clients.size === 0) return;
  const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(body);
    } catch (_err) {}
  }
}

function buildNarrationSummary(task) {
  if (!task?.outputPath) return null;
  const narrationPath = path.join(task.outputPath, 'narration.json');
  const narration = readJsonSafe(narrationPath, null);
  if (!narration || typeof narration !== 'object') return null;

  const fullText = String(
    narration.full_text ||
    narration.fullText ||
    narration.text ||
    ''
  ).trim();
  const targetDuration = Number(
    narration.target_duration_sec ||
    narration.targetDuration ||
    narration.duration ||
    0
  );
  const charCount = Number(narration.char_count || narration.charCount || 0) || fullText.length;
  const speed = Number(narration.speed || 0) ||
    (targetDuration > 0 ? Number((charCount / targetDuration).toFixed(1)) : 0);

  if (!fullText && !targetDuration && !charCount) return null;
  return {
    targetDuration,
    charCount,
    speed,
    fullText
  };
}

function emitNarrationSummary(jobId, task) {
  const summary = buildNarrationSummary(task);
  if (!summary) return false;
  const summaryKey = JSON.stringify([
    summary.targetDuration,
    summary.charCount,
    summary.speed,
    summary.fullText
  ]);
  if (task.narrationSummaryKey === summaryKey) return false;
  task.narrationSummaryKey = summaryKey;
  task.narrationSummary = summary;
  emitTaskEvent(jobId, 'narration_summary', summary);
  return true;
}

function closeTaskClients(jobId) {
  const clients = taskClients.get(jobId);
  if (!clients) return;
  for (const res of clients) {
    try {
      res.end();
    } catch (_err) {}
  }
  taskClients.delete(jobId);
}

function parsePythonProtocolLine(line) {
  const text = String(line || '').trim();
  if (!text.startsWith(PYTHON_PROTOCOL_PREFIX)) return null;
  try {
    return JSON.parse(text.slice(PYTHON_PROTOCOL_PREFIX.length));
  } catch (_err) {
    return null;
  }
}

function applyPythonProtocolEvent(jobId, task, event = {}, options = {}) {
  const syncTaskState = typeof options.syncTaskState === 'function' ? options.syncTaskState : null;
  if (!task || !event || typeof event !== 'object') return;
  const type = String(event.type || '').trim();
  if (type === 'stage') {
    const stageKey = String(event.stage || '').trim();
    const stageMeta = STAGE_PROGRESS_MAP[stageKey] || null;
    const message = String(event.message || stageMeta?.message || stageKey || '阶段切换').trim();
    if (stageMeta) {
      task.currentStep = stageMeta.step;
      task.progress = Math.max(Number(task.progress || 0), stageMeta.percent);
    }
    task.statusText = message;
    task.updatedAt = nowIso();
    addTaskLog(task, message, 'info');
    if (syncTaskState) syncTaskState(task);
    if (stageMeta) {
      emitTaskEvent(jobId, 'step', { step: stageMeta.step, message });
      emitTaskEvent(jobId, 'progress', { percent: task.progress, message });
    }
    return;
  }
  if (type === 'result') {
    const message = String(event.message || '').trim();
    if (!message) return;
    task.statusText = message;
    task.updatedAt = nowIso();
    addTaskLog(task, message, 'success');
    if (syncTaskState) syncTaskState(task);
    emitTaskEvent(jobId, 'status', { message });
    return;
  }
  if (type === 'error') {
    const message = String(event.message || 'Python 脚本执行失败').trim();
    task.statusText = message;
    task.updatedAt = nowIso();
    addTaskLog(task, message, 'error');
    if (syncTaskState) syncTaskState(task, { error: message });
    emitTaskEvent(jobId, 'status', { message });
  }
}

function parseAndEmitProgress(jobId, output, options = {}) {
  const syncTaskState = typeof options.syncTaskState === 'function' ? options.syncTaskState : null;
  const task = activeTasks.get(jobId);
  const lines = output.split('\n');

  for (const line of lines) {
    const message = line.trim();
    if (!message) continue;
    const protocolEvent = parsePythonProtocolLine(message);
    if (protocolEvent) {
      applyPythonProtocolEvent(jobId, task, protocolEvent, { syncTaskState });
      continue;
    }
    if (task) {
      task.statusText = message;
      task.updatedAt = nowIso();
      addTaskLog(task, message, 'info');
      if (syncTaskState) syncTaskState(task);
    }

    const stepMatch = line.match(/步骤(\d+):/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      if (task) {
        task.currentStep = step;
        const mappedPercent = Object.values(STAGE_PROGRESS_MAP).find((item) => item.step === step)?.percent;
        if (Number.isFinite(mappedPercent)) {
          task.progress = Math.max(Number(task.progress || 0), mappedPercent);
        }
        if (syncTaskState) syncTaskState(task);
      }
      emitTaskEvent(jobId, 'step', {
        step,
        message
      });
      if (task) {
        emitTaskEvent(jobId, 'progress', {
          percent: Number(task.progress || 0),
          message
        });
      }
      continue;
    }

    const progressMatch = line.match(/(\d+)%/);
    if (progressMatch) {
      const percent = parseInt(progressMatch[1], 10);
      if (task) task.progress = percent;
      if (task && syncTaskState) syncTaskState(task);
      emitTaskEvent(jobId, 'progress', {
        percent,
        message
      });
      continue;
    }

    if (line.includes('规划摘要') || line.includes('编排摘要')) {
      const summaryMatch = output.match(/总时长:\s*([\d.]+)秒.*素材占比:\s*([\d.]+)%.*数字人占比:\s*([\d.]+)%/s);
      if (summaryMatch) {
        emitTaskEvent(jobId, 'plan_summary', {
          totalDuration: parseFloat(summaryMatch[1]),
          materialRatio: parseFloat(summaryMatch[2]),
          aimanRatio: parseFloat(summaryMatch[3])
        });
      } else {
        const segmentSummaryMatch = output.match(/已选素材段数:\s*(\d+).*素材总时长:\s*([\d.]+)秒/s);
        if (segmentSummaryMatch) {
          emitTaskEvent(jobId, 'plan_summary', {
            totalDuration: parseFloat(segmentSummaryMatch[2]),
            materialRatio: null,
            aimanRatio: null,
            segmentCount: parseInt(segmentSummaryMatch[1], 10)
          });
        }
      }
      continue;
    }

    if (line.includes('解说词摘要')) {
      const emittedFromFile = emitNarrationSummary(jobId, task);
      const summaryMatch = emittedFromFile
        ? null
        : output.match(/目标时长:\s*([\d.]+)秒.*字数:\s*(\d+)字.*语速:\s*([\d.]+)字\/秒/s);
      if (summaryMatch) {
        emitTaskEvent(jobId, 'narration_summary', {
          targetDuration: parseFloat(summaryMatch[1]),
          charCount: parseInt(summaryMatch[2], 10),
          speed: parseFloat(summaryMatch[3]),
          fullText: ''
        });
      }
      continue;
    }

    emitTaskEvent(jobId, 'status', { message });
  }
}

module.exports = {
  STAGE_PROGRESS_MAP,
  addTaskLog,
  buildNarrationSummary,
  collectStderr,
  emitNarrationSummary,
  summarizeFailureMessage,
  emitTaskEvent,
  closeTaskClients,
  parsePythonProtocolLine,
  applyPythonProtocolEvent,
  parseAndEmitProgress
};
