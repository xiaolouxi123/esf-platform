'use strict';

/**
 * 主进程里的平台 API 客户端。
 *
 * 为什么 HTTP 请求放在主进程而不是渲染层：
 *   1. 渲染层拿不到 JWT，页面被注入脚本也偷不走凭证
 *   2. 不受 CORS 限制，也不用在 index.html 里放宽 CSP
 */

const DEFAULT_BASE = 'http://127.0.0.1:3000';
const TIMEOUT_MS = 8000;

class ApiError extends Error {
  constructor(message, code = 'API_ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function normalizeBase(url) {
  const raw = String(url || DEFAULT_BASE).trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

async function request(settings, { method = 'GET', path, body, token } = {}) {
  const base = normalizeBase(settings && settings.apiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload || payload.ok !== true) {
      const message = (payload && payload.message) || `平台服务返回异常（HTTP ${res.status}）`;
      throw new ApiError(message, (payload && payload.code) || `HTTP_${res.status}`, res.status);
    }

    return payload.data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') {
      throw new ApiError('连接平台服务超时，请确认后端已启动', 'TIMEOUT');
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
      throw new ApiError(`连不上平台服务（${base}），请先启动 server`, 'BACKEND_UNREACHABLE');
    }
    throw new ApiError(`网络错误：${err.message}`, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

const health = (settings) => request(settings, { path: '/api/health' });
const config = (settings) => request(settings, { path: '/api/config' });

const register = (settings, payload) =>
  request(settings, { method: 'POST', path: '/api/auth/register', body: payload });

const login = (settings, username, password) =>
  request(settings, { method: 'POST', path: '/api/auth/login', body: { username, password } });

const logout = (settings, token) =>
  request(settings, { method: 'POST', path: '/api/auth/logout', token });

const me = (settings, token) => request(settings, { path: '/api/me', token });

const stats = (settings, token) => request(settings, { path: '/api/me/stats', token });

const servers = (settings, token) => request(settings, { path: '/api/servers', token });

const launchToken = (settings, token, serverKey) =>
  request(settings, { method: 'POST', path: '/api/launch-token', token, body: { serverKey } });

module.exports = {
  ApiError,
  normalizeBase,
  health,
  config,
  register,
  login,
  logout,
  me,
  stats,
  servers,
  launchToken,
};
