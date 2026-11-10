#!/usr/bin/env node
'use strict';

/**
 * 本机模拟验收（替代部分真人验收）
 *
 * 覆盖 KB current-state.md 待办 1 中可在 API 层验证的部分：
 *   1. 观战 4 人上限（满员拒绝 + 空位后可再进）
 *   2. 锁服排队与排位优先着色（priority=ranked 排前）
 *   3. AFK 判负（-30）与战绩公开 AFK 标记
 *   4. 结算补交（参赛者可补交、幂等、非参赛者被拒）
 *
 * 运行前提：本地开发库已启动并迁移（npm run db:start && npm run migrate）
 *   node scripts/acceptance-sim.cjs
 *
 * 只在本机临时数据上跑，finally 里全部清理；不连生产、不改线上数据。
 * 无法在 API 层模拟的项目在输出末尾单独列出，需双开 hl.exe 或真人验证。
 */

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const PASSWORD = 'SimPass_2026_1';
const serverKey = `t_sim_${stamp}`.slice(0, 32);
// 0=房主 1=对手 2..6=5 名观战者 7=非参赛者
const names = Array.from({ length: 8 }, (_, i) => `t_sim_${i}_${stamp}`);

let base;
let server;
let roomId;
let matchId;
const ids = [];
const tokens = [];
const results = [];

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

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`[FAIL] ${name} — ${err.message}`);
  }
}

async function setup() {
  assert.ok(await ping(), '本地数据库不可用：先 npm run db:start && npm run migrate');

  const hash = bcrypt.hashSync(PASSWORD, 4);
  for (let i = 0; i < names.length; i++) {
    const r = await q(
      'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
      [names[i], hash, `模拟${i}`, 'user']
    );
    ids.push(r.insertId);
  }

  // getMatch() 用 INNER JOIN servers，必须让临时 serverKey 在 servers 表里有对应行
  await q(
    `INSERT INTO servers (server_key, name, ip, port, enabled, mode, sort)
     VALUES (?, '模拟验收服', '127.0.0.1', 27099, 1, '单挑', 99)`,
    [serverKey]
  );

  // 直接造一个 live 约战房间（避开 0.5.23「只开放单挑 1」的同服排他限制）
  const room = await q(
    `INSERT INTO challenge_rooms (host_id, title, mode, map, server_key, status, max_players, started_at)
     VALUES (?, '模拟验收房间', '1v1', 'esf_cell', ?, 'live', 2, NOW())`,
    [ids[0], serverKey]
  );
  roomId = room.insertId;

  // 造一场进行中的排位（2 队各 2 人）
  const match = await q(
    `INSERT INTO ranked_matches (mode, server_key, map, status, started_at)
     VALUES ('2v2', ?, 'esf_cell', 'live', NOW())`,
    [serverKey]
  );
  matchId = match.insertId;
  const seats = [
    [ids[0], 'a', 1],
    [ids[1], 'a', 2],
    [ids[2], 'b', 1],
    [ids[3], 'b', 2],
  ];
  for (const [userId, team, slot] of seats) {
    await q(
      `INSERT INTO ranked_match_players (match_id, user_id, team, slot, ready, rating_before)
       VALUES (?, ?, ?, ?, 1, 1000)`,
      [matchId, userId, team, slot]
    );
  }

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const name of names) {
    const res = await api('POST', '/api/auth/login', { body: { username: name, password: PASSWORD } });
    assert.equal(res.status, 200, `登录失败: ${name}`);
    tokens.push(res.body.data.accessToken);
  }
}

async function cleanup() {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    if (roomId) {
      await q('DELETE FROM challenge_spectators WHERE room_id = ?', [roomId]);
      await q('DELETE FROM challenge_room_players WHERE room_id = ?', [roomId]);
      await q('DELETE FROM challenge_rooms WHERE id = ?', [roomId]);
    }
    if (matchId) {
      await q('DELETE FROM ranked_bets WHERE match_id = ?', [matchId]);
      await q('DELETE FROM ranked_matches WHERE id = ?', [matchId]);
    }
    await q('DELETE FROM challenge_queue WHERE server_key = ?', [serverKey]);
    await q('DELETE FROM servers WHERE server_key = ?', [serverKey]);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      await q(`DELETE FROM ranked_queue WHERE user_id IN (${ph})`, ids);
      await q(`DELETE FROM ranked_profiles WHERE user_id IN (${ph})`, ids);
      await q(`DELETE FROM coin_transactions WHERE user_id IN (${ph})`, ids);
      await q(`DELETE FROM wallets WHERE user_id IN (${ph})`, ids);
      await q(`DELETE FROM users WHERE id IN (${ph})`, ids);
    }
  } catch (err) {
    console.log(`[WARN] 清理未完全成功: ${err.message}`);
  }
  await close();
}

