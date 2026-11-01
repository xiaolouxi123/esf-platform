'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../env');

function makeLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // 自动化测试不触发限流
    skip: () => env.nodeEnv === 'test',
    handler: (req, res) =>
      res.status(429).json({ ok: false, code: 'RATE_LIMITED', message }),
  });
}

const loginLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 5,
  message: '登录尝试过于频繁，请 1 分钟后再试',
});

const registerLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 3,
  message: '注册过于频繁，请 1 分钟后再试',
});

const chatLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 10,
  message: '发言太快了，请稍等一会儿',
});

module.exports = { loginLimiter, registerLimiter, chatLimiter };
