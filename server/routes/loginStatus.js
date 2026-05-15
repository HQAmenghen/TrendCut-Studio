/**
 * 登录状态检测路由
 */

function registerLoginStatusRoutes(app, loginStatusService, feishuService) {
  const renderActionPage = ({ success, title, message, details = '' }) => `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fb; color: #1f2329; margin: 0; padding: 32px; }
    .card { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 12px 30px rgba(31,35,41,0.08); }
    .badge { display: inline-block; padding: 6px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; background: ${success ? '#e8f7ec' : '#fdecec'}; color: ${success ? '#157347' : '#b42318'}; }
    h1 { font-size: 24px; margin: 16px 0 8px; }
    p { line-height: 1.7; margin: 0 0 12px; }
    .details { margin-top: 16px; color: #667085; font-size: 14px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">${success ? '已处理' : '处理失败'}</span>
    <h1>${title}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ''}
  </div>
</body>
</html>`;

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

      const result = await loginStatusService.checkAccountStatus(account, { notifyFeishu: false });
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

  const handleRequestLatestQr = async (req, res) => {
    try {
      const { accountId } = req.params;
      console.log(`[LoginStatus] 收到获取最新二维码请求: accountId=${accountId}, method=${req.method}`);

      const result = await loginStatusService.requestLatestQrCode(accountId, {
        notifyFeishu: false,
        trigger: 'manual_refresh'
      });

      console.log('[LoginStatus] 获取最新二维码请求完成:', {
        accountId,
        status: result.status,
        hasQrCodePath: Boolean(result.qrCodePath)
      });

      const acceptsJson = String(req.headers.accept || '').includes('application/json') || req.query.format === 'json';
      if (acceptsJson) {
        return res.json(result);
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderActionPage({
        success: true,
        title: '最新二维码请求已提交',
        message: `账号 ${accountId} 的最新二维码请求已发送到服务端，请回到控制台查看最新登录二维码。`,
        details: result.status === 'logged_in'
          ? '当前账号已处于登录状态，本次不会推送登录通知。'
          : '本次只会刷新本地二维码缓存，不会推送飞书。'
      }));
    } catch (err) {
      console.error('[LoginStatus] 获取最新二维码请求失败:', err.message);
      const acceptsJson = String(req.headers.accept || '').includes('application/json') || req.query.format === 'json';
      if (acceptsJson) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }
      res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderActionPage({
        success: false,
        title: '获取最新二维码失败',
        message: '服务端处理二维码刷新请求时出错了，请稍后再试。',
        details: err.message
      }));
    }
  };

  app.get('/api/login-status/request-latest-qr/:accountId', handleRequestLatestQr);
  app.post('/api/login-status/request-latest-qr/:accountId', handleRequestLatestQr);

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
        '🔔 测试通知\n' +
        `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n` +
        '来源: AI视频中台 - 登录状态检测服务'
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
