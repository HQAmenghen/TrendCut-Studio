/**
 * 失败摘要工具模块
 *
 * 提供统一的失败摘要数据结构和生成函数，用于快速排障。
 */

/**
 * 创建标准的失败摘要对象
 *
 * @param {Object} options - 失败摘要选项
 * @param {string} options.module - 模块名称（如 'vertical_queue', 'publish_wechat', 'review', 'pipeline'）
 * @param {string} options.stage - 失败阶段（如 'download', 'render', 'upload', 'login'）
 * @param {string} options.errorCode - 错误码
 * @param {string} options.errorMessage - 错误消息
 * @param {string} [options.details] - 详细信息
 * @param {string} [options.hint] - 排障建议
 * @param {Array<string>} [options.stderrTail] - stderr 尾部日志
 * @param {Array<string>} [options.stdoutTail] - stdout 尾部日志
 * @param {number} [options.exitCode] - 进程退出码
 * @param {boolean} [options.retryable] - 是否可重试
 * @param {Object} [options.context] - 额外上下文信息
 * @returns {Object} 标准失败摘要对象
 */
function createFailureSummary(options) {
  const {
    module,
    stage,
    errorCode,
    errorMessage,
    details = '',
    hint = '',
    stderrTail = [],
    stdoutTail = [],
    exitCode = null,
    retryable = true,
    context = {}
  } = options;

  return {
    failedAt: new Date().toISOString(),
    module: String(module || 'unknown'),
    stage: String(stage || 'unknown'),
    errorCode: String(errorCode || 'UNKNOWN_ERROR'),
    errorMessage: String(errorMessage || '未知错误'),
    details: String(details),
    hint: String(hint),
    stderrTail: Array.isArray(stderrTail) ? stderrTail.slice(-20) : [],
    stdoutTail: Array.isArray(stdoutTail) ? stdoutTail.slice(-12) : [],
    exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : null,
    retryable: Boolean(retryable),
    context: context && typeof context === 'object' ? context : {}
  };
}

/**
 * 从 Python 错误创建失败摘要
 *
 * @param {Object} error - Python 错误对象
 * @param {string} module - 模块名称
 * @param {Object} [options] - 额外选项
 * @returns {Object} 失败摘要对象
 */
