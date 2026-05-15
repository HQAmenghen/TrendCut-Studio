const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// 基础目录
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const FRONTEND_DIST_DIR = path.join(PROJECT_ROOT, 'frontend-dist');
const FRONTEND_INDEX_PATH = path.join(FRONTEND_DIST_DIR, 'index.html');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const PYTHON_DIR = path.join(PROJECT_ROOT, 'python');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor');

// Pipeline 相关
const WORKFLOW_PATH = path.join(CONFIG_DIR, 'workflow_api.json');
const PIPELINE_DIR = path.join(PYTHON_DIR, 'pipeline');

// XAI Top10 相关
const XAI_TOP10_DIR = path.join(PYTHON_DIR, 'xai');
const XAI_TOP10_SCRIPT = path.join(XAI_TOP10_DIR, 'run_xai_top10.py');
const XAI_TOP10_TRANSLATE_SCRIPT = path.join(XAI_TOP10_DIR, 'translate_result_summaries.py');
const XAI_TOP10_RESULT = path.join(XAI_TOP10_DIR, 'result.json');
const XAI_TOP10_PARTIAL = path.join(XAI_TOP10_DIR, 'result.partial.json');
const XAI_TOP10_LOG = path.join(XAI_TOP10_DIR, 'run_log.txt');
const XAI_TOP10_ERROR_LOG = path.join(XAI_TOP10_DIR, 'run_error.log');
const XAI_TOP10_ACCOUNTS = path.join(XAI_TOP10_DIR, 'xai_accounts.json');

// Vertical Queue 相关
const VERTICAL_QUEUE_ROOT = path.join(UPLOADS_DIR, 'xai_vertical_queue');
const VERTICAL_PUBLIC_DIR = path.join(PROJECT_ROOT, 'public', 'xai_vertical_queue');

// Runtime Jobs 相关
const RUNTIME_ROOT = path.join(UPLOADS_DIR, 'runtime_jobs');
const PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');

// Publish 相关
const PUBLISH_CENTER_DIR = path.join(PYTHON_DIR, 'publish');
const PUBLISH_CONFIG_PATH = path.join(PUBLISH_CENTER_DIR, 'platform_config.json');
const PUBLISH_JOBS_PATH = path.join(PUBLISH_CENTER_DIR, 'publish_jobs.json');
const PUBLISH_DESCRIPTION_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'generate_publish_description.py');

// WeChat RPA 相关
const WECHAT_RPA_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_rpa.py');
const WECHAT_RPA_PROFILE_ROOT = path.join(PUBLISH_CENTER_DIR, 'browser_profiles', 'wechatChannels');
const WECHAT_RPA_TASK_DIR = path.join(PUBLISH_CENTER_DIR, 'wechat_channels_tasks');
const PLATFORM_RPA_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'browser_platform_rpa.py');
const SOCIAL_AUTO_UPLOAD_ADAPTER_SCRIPT = path.join(PUBLISH_CENTER_DIR, 'social_auto_upload_adapter.py');
const SOCIAL_AUTO_UPLOAD_VENDOR_DIR = path.join(VENDOR_DIR, 'social-auto-upload');
const SOCIAL_AUTO_UPLOAD_RUNTIME_DIR = path.join(DATA_DIR, 'social-auto-upload-runtime');
const PLATFORM_RPA_PROFILE_ROOT = path.join(PUBLISH_CENTER_DIR, 'browser_profiles');
const PLATFORM_RPA_TASK_DIR = path.join(PUBLISH_CENTER_DIR, 'platform_rpa_tasks');

// Task Store
const TASK_STORE_DB_PATH = path.join(DATA_DIR, 'tasks.db');

module.exports = {
  PROJECT_ROOT,
  PUBLIC_DIR,
  FRONTEND_DIST_DIR,
  FRONTEND_INDEX_PATH,
  CONFIG_DIR,
  PYTHON_DIR,
  DATA_DIR,
  UPLOADS_DIR,
  VENDOR_DIR,
  WORKFLOW_PATH,
  PIPELINE_DIR,
  XAI_TOP10_DIR,
  XAI_TOP10_SCRIPT,
  XAI_TOP10_TRANSLATE_SCRIPT,
  XAI_TOP10_RESULT,
  XAI_TOP10_PARTIAL,
  XAI_TOP10_LOG,
  XAI_TOP10_ERROR_LOG,
  XAI_TOP10_ACCOUNTS,
  VERTICAL_QUEUE_ROOT,
  VERTICAL_PUBLIC_DIR,
  RUNTIME_ROOT,
  PROJECTS_DIR,
  PUBLISH_CENTER_DIR,
  PUBLISH_CONFIG_PATH,
  PUBLISH_JOBS_PATH,
  PUBLISH_DESCRIPTION_SCRIPT,
  WECHAT_RPA_SCRIPT,
  WECHAT_RPA_PROFILE_ROOT,
  WECHAT_RPA_TASK_DIR,
  PLATFORM_RPA_SCRIPT,
  SOCIAL_AUTO_UPLOAD_ADAPTER_SCRIPT,
  SOCIAL_AUTO_UPLOAD_VENDOR_DIR,
  SOCIAL_AUTO_UPLOAD_RUNTIME_DIR,
  PLATFORM_RPA_PROFILE_ROOT,
  PLATFORM_RPA_TASK_DIR,
  TASK_STORE_DB_PATH
};
