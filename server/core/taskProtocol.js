const fs = require('fs');
const path = require('path');

/**
 * 任务对象协议
 *
 * 统一 Node 和 Python 之间的任务通信格式，避免文件名耦合。
 *
 * 文件结构：
 * - task.json: 任务输入（Node 写入，Python 读取）
 * - result.json: 任务成功输出（Python 写入，Node 读取）
 * - failure.json: 任务失败输出（Python 写入，Node 读取）
 */

/**
 * 创建任务输入对象
 * @param {string} taskId - 任务 ID
 * @param {string} type - 任务类型（vertical_queue, pipeline, xai_top10, wechat_rpa）
 * @param {object} input - 任务输入参数
 * @param {string} workDir - 工作目录
 * @returns {object} 任务输入对象
 */
function createTaskInput(taskId, type, input, workDir) {
  return {
    taskId,
    type,
    input: input || {},
    workDir: workDir || '',
    createdAt: new Date().toISOString()
  };
}

/**
 * 创建任务成功输出对象
 * @param {string} taskId - 任务 ID
 * @param {object} artifacts - 产物清单（文件名映射）
 * @param {object} metadata - 元数据
 * @returns {object} 任务成功输出对象
 */
function createTaskResult(taskId, artifacts, metadata) {
  return {
    taskId,
    status: 'success',
    artifacts: artifacts || {},
    metadata: metadata || {},
    completedAt: new Date().toISOString()
  };
}

/**
 * 创建任务失败输出对象
 * @param {string} taskId - 任务 ID
 * @param {object} error - 错误信息
 * @returns {object} 任务失败输出对象
 */
function createTaskFailure(taskId, error) {
  return {
    taskId,
    status: 'failed',
    error: {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'Unknown error',
      stage: error.stage || 'unknown',
      details: error.details || ''
    },
    failedAt: new Date().toISOString()
  };
}

/**
 * 写入任务输入文件
 * @param {string} workDir - 工作目录
 * @param {object} taskInput - 任务输入对象
 */
function writeTaskInput(workDir, taskInput) {
  const taskPath = path.join(workDir, 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(taskInput, null, 2), 'utf-8');
}

/**
 * 读取任务输入文件
 * @param {string} workDir - 工作目录
 * @returns {object|null} 任务输入对象，不存在返回 null
 */
function readTaskInput(workDir) {
  const taskPath = path.join(workDir, 'task.json');
  if (!fs.existsSync(taskPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

/**
 * 写入任务结果文件
 * @param {string} workDir - 工作目录
 * @param {object} taskResult - 任务结果对象
 */
function writeTaskResult(workDir, taskResult) {
  const resultPath = path.join(workDir, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify(taskResult, null, 2), 'utf-8');
}

/**
 * 读取任务结果文件
 * @param {string} workDir - 工作目录
 * @returns {object|null} 任务结果对象，不存在返回 null
 */
function readTaskResult(workDir) {
  const resultPath = path.join(workDir, 'result.json');
  if (!fs.existsSync(resultPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

/**
 * 写入任务失败文件
 * @param {string} workDir - 工作目录
 * @param {object} taskFailure - 任务失败对象
 */
function writeTaskFailure(workDir, taskFailure) {
  const failurePath = path.join(workDir, 'failure.json');
  fs.writeFileSync(failurePath, JSON.stringify(taskFailure, null, 2), 'utf-8');
}

/**
 * 读取任务失败文件
 * @param {string} workDir - 工作目录
 * @returns {object|null} 任务失败对象，不存在返回 null
 */
function readTaskFailure(workDir) {
  const failurePath = path.join(workDir, 'failure.json');
  if (!fs.existsSync(failurePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(failurePath, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

/**
 * 读取任务输出（优先读取 result.json，回退到 failure.json）
 * @param {string} workDir - 工作目录
 * @returns {object|null} 任务输出对象，不存在返回 null
 */
function readTaskOutput(workDir) {
  const result = readTaskResult(workDir);
  if (result) {
    return result;
  }
  return readTaskFailure(workDir);
}

/**
 * 检查任务是否完成（成功或失败）
 * @param {string} workDir - 工作目录
 * @returns {boolean} 是否完成
 */
function isTaskCompleted(workDir) {
  return fs.existsSync(path.join(workDir, 'result.json')) ||
         fs.existsSync(path.join(workDir, 'failure.json'));
}

/**
 * 解析产物路径（相对路径转绝对路径）
 * @param {string} workDir - 工作目录
 * @param {object} artifacts - 产物清单
 * @returns {object} 绝对路径的产物清单
 */
function resolveArtifactPaths(workDir, artifacts) {
  const resolved = {};
  for (const [key, value] of Object.entries(artifacts || {})) {
    if (typeof value === 'string') {
      resolved[key] = path.isAbsolute(value) ? value : path.join(workDir, value);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

module.exports = {
  createTaskInput,
  createTaskResult,
  createTaskFailure,
  writeTaskInput,
  readTaskInput,
  writeTaskResult,
  readTaskResult,
  writeTaskFailure,
  readTaskFailure,
  readTaskOutput,
  isTaskCompleted,
  resolveArtifactPaths
};
