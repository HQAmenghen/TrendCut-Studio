function sendError(res, options = {}) {
  // 支持直接传入 Error 对象
  if (options instanceof Error) {
    const err = options;
    return sendError(res, {
      status: err.status || 500,
      code: err.code || 'INTERNAL_ERROR',
      stage: err.stage || 'request',
      error: err.message,
      details: err.details || '',
      hint: err.hint || ''
    });
  }

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
