/**
 * WeChat RPA 服务 - 组装模块
 *
 * 将三个子模块组装成统一的服务接口：
 * - wechatRpa.runtime - 运行时管理
 * - wechatRpa.login - 登录检查
 * - wechatRpa.process - 进程管理
 */

const { createWechatRuntimeService } = require('./wechatRpa.runtime');
const { createWechatLoginService } = require('./wechatRpa.login');
const { createWechatProcessService } = require('./wechatRpa.process');
const { createPlatformRpaService } = require('./platformRpa');

function createWechatRpaService(deps) {
  const {
    fs,
    path,
    spawn,
    stopProcessTree,
    runPythonScriptCancellable,
    slugifyText,
    publishCenterDir,
    wechatRpaScript,
    wechatRpaTaskDir,
    wechatRpaProfileRoot,
    platformRpaScript,
    socialAutoUploadAdapterScript,
    platformRpaTaskDir,
    platformRpaProfileRoot,
    socialAutoUploadDir,
    socialAutoUploadPython,
    buildShortTitle,
    readPublishJobs,
    readPublishConfig,
    validateWechatTaskConfig,
    updatePublishPlatformTask
  } = deps;

  // 创建运行时服务
  const runtimeService = createWechatRuntimeService({
    path,
    slugifyText,
    wechatRpaProfileRoot,
    buildShortTitle,
    readPublishJobs,
    updatePublishPlatformTask
  });

  // 创建进程服务（依赖运行时服务）
  const processService = createWechatProcessService({
    fs,
    path,
    runPythonScriptCancellable,
    publishCenterDir,
    wechatRpaScript,
    wechatRpaTaskDir,
    readPublishJobs,
    readPublishConfig,
    validateWechatTaskConfig,
    // 注入运行时服务函数
    buildWechatPublishPayload: runtimeService.buildWechatPublishPayload,
    parseWechatRpaLine: runtimeService.parseWechatRpaLine,
    parseWechatLogLine: runtimeService.parseWechatLogLine,
    getWechatStateProgress: runtimeService.getWechatStateProgress,
    readWechatRuntimeLogs: runtimeService.readWechatRuntimeLogs,
    appendWechatRuntimeLog: runtimeService.appendWechatRuntimeLog,
    safeUpdatePublishPlatformTask: runtimeService.safeUpdatePublishPlatformTask
  });

  // 创建登录服务（依赖运行时和进程服务）
  const loginService = createWechatLoginService({
    fs,
    path,
    spawn,
    stopProcessTree,
    publishCenterDir,
    buildWechatProfileDir: runtimeService.buildWechatProfileDir,
    getActiveWechatRuntimeForAccount: processService.getActiveWechatRuntimeForAccount
  });

  const platformRpaService = createPlatformRpaService({
    fs,
    path,
    slugifyText,
    runPythonScriptCancellable,
    publishCenterDir,
    platformRpaScript,
    socialAutoUploadAdapterScript,
    platformRpaTaskDir,
    platformRpaProfileRoot,
    socialAutoUploadDir,
    socialAutoUploadPython,
    readPublishJobs,
    readPublishConfig,
    updatePublishPlatformTask,
    startWechatRpa: processService.startWechatRpa,
    retryWechatRpa: processService.retryWechatRpa,
    cancelWechatRpa: processService.cancelWechatRpa
  });

  // 导出统一接口
  return {
    startWechatRpa: processService.startWechatRpa,
    retryWechatRpa: processService.retryWechatRpa,
    cancelWechatRpa: processService.cancelWechatRpa,
    startPlatformRpa: platformRpaService.startPlatformRpa,
    retryPlatformRpa: platformRpaService.retryPlatformRpa,
    cancelPlatformRpa: platformRpaService.cancelPlatformRpa,
    checkWechatLogin: loginService.checkWechatLogin,
    openWechatContentManager: loginService.openWechatContentManager
  };
}

module.exports = {
  createWechatRpaService
};
