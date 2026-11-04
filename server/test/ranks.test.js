'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const password = 'RankPass_1';
const ownerName = `t_rank_owner_${stamp}`;
const playerName = `t_rank_player_${stamp}`;
const ids = [];
let ownerToken;
let playerToken;
let server;
let base;
let original;

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
  for (const [index, username] of [ownerName, playerName].entries()) {
    const result = await q(
      'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
      [username, hash, `等级${index}`, index === 0 ? 'owner' : 'user']
    );
    ids.push(result.insertId);
  }

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerToken = await login(ownerName);
  playerToken = await login(playerName);
  const current = await api('GET', '/api/admin/ranks', { token: ownerToken });
  original = current.body.data.ranks;
});

after(async () => {
  if (original) {
    await api('PUT', '/api/admin/ranks', {
      token: ownerToken,
      body: { ranks: original },
    });
  }
  await new Promise((resolve) => server.close(resolve));
  if (ids.length) await q('DELETE FROM users WHERE id IN (?, ?)', ids);
  await close();
});

test('格斗等级：公开读取、权限与完整保存', async () => {
  const publicList = await api('GET', '/api/ranks');
  assert.equal(publicList.status, 200);
  assert.equal(publicList.body.data.ranks.length, 7);
  assert.deepEqual(
    publicList.body.data.ranks.map((rank) => rank.level),
    [0, 1, 2, 3, 4, 5, 6]
  );

  const denied = await api('GET', '/api/admin/ranks', { token: playerToken });
  assert.equal(denied.status, 403);

  const invalid = await api('PUT', '/api/admin/ranks', {
    token: ownerToken,
    body: { ranks: original.slice(0, 6) },
  });
  assert.equal(invalid.status, 400);

  const changed = original.map((rank) =>
    rank.level === 6 ? { ...rank, name: 'S+', color: '#FFAA33', sortOrder: 9 } : rank
  );
  const saved = await api('PUT', '/api/admin/ranks', {
    token: ownerToken,
    body: { ranks: changed },
  });
  assert.equal(saved.status, 200);
  const top = saved.body.data.ranks.find((rank) => rank.level === 6);
  assert.equal(top.name, 'S+');
  assert.equal(top.color, '#FFAA33');
  assert.equal(top.sortOrder, 9);
});
