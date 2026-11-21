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
const challengeServerKey = serverKey;
const ids = [];
const tokens = [];
let server;
let base;
let roomId;
let challengeServerId;

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
  const inserted = await q(
    `INSERT INTO servers (server_key, name, ip, port, enabled, mode, is_challenge)
     VALUES (?, '测试约战服', '127.0.0.1', 27097, 1, '混战', 1)`,
    [serverKey]
  );
  challengeServerId = inserted.insertId;
  await q(
    `INSERT INTO server_status (server_id, name, map, players, max_players, ping_ms, online)
     VALUES (?, '测试约战服', 'esf_cell', 0, 12, 8, 1)`,
    [challengeServerId]
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
  if (ids.length) await q('DELETE FROM challenge_queue WHERE user_id IN (?, ?, ?, ?)', ids);
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

  await q('UPDATE server_status SET online = 0 WHERE server_id = ?', [challengeServerId]);
  const offline = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '离线约战服', serverKey: challengeServerKey },
  });
  assert.equal(offline.status, 400);
  assert.match(offline.body.message, /离线/);
  await q('UPDATE server_status SET online = 1 WHERE server_id = ?', [challengeServerId]);

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


test('约战：私密房需要正确密码，列表不泄露密码哈希', async () => {
  const created = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: {
      mode: '1v1',
      title: '私密房测试',
      map: 'esf_cell',
      serverKey: challengeServerKey,
      private: true,
      password: 'room-1234',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const privateRoomId = created.body.data.room.id;
  assert.equal(created.body.data.room.isPrivate, true);
  assert.equal(created.body.data.room.password_hash, undefined);

  const listed = await api('GET', '/api/challenges', { token: tokens[3] });
  assert.equal(listed.status, 200);
  const listedRoom = listed.body.data.rooms.find((item) => item.id === privateRoomId);
  assert.ok(listedRoom, '私密房应出现在列表');
  assert.equal(listedRoom.isPrivate, true);
  assert.equal(listedRoom.passwordHash, undefined);

  const noPassword = await api('POST', `/api/challenges/${privateRoomId}/join`, {
    token: tokens[2],
  });
  assert.equal(noPassword.status, 400);
  assert.match(noPassword.body.message, /密码/);

  const wrong = await api('POST', `/api/challenges/${privateRoomId}/join`, {
    token: tokens[2],
    body: { password: 'wrong-pass' },
  });
  assert.equal(wrong.status, 403);
  assert.match(wrong.body.message, /密码不正确/);

  const joined = await api('POST', `/api/challenges/${privateRoomId}/join`, {
    token: tokens[2],
    body: { password: 'room-1234' },
  });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.data.room.playerCount, 2);

  await api('POST', `/api/challenges/${privateRoomId}/close`, { token: tokens[1] });
});

test('约战：房主可转让，房主离开不散房', async () => {
  const created = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '转让测试', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const transferRoomId = created.body.data.room.id;

  await api('POST', `/api/challenges/${transferRoomId}/join`, { token: tokens[2] });

  const toOutsider = await api('POST', `/api/challenges/${transferRoomId}/transfer`, {
    token: tokens[1],
    body: { userId: ids[3] },
  });
  assert.equal(toOutsider.status, 400);

  const transferred = await api('POST', `/api/challenges/${transferRoomId}/transfer`, {
    token: tokens[1],
    body: { userId: ids[2] },
  });
  assert.equal(transferred.status, 200, JSON.stringify(transferred.body));
  assert.equal(transferred.body.data.transferredTo, ids[2]);
  assert.equal(transferred.body.data.room.isHost, false);

  const targetState = await api('GET', '/api/challenges', { token: tokens[2] });
  assert.equal(targetState.body.data.myRoom.isHost, true);

  const oldHostLeaves = await api('POST', `/api/challenges/${transferRoomId}/leave`, {
    token: tokens[1],
  });
  assert.equal(oldHostLeaves.status, 200, JSON.stringify(oldHostLeaves.body));
  assert.equal(oldHostLeaves.body.data.myRoom, null);
  assert.equal(oldHostLeaves.body.data.leave.closed, false);

  const survivor = await api('GET', '/api/challenges', { token: tokens[2] });
  assert.equal(survivor.body.data.myRoom.id, transferRoomId);
  assert.equal(survivor.body.data.myRoom.playerCount, 1);
  assert.equal(survivor.body.data.myRoom.isHost, true);

  await api('POST', `/api/challenges/${transferRoomId}/close`, { token: tokens[2] });

  // 房主不手动转让、直接离开时，服务端应自动把房间交给最早加入的成员。
  const autoCreated = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '自动转让测试', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(autoCreated.status, 201, JSON.stringify(autoCreated.body));
  const autoRoomId = autoCreated.body.data.room.id;
  await api('POST', `/api/challenges/${autoRoomId}/join`, { token: tokens[2] });

  const autoLeave = await api('POST', `/api/challenges/${autoRoomId}/leave`, { token: tokens[1] });
  assert.equal(autoLeave.status, 200, JSON.stringify(autoLeave.body));
  assert.equal(autoLeave.body.data.leave.transferredTo, ids[2]);
  assert.equal(autoLeave.body.data.leave.closed, false);

  const autoSurvivor = await api('GET', '/api/challenges', { token: tokens[2] });
  assert.equal(autoSurvivor.body.data.myRoom.id, autoRoomId);
  assert.equal(autoSurvivor.body.data.myRoom.isHost, true);
  await api('POST', `/api/challenges/${autoRoomId}/close`, { token: tokens[2] });
});

