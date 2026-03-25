function sendError(res, options = {}) {
  const status = Number(options.status || 500);
  const payload = {
    success: false,
    error: String(options.error || '请求失败'),
    code: String(options.code || 'INTERNAL_ERROR'),
    stage: String(options.stage || 'request'),
    details: String(options.details || ''),
    hint: String(options.hint || '')
  };
  return res.status(status).json(payload);
}

module.exports = {
  sendError
};
