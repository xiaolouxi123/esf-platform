'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const password = 'RankedPass_1';
const usernames = Array.from({ length: 5 }, (_, i) => `t_rank_${i}_${stamp}`);
const serverKey = `t_rank_${stamp}`;
let server;
let base;
let ids = [];
let tokens = [];
let matchId;

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
  for (let i = 0; i < usernames.length; i++) {
    const result = await q(
      'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
      [usernames[i], hash, `排位${i}`, i === 0 ? 'owner' : 'user']
    );
    ids.push(result.insertId);
  }

  const srv = await q(
    `INSERT INTO servers (server_key, name, ip, port, enabled, mode)
     VALUES (?, '测试排位服', '127.0.0.1', 27098, 1, '单挑')`,
    [serverKey]
  );
  await q(
    `INSERT INTO server_status (server_id, name, map, players, max_players, ping_ms, online)
     VALUES (?, '测试排位服', 'esf_cell', 0, 12, 10, 1)`,
    [srv.insertId]
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const name of usernames) tokens.push(await login(name));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (matchId) await q('DELETE FROM ranked_matches WHERE id = ?', [matchId]);
  await q('DELETE FROM ranked_queue WHERE user_id IN (?, ?, ?, ?, ?)', ids);
  await q('DELETE FROM servers WHERE server_key = ?', [serverKey]);
  await q('DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)', ids);
  await close();
});

test('四人快速匹配生成 2v2 对局并锁定服务器', async () => {
  for (let i = 0; i < 4; i++) {
    const res = await api('POST', '/api/ranked/queue', {
      token: tokens[i],
      body: { mode: '2v2' },
    });
    assert.equal(res.status, 200);
  }

  const state = await api('GET', '/api/ranked/state', { token: tokens[0] });
  assert.equal(state.status, 200);
  assert.equal(state.body.data.state, 'matched');
  assert.equal(state.body.data.match.mode, '2v2');
  assert.equal(state.body.data.match.playerCount, 4);
  matchId = state.body.data.match.id;

  const servers = await api('GET', '/api/servers', { token: tokens[4] });
  const target = servers.body.data.servers.find((item) => item.serverKey === serverKey);
  assert.ok(target.ranked, '服务器应显示排位比赛');
  assert.equal(target.locked, true);

  const denied = await api('POST', '/api/launch-token', {
    token: tokens[4],
    body: { serverKey },
  });
  assert.equal(denied.status, 400);

  const allowed = await api('POST', '/api/launch-token', {
    token: tokens[0],
    body: { serverKey },
  });
  assert.equal(allowed.status, 200);
});

test('竞猜扣币，全员准备后开赛，结算按奖池派彩', async () => {
  await q('INSERT IGNORE INTO wallets (user_id, coins) VALUES (?, 100)', [ids[4]]);
  await q('UPDATE wallets SET coins = 100 WHERE user_id = ?', [ids[4]]);
  const participantBet = await api('POST', '/api/ranked/bet', {
    token: tokens[0],
    body: { matchId, team: 'a', amount: 10 },
  });
  assert.equal(participantBet.status, 400, '参赛玩家不能下注');

  const bet = await api('POST', '/api/ranked/bet', {
    token: tokens[4],
    body: { matchId, team: 'a', amount: 50 },
  });
  assert.equal(bet.status, 200, JSON.stringify(bet.body));

  for (let i = 0; i < 4; i++) {
    const ready = await api('POST', '/api/ranked/ready', { token: tokens[i] });
    assert.equal(ready.status, 200);
  }

  const live = await api('GET', '/api/ranked/state', { token: tokens[0] });
  assert.equal(live.body.data.match.status, 'live');
  assert.equal(live.body.data.match.allReady, true);

  const finished = await api('POST', '/api/ranked/finish', {
    token: tokens[0],
    body: { matchId, winner: 'a' },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.body.data.winner, 'a');

  const wallet = await q('SELECT coins FROM wallets WHERE user_id = ?', [ids[4]]);
  assert.ok(Number(wallet[0].coins) > 50, '押中应获得派彩');

  const profile = await api('GET', '/api/ranked/state', { token: tokens[0] });
  assert.ok(profile.body.data.profile.rating > 1000);
  assert.equal(profile.body.data.state, 'idle');
  const last = profile.body.data.lastResult;
  assert.equal(last.matchId, matchId);
  assert.equal(last.winner, 'a');
  assert.equal(last.result, last.myTeam === 'a' ? 'win' : 'loss');
  assert.equal(last.ratingDelta, last.myTeam === 'a' ? 25 : -20);
});
