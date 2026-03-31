const { readPublishConfig } = require('../publish/store');

/**
 * 登录状态检测服务
 * 管理所有账号的登录状态，支持定时检测和状态缓存
 */

class LoginStatusService {
  constructor(deps) {
    this.checkWechatLogin = deps.checkWechatLogin;
    this.feishuService = deps.feishuService;
    this.readPublishConfig = deps.readPublishConfig || readPublishConfig;
    this.feishuReceiveIdType = deps.feishuReceiveIdType || 'chat_id';
    this.feishuReceiveId = deps.feishuReceiveId || '';

    // 状态缓存
    this.statusCache = new Map(); // accountId -> { status, lastCheck, lastNotify }
    this.checkInProgress = new Set(); // 正在检测的账号

    // 配置
    this.enabled = process.env.LOGIN_CHECK_ENABLED !== 'false';
    this.retryTimes = parseInt(process.env.LOGIN_CHECK_RETRY_TIMES) || 3;
    this.notifyLoginStatus = process.env.FEISHU_NOTIFY_LOGIN_STATUS !== 'false';
  }

  /**
   * 获取所有需要检测的账号
   */
  getAccountsToCheck() {
    try {
      const config = this.readPublishConfig();
      const wechatConfig = config?.wechatChannels;

      if (!wechatConfig || !wechatConfig.enabled) {
        return [];
      }

      const accounts = wechatConfig.accounts || [];
      return accounts.filter(acc => acc && acc.id);
    } catch (err) {
      console.error('[LoginStatus] 获取账号列表失败:', err.message);
      return [];
    }
  }

