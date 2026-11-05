'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const username = `p_${stamp}`;
const secondUsername = `q_${stamp}`;
const password = 'ProfilePass_1';
const gameName = `昵称_${stamp}`;

let server;
let base;
let token;
let userId;
let secondUserId;

async function api(method, path, { token: accessToken, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

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
  await q('DELETE FROM users WHERE username IN (?, ?)', [username, secondUsername]).catch(() => {});
  await close();
});

test('注册：游戏昵称不能与已有账号名/游戏名重复', async () => {
  const first = await api('POST', '/api/auth/register', {
    body: { username, password, gameName },
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  userId = first.body.data.user.id;

  const duplicateGameName = await api('POST', '/api/auth/register', {
    body: { username: secondUsername, password, gameName },
  });
  assert.equal(duplicateGameName.status, 409);
  assert.equal(duplicateGameName.body.code, 'CONFLICT');

  const duplicateUsernameAsGameName = await api('POST', '/api/auth/register', {
    body: { username: `r_${stamp}`, password, gameName: username },
  });
  assert.equal(duplicateUsernameAsGameName.status, 409);
});

test('登录后 GET /me 返回改名元数据', async () => {
  const login = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  token = login.body.data.accessToken;

  const me = await api('GET', '/api/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.gameName, gameName);
  assert.equal(me.body.data.user.canChangeGameName, true);
  assert.equal(me.body.data.user.nextGameNameChangeAt, null);
});

test('PATCH /me：账号名不可修改', async () => {
  const res = await api('PATCH', '/api/me', {
    token,
    body: { username: `hack_${stamp}` },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'BAD_REQUEST');

  const me = await api('GET', '/api/me', { token });
  assert.equal(me.body.data.user.username, username);
});

test('PATCH /me：游戏昵称拒绝引号、反斜杠和控制字符', async () => {
  for (const badName of ['a"b', 'a\\b', 'a\nb']) {
    const res = await api('PATCH', '/api/me', {
      token,
      body: { gameName: badName },
    });
    assert.equal(res.status, 400, badName);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
  }

  const me = await api('GET', '/api/me', { token });
  assert.equal(me.body.data.user.gameName, gameName);
});

test('PATCH /me：游戏名每天只能修改一次，重复提交同值不消耗次数', async () => {
  const nextName = `新昵称_${stamp}`;
  const first = await api('PATCH', '/api/me', {
    token,
    body: { gameName: nextName },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const afterFirst = await api('GET', '/api/me', { token });
  assert.equal(afterFirst.body.data.user.gameName, nextName);
  assert.equal(afterFirst.body.data.user.canChangeGameName, false);
  assert.ok(afterFirst.body.data.user.nextGameNameChangeAt);

  const sameAgain = await api('PATCH', '/api/me', {
    token,
    body: { gameName: nextName },
  });
  assert.equal(sameAgain.status, 200, JSON.stringify(sameAgain.body));

  const secondChange = await api('PATCH', '/api/me', {
    token,
    body: { gameName: `再改_${stamp}` },
  });
  assert.equal(secondChange.status, 400);
  assert.match(secondChange.body.message, /每天只能修改一次/);
});

test('PATCH /me：改名撞到别人的账号名/游戏名返回 409', async () => {
  // 直接造一个已有用户，避免依赖上一条测试的顺序
  const takenName = `占用昵称_${stamp}`;
  const inserted = await q(
    'INSERT INTO users (username, password_hash, game_name) VALUES (?, ?, ?)',
    [secondUsername, 'x', takenName]
  );
  secondUserId = inserted.insertId;

  // 上一条测试已消耗今天的改名次数，这里重置后再测重名冲突。
  await q('UPDATE users SET game_name_updated_at = NULL WHERE id = ?', [userId]);

  const res = await api('PATCH', '/api/me', {
    token,
    body: { gameName: takenName },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONFLICT');

  await q('DELETE FROM users WHERE id = ?', [secondUserId]).catch(() => {});
  secondUserId = null;
});