async function main() {
  console.log('=== ESF 本机模拟验收（API 层） ===');
  console.log(`时间: ${new Date().toISOString()}  临时服务器: ${serverKey}`);
  console.log('环境: 本地 dev MySQL(127.0.0.1:3307) + 本地 Express API\n');

  await setup();

  // ---- 1. 观战 4 人上限 ----
  await check('观战 4 人上限：前 4 人成功、第 5 人被 409 拒绝', async () => {
    for (let i = 2; i <= 5; i++) {
      const res = await api('POST', `/api/challenges/${roomId}/spectate`, { token: tokens[i] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
    const denied = await api('POST', `/api/challenges/${roomId}/spectate`, { token: tokens[6] });
    assert.equal(denied.status, 409, JSON.stringify(denied.body));
    const row = await q('SELECT COUNT(*) AS n FROM challenge_spectators WHERE room_id = ?', [roomId]);
    assert.equal(Number(row[0].n), 4);
    return `spectators=4，第 5 人 409（${denied.body.message}）`;
  });

  await check('观战空位释放后可再次加入', async () => {
    const left = await api('DELETE', `/api/challenges/${roomId}/spectate`, { token: tokens[2] });
    assert.equal(left.status, 200, JSON.stringify(left.body));
    const joined = await api('POST', `/api/challenges/${roomId}/spectate`, { token: tokens[6] });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));
    assert.equal(joined.body.data.spectators, 4);
    assert.equal(joined.body.data.limit, 4);
    return 'leave → 3 人，join → 4 人，limit=4';
  });

  // ---- 2. 锁服排队：排位优先 ----
  await check('锁服排队：排位等待者 priority=ranked 且排在最前', async () => {
    // 让 ids[2] 同时处于排位队列中（模拟"排位等待者优先"）
    await q('INSERT INTO ranked_queue (user_id, mode, rating) VALUES (?, ?, ?)', [ids[2], '1v1', 1000]);
    for (const i of [3, 2]) {
      const res = await api('POST', '/api/queue', {
        token: tokens[i],
        body: { serverKey, kind: 'challenge' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
    const list = await api('GET', `/api/queue?serverKey=${encodeURIComponent(serverKey)}`, { token: tokens[0] });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const entries = list.body.data.entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].priority, 'ranked', JSON.stringify(entries));
    assert.equal(entries[0].position, 1);
    assert.equal(entries[1].priority, 'challenge');
    return `count=2，position1=${entries[0].priority}，position2=${entries[1].priority}`;
  });

  await check('退出排队后队列清空（无残留占位）', async () => {
    const left = await api('DELETE', `/api/queue?serverKey=${encodeURIComponent(serverKey)}`, { token: tokens[2] });
    assert.equal(left.status, 200, JSON.stringify(left.body));
    assert.equal(left.body.data.count, 1);
    return '剩余 1 人';
  });

  // ---- 3 & 4. AFK 判负 + 结算补交 ----
  await check('非参赛者不能补交结算（比赛未结算时）', async () => {
    const res = await api('POST', '/api/ranked/settle', {
      token: tokens[7],
      body: { matchId, winner: 'b', players: [] },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /只有参赛玩家/);
    return '400：只有参赛玩家可以补交结算';
  });

  await check('结算补交：AFK 玩家扣 30、胜者 +25、普通败者 -20', async () => {
    const res = await api('POST', '/api/ranked/settle', {
      token: tokens[0],
      body: { matchId, winner: 'a', players: [{ userId: ids[3], afk: true }] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.alreadySettled, false);

    const rows = await q(
      'SELECT user_id, team, rating_before, rating_after, afk FROM ranked_match_players WHERE match_id = ?',
      [matchId]
    );
    const byId = Object.fromEntries(rows.map((r) => [Number(r.user_id), r]));
    assert.equal(Number(byId[ids[0]].rating_after), 1025, '胜方 +25');
    assert.equal(Number(byId[ids[2]].rating_after), 980, '普通败方 -20');
    assert.equal(Number(byId[ids[3]].rating_after), 970, 'AFK 败方 -30');
    assert.equal(Number(byId[ids[3]].afk), 1, 'AFK 标记落库');
    return '1025 / 980 / 970，AFK 标记落库';
  });

  await check('战绩接口公开 AFK 标记', async () => {
    const res = await api('GET', '/api/ranked/history', { token: tokens[0] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(JSON.stringify(res.body), /"afk":true/, '战绩应包含 afk:true');
    return '/api/ranked/history 含 afk:true';
  });

  await check('结算补交幂等：重复提交不重复结算', async () => {
    const res = await api('POST', '/api/ranked/settle', {
      token: tokens[0],
      body: { matchId, winner: 'a', players: [{ userId: ids[3], afk: true }] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.alreadySettled, true);
    const rows = await q(
      'SELECT COUNT(*) AS n FROM ranked_match_players WHERE match_id = ? AND rating_after = 970',
      [matchId]
    );
    assert.equal(Number(rows[0].n), 1);
    return '第二次返回 alreadySettled=true，rating 未变';
  });

  await check('已结算比赛：非参赛者仍被拒绝且不泄露比赛详情', async () => {
    const res = await api('POST', '/api/ranked/settle', {
      token: tokens[7],
      body: { matchId, winner: 'b', players: [] },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /只有参赛玩家/);
    assert.equal(res.body.ok, false);
    assert.ok(!res.body.data?.match, '不应返回比赛详情');
    return '400：已结算比赛同样拒绝非参赛者';
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n汇总: ${passed} PASS / ${failed} FAIL`);
  console.log('\n无法在 API 层模拟（需双开 hl.exe / 真人）：');
  console.log('  - 开局自动分边（AMXX 插件 jointeam 下发，KB 待办 9）');
  console.log('  - AFK 180s 提醒 / 300s 判负的计时触发（插件侧）；本脚本只验证结算侧 -30 规则');
  console.log('  - 赛后 10 秒退出与启动器按 PID 强杀（需 esf_match_end.flag + 游戏进程）');
  console.log('  - 观战 Token 实际进服、锁服排队时的真实进服行为、真人对局手感与网络延迟');

  await cleanup();
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error('[ERROR] 验收脚本异常:', err);
  await cleanup().catch(() => {});
  process.exitCode = 1;
});
