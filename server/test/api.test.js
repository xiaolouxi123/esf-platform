'use strict';

// 必须在 require 项目模块之前设置，限流器会读它
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const username = `t_${stamp}`;
const password = 'Passw0rd_test';

let server;
let base;
let accessToken;

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

before(async () => {
  const dbUp = await ping();
  assert.ok(dbUp, '数据库不可用：请先 npm run db:start 并 npm run migrate');

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await q('DELETE FROM users WHERE username = ?', [username]).catch(() => {});
  await close();
});

test('GET /api/health 返回 db up', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.db, 'up');
});

test('注册：弱密码被 zod 拒绝', async () => {
  const res = await api('POST', '/api/auth/register', {
    body: { username: `x_${stamp}`, password: '123' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_FAILED');
});

test('注册：成功返回 201', async () => {
  const res = await api('POST', '/api/auth/register', {
    body: { username, password, gameName: '悟空' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.user.username, username);
  assert.equal(res.body.data.user.gameName, '悟空');
  assert.equal(res.body.data.user.role, 'user');
});

test('注册：重复账号返回 409', async () => {
  const res = await api('POST', '/api/auth/register', {
    body: { username, password },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONFLICT');
});

test('登录：密码错误返回 401 且写审计', async () => {
  const res = await api('POST', '/api/auth/login', {
    body: { username, password: 'wrong-password' },
  });
  assert.equal(res.status, 401);

  const logs = await q(
    'SELECT reason FROM login_logs WHERE username = ? ORDER BY id DESC LIMIT 1',
    [username]
  );
  assert.equal(logs[0].reason, 'BAD_PASSWORD');
});

test('登录：成功发 JWT', async () => {
  const res = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.data.accessToken, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(res.body.data.expiresIn, 604800);
  accessToken = res.body.data.accessToken;
});

test('GET /api/me：无 token 401，有 token 返回本人', async () => {
  const noToken = await api('GET', '/api/me');
  assert.equal(noToken.status, 401);

  const withToken = await api('GET', '/api/me', { token: accessToken });
  assert.equal(withToken.status, 200);
  assert.equal(withToken.body.data.user.username, username);
});

test('GET /api/servers：返回种子服务器', async () => {
  const res = await api('GET', '/api/servers', { token: accessToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.servers.length >= 1);
  const seeded = res.body.data.servers.find((s) => s.serverKey === 'fcx-1v1-1');
  assert.ok(seeded, '缺少 fcx-1v1-1');
  assert.equal(seeded.ip, '114.132.84.150');
  assert.equal(seeded.port, 27016);
});

test('直连查询：地址格式错误返回 400（不能挂住请求）', async () => {
  const res = await api('GET', '/api/servers/lookup?address=not-an-address', { token: accessToken });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'BAD_REQUEST');
});

test('资源：未登录不能上传', async () => {
  const form = new FormData();
  form.append('kind', 'sound');
  form.append('name', '未登录');
  form.append('targetPath', 'sound/anon.wav');
  form.append('file', new Blob([Buffer.from('RIFF')]), 'anon.wav');

  const res = await fetch(`${base}/api/assets`, { method: 'POST', body: form });
  assert.equal(res.status, 401);
});

test('资源：扩展名与路径校验', async () => {
  const wrongExt = new FormData();
  wrongExt.append('kind', 'sound');
  wrongExt.append('name', '错误格式');
  wrongExt.append('targetPath', 'sound/x.exe');
  wrongExt.append('file', new Blob([Buffer.from('x')]), 'x.exe');
  const bad = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: wrongExt,
  });
  assert.equal(bad.status, 400);

  const traversal = new FormData();
  traversal.append('kind', 'sound');
  traversal.append('name', '越界');
  traversal.append('targetPath', '../../evil.wav');
  traversal.append('file', new Blob([Buffer.from('RIFF')]), 'evil.wav');
  const trav = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: traversal,
  });
  assert.equal(trav.status, 400);
});

test('资源：上传进待审 → 公开列表不可见 → 匿名下载 404', async () => {
  const payload = Buffer.alloc(1024, 1);
  payload.write('RIFF', 0);

  const form = new FormData();
  form.append('kind', 'sound');
  form.append('name', '测试音效');
  form.append('version', '1.0.0');
  form.append('targetPath', 'sound/test/beep.wav');
  form.append('file', new Blob([payload], { type: 'audio/wav' }), 'beep.wav');

  const res = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  const asset = json.data.asset;
  assert.equal(asset.status, 'pending');
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);

  const pub = await api('GET', '/api/assets?kind=sound');
  assert.ok(!pub.body.data.assets.some((item) => item.id === asset.id), '待审资源不应出现在公开列表');

  const download = await fetch(`${base}/api/assets/${asset.id}/download`);
  assert.equal(download.status, 404);

  // 清理：数据库行 + 磁盘文件
  const rows = await q('SELECT stored_name FROM assets WHERE id = ?', [asset.id]);
  await q('DELETE FROM assets WHERE id = ?', [asset.id]);
  if (rows[0]) {
    fs.rmSync(path.join(__dirname, '..', 'uploads', 'sound', rows[0].stored_name), { force: true });
  }
});

test('连服 Token：未知服务器 404', async () => {
  const res = await api('POST', '/api/launch-token', {
    token: accessToken,
    body: { serverKey: 'no-such-server' },
  });
  assert.equal(res.status, 404);
});

test('连服 Token：签发 32 位 hex，重复请求复用同一条', async () => {
  const first = await api('POST', '/api/launch-token', {
    token: accessToken,
    body: { serverKey: 'fcx-1v1-1' },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const { token } = first.body.data;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(first.body.data.reused, false);

  const second = await api('POST', '/api/launch-token', {
    token: accessToken,
    body: { serverKey: 'fcx-1v1-1' },
  });
  assert.equal(second.body.data.reused, true);
  assert.equal(second.body.data.token, token);

  const rows = await q(
    'SELECT used_at, server_key FROM launch_tokens WHERE token = ?',
    [token]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].used_at, null);
  assert.equal(rows[0].server_key, 'fcx-1v1-1');
});

test('GET /api/config 返回公告与数据库状态', async () => {
  const res = await api('GET', '/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.db, 'up');
  assert.equal(typeof res.body.data.minLauncherVersion, 'string');
  assert.equal(typeof res.body.data.maintenance, 'boolean');
});

test('GET /api/me/stats 需要登录，返回聚合数据', async () => {
  const noToken = await api('GET', '/api/me/stats');
  assert.equal(noToken.status, 401);

  const res = await api('GET', '/api/me/stats', { token: accessToken });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.sessions, 'number');
  assert.equal(typeof res.body.data.totalSeconds, 'number');
});

test('退出登录：旧 JWT 立即失效', async () => {
  const res = await api('POST', '/api/auth/logout', { token: accessToken });
  assert.equal(res.status, 200);

  const me = await api('GET', '/api/me', { token: accessToken });
  assert.equal(me.status, 401);
  assert.equal(me.body.code, 'AUTH_REQUIRED');
});
