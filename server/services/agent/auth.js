function extractBearerToken(req) {
  const header = String(req.get?.('authorization') || req.headers?.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function extractAgentToken(req) {
  return String(
    extractBearerToken(req)
    || req.get?.('x-agent-token')
    || req.headers?.['x-agent-token']
    || req.query?.agentToken
    || ''
  ).trim();
}

function isLoopbackAddress(address = '') {
  const value = String(address || '').trim();
  return value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value === 'localhost';
}

function createAgentAuthMiddleware(options = {}) {
  const token = String(options.token || process.env.AGENT_API_TOKEN || '').trim();
  const allowWithoutToken = options.allowWithoutToken === true || process.env.AGENT_API_ALLOW_UNAUTHENTICATED === 'true';

  return function agentAuth(req, res, next) {
    if (!token) {
      if (allowWithoutToken && isLoopbackAddress(req.ip || req.socket?.remoteAddress)) {
        return next();
      }
      return res.status(503).json({
        success: false,
        error: 'AGENT_API_TOKEN 未配置，agent 接口已拒绝访问',
        code: 'AGENT_AUTH_TOKEN_NOT_CONFIGURED',
        stage: 'agent.auth',
        details: '',
        hint: '请在 .env 中设置 AGENT_API_TOKEN，并在 MCP server 环境变量中使用同一个值'
      });
    }

    if (extractAgentToken(req) !== token) {
      return res.status(401).json({
        success: false,
        error: 'agent token 无效或缺失',
        code: 'AGENT_AUTH_INVALID',
        stage: 'agent.auth',
        details: '',
        hint: '请求需携带 Authorization: Bearer <AGENT_API_TOKEN> 或 x-agent-token'
      });
    }

    return next();
  };
}

module.exports = {
  createAgentAuthMiddleware,
  extractAgentToken
};
