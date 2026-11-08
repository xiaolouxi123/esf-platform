'use strict';

/**
 * 基础安全响应头。API 与静态资源都过这一层；
 * HSTS 只在 HTTPS（含反代转发）时下发，避免本地 http 调试被浏览器记住。
 */
module.exports = function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (req.secure || forwarded === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // API 只回 JSON，不允许被当文档渲染；静态站点（website/updates）另放开。
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
};
