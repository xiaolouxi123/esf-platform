'use strict';

// 必须在 require 项目模块之前设置，限流器会读它
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const username = `t_${stamp}`;
const password = 'Passw0rd_test';

const ownerUsername = `o_${stamp}`;
const ownerPassword = 'OwnerPass_1';
const adminUsername = `a_${stamp}`;
const adminPassword = 'AdminPass_1';
const opsUsername = `ops_${stamp}`;
const opsPassword = 'OpsPass_123';
const victimUsername = `v_${stamp}`;
const victimPassword = 'VictimPass_1';

let ownerId;
let adminId;
let opsId;
let victimId;
let ownerToken;
let adminToken;
let opsToken;

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

  // 造 4 个账号：所有者 / 管理员 / 待升级（运营）/ 被封禁目标
  const insertUser = (name, pwd, nick, role) =>
    q('INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)', [
      name,
      bcrypt.hashSync(pwd, 4),
      nick,
      role,
    ]);

  ownerId = (await insertUser(ownerUsername, ownerPassword, '测试所有者', 'owner')).insertId;
  adminId = (await insertUser(adminUsername, adminPassword, '测试管理员', 'admin')).insertId;
  opsId = (await insertUser(opsUsername, opsPassword, '待升级运营', 'user')).insertId;
  victimId = (await insertUser(victimUsername, victimPassword, '待封禁玩家', 'user')).insertId;

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await q('DELETE FROM users WHERE username IN (?, ?, ?, ?, ?)', [
    username,
    ownerUsername,
    adminUsername,
    opsUsername,
    victimUsername,
  ]).catch(() => {});
  await q('DELETE FROM audit_logs WHERE target_id IN (?, ?, ?, ?)', [ownerId, adminId, opsId, victimId]).catch(() => {});
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

