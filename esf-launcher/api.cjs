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

const lookupServer = (settings, token, address) =>
  request(settings, {
    path: `/api/servers/lookup?address=${encodeURIComponent(address)}`,
    token,
  });

/** 单个房间实时详情（含玩家列表），展开行用 */
const serverDetail = (settings, token, params) =>
  request(settings, { path: `/api/servers/detail${queryString(params)}`, token });

const launchToken = (settings, token, serverKey) =>
  request(settings, { method: 'POST', path: '/api/launch-token', token, body: { serverKey } });

/* ---------------- 资源库 ---------------- */

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const assets = (settings, params) => request(settings, { path: `/api/assets${queryString(params)}` });

const assetDetail = (settings, id) => request(settings, { path: `/api/assets/${id}` });

const setAssetStatus = (settings, token, id, status) =>
  request(settings, { method: 'PATCH', path: `/api/assets/${id}/status`, token, body: { status } });

/** 上传：multipart 里 kind 必须排在 file 前面，multer 靠它决定目录与扩展名白名单 */
async function uploadAsset(settings, token, fields, fileBuffer, fileName) {
  const base = normalizeBase(settings && settings.apiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const form = new FormData();
    form.append('kind', fields.kind);
    form.append('name', fields.name);
    if (fields.version) form.append('version', fields.version);
    form.append('targetPath', fields.targetPath);
    if (fields.description) form.append('description', fields.description);
    form.append('file', new Blob([fileBuffer]), fileName);

    const res = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload || payload.ok !== true) {
      throw new ApiError(
        (payload && payload.message) || `上传失败（HTTP ${res.status}）`,
        (payload && payload.code) || `HTTP_${res.status}`,
        res.status
      );
    }
    return payload.data.asset;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError('上传超时，请检查网络或文件大小', 'TIMEOUT');
    throw new ApiError(`上传失败：${err.message}`, 'UPLOAD_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

/** 下载资源为 Buffer，供主进程校验 sha256 后写入模组目录 */
async function downloadAsset(settings, token, id) {
  const base = normalizeBase(settings && settings.apiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${base}/api/assets/${id}/download`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `下载失败（HTTP ${res.status}）`;
      try {
        const payload = await res.json();
        if (payload && payload.message) message = payload.message;
      } catch {
        /* 非 JSON 响应 */
      }
      throw new ApiError(message, `HTTP_${res.status}`, res.status);
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError('下载超时', 'TIMEOUT');
    throw new ApiError(`下载失败：${err.message}`, 'DOWNLOAD_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 管理台 ---------------- */

const adminOverview = (settings, token) => request(settings, { path: '/api/admin/overview', token });

const adminUsers = (settings, token, params) =>
  request(settings, { path: `/api/admin/users${queryString(params)}`, token });

const adminUpdateUser = (settings, token, id, patch) =>
  request(settings, { method: 'PATCH', path: `/api/admin/users/${id}`, token, body: patch });

const adminKickUser = (settings, token, id) =>
  request(settings, { method: 'POST', path: `/api/admin/users/${id}/kick`, token });

const adminAssets = (settings, token, status) =>
  request(settings, { path: `/api/admin/assets${queryString({ status })}`, token });

const adminAudit = (settings, token, params) =>
  request(settings, { path: `/api/admin/audit${queryString(params)}`, token });

const adminTransferOwner = (settings, token, userId) =>
  request(settings, { method: 'POST', path: '/api/admin/owner/transfer', token, body: { userId } });

const adminPlatform = (settings, token) =>
  request(settings, { path: '/api/admin/platform', token });

const adminUpdatePlatform = (settings, token, patch) =>
  request(settings, { method: 'PATCH', path: '/api/admin/platform', token, body: patch });

/* ---------------- 社交：在线状态 / 大厅频道 ---------------- */

const pingPresence = (settings, token, payload) =>
  request(settings, { method: 'POST', path: '/api/presence', token, body: payload });

const presenceList = (settings, token) => request(settings, { path: '/api/presence', token });

const chatList = (settings, token, after) =>
  request(settings, { path: `/api/chat${queryString({ after })}`, token });

const chatSend = (settings, token, body) =>
  request(settings, { method: 'POST', path: '/api/chat', token, body: { body } });

const updateProfile = (settings, token, patch) =>
  request(settings, { method: 'PATCH', path: '/api/me', token, body: patch });

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
  lookupServer,
  serverDetail,
  launchToken,
  assets,
  assetDetail,
  setAssetStatus,
  uploadAsset,
  downloadAsset,
  adminOverview,
  adminUsers,
  adminUpdateUser,
  adminKickUser,
  adminAssets,
  adminAudit,
  adminTransferOwner,
  adminPlatform,
  adminUpdatePlatform,
  pingPresence,
  presenceList,
  chatList,
  chatSend,
  updateProfile,
};
