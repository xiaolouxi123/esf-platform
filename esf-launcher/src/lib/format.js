/** 一些展示用的格式化工具 */

export function initials(name) {
  const value = String(name || '?').trim();
  return value ? value.slice(0, 1).toUpperCase() : '?';
}

export function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds) || 0;
  if (seconds <= 0) return '—';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

export function formatRelative(isoString) {
  if (!isoString) return '还没有记录';

  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '还没有记录';

  const diffSeconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSeconds < 60) return '刚刚';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  if (diffSeconds < 86400 * 30) return `${Math.floor(diffSeconds / 86400)} 天前`;
  return new Date(then).toLocaleDateString('zh-CN');
}

/** 延迟分级：给卡片换个颜色 */
export function pingTone(ping) {
  const value = Number(ping);
  if (!Number.isFinite(value) || value < 0) return 'unknown';
  if (value <= 60) return 'good';
  if (value <= 140) return 'ok';
  return 'bad';
}

const ROLE_LABELS = {
  owner: '所有者',
  admin: '管理员',
  ops: '运营',
  creator: '作者',
  user: '玩家',
};

const ROLE_RANK = { user: 0, creator: 1, ops: 2, admin: 3, owner: 4 };

export function roleLabel(role) {
  return ROLE_LABELS[role] || '玩家';
}

export function roleRank(role) {
  return ROLE_RANK[role] ?? 0;
}

/** 能进管理台（运营及以上） */
export function isStaff(role) {
  return ['ops', 'admin', 'owner'].includes(role);
}

/** 管理员及以上：改角色、看审计、开发者工具 */
export function isAdminRole(role) {
  return ['admin', 'owner'].includes(role);
}

export function isOwner(role) {
  return role === 'owner';
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

/** 秒 → 12:34 / 1:02:03（玩家在线时长用） */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function loadFavoriteSet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export function saveFavoriteSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* 隐私模式下忽略 */
  }
}
