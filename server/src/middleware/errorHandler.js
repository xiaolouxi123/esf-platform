'use strict';

const { ZodError } = require('zod');
const { ApiError } = require('../lib/errors');

function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    code: 'NOT_FOUND',
    message: `接口不存在: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      ok: false,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    // 旧版客户端只显示 message 字段，笼统的「参数不合法」会让人不知道为什么失败；
    // 直接把第一条字段错误提上来，details 保留完整列表给新客户端。
    const first = err.issues.find((issue) => issue.message);
    return res.status(400).json({
      ok: false,
      code: 'VALIDATION_FAILED',
      message: first ? first.message : '参数不合法',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', message: '请求体不是合法 JSON' });
  }

  if (err && err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ ok: false, code: 'CONFLICT', message: '数据已存在' });
  }

  console.error('[error]', req.method, req.originalUrl, err);
  return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
}

module.exports = { notFoundHandler, errorHandler };