  /**
   * 检测单个账号的登录状态（带重试）
   */
  async checkAccountStatus(account, options = {}) {
    const accountId = account.id;
    const retryTimes = options.retryTimes || this.retryTimes;
    const notifyFeishu = options.notifyFeishu !== undefined ? options.notifyFeishu : true;

    // 防止并发检测同一账号
    if (this.checkInProgress.has(accountId)) {
      console.log(`[LoginStatus] 账号 ${accountId} 正在检测中，跳过`);
      return this.statusCache.get(accountId) || { status: 'checking' };
    }

    this.checkInProgress.add(accountId);

    try {
      let lastError = null;
      let qrCodePath = '';

      // 重试机制
      for (let attempt = 1; attempt <= retryTimes; attempt++) {
        try {
          console.log(`[LoginStatus] 检测账号 ${accountId} (尝试 ${attempt}/${retryTimes})`);

          const result = await this.checkWechatLogin(accountId, { poll: false });

          if (result.success) {
            const status = result.status === 'logged_in' ? 'logged_in' : 'need_login';
            const now = Date.now();

            // 保存二维码路径
            if (result.qrCodePath) {
              qrCodePath = result.qrCodePath;
            }

            // 更新缓存
            const cached = this.statusCache.get(accountId) || {};
            const statusChanged = cached.status && cached.status !== status;
            const isFirstCheck = !cached.status;  // 首次检测

            this.statusCache.set(accountId, {
              status,
              lastCheck: now,
              lastNotify: (statusChanged || isFirstCheck) ? now : cached.lastNotify,
              qrCodePath,
              account
            });

            console.log(`[LoginStatus] 账号 ${accountId} 状态: ${status} (首次检测: ${isFirstCheck}, 状态变化: ${statusChanged})`);

            // 如果状态变化、首次检测到需要登录、或允许通知，发送通知
            const shouldNotify = notifyFeishu && this.notifyLoginStatus && this.feishuService;
            const needNotify = statusChanged || (isFirstCheck && status === 'need_login');

            console.log(`[LoginStatus] 通知判断: notifyFeishu=${notifyFeishu}, notifyLoginStatus=${this.notifyLoginStatus}, hasFeishuService=${!!this.feishuService}, shouldNotify=${shouldNotify}, needNotify=${needNotify}`);

            if (shouldNotify && needNotify) {
              console.log(`[LoginStatus] 准备发送飞书通知: ${accountId} ${cached.status || '无'} -> ${status}`);
              await this.notifyStatusChange(account, status, cached.status, { qrCodePath });
            } else {
              console.log(`[LoginStatus] 跳过飞书通知: ${accountId} (shouldNotify=${shouldNotify}, needNotify=${needNotify})`);
            }

            return { status, success: true, checked: true };
          } else {
            lastError = result.error || '检测失败';
            if (attempt < retryTimes) {
              // 等待后重试
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
          }
        } catch (err) {
          lastError = err.message;
          console.error(`[LoginStatus] 检测账号 ${accountId} 异常 (尝试 ${attempt}):`, err.message);

          if (attempt < retryTimes) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        }
      }

      // 所有重试都失败
      console.error(`[LoginStatus] 账号 ${accountId} 检测失败，已重试 ${retryTimes} 次`);

      const now = Date.now();
      const cached = this.statusCache.get(accountId) || {};

      this.statusCache.set(accountId, {
        status: 'error',
        lastCheck: now,
        lastNotify: cached.lastNotify,
        error: lastError,
        account
      });

      // 发送错误通知（但不要太频繁）
      const shouldNotify = !cached.lastNotify || (now - cached.lastNotify > 3600000); // 1小时
      if (shouldNotify && notifyFeishu && this.notifyLoginStatus && this.feishuService) {
        await this.notifyStatusChange(account, 'error', cached.status, { error: lastError });
      }

      return { status: 'error', success: false, error: lastError, checked: true };

    } finally {
      this.checkInProgress.delete(accountId);
    }
  }

  /**
   * 检测所有账号的登录状态
   */
  async checkAllAccounts(options = {}) {
    if (!this.enabled) {
      console.log('[LoginStatus] 登录状态检测已禁用');
      return { checked: 0, results: [] };
    }

    const { notifyFeishu = true } = options;
    const accounts = this.getAccountsToCheck();

    if (accounts.length === 0) {
      console.log('[LoginStatus] 没有需要检测的账号');
      return { checked: 0, results: [] };
    }

    console.log(`[LoginStatus] 开始检测 ${accounts.length} 个账号的登录状态 (通知: ${notifyFeishu ? '是' : '否'})`);

    const results = [];

    // 串行检测，避免并发过多
    for (const account of accounts) {
      const result = await this.checkAccountStatus(account, { notifyFeishu });
      results.push({
        accountId: account.id,
        accountLabel: account.displayName || account.helperAccount || account.id,
        ...result
      });
    }

    const summary = {
      checked: results.length,
      logged_in: results.filter(r => r.status === 'logged_in').length,
      need_login: results.filter(r => r.status === 'need_login').length,
      error: results.filter(r => r.status === 'error').length,
      results
    };

    console.log(`[LoginStatus] 检测完成: ${summary.logged_in} 已登录, ${summary.need_login} 需登录, ${summary.error} 异常`);

    return summary;
  }

  /**
   * 批量检测指定账号的登录状态
   */
  async checkBatchAccounts(accountIds, options = {}) {
    if (!this.enabled) {
      console.log('[LoginStatus] 登录状态检测已禁用');
      return { checked: 0, results: [] };
    }

    const { notifyFeishu = true, parallel = false } = options;
    const allAccounts = this.getAccountsToCheck();
    const accounts = allAccounts.filter(acc => accountIds.includes(acc.id));

    if (accounts.length === 0) {
      console.log('[LoginStatus] 没有找到要检测的账号');
      return { checked: 0, results: [] };
    }

    console.log(`[LoginStatus] 开始批量检测 ${accounts.length} 个账号 (通知: ${notifyFeishu ? '是' : '否'}, 模式: ${parallel ? '并行' : '串行'})`);

    let results = [];

    if (parallel) {
      // 并行检测
      const promises = accounts.map(account =>
        this.checkAccountStatus(account, { notifyFeishu })
          .then(result => ({
            accountId: account.id,
            accountLabel: account.displayName || account.helperAccount || account.id,
            ...result
          }))
          .catch(err => ({
            accountId: account.id,
            accountLabel: account.displayName || account.helperAccount || account.id,
            status: 'error',
            success: false,
            error: err.message,
            checked: true
          }))
      );
      results = await Promise.all(promises);
    } else {
      // 串行检测
      for (const account of accounts) {
        const result = await this.checkAccountStatus(account, { notifyFeishu });
        results.push({
          accountId: account.id,
          accountLabel: account.displayName || account.helperAccount || account.id,
          ...result
        });
      }
    }

    const summary = {
      checked: results.length,
      logged_in: results.filter(r => r.status === 'logged_in').length,
      need_login: results.filter(r => r.status === 'need_login').length,
      error: results.filter(r => r.status === 'error').length,
      results
    };

    console.log(`[LoginStatus] 批量检测完成: ${summary.logged_in} 已登录, ${summary.need_login} 需登录, ${summary.error} 异常`);

    return summary;
  }

  /**
   * 发送状态变化通知
   */
  async notifyStatusChange(account, newStatus, oldStatus, details = {}) {
    console.log(`[LoginStatus] notifyStatusChange 被调用: accountId=${account.id}, newStatus=${newStatus}, oldStatus=${oldStatus || '无'}, hasFeishuService=${!!this.feishuService}`);

    if (!this.feishuService) {
      console.log('[LoginStatus] 飞书服务未配置，跳过通知');
      return;
    }

    try {
      // 通知条件：
      // 1. 状态恶化：logged_in -> need_login/error
      // 2. 状态恢复：need_login/error -> logged_in
      // 3. 首次检测到需要登录：oldStatus 为空且 newStatus 为 need_login
      // 4. 检测异常：newStatus 为 error
      const shouldNotify =
        (oldStatus === 'logged_in' && newStatus !== 'logged_in') ||
        (oldStatus !== 'logged_in' && newStatus === 'logged_in') ||
        (!oldStatus && newStatus === 'need_login') ||  // 首次检测到需要登录
        (newStatus === 'error');

      console.log(`[LoginStatus] 通知条件判断: shouldNotify=${shouldNotify}, 条件详情: {logged_in->other: ${oldStatus === 'logged_in' && newStatus !== 'logged_in'}, other->logged_in: ${oldStatus !== 'logged_in' && newStatus === 'logged_in'}, first_need_login: ${!oldStatus && newStatus === 'need_login'}, error: ${newStatus === 'error'}}`);

      if (!shouldNotify) {
        console.log(`[LoginStatus] 跳过通知: ${account.id} ${oldStatus || '无'} -> ${newStatus}`);
        return;
      }

      console.log(`[LoginStatus] 发送飞书通知: ${account.id} ${oldStatus || '无'} -> ${newStatus}, details:`, {
        hasQrCodePath: !!details.qrCodePath,
        qrCodePath: details.qrCodePath,
        receiveIdType: this.feishuReceiveIdType,
        receiveId: this.feishuReceiveId
      });

      const result = await this.feishuService.sendLoginAlert(account, newStatus, {
        ...details,
        loginUrl: `http://localhost:3001`,
        oldStatus,
        receiveIdType: this.feishuReceiveIdType,
        receiveId: this.feishuReceiveId
      });

      console.log('[LoginStatus] 飞书通知发送结果:', result);
    } catch (err) {
      console.error('[LoginStatus] 发送飞书通知失败:', err.message, err.stack);
    }
  }

  /**
   * 获取账号状态缓存
   */
  getAccountStatus(accountId) {
    return this.statusCache.get(accountId) || null;
  }

  /**
   * 获取所有账号状态
   */
  getAllStatus() {
    const statuses = [];
    for (const [accountId, data] of this.statusCache.entries()) {
      statuses.push({
        accountId,
        accountLabel: data.account?.displayName || data.account?.helperAccount || accountId,
        status: data.status,
        lastCheck: data.lastCheck,
        lastNotify: data.lastNotify,
        error: data.error
      });
    }
    return statuses;
  }

  /**
   * 清除状态缓存
   */
  clearCache(accountId = null) {
    if (accountId) {
      this.statusCache.delete(accountId);
    } else {
      this.statusCache.clear();
    }
  }
}

/**
 * 创建登录状态检测服务
 */
function createLoginStatusService(deps) {
  return new LoginStatusService(deps);
}

module.exports = {
  LoginStatusService,
  createLoginStatusService
};
