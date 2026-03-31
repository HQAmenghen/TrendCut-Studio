/**
 * 登录状态检测路由
 */

function registerLoginStatusRoutes(app, loginStatusService, feishuService) {
  // 手动触发检测所有账号
  app.post('/api/login-status/check-all', async (req, res) => {
    try {
      const { notifyFeishu = false } = req.body || {};
      const summary = await loginStatusService.checkAllAccounts({ notifyFeishu });
      res.json({
        success: true,
        summary
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // 批量检测指定账号
  app.post('/api/login-status/check-batch', async (req, res) => {
    try {
      const { accountIds = [], notifyFeishu = false, parallel = false } = req.body || {};

      if (!Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: '请选择要检测的账号'
        });
      }

      const summary = await loginStatusService.checkBatchAccounts(accountIds, {
        notifyFeishu,
        parallel
      });

      res.json({
        success: true,
        summary
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // 检测单个账号
  app.post('/api/login-status/check/:accountId', async (req, res) => {
    try {
      const { accountId } = req.params;
      const config = loginStatusService.readPublishConfig();
      const account = config?.wechatChannels?.accounts?.find(acc => acc.id === accountId);

      if (!account) {
        return res.status(404).json({
          success: false,
          error: '账号不存在'
        });
      }

      const result = await loginStatusService.checkAccountStatus(account);
      res.json({
        success: true,
        accountId,
        result
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // 获取所有账号状态
  app.get('/api/login-status/all', (req, res) => {
    try {
      const statuses = loginStatusService.getAllStatus();
      res.json({
        success: true,
        statuses
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // 获取单个账号状态
  app.get('/api/login-status/:accountId', (req, res) => {
    try {
      const { accountId } = req.params;
      const status = loginStatusService.getAccountStatus(accountId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: '未找到该账号的状态缓存'
        });
      }

      res.json({
        success: true,
        accountId,
        status
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // 清除状态缓存
  app.delete('/api/login-status/cache/:accountId?', (req, res) => {
    try {
      const { accountId } = req.params;
      loginStatusService.clearCache(accountId);

      res.json({
        success: true,
        message: accountId ? `已清除账号 ${accountId} 的缓存` : '已清除所有缓存'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // 测试飞书通知
  app.post('/api/login-status/test-feishu', async (req, res) => {
    try {
      if (!feishuService || !feishuService.enabled) {
        return res.json({
          success: false,
          error: '飞书通知服务未配置'
        });
      }

      const result = await feishuService.sendText(
        `🔔 测试通知\n` +
        `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n` +
        `来源: AI视频中台 - 登录状态检测服务`
      );

      res.json({
        success: result.success,
        message: result.success ? '测试通知发送成功' : '测试通知发送失败',
        error: result.error
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });
}

module.exports = {
  registerLoginStatusRoutes
};