function createFailureSummaryFromPythonError(error, module, options = {}) {
  const sanitizeLines = (text) => {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  const stderrTail = sanitizeLines(error?.stderr || '').slice(-20);
  const stdoutTail = sanitizeLines(error?.stdout || '').slice(-12);

  // 尝试从错误中提取排障建议
  let hint = String(error?.hint || '');
  if (!hint && error?.code) {
    hint = generateHintFromErrorCode(error.code);
  }

  // 判断是否可重试
  let retryable = true;
  const nonRetryableCodes = [
    'FILE_NOT_FOUND',
    'INVALID_CONFIG',
    'PERMISSION_DENIED',
    'INVALID_INPUT'
  ];
  if (nonRetryableCodes.includes(error?.code)) {
    retryable = false;
  }

  return createFailureSummary({
    module,
    stage: String(error?.stage || options.stage || 'unknown'),
    errorCode: String(error?.code || 'PYTHON_SCRIPT_FAILED'),
    errorMessage: String(error?.message || '未知错误'),
    details: String(error?.details || ''),
    hint,
    stderrTail,
    stdoutTail,
    exitCode: error?.exitCode,
    retryable,
    context: {
      scriptPath: error?.scriptPath || '',
      protocol: error?.protocol || null,
      ...options.context
    }
  });
}

/**
 * 从通用错误创建失败摘要
 *
 * @param {Error} error - 错误对象
 * @param {string} module - 模块名称
 * @param {string} stage - 失败阶段
 * @param {Object} [options] - 额外选项
 * @returns {Object} 失败摘要对象
 */
function createFailureSummaryFromError(error, module, stage, options = {}) {
  const errorMessage = error?.message || String(error) || '未知错误';
  const errorCode = error?.code || options.errorCode || 'UNKNOWN_ERROR';

  let hint = options.hint || '';
  if (!hint) {
    hint = generateHintFromErrorCode(errorCode);
  }

  return createFailureSummary({
    module,
    stage,
    errorCode,
    errorMessage,
    details: error?.details || options.details || error?.stack || '',
    hint,
    stderrTail: options.stderrTail || [],
    stdoutTail: options.stdoutTail || [],
    exitCode: error?.exitCode || options.exitCode,
    retryable: options.retryable !== undefined ? options.retryable : true,
    context: {
      errorName: error?.name || 'Error',
      ...options.context
    }
  });
}

/**
 * 根据错误码生成排障建议
 *
 * @param {string} errorCode - 错误码
 * @returns {string} 排障建议
 */
function generateHintFromErrorCode(errorCode) {
  const hints = {
    'NETWORK_ERROR': '检查网络连接和代理设置',
    'TIMEOUT': '增加超时时间或检查服务响应速度',
    'FILE_NOT_FOUND': '检查文件路径是否正确',
    'PERMISSION_DENIED': '检查文件或目录权限',
    'INVALID_CONFIG': '检查配置文件格式和必填字段',
    'INVALID_INPUT': '检查输入参数格式和有效性',
    'API_ERROR': '检查 API 密钥和配额',
    'LOGIN_REQUIRED': '需要重新登录或刷新令牌',
    'RATE_LIMIT': '请求频率过高，稍后重试',
    'PYTHON_SCRIPT_FAILED': '检查 Python 环境和依赖',
    'DOWNLOAD_FAILED': '检查视频链接有效性和网络连接',
    'RENDER_FAILED': '检查视频文件完整性和渲染参数',
    'UPLOAD_FAILED': '检查上传权限和网络连接',
    'WECHAT_LOGIN_FAILED': '需要扫码重新登录微信视频号',
    'WECHAT_UPLOAD_FAILED': '检查视频格式和大小限制',
    'REVIEW_FAILED': '检查 AI 审核配置和 API 密钥'
  };

  return hints[errorCode] || '查看详细日志以获取更多信息';
}

/**
 * 格式化失败摘要为简短文本（用于卡片展示）
 *
 * @param {Object} failureSummary - 失败摘要对象
 * @returns {string} 简短文本
 */
function formatFailureSummaryBrief(failureSummary) {
  if (!failureSummary) return '';

  const parts = [];

  if (failureSummary.stage) {
    parts.push(`[${failureSummary.stage}]`);
  }

  parts.push(failureSummary.errorMessage || '未知错误');

  if (failureSummary.hint) {
    parts.push(`💡 ${failureSummary.hint}`);
  }

  return parts.join(' ');
}

/**
 * 格式化失败摘要为详细文本（用于详情弹窗）
 *
 * @param {Object} failureSummary - 失败摘要对象
 * @returns {string} 详细文本
 */
function formatFailureSummaryDetailed(failureSummary) {
  if (!failureSummary) return '';

  const lines = [];

  lines.push(`失败时间: ${failureSummary.failedAt || 'N/A'}`);
  lines.push(`模块: ${failureSummary.module || 'N/A'}`);
  lines.push(`阶段: ${failureSummary.stage || 'N/A'}`);
  lines.push(`错误码: ${failureSummary.errorCode || 'N/A'}`);
  lines.push(`错误消息: ${failureSummary.errorMessage || 'N/A'}`);

  if (failureSummary.details) {
    lines.push(`详细信息: ${failureSummary.details}`);
  }

  if (failureSummary.hint) {
    lines.push(`💡 排障建议: ${failureSummary.hint}`);
  }

  if (failureSummary.exitCode !== null) {
    lines.push(`退出码: ${failureSummary.exitCode}`);
  }

  lines.push(`可重试: ${failureSummary.retryable ? '是' : '否'}`);

  if (failureSummary.stderrTail && failureSummary.stderrTail.length > 0) {
    lines.push('');
    lines.push('stderr 尾部:');
    failureSummary.stderrTail.forEach(line => lines.push(`  ${line}`));
  }

  if (failureSummary.stdoutTail && failureSummary.stdoutTail.length > 0) {
    lines.push('');
    lines.push('stdout 尾部:');
    failureSummary.stdoutTail.forEach(line => lines.push(`  ${line}`));
  }

  return lines.join('\n');
}

module.exports = {
  createFailureSummary,
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError,
  generateHintFromErrorCode,
  formatFailureSummaryBrief,
  formatFailureSummaryDetailed
};
