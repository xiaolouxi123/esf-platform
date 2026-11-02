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

test('管理员删除头衔，成员自动清空', async () => {
  const removed = await api('DELETE', `/api/titles/${titleId}`, { token: tokens.owner });
  assert.equal(removed.status, 200);
  titleId = null;

  const me = await api('GET', '/api/me', { token: tokens.user });
  assert.equal(me.body.data.user.titleId, null);
});