test('约战：进行中列表、观战位与个人战绩', async () => {
  const created = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '进行中测试', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const liveRoomId = created.body.data.room.id;

  await api('POST', `/api/challenges/${liveRoomId}/join`, { token: tokens[2] });
  await api('POST', `/api/challenges/${liveRoomId}/ready`, {
    token: tokens[2],
    body: { ready: true },
  });
  const started = await api('POST', `/api/challenges/${liveRoomId}/start`, { token: tokens[1] });
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const listed = await api('GET', '/api/challenges', { token: tokens[3] });
  const live = listed.body.data.liveRooms.find((item) => item.id === liveRoomId);
  assert.ok(live, '进行中的房间应出现在 liveRooms');
  assert.equal(live.spectatorCount, 0);
  assert.equal(live.spectatorFull, false);

  const spectate = await api('POST', `/api/challenges/${liveRoomId}/spectate`, {
    token: tokens[3],
  });
  assert.equal(spectate.status, 201, JSON.stringify(spectate.body));

  const afterSpectate = await api('GET', '/api/challenges', { token: tokens[3] });
  const liveAfter = afterSpectate.body.data.liveRooms.find((item) => item.id === liveRoomId);
  assert.equal(liveAfter.spectatorCount, 1);

  await q(
    `INSERT INTO challenge_player_stats (room_id, user_id, team, kills, deaths)
     VALUES (?, ?, 'a', 10, 7), (?, ?, 'b', 7, 10)`,
    [liveRoomId, ids[1], liveRoomId, ids[2]]
  );
  await q(
    `INSERT INTO challenge_results (room_id, winner, score_a, score_b, victory_type, victory_limit)
     VALUES (?, 'a', 2, 1, 'series', 2)`,
    [liveRoomId]
  );
  await q("UPDATE challenge_rooms SET status = 'closed', closed_at = NOW() WHERE id = ?", [liveRoomId]);

  const history = await api('GET', '/api/challenges/history?limit=5', { token: tokens[1] });
  assert.equal(history.status, 200, JSON.stringify(history.body));
  const item = history.body.data.items.find((row) => row.roomId === liveRoomId);
  assert.ok(item, '应返回刚结算的约战战绩');
  assert.equal(item.won, true);
  assert.equal(item.scoreA, 2);
  assert.equal(item.scoreB, 1);
  assert.equal(item.opponents, '约战2');

  const loserHistory = await api('GET', '/api/challenges/history?limit=5', { token: tokens[2] });
  const lost = loserHistory.body.data.items.find((row) => row.roomId === liveRoomId);
  assert.equal(lost.won, false);
});
test('约战：房主再来一局会复制新房并带入原成员', async () => {
  const created = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '连续房间测试', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const oldRoomId = created.body.data.room.id;

  await api('POST', `/api/challenges/${oldRoomId}/join`, { token: tokens[2] });
  await api('POST', `/api/challenges/${oldRoomId}/ready`, {
    token: tokens[2],
    body: { ready: true },
  });
  const started = await api('POST', `/api/challenges/${oldRoomId}/start`, { token: tokens[1] });
  assert.equal(started.status, 200, JSON.stringify(started.body));

  await q(
    `INSERT INTO challenge_results (room_id, winner, score_a, score_b, victory_type, victory_limit)
     VALUES (?, 'a', 2, 1, 'series', 2)`,
    [oldRoomId]
  );
  await q("UPDATE challenge_rooms SET status = 'closed', closed_at = NOW() WHERE id = ?", [oldRoomId]);

  const result = await api('GET', `/api/challenges/${oldRoomId}/result`, { token: tokens[1] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.result.hostId, ids[1]);

  const denied = await api('POST', `/api/challenges/${oldRoomId}/rematch`, { token: tokens[2] });
  assert.equal(denied.status, 403);

  const rematched = await api('POST', `/api/challenges/${oldRoomId}/rematch`, { token: tokens[1] });
  assert.equal(rematched.status, 200, JSON.stringify(rematched.body));
  const nextRoom = rematched.body.data.room;
  assert.notEqual(nextRoom.id, oldRoomId);
  assert.equal(nextRoom.status, 'waiting');
  assert.equal(nextRoom.playerCount, 2);
  assert.equal(nextRoom.allReady, true);
  assert.match(nextRoom.title, /再来一局/);
  assert.deepEqual(rematched.body.data.skipped, []);

  const state = await api('GET', '/api/challenges', { token: tokens[2] });
  assert.equal(state.body.data.myRoom.id, nextRoom.id);
  assert.equal(state.body.data.myRoom.isHost, false);

  await api('POST', `/api/challenges/${nextRoom.id}/close`, { token: tokens[1] });

  // 旧成员已在别的房间时，再来一局应跳过他，而不是把一个人拉进两间房。
  const blocking = await api('POST', '/api/challenges', {
    token: tokens[2],
    body: { mode: '1v1', title: '占用中的房间', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(blocking.status, 201, JSON.stringify(blocking.body));
  const blockingRoomId = blocking.body.data.room.id;

  const partial = await api('POST', `/api/challenges/${oldRoomId}/rematch`, { token: tokens[1] });
  assert.equal(partial.status, 200, JSON.stringify(partial.body));
  assert.equal(partial.body.data.room.playerCount, 1);
  assert.equal(partial.body.data.skipped.length, 1);
  assert.equal(partial.body.data.skipped[0], '约战2');

  await api('POST', `/api/challenges/${partial.body.data.room.id}/close`, { token: tokens[1] });
  await api('POST', `/api/challenges/${blockingRoomId}/close`, { token: tokens[2] });
});

test('约战：候场登记按先后排序，可查询与取消', async () => {
  await q('DELETE FROM challenge_queue WHERE user_id IN (?, ?)', [ids[2], ids[3]]);

  const first = await api('POST', '/api/queue', {
    token: tokens[2],
    body: { serverKey: challengeServerKey, kind: 'challenge' },
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.count, 1);
  assert.equal(first.body.data.entries[0].mine, true);
  assert.equal(first.body.data.entries[0].position, 1);

  const second = await api('POST', '/api/queue', {
    token: tokens[3],
    body: { serverKey: challengeServerKey, kind: 'challenge' },
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.count, 2);
  assert.equal(second.body.data.entries.find((entry) => entry.mine).position, 2);
  assert.equal(second.body.data.entries.find((entry) => !entry.mine).position, 1);

  const listed = await api('GET', `/api/queue?serverKey=${challengeServerKey}`, { token: tokens[2] });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.data.count, 2);
  assert.equal(listed.body.data.entries.find((entry) => entry.mine).position, 1);

  const left = await api('DELETE', `/api/queue?serverKey=${challengeServerKey}`, { token: tokens[2] });
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(left.body.data.count, 1);
  assert.equal(left.body.data.entries.some((entry) => entry.mine), false);

  const denied = await api('GET', '/api/queue');
  assert.equal(denied.status, 401);

  await api('DELETE', `/api/queue?serverKey=${challengeServerKey}`, { token: tokens[3] });
});

test('约战：2v2 换队，换队取消准备，1v1 拒绝换队', async () => {
  const created = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '2v2', title: '换队测试', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const teamRoomId = created.body.data.room.id;
  assert.equal(created.body.data.room.maxPlayers, 4);
  assert.equal(created.body.data.room.teams.a.length, 1);

  const switched = await api('POST', `/api/challenges/${teamRoomId}/team`, {
    token: tokens[1],
    body: { team: 'b' },
  });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  assert.equal(switched.body.data.room.teams.b.length, 1);
  assert.equal(switched.body.data.room.teams.a.length, 0);
  assert.equal(switched.body.data.room.teams.b[0].ready, false);

  const again = await api('POST', `/api/challenges/${teamRoomId}/team`, {
    token: tokens[1],
    body: { team: 'b' },
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.room.teams.b.length, 1);

  await api('POST', `/api/challenges/${teamRoomId}/close`, { token: tokens[1] });

  const duel = await api('POST', '/api/challenges', {
    token: tokens[1],
    body: { mode: '1v1', title: '单挑换队测试', map: 'esf_cell', serverKey: challengeServerKey },
  });
  assert.equal(duel.status, 201, JSON.stringify(duel.body));
  const duelId = duel.body.data.room.id;
  const rejected = await api('POST', `/api/challenges/${duelId}/team`, {
    token: tokens[1],
    body: { team: 'b' },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.message, /1v1/);

  await api('POST', `/api/challenges/${duelId}/close`, { token: tokens[1] });
});
