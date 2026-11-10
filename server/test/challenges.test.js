'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, one, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const password = 'ChallengePass_1';
const names = Array.from({ length: 4 }, (_, i) => `t_ch_${i}_${stamp}`);
const serverKey = `t_ch_${stamp}`;
const adminKey = `t_adm_${stamp}`;
// 0.5.23 起约战只开放「单挑 1」（见 src/services/challenges.js CHALLENGE_SERVER_KEY）
const challengeServerKey = 'fcx-1v1-1';
const ids = [];
const tokens = [];
let server;
let base;
let roomId;

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
  for (let i = 0; i < names.length; i++) {
    const result = await q(
      'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
      [names[i], hash, `约战${i}`, i === 0 ? 'owner' : 'user']
    );
    ids.push(result.insertId);
  }
  await q(
    `INSERT INTO servers (server_key, name, ip, port, enabled, mode)
     VALUES (?, '测试约战服', '127.0.0.1', 27097, 1, '混战')`,
    [serverKey]
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const name of names) tokens.push(await login(name));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (roomId) await q('DELETE FROM challenge_rooms WHERE id = ?', [roomId]);
  if (ids.length) await q('DELETE FROM challenge_rooms WHERE host_id IN (?, ?, ?, ?)', ids);
  await q('DELETE FROM servers WHERE server_key IN (?, ?)', [serverKey, adminKey]);
  if (ids.length) await q('DELETE FROM users WHERE id IN (?, ?, ?, ?)', ids);
  await close();
});

test('收藏服务器：未登录 401，登录后全量同步和增删', async () => {
  const denied = await api('GET', '/api/favorites');
  assert.equal(denied.status, 401);

  const first = await api('GET', '/api/favorites', { token: tokens[1] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.data.serverKeys, []);

  const put = await api('PUT', '/api/favorites', {
    token: tokens[1],
    body: { serverKeys: [serverKey] },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.data.serverKeys, [serverKey]);

  const add = await api('POST', `/api/favorites/${serverKey}`, { token: tokens[1] });
  assert.equal(add.status, 200);
  assert.deepEqual(add.body.data.serverKeys, [serverKey]);

  const remove = await api('DELETE', `/api/favorites/${serverKey}`, { token: tokens[1] });
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body.data.serverKeys, []);
});

test('管理台服务器：普通玩家 403，所有者可新增和修改', async () => {
  const denied = await api('GET', '/api/admin/servers', { token: tokens[1] });
  assert.equal(denied.status, 403);

  const created = await api('POST', '/api/admin/servers', {
    token: tokens[0],
    body: {
      serverKey: adminKey,
      name: '测试约战服',
      ip: '127.0.0.1',
      port: 27097,
      mode: '混战',
      sort: 3,
      enabled: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.server.serverKey, adminKey);

  const patched = await api('PATCH', `/api/admin/servers/${adminKey}`, {
    token: tokens[0],
    body: { name: '测试约战服 2', enabled: false },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.data.server.name, '测试约战服 2');
  assert.equal(patched.body.data.server.enabled, false);
});

test('约战：建房、邀请、接受、准备、开赛、关闭', async () => {
  const invalid = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '3v3' },
  });
  assert.equal(invalid.status, 400);

  const created = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '测试约战', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  roomId = created.body.data.room.id;
  assert.equal(created.body.data.room.maxPlayers, 2);
  assert.equal(created.body.data.room.isHost, true);

  const invited = await api('POST', `/api/challenges/${roomId}/invite`, {
    token: tokens[1],
    body: { userId: ids[2] },
  });
  assert.equal(invited.status, 200, JSON.stringify(invited.body));

  const targetState = await api('GET', '/api/challenges', { token: tokens[2] });
  assert.equal(targetState.status, 200);
  const invite = targetState.body.data.invites.find((item) => item.room.id === roomId);
  assert.ok(invite, '被邀请人应看到邀请');

  const accepted = await api('POST', `/api/challenges/invites/${invite.id}/respond`, {
    token: tokens[2],
    body: { action: 'accept' },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.accepted, true);
  assert.equal(accepted.body.data.state.myRoom.playerCount, 2);

  const ready = await api('POST', `/api/challenges/${roomId}/ready`, {
    token: tokens[2],
    body: { ready: true },
  });
  assert.equal(ready.status, 200, JSON.stringify(ready.body));

  const started = await api('POST', `/api/challenges/${roomId}/start`, {
    token: tokens[1],
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.data.room.status, 'live');

  const liveList = await api('GET', '/api/servers', { token: tokens[3] });
  const liveServer = liveList.body.data.servers.find((item) => item.serverKey === challengeServerKey);
  assert.ok(liveServer.challenge, '服务器应显示约战锁');
  assert.equal(liveServer.locked, true);
  assert.equal(liveServer.canJoin, false);
  assert.equal(liveServer.canSpectate, true);

  const blockedJoin = await api('POST', '/api/launch-token', {
    token: tokens[3],
    body: { serverKey: challengeServerKey, purpose: 'join' },
  });
  assert.equal(blockedJoin.status, 409, JSON.stringify(blockedJoin.body));

  const spectator = await api('POST', '/api/launch-token', {
    token: tokens[3],
    body: { serverKey: challengeServerKey, purpose: 'spectate' },
  });
  assert.equal(spectator.status, 200, JSON.stringify(spectator.body));
  assert.equal(spectator.body.data.purpose, 'spectate');

  const participant = await api('POST', '/api/launch-token', {
    token: tokens[1],
    body: { serverKey: challengeServerKey, purpose: 'join' },
  });
  assert.equal(participant.status, 200, JSON.stringify(participant.body));

  const closed = await api('POST', `/api/challenges/${roomId}/close`, {
    token: tokens[1],
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.data.myRoom, null);

  const row = await one('SELECT status FROM challenge_rooms WHERE id = ?', [roomId]);
  assert.equal(row.status, 'closed');
});
