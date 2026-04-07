/**
 * WeChat RPA 运行时管理服务
 *
 * 职责：
 * - 运行时状态管理
 * - 日志管理
 * - 协议解析（STATUS|, LOG|）
 * - Payload 构建
 */

function createWechatRuntimeService(deps) {
  const {
    path,
    slugifyText,
    wechatRpaProfileRoot,
    buildShortTitle,
    readPublishJobs,
    updatePublishPlatformTask
  } = deps;

  /**
   * 构建微信配置目录
   */
  function buildWechatProfileDir(accountId) {
    const safeAccountId = slugifyText(accountId || '', 'default');
    return path.join(wechatRpaProfileRoot, safeAccountId);
  }

  /**
   * 构建微信发布 Payload
   */
  function buildWechatPublishPayload(job, wechatAccount) {
    const tagStrategy = job.publishData?.tagStrategy === 'model' ? 'model' : 'system';
    const tags = tagStrategy === 'model'
      ? []
      : (Array.isArray(job.publishData?.tags) ? job.publishData.tags : []);
    return {
      title: job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布',
      shortTitle: job.publishData?.shortTitle || job.asset?.metadata?.suggestedShortTitle || buildShortTitle(job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布'),
      description: job.publishData?.description || job.asset?.metadata?.suggestedDescription || '',
      tags,
      originalDeclaration: true,
      publishMode: 'draft',
      videoPath: job.asset?.path,
      userDataDir: buildWechatProfileDir(wechatAccount?.id),
      loginTimeoutSec: 240,
      headless: false,
      finderUserName: wechatAccount?.finderUserName || '',
      helperAccount: wechatAccount?.helperAccount || '',
      accountId: wechatAccount?.id || '',
      accountLabel: wechatAccount?.displayName || wechatAccount?.helperAccount || wechatAccount?.finderUserName || ''
    };
  }

  /**
   * 解析 WeChat RPA 状态行
   * 格式：STATUS|state|stage|message|extra_json
   */
  function parseWechatRpaLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('STATUS|')) return null;
    const parts = text.split('|');
    if (parts.length < 4) return null;
    let extra = {};
    try {
      extra = parts[4] ? JSON.parse(parts[4]) : {};
    } catch (_err) {}
    return {
      state: parts[1],
      message: parts[3] || parts[2] || '',
      extra
    };
  }

  /**
   * 解析 WeChat 日志行
   * 格式：LOG|message
   */
  function parseWechatLogLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('LOG|')) return null;
    return text.slice(4).trim();
  }

  /**
   * 获取 WeChat 状态对应的进度值
   */
  function getWechatStateProgress(state) {
    const map = {
      starting: 3,
      navigating: 8,
      need_login: 15,
      login_ready: 24,
      uploading: 42,
      uploaded: 58,
      editing: 72,
      edited: 86,
      ready_for_manual_publish: 100,
      publishing: 94,
      success: 100,
      failed: 100
    };
    return map[state] ?? 0;
  }

  /**
   * 读取 WeChat 运行时日志
   */
  function readWechatRuntimeLogs(jobId) {
    const payload = readPublishJobs();
    const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
    const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
    return Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
  }

  /**
   * 追加 WeChat 运行时日志
   */
  function appendWechatRuntimeLog(jobId, line, publishMode, state, message, progress) {
    if (!line) return;
    safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
      runtime: {
        state,
        lastMessage: message,
        updatedAt: new Date().toISOString(),
        publishMode,
        progress,
        logs: [...readWechatRuntimeLogs(jobId), line].slice(-120)
      }
    });
  }

  /**
   * 安全更新发布平台任务（忽略已删除任务的错误）
   */
  function safeUpdatePublishPlatformTask(jobId, platform, patch) {
    try {
      updatePublishPlatformTask(jobId, platform, patch);
    } catch (err) {
      // 忽略已删除任务的更新错误
    }
  }

  return {
    buildWechatProfileDir,
    buildWechatPublishPayload,
    parseWechatRpaLine,
    parseWechatLogLine,
    getWechatStateProgress,
    readWechatRuntimeLogs,
    appendWechatRuntimeLog,
    safeUpdatePublishPlatformTask
  };
}

module.exports = { createWechatRuntimeService };
