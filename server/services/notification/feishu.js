const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

/**
 * 飞书通知服务
 * 支持发送文本消息、富文本消息、卡片消息、图片消息
 */

class FeishuNotificationService {
  constructor(config) {
    // 兼容旧的 webhookUrl 字符串参数
    if (typeof config === 'string') {
      this.webhookUrl = config;
      this.enabled = Boolean(config);
      this.mode = 'webhook';
    } else {
      this.webhookUrl = config.webhookUrl;
      this.appId = config.appId;
      this.appSecret = config.appSecret;
      this.enabled = Boolean(config.webhookUrl || (config.appId && config.appSecret));
      this.mode = (config.appId && config.appSecret) ? 'app' : 'webhook';
    }

    // 缓存 tenant_access_token
    this.accessToken = null;
    this.accessTokenExpiry = 0;
  }

  /**
   * 获取 tenant_access_token（应用模式）
   */
  async getTenantAccessToken() {
    if (!this.appId || !this.appSecret) {
      throw new Error('飞书应用配置不完整');
    }

    // 如果 token 还有效，直接返回
    if (this.accessToken && Date.now() < this.accessTokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          app_id: this.appId,
          app_secret: this.appSecret
        },
        { timeout: 10000 }
      );

      if (response.data.code === 0) {
        this.accessToken = response.data.tenant_access_token;
        // 提前5分钟过期
        this.accessTokenExpiry = Date.now() + (response.data.expire - 300) * 1000;
        return this.accessToken;
      } else {
        throw new Error(`获取 access_token 失败: ${response.data.msg}`);
      }
    } catch (err) {
      console.error('[Feishu] 获取 tenant_access_token 失败:', err.message);
      throw err;
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(text) {
    if (!this.enabled) {
      console.warn('[Feishu] Webhook URL 未配置，跳过通知');
      return { success: false, reason: 'webhook_not_configured' };
    }

    try {
      const response = await axios.post(this.webhookUrl, {
        msg_type: 'text',
        content: {
          text
        }
      }, {
        timeout: 10000
      });

      if (response.data.code === 0) {
        console.log('[Feishu] 文本消息发送成功');
        return { success: true };
      } else {
        console.error('[Feishu] 消息发送失败:', response.data);
        return { success: false, error: response.data.msg };
      }
    } catch (err) {
      console.error('[Feishu] 发送消息异常:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 发送富文本消息
   */
  async sendRichText(title, content) {
    if (!this.enabled) {
      console.warn('[Feishu] Webhook URL 未配置，跳过通知');
      return { success: false, reason: 'webhook_not_configured' };
    }

    try {
      const response = await axios.post(this.webhookUrl, {
        msg_type: 'post',
        content: {
          post: {
            zh_cn: {
              title,
              content
            }
          }
        }
      }, {
        timeout: 10000
      });

      if (response.data.code === 0) {
        console.log('[Feishu] 富文本消息发送成功');
        return { success: true };
      } else {
        console.error('[Feishu] 消息发送失败:', response.data);
        return { success: false, error: response.data.msg };
      }
    } catch (err) {
      console.error('[Feishu] 发送消息异常:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 发送卡片消息
   */
  async sendCard(card, receiveIdType = 'chat_id', receiveId = null) {
    // 应用模式：使用消息 API
    if (this.mode === 'app' && receiveId) {
      try {
        const token = await this.getTenantAccessToken();

        const response = await axios.post(
          'https://open.feishu.cn/open-apis/im/v1/messages',
          {
            receive_id: receiveId,
            msg_type: 'interactive',
            content: JSON.stringify(card)
          },
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            params: {
              receive_id_type: receiveIdType
            },
            timeout: 10000
          }
        );

        if (response.data.code === 0) {
          console.log('[Feishu] 卡片消息发送成功');
          return { success: true };
        } else {
          console.error('[Feishu] 卡片消息发送失败:', response.data);
          return { success: false, error: response.data.msg };
        }
      } catch (err) {
        console.error('[Feishu] 发送卡片消息异常:', err.message);
        return { success: false, error: err.message };
      }
    }

    // Webhook 模式：使用 webhook URL
    if (!this.enabled || !this.webhookUrl) {
      console.warn('[Feishu] Webhook URL 未配置，跳过通知');
      return { success: false, reason: 'webhook_not_configured' };
    }

    try {
      const response = await axios.post(this.webhookUrl, {
        msg_type: 'interactive',
        card
      }, {
        timeout: 10000
      });

      if (response.data.code === 0) {
        console.log('[Feishu] 卡片消息发送成功');
        return { success: true };
      } else {
        console.error('[Feishu] 消息发送失败:', response.data);
        return { success: false, error: response.data.msg };
      }
    } catch (err) {
      console.error('[Feishu] 发送消息异常:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 上传图片到飞书（应用模式）
   */
  async uploadImage(imagePath) {
    if (this.mode !== 'app') {
      throw new Error('上传图片需要使用飞书应用模式（需配置 appId 和 appSecret）');
    }

    try {
      const token = await this.getTenantAccessToken();
      const imageBuffer = await fs.readFile(imagePath);

      const form = new FormData();
      form.append('image_type', 'message');
      form.append('image', imageBuffer, {
        filename: 'qrcode.png',
        contentType: 'image/png'
      });

      const response = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/images',
        form,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...form.getHeaders()
          },
          timeout: 30000
        }
      );

      if (response.data.code === 0) {
        console.log('[Feishu] 图片上传成功:', response.data.data.image_key);
        return { success: true, imageKey: response.data.data.image_key };
      } else {
        console.error('[Feishu] 图片上传失败:', response.data);
        return { success: false, error: response.data.msg };
      }
    } catch (err) {
      console.error('[Feishu] 上传图片异常:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 发送图片消息（应用模式）
   */
  async sendImage(receiveIdType, receiveId, imageKey) {
    if (this.mode !== 'app') {
      throw new Error('发送图片需要使用飞书应用模式（需配置 appId 和 appSecret）');
    }

    try {
      const token = await this.getTenantAccessToken();

      const response = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        {
          receive_id: receiveId,
          msg_type: 'image',
          content: JSON.stringify({
            image_key: imageKey
          })
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: {
            receive_id_type: receiveIdType // 'open_id', 'user_id', 'union_id', 'email', 'chat_id'
          },
          timeout: 10000
        }
      );

      if (response.data.code === 0) {
        console.log('[Feishu] 图片消息发送成功');
        return { success: true };
      } else {
        console.error('[Feishu] 图片消息发送失败:', response.data);
        return { success: false, error: response.data.msg };
      }
    } catch (err) {
      console.error('[Feishu] 发送图片消息异常:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 发送登录状态告警（支持二维码图片）
   */
  async sendLoginAlert(accountInfo, status, details = {}) {
    console.log('[Feishu] sendLoginAlert 被调用:', {
      accountId: accountInfo.id,
      status,
      mode: this.mode,
      hasQrCodePath: !!details.qrCodePath,
      hasReceiveId: !!details.receiveId
    });

    const accountLabel = accountInfo.displayName || accountInfo.helperAccount || accountInfo.finderUserName || accountInfo.id;
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    let statusText = '';
    let statusColor = '';
    let actionText = '';

    switch (status) {
      case 'logged_out':
        statusText = '❌ 登录已失效';
        statusColor = 'red';
        actionText = '请尽快重新扫码登录，否则将影响自动发布功能';
        break;
      case 'need_login':
        statusText = '⚠️ 需要登录';
        statusColor = 'orange';
        actionText = '请扫码登录以恢复自动发布功能';
        break;
      case 'error':
        statusText = '⚠️ 检测异常';
        statusColor = 'orange';
        actionText = '登录状态检测失败，请手动检查';
        break;
      case 'logged_in':
        statusText = '✅ 登录恢复';
        statusColor = 'green';
        actionText = '账号已重新登录，自动发布功能已恢复';
        break;
      default:
        statusText = `状态: ${status}`;
        statusColor = 'grey';
        actionText = '请检查账号状态';
    }

    // 如果有二维码图片且使用应用模式，先发送图片
    if (details.qrCodePath && this.mode === 'app' && details.receiveId) {
      try {
        console.log('[Feishu] 准备上传并发送二维码图片...', {
          qrCodePath: details.qrCodePath,
          receiveIdType: details.receiveIdType,
          receiveId: details.receiveId
        });
        const uploadResult = await this.uploadImage(details.qrCodePath);

        if (uploadResult.success) {
          console.log('[Feishu] 图片上传成功，准备发送...');
          await this.sendImage(
            details.receiveIdType || 'chat_id',
            details.receiveId,
            uploadResult.imageKey
          );
          console.log('[Feishu] 二维码图片已发送');
        } else {
          console.error('[Feishu] 二维码上传失败:', uploadResult.error);
        }
      } catch (err) {
        console.error('[Feishu] 发送二维码图片失败:', err.message, err.stack);
      }
    } else {
      console.log('[Feishu] 跳过图片发送:', {
        hasQrCodePath: !!details.qrCodePath,
        mode: this.mode,
        hasReceiveId: !!details.receiveId
      });
    }

    // 构建卡片消息
    const card = {
      header: {
        title: {
          tag: 'plain_text',
          content: '🔔 微信视频号登录状态告警'
        },
        template: statusColor
      },
      elements: [
        {
          tag: 'div',
          fields: [
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**账号**\n${accountLabel}`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**状态**\n${statusText}`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**检测时间**\n${timestamp}`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**账号ID**\n${accountInfo.id}`
              }
            }
          ]
        },
        {
          tag: 'hr'
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**处理建议**\n${actionText}`
          }
        }
      ]
    };

    // 添加错误详情
    if (details.error) {
      card.elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**错误信息**\n${details.error}`
        }
      });
    }

    // 添加操作按钮
    if (status === 'logged_out' || status === 'need_login') {
      card.elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '前往登录'
            },
            type: 'primary',
            url: details.loginUrl || 'http://localhost:3001'
          }
        ]
      });
    }

    console.log('[Feishu] 准备发送卡片消息...');
    const result = await this.sendCard(card, details.receiveIdType, details.receiveId);
    console.log('[Feishu] 卡片消息发送结果:', result);
    return result;
  }

  /**
   * 发送 AutoPilot 状态通知
   */
  async sendAutoPilotNotification(type, data) {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    let title = '';
    let color = '';
    let content = [];

    switch (type) {
      case 'started':
        title = '🚀 AutoPilot 已启动';
        color = 'blue';
        content = [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**启动时间**\n${timestamp}\n\n**任务数量**\n${data.count || 0} 个视频`
            }
          }
        ];
        break;

      case 'completed':
        title = '✅ AutoPilot 任务完成';
        color = 'green';
        content = [
          {
            tag: 'div',
            fields: [
              {
                is_short: true,
                text: {
                  tag: 'lark_md',
                  content: `**成功**\n${data.success || 0}`
                }
              },
              {
                is_short: true,
                text: {
                  tag: 'lark_md',
                  content: `**失败**\n${data.failed || 0}`
                }
              }
            ]
          }
        ];
        break;

      case 'error':
        title = '❌ AutoPilot 执行失败';
        color = 'red';
        content = [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**错误信息**\n${data.error || '未知错误'}`
            }
          }
        ];
        break;

      default:
        return { success: false, reason: 'unknown_type' };
    }

    const card = {
      header: {
        title: {
          tag: 'plain_text',
          content: title
        },
        template: color
      },
      elements: content
    };

    return await this.sendCard(card);
  }

  /**
   * 发送 AI 审核通知
   */
  async sendReviewNotification(videoTitle, reviewResult) {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const passed = reviewResult.passed;
    const score = reviewResult.overall_score;

    const card = {
      header: {
        title: {
          tag: 'plain_text',
          content: passed ? '✅ AI审核通过' : '⚠️ AI审核未通过'
        },
        template: passed ? 'green' : 'orange'
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**视频标题**\n${videoTitle}`
          }
        },
        {
          tag: 'div',
          fields: [
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**综合得分**\n${score}/100`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**审核时间**\n${timestamp}`
              }
            }
          ]
        },
        {
          tag: 'hr'
        },
        {
          tag: 'div',
          fields: [
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**内容质量**\n${reviewResult.scores.content}分`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**字幕准确性**\n${reviewResult.scores.subtitle}分`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**标题吸引力**\n${reviewResult.scores.title}分`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**剪辑质量**\n${reviewResult.scores.editing}分`
              }
            }
          ]
        }
      ]
    };

    // 添加修复建议
    if (!passed && reviewResult.fix_suggestions && reviewResult.fix_suggestions.length > 0) {
      const suggestions = reviewResult.fix_suggestions.slice(0, 3).map(s =>
        `• [${s.category}] ${s.issue}`
      ).join('\n');

      card.elements.push({
        tag: 'hr'
      });
      card.elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**修复建议**\n${suggestions}`
        }
      });
    }

    return await this.sendCard(card);
  }
}

/**
 * 创建飞书通知服务实例
 */
function createFeishuService(config) {
  return new FeishuNotificationService(config);
}

module.exports = {
  FeishuNotificationService,
  createFeishuService
};
