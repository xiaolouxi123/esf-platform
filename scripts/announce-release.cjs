/**
 * 发布公告到平台首页。
 *
 * 用法：
 *   $env:ESF_API_BASE="http://119.91.99.176:3000"
 *   $env:ESF_ADMIN_USER="yun"
 *   $env:ESF_ADMIN_PASS="..."
 *   $env:ESF_NOTICE="0.4.2 已发布：... "
 *   node scripts/announce-release.cjs
 *
 * 不要把账号密码写进仓库或命令行历史。
 */
const base = String(process.env.ESF_API_BASE || '').replace(/\/+$/, '');
const username = process.env.ESF_ADMIN_USER || '';
const password = process.env.ESF_ADMIN_PASS || '';
const notice = String(process.env.ESF_NOTICE || '').trim();

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body.data;
}

(async () => {
  if (!base || !username || !password || !notice) {
    throw new Error('需要 ESF_API_BASE / ESF_ADMIN_USER / ESF_ADMIN_PASS / ESF_NOTICE');
  }
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  await request('/api/admin/platform', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${login.accessToken}` },
    body: JSON.stringify({ notice: notice.slice(0, 300) }),
  });
  console.log('公告已发布:', notice);
})().catch((err) => {
  console.error('发布失败:', err.message);
  process.exitCode = 1;
});
