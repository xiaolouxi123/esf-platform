'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const names = {
  owner: `t_owner_${stamp}`,
  admin: `t_admin_${stamp}`,
  ops: `t_ops_${stamp}`,
  user: `t_user_${stamp}`,
};
const password = 'TitlePass_1';

let server;
let base;
let ids = {};
let tokens = {};
let titleId;
let noviceKey = `t_novice_${stamp}`;

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function login(username) {
  const res = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `登录失败: ${username}`);
  return res.body.data.accessToken;
}

before(async () => {
  assert.ok(await ping(), '数据库不可用');
  const hash = bcrypt.hashSync(password, 4);
  for (const role of ['owner', 'admin', 'ops', 'user']) {
    const result = await q(
      'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
      [names[role], hash, role, role]
    );
    ids[role] = result.insertId;
  }

  await q(
    `INSERT INTO servers (server_key, name, ip, port, enabled, mode)
     VALUES (?, '测试新手房', '127.0.0.1', 27099, 1, '新手')`,
    [noviceKey]
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const role of ['owner', 'admin', 'ops', 'user']) {
    tokens[role] = await login(names[role]);
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await q('DELETE FROM users WHERE username IN (?, ?, ?, ?)', [
    names.owner,
    names.admin,
    names.ops,
    names.user,
  ]);
  if (titleId) await q('DELETE FROM titles WHERE id = ?', [titleId]);
  await q('DELETE FROM servers WHERE server_key = ?', [noviceKey]);
  await close();
});

test('头衔列表可读', async () => {
  const res = await api('GET', '/api/titles', { token: tokens.user });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.titles));
  assert.ok(res.body.data.titles.length >= 5);
});

test('普通玩家不能创建头衔', async () => {
  const res = await api('POST', '/api/titles', {
    token: tokens.user,
    body: { name: `x_${stamp}`, color: '#123456', rank: 1 },
  });
  assert.equal(res.status, 403);
});

test('管理员创建头衔，运营授予玩家', async () => {
  const created = await api('POST', '/api/titles', {
    token: tokens.admin,
    body: { name: `头衔_${stamp}`, color: '#12AB34', rank: 66 },
  });
  assert.equal(created.status, 201);
  titleId = created.body.data.title.id;
  assert.equal(created.body.data.title.color, '#12AB34');

  const assigned = await api('PATCH', '/api/assign-title', {
    token: tokens.ops,
    body: { userId: ids.user, titleId },
  });
  assert.equal(assigned.status, 200);

  const list = await api('GET', '/api/titles', { token: tokens.user });
  const found = list.body.data.titles.find((item) => item.id === titleId);
  assert.equal(found.memberCount, 1);
});

test('自定义头像保存与清除', async () => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const saved = await api('PATCH', '/api/me', {
    token: tokens.user,
    body: { avatarData: png },
  });
  assert.equal(saved.status, 200);

  const me = await api('GET', '/api/me', { token: tokens.user });
  assert.equal(me.body.data.user.avatarUrl, png);
  assert.ok(me.body.data.user.titleId === titleId);

  const cleared = await api('PATCH', '/api/me', {
    token: tokens.user,
    body: { avatarData: '' },
  });
  assert.equal(cleared.status, 200);

  const after = await api('GET', '/api/me', { token: tokens.user });
  assert.equal(after.body.data.user.avatarUrl, '');
});

test('成员名册包含离线成员和权限等级', async () => {
  const res = await api('GET', '/api/members', { token: tokens.user });
  assert.equal(res.status, 200);
  const list = res.body.data.members;
  assert.ok(Array.isArray(list));
  const target = list.find((item) => item.id === ids.owner);
  assert.ok(target, '名册里应该有成员');
  assert.equal(target.role, 'owner');
  assert.equal(typeof target.online, 'boolean');
});

test('成员详情包含战绩与权限', async () => {
  const res = await api('GET', `/api/members/${ids.user}`, { token: tokens.user });
  assert.equal(res.status, 200);
  const member = res.body.data.member;
  assert.equal(member.username, names.user);
  assert.equal(member.role, 'user');
  assert.equal(typeof member.sessions, 'number');
  assert.equal(typeof member.totalSeconds, 'number');
});

test('管理员设置格斗等级，新手房拒绝已定级玩家', async () => {
  const before = await api('GET', `/api/members/${ids.user}`, { token: tokens.user });
  assert.equal(before.body.data.member.combatLevel, 0);

  const denied = await api('PATCH', `/api/members/${ids.user}/combat-level`, {
    token: tokens.ops,
    body: { combatLevel: 2 },
  });
  assert.equal(denied.status, 403);

  const changed = await api('PATCH', `/api/members/${ids.user}/combat-level`, {
    token: tokens.admin,
    body: { combatLevel: 2 },
  });
  assert.equal(changed.status, 200);

  const novice = await api('POST', '/api/launch-token', {
    token: tokens.user,
    body: { serverKey: noviceKey },
  });
  assert.equal(novice.status, 400);
  assert.match(novice.body.message, /格斗等级/);
});

test('金币按在线/游戏时长结算', async () => {
  await api('POST', '/api/presence', { token: tokens.user, body: { state: 'lobby' } });
  await q('UPDATE wallets SET last_earned_at = (NOW() - INTERVAL 2 MINUTE) WHERE user_id = ?', [
    ids.user,
  ]);
  const ping = await api('POST', '/api/presence', {
    token: tokens.user,
    body: { state: 'ingame' },
  });
  assert.equal(ping.status, 200);
  assert.ok(ping.body.data.wallet.coins >= 4);

  const summary = await api('GET', '/api/economy/summary', { token: tokens.user });
  assert.equal(summary.status, 200);
  assert.ok(summary.body.data.wallet.coins >= 4);
  assert.ok(summary.body.data.transactions.length >= 1);
});

test('管理员删除头衔，成员自动清空', async () => {
  const removed = await api('DELETE', `/api/titles/${titleId}`, { token: tokens.owner });
  assert.equal(removed.status, 200);
  titleId = null;

  const me = await api('GET', '/api/me', { token: tokens.user });
  assert.equal(me.body.data.user.titleId, null);
});