test('资源：特效 sprite 可上传（.spr）', async () => {
  const payload = Buffer.alloc(64, 2);
  const form = new FormData();
  form.append('kind', 'sprite');
  form.append('name', '光束特效');
  form.append('version', '1.0.0');
  form.append('targetPath', 'sprites/beam.spr');
  form.append('file', new Blob([payload], { type: 'application/octet-stream' }), 'beam.spr');

  const res = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.data.asset.kind, 'sprite');
  assert.equal(json.data.asset.status, 'pending');

  const pub = await api('GET', '/api/assets?kind=sprite');
  assert.ok(!pub.body.data.assets.some((item) => item.id === json.data.asset.id), '待审特效不应出现在公开列表');

  const rows = await q('SELECT stored_name FROM assets WHERE id = ?', [json.data.asset.id]);
  await q('DELETE FROM assets WHERE id = ?', [json.data.asset.id]);
  if (rows[0]) {
    fs.rmSync(path.join(__dirname, '..', 'uploads', 'sprite', rows[0].stored_name), { force: true });
  }
});
test('资源：封面图片随资源保存，待审封面不公开', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  const form = new FormData();
  form.append('kind', 'model');
  form.append('name', '带封面模型');
  form.append('version', '1.0.0');
  form.append('targetPath', 'models/test/cover.mdl');
  form.append('file', new Blob([Buffer.alloc(32, 3)]), 'cover.mdl');
  form.append('cover', new Blob([png], { type: 'image/png' }), 'cover.png');

  const res = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  const asset = json.data.asset;
  assert.match(asset.coverUrl, /\/api\/assets\/\d+\/cover$/);
  assert.equal(asset.coverMime, 'image/png');

  const anonymous = await fetch(`${base}${asset.coverUrl}`);
  assert.equal(anonymous.status, 404, '待审资源封面不应公开');

  const asAuthor = await fetch(`${base}${asset.coverUrl}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(asAuthor.status, 200);
  assert.equal(asAuthor.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await asAuthor.arrayBuffer());
  assert.equal(bytes.length, png.length);

  const rows = await q('SELECT stored_name, cover_name FROM assets WHERE id = ?', [asset.id]);
  await q('DELETE FROM assets WHERE id = ?', [asset.id]);
  if (rows[0]) {
    fs.rmSync(path.join(__dirname, '..', 'uploads', 'model', rows[0].stored_name), { force: true });
    if (rows[0].cover_name) {
      fs.rmSync(path.join(__dirname, '..', 'uploads', 'covers', rows[0].cover_name), { force: true });
    }
  }
});
test('管理台：普通玩家访问管理接口返回 403', async () => {
  const res = await api('GET', '/api/admin/users', { token: accessToken });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('管理台：所有者能看概览与玩家列表，角色按等级排序', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { username: ownerUsername, password: ownerPassword },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.data.user.role, 'owner');
  ownerToken = login.body.data.accessToken;

  const overview = await api('GET', '/api/admin/overview', { token: ownerToken });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.data.users.total >= 4);
  assert.ok(overview.body.data.users.owners >= 1);

  const users = await api('GET', '/api/admin/users?limit=50', { token: ownerToken });
  assert.equal(users.status, 200);
  const roles = users.body.data.users.map((item) => item.username === ownerUsername ? item.role : null);
  assert.ok(roles.includes('owner'));
  assert.ok(users.body.data.users.some((item) => item.username === adminUsername));
});

test('管理台：所有者不能改自己', async () => {
  const res = await api('PATCH', `/api/admin/users/${ownerId}`, {
    token: ownerToken,
    body: { role: 'user' },
  });
  assert.equal(res.status, 400);
});

test('管理台：管理员也不能修改所有者', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { username: adminUsername, password: adminPassword },
  });
  adminToken = login.body.data.accessToken;

  const res = await api('PATCH', `/api/admin/users/${ownerId}`, {
    token: adminToken,
    body: { status: 'banned' },
  });
  assert.equal(res.status, 403);
  assert.match(res.body.message, /所有者/);
});

test('管理台：可以升为运营，但运营不能改角色、碰不了管理员', async () => {
  const promote = await api('PATCH', `/api/admin/users/${opsId}`, {
    token: ownerToken,
    body: { role: 'ops' },
  });
  assert.equal(promote.status, 200, JSON.stringify(promote.body));
  assert.equal(promote.body.data.user.role, 'ops');

  const login = await api('POST', '/api/auth/login', {
    body: { username: opsUsername, password: opsPassword },
  });
  assert.equal(login.status, 200);
  opsToken = login.body.data.accessToken;

  const staffList = await api('GET', '/api/admin/users', { token: opsToken });
  assert.equal(staffList.status, 200, '运营可以看列表');

  const roleChange = await api('PATCH', `/api/admin/users/${adminId}`, {
    token: opsToken,
    body: { role: 'ops' },
  });
  assert.equal(roleChange.status, 403, '运营不能改角色');

  const touchAdmin = await api('PATCH', `/api/admin/users/${adminId}`, {
    token: opsToken,
    body: { status: 'banned' },
  });
  assert.equal(touchAdmin.status, 403, '运营不能封管理员');
});

test('管理台：运营只能封禁玩家或作者', async () => {
  const ok = await api('PATCH', `/api/admin/users/${victimId}`, {
    token: opsToken,
    body: { status: 'banned' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const audit = await q(
    "SELECT action, actor_name FROM audit_logs WHERE action = 'user.ban' AND target_id = ? ORDER BY id DESC LIMIT 1",
    [victimId]
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_name, opsUsername);
});

test('管理台：强制下线后旧 JWT 立即失效', async () => {
  const kick = await api('POST', `/api/admin/users/${opsId}/kick`, { token: ownerToken });
  assert.equal(kick.status, 200);

  const me = await api('GET', '/api/me', { token: opsToken });
  assert.equal(me.status, 401);
});

test('管理台：封禁后无法登录', async () => {
  const ban = await api('PATCH', `/api/admin/users/${opsId}`, {
    token: ownerToken,
    body: { status: 'banned' },
  });
  assert.equal(ban.status, 200);
  assert.equal(ban.body.data.user.status, 'banned');

  const login = await api('POST', '/api/auth/login', {
    body: { username: opsUsername, password: opsPassword },
  });
  assert.equal(login.status, 403);
});

test('管理台：审计日志可查，且普通玩家无权看', async () => {
  const denied = await api('GET', '/api/admin/audit', { token: accessToken });
  assert.equal(denied.status, 403);

  const res = await api('GET', '/api/admin/audit?limit=20', { token: ownerToken });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.data.logs.length >= 3);
  const actions = res.body.data.logs.map((item) => item.action);
  assert.ok(actions.includes('user.role'));
  assert.ok(actions.includes('user.ban'));
  assert.ok(actions.includes('user.kick'));

  const filtered = await api('GET', '/api/admin/audit?action=user.kick', { token: ownerToken });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.data.logs.every((item) => item.action === 'user.kick'));
});

test('房间详情：必须给 serverKey 或 address', async () => {
  const res = await api('GET', '/api/servers/detail', { token: accessToken });
  assert.equal(res.status, 400);
});

test('房间详情：未登记的 serverKey 返回 404', async () => {
  const res = await api('GET', '/api/servers/detail?serverKey=no-such-room', { token: accessToken });
  assert.equal(res.status, 404);
});

test('房间详情：非法地址返回 400', async () => {
  const res = await api('GET', '/api/servers/detail?address=bad', { token: accessToken });
  assert.equal(res.status, 400);
});

test('运营设置：公告与维护模式可改，普通玩家无权', async () => {
  const denied = await api('PATCH', '/api/admin/platform', {
    token: accessToken,
    body: { notice: '不该生效' },
  });
  assert.equal(denied.status, 403);

  const res = await api('PATCH', '/api/admin/platform', {
    token: ownerToken,
    body: { notice: '测试公告：今晚 20 点维护', maintenance: true, maintenanceText: '维护到 21 点' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.maintenance, true);

  const config = await api('GET', '/api/config');
  assert.equal(config.body.data.notice, '测试公告：今晚 20 点维护');
  assert.equal(config.body.data.maintenance, true);
  assert.equal(config.body.data.maintenanceText, '维护到 21 点');

  const reset = await api('PATCH', '/api/admin/platform', {
    token: ownerToken,
    body: { notice: '', maintenance: false, maintenanceText: '' },
  });
  assert.equal(reset.status, 200);
  const after = await api('GET', '/api/config');
  assert.equal(after.body.data.maintenance, false);
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

test('头像：PATCH /api/me 能保存 emoji', async () => {
  const res = await api('PATCH', '/api/me', {
    token: accessToken,
    body: { avatar: '🐉' },
  });
  assert.equal(res.status, 200);

  const me = await api('GET', '/api/me', { token: accessToken });
  assert.equal(me.body.data.user.avatar, '🐉');
});

test('在线状态：心跳后出现在在线列表并标注状态', async () => {
  const ping = await api('POST', '/api/presence', {
    token: accessToken,
    body: { state: 'ingame', serverKey: 'fcx-1v1-1' },
  });
  assert.equal(ping.status, 200);
  assert.equal(ping.body.data.state, 'ingame');

  const list = await api('GET', '/api/presence', { token: accessToken });
  assert.equal(list.status, 200);
  const self = list.body.data.online.find((item) => item.username === username);
  assert.ok(self, '自己应该在在线列表里');
  assert.equal(self.state, 'ingame');
  assert.equal(self.serverKey, 'fcx-1v1-1');
});

test('大厅频道：发消息并拉取', async () => {
  const sent = await api('POST', '/api/chat', {
    token: accessToken,
    body: { body: '接口自测消息' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.message.body, '接口自测消息');
  assert.equal(sent.body.data.message.user.username, username);

  const list = await api('GET', '/api/chat', { token: accessToken });
  assert.equal(list.status, 200);
  assert.ok(list.body.data.messages.some((item) => item.body === '接口自测消息'));

  const after = await api('GET', `/api/chat?after=${sent.body.data.message.id}`, { token: accessToken });
  assert.equal(after.status, 200);
  assert.equal(after.body.data.messages.length, 0);
});

test('大厅频道：空消息被拒绝', async () => {
  const res = await api('POST', '/api/chat', { token: accessToken, body: { body: '   ' } });
  assert.equal(res.status, 400);
});

test('版本信息：config 返回 latestVersion 与下载地址字段', async () => {
  const res = await api('GET', '/api/config');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.latestVersion, 'string');
  assert.ok('releaseNotes' in res.body.data);
  assert.ok('downloadUrl' in res.body.data);
});

test('退出登录：旧 JWT 立即失效', async () => {
  const res = await api('POST', '/api/auth/logout', { token: accessToken });
  assert.equal(res.status, 200);

  const me = await api('GET', '/api/me', { token: accessToken });
  assert.equal(me.status, 401);
  assert.equal(me.body.code, 'AUTH_REQUIRED');
});

// 转让所有权会改两个人的角色并让双方 token 失效，放在最后跑
test('所有者可以转让所有权，双方旧 JWT 失效且写入审计', async () => {
  const res = await api('POST', '/api/admin/owner/transfer', {
    token: ownerToken,
    body: { userId: adminId },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.owner, adminUsername);

  const rows = await q('SELECT username, role FROM users WHERE username IN (?, ?)', [
    ownerUsername,
    adminUsername,
  ]);
  const byName = Object.fromEntries(rows.map((row) => [row.username, row.role]));
  assert.equal(byName[adminUsername], 'owner', '接手人应成为所有者');
  assert.equal(byName[ownerUsername], 'admin', '原所有者降为管理员');

  const oldOwner = await api('GET', '/api/me', { token: ownerToken });
  assert.equal(oldOwner.status, 401, '原所有者旧 JWT 应失效');
  const oldAdmin = await api('GET', '/api/me', { token: adminToken });
  assert.equal(oldAdmin.status, 401, '接手人旧 JWT 也应失效');

  const logs = await q(
    "SELECT action, detail FROM audit_logs WHERE action = 'owner.transfer' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(logs.length, 1);
});
