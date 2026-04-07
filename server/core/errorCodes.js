// 错误码命名规范：SERVICE_ACTION_RESULT
// 示例：VERTICAL_QUEUE_ENQUEUE_FAILED

const ERROR_CODES = {
  // 通用错误
  INTERNAL_ERROR: { stage: 'request', message: '内部服务器错误' },
  INVALID_REQUEST: { stage: 'request', message: '无效的请求' },

  // Python 子进程
  PYTHON_SCRIPT_FAILED: { stage: 'python', message: 'Python 脚本执行失败' },
  PYTHON_SCRIPT_CANCELLED: { stage: 'python', message: 'Python 脚本已取消' },
  PYTHON_SCRIPT_TIMEOUT: { stage: 'python', message: 'Python 脚本执行超时' },

  // Vertical Queue
  VERTICAL_QUEUE_ENQUEUE_FAILED: { stage: 'vertical.queue', message: '入队失败' },
  VERTICAL_QUEUE_CANCEL_FAILED: { stage: 'vertical.queue', message: '取消失败' },
  VERTICAL_QUEUE_REMOVE_FAILED: { stage: 'vertical.queue', message: '移除失败' },
  VERTICAL_QUEUE_STATUS_READ_FAILED: { stage: 'vertical.queue', message: '读取状态失败' },
  VERTICAL_QUEUE_VIDEO_DOWNLOAD_FAILED: { stage: 'vertical.queue', message: '视频下载失败' },
  VERTICAL_QUEUE_VIDEO_COPY_FAILED: { stage: 'vertical.queue', message: '视频复制失败' },
  VERTICAL_QUEUE_VIDEO_URLS_EMPTY: { stage: 'vertical.queue', message: '没有可入队的视频链接' },

  // XAI Service
  XAI_CLIENT_INIT_FAILED: { stage: 'xai', message: 'XAI 客户端初始化失败' },
  XAI_SCRIPT_FAILED: { stage: 'xai', message: 'XAI 脚本执行失败' },
  XAI_RESULT_READ_FAILED: { stage: 'xai', message: '读取 XAI 结果失败' },
  XAI_TRANSLATE_FAILED: { stage: 'xai', message: '翻译失败' },

  // Standalone
  STANDALONE_CLIENT_INIT_FAILED: { stage: 'standalone', message: '独立客户端初始化失败' },
  STANDALONE_VIDEO_GENERATION_FAILED: { stage: 'standalone', message: '视频生成失败' },

  // Publish - Config
  PUBLISH_CONFIG_READ_FAILED: { stage: 'publish.config', message: '读取配置失败' },
  PUBLISH_CONFIG_WRITE_FAILED: { stage: 'publish.config', message: '写入配置失败' },
  PUBLISH_CONFIG_INVALID: { stage: 'publish.config', message: '配置无效' },
  PUBLISH_MODE_INVALID: { stage: 'publish.config', message: 'mode 仅支持 draft 或 publish' },

  // Publish - Assets
  PUBLISH_ASSETS_SCAN_FAILED: { stage: 'publish.assets', message: '扫描资产失败' },
  PUBLISH_ASSET_NOT_FOUND: { stage: 'publish.assets', message: '资产不存在' },
  PUBLISH_ASSET_METADATA_READ_FAILED: { stage: 'publish.assets', message: '读取资产元数据失败' },

  // Publish - Jobs
  PUBLISH_JOB_CREATE_FAILED: { stage: 'publish.jobs', message: '创建发布任务失败' },
  PUBLISH_JOB_UPDATE_FAILED: { stage: 'publish.jobs', message: '更新发布任务失败' },
  PUBLISH_JOB_DELETE_FAILED: { stage: 'publish.jobs', message: '删除发布任务失败' },
  PUBLISH_JOB_NOT_FOUND: { stage: 'publish.jobs', message: '发布任务不存在' },
  PUBLISH_JOBS_READ_FAILED: { stage: 'publish.jobs', message: '读取发布任务列表失败' },

  // Publish - Description
  PUBLISH_DESCRIPTION_GENERATE_FAILED: { stage: 'publish.description', message: '生成描述失败' },
  PUBLISH_DESCRIPTION_SAVE_FAILED: { stage: 'publish.description', message: '保存描述失败' },

  // Publish - WeChat
  PUBLISH_WECHAT_START_FAILED: { stage: 'publish.wechat', message: '启动微信视频号任务失败' },
  PUBLISH_WECHAT_START_ALL_FAILED: { stage: 'publish.wechat', message: '一键启动所有任务失败' },
  PUBLISH_WECHAT_CANCEL_FAILED: { stage: 'publish.wechat', message: '取消微信任务失败' },
  PUBLISH_WECHAT_CONFIG_INCOMPLETE: { stage: 'publish.wechat', message: '微信视频号配置不完整' },
  PUBLISH_WECHAT_ACCOUNT_NOT_FOUND: { stage: 'publish.wechat', message: '未找到对应的视频号发布账号' },
  PUBLISH_WECHAT_ACCOUNT_BUSY: { stage: 'publish.wechat', message: '账号当前已有发布任务在运行' },
  PUBLISH_WECHAT_VIDEO_NOT_FOUND: { stage: 'publish.wechat', message: '待发布视频文件不存在' },
  PUBLISH_WECHAT_SCRIPT_NOT_FOUND: { stage: 'publish.wechat', message: '视频号 RPA 脚本不存在' },
  PUBLISH_WECHAT_NO_RUNNING_TASK: { stage: 'publish.wechat', message: '当前没有可取消的视频号运行任务' },

  // Review
  REVIEW_CONFIG_READ_FAILED: { stage: 'review.config', message: '读取审核配置失败' },
  REVIEW_CONFIG_WRITE_FAILED: { stage: 'review.config', message: '写入审核配置失败' },
  REVIEW_EXECUTE_FAILED: { stage: 'review.execute', message: '执行审核失败' },
  REVIEW_VIDEO_NOT_FOUND: { stage: 'review.video', message: '视频文件不存在' },
  REVIEW_METADATA_NOT_FOUND: { stage: 'review.metadata', message: '元数据文件不存在' },
  REVIEW_RESULT_PARSE_FAILED: { stage: 'review.result', message: '解析审核结果失败' },
  REVIEW_SUGGESTION_GENERATE_FAILED: { stage: 'review.suggestion', message: '生成修改建议失败' },
  REVIEW_SUGGESTION_SAVE_FAILED: { stage: 'review.suggestion', message: '保存修改建议失败' },
  REVIEW_REGENERATE_FAILED: { stage: 'review.regenerate', message: '重新生成视频失败' },
  REVIEW_QUEUE_SERVICE_UNAVAILABLE: { stage: 'review.queue', message: '视频生成服务不可用' },
  REVIEW_ASSET_NOT_FOUND: { stage: 'review.asset', message: '审核资产不存在' },

  // System
  SYSTEM_PRESET_NOT_FOUND: { stage: 'system.preset', message: '预设不存在' },
  SYSTEM_WORKFLOW_READ_FAILED: { stage: 'system.workflow', message: '读取工作流失败' },
  SYSTEM_WORKFLOW_WRITE_FAILED: { stage: 'system.workflow', message: '写入工作流失败' },
  SYSTEM_JSON_PARSE_FAILED: { stage: 'system.json', message: 'JSON 解析失败' },
  SYSTEM_LLM_CONFIG_INVALID: { stage: 'system.llm', message: 'LLM 配置无效' },
  SYSTEM_FEISHU_SEND_FAILED: { stage: 'system.feishu', message: '飞书消息发送失败' },
  SYSTEM_SELFCHECK_FAILED: { stage: 'system.selfcheck', message: '自检失败' },
  SYSTEM_SCHEDULER_START_FAILED: { stage: 'system.scheduler', message: '定时任务启动失败' },

  // Login Status
  LOGIN_STATUS_CHECK_FAILED: { stage: 'login.status', message: '登录状态检查失败' },
  LOGIN_STATUS_QRCODE_GENERATE_FAILED: { stage: 'login.qrcode', message: '二维码生成失败' },
  LOGIN_STATUS_SESSION_NOT_FOUND: { stage: 'login.session', message: '登录会话不存在' }
};

function createError(code, details = '', hint = '') {
  const template = ERROR_CODES[code];
  if (!template) {
    console.warn(`Unknown error code: ${code}, falling back to INTERNAL_ERROR`);
    const error = new Error(details || 'Unknown error');
    error.code = code;
    error.stage = 'unknown';
    error.details = details;
    error.hint = hint;
    return error;
  }

  const error = new Error(template.message);
  error.code = code;
  error.stage = template.stage;
  error.details = details;
  error.hint = hint;
  return error;
}

module.exports = { ERROR_CODES, createError };
