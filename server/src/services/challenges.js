'use strict';

/**
 * 约战房间。
 *
 * 和排位是两套东西：
 *   - 排位由队列/评分/结算驱动，会锁服；
 *   - 约战只是“把一桌人约到一起”，不计分、不锁服，房主可以指定一张图/一台服。
 *
 * 所有写操作都用事务 + SELECT ... FOR UPDATE 防重复进房/超员。
 */

const { pool, q, one } = require('../db');
const { badRequest, forbidden, notFound, conflict } = require('../lib/errors');

const MODE_SLOTS = { '1v1': 1, '2v2': 2 };
const MODES = Object.keys(MODE_SLOTS);
const VICTORY_TYPES = ['kills', 'deaths'];
const STALE_HOURS = 6;

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    avatar: row.avatar || '',
    avatarUrl: row.avatar_url || '',
    role: row.role,
    combatLevel: Number(row.combat_level || 0),
  };
}

function normalizeMode(mode) {
  const value = String(mode || '');
  if (!MODES.includes(value)) throw badRequest('约战模式只能是 1v1 / 2v2');
  return value;
}

function normalizeTitle(title, fallback) {
  const value = String(title || '').trim();
  if (!value) return fallback;
  if (value.length < 2 || value.length > 48) throw badRequest('房间名需要 2-48 个字');
  return value;
}

function normalizeMap(map) {
  const value = String(map || '').trim();
  if (!value) return null;
  if (value.length > 64) throw badRequest('地图名太长');
  return value;
}

function normalizeVictoryType(type) {
  const value = String(type || 'kills');
  if (!VICTORY_TYPES.includes(value)) throw badRequest('胜利条件只能是击杀数或死亡数');
  return value;
}

function normalizeVictoryLimit(limit) {
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 3 || value > 50) {
    throw badRequest('胜利目标需要在 3-50 之间');
  }
  return value;
}

function victoryLabel(type, limit) {
  return type === 'deaths' ? `死亡 ${limit} 次` : `击杀 ${limit} 人`;
}

function roomRow(id) {
  return one(
    `SELECT r.*, u.username AS host_username, u.game_name AS host_game_name,
            u.avatar AS host_avatar, u.avatar_url AS host_avatar_url,
            u.role AS host_role, u.combat_level AS host_combat_level,
            s.name AS server_name, s.ip AS server_ip, s.port AS server_port,
            c.victory_type, c.victory_limit,
            res.winner AS result_winner, res.score_a AS result_score_a,
            res.score_b AS result_score_b, res.ended_at AS result_ended_at
       FROM challenge_rooms r
       JOIN users u ON u.id = r.host_id
       LEFT JOIN servers s ON s.server_key = r.server_key
       LEFT JOIN challenge_configs c ON c.room_id = r.id
       LEFT JOIN challenge_results res ON res.room_id = r.id
      WHERE r.id = ?
      LIMIT 1`,
    [id]
  );
}

async function roomMembers(roomId) {
  const rows = await q(
    `SELECT p.team, p.ready, p.joined_at,
            u.id, u.username, u.game_name, u.avatar, u.avatar_url,
            u.role, u.combat_level,
            COALESCE(st.kills, 0) AS kills, COALESCE(st.deaths, 0) AS deaths
       FROM challenge_room_players p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN challenge_player_stats st ON st.room_id = p.room_id AND st.user_id = p.user_id
      WHERE p.room_id = ?
      ORDER BY p.joined_at ASC, p.user_id ASC`,
    [roomId]
  );
  return rows.map((row) => ({
    ...publicUser(row),
    team: row.team,
    ready: Boolean(row.ready),
    joinedAt: row.joined_at,
    kills: Number(row.kills || 0),
    deaths: Number(row.deaths || 0),
  }));
}

async function pendingInvites(roomId) {
  const rows = await q(
    `SELECT i.id, i.created_at, u.id AS user_id, u.username, u.game_name, u.avatar, u.avatar_url, u.role
       FROM challenge_invites i
       JOIN users u ON u.id = i.to_user_id
      WHERE i.room_id = ? AND i.status = 'pending'
      ORDER BY i.id ASC`,
    [roomId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    user: publicUser({
      id: row.user_id,
      username: row.username,
      game_name: row.game_name,
      avatar: row.avatar,
      avatar_url: row.avatar_url,
      role: row.role,
      combat_level: 0,
    }),
    createdAt: row.created_at,
  }));
}

function serverOf(row) {
  if (!row.server_key || !row.server_ip) return null;
  return {
    serverKey: row.server_key,
    name: row.server_name || row.server_key,
    ip: row.server_ip,
    port: Number(row.server_port),
  };
}

function roomBase(row) {
  return {
    id: Number(row.id),
    displayNo: row.day_seq ? Number(row.day_seq) : Number(row.id),
    dayDate: row.day_date || null,
    title: row.title,
    mode: row.mode,
    map: row.map || null,
    serverKey: row.server_key || null,
    server: serverOf(row),
    status: row.status,
    maxPlayers: Number(row.max_players),
    victoryType: row.victory_type || 'kills',
    victoryLimit: Number(row.victory_limit || 10),
    victoryLabel: victoryLabel(row.victory_type || 'kills', Number(row.victory_limit || 10)),
    result: row.result_winner
      ? {
          winner: row.result_winner,
          scoreA: Number(row.result_score_a || 0),
          scoreB: Number(row.result_score_b || 0),
          endedAt: row.result_ended_at,
        }
      : null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    closedAt: row.closed_at || null,
    host: publicUser({
      id: row.host_id,
      username: row.host_username,
      game_name: row.host_game_name,
      avatar: row.host_avatar,
      avatar_url: row.host_avatar_url,
      role: row.host_role,
      combat_level: row.host_combat_level,
    }),
  };
}

async function getRoom(roomId, viewerId) {
  const row = await roomRow(roomId);
  if (!row) return null;
  const members = await roomMembers(roomId);
  const teams = { a: [], b: [] };
  for (const member of members) teams[member.team].push(member);
  const isMember = members.some((member) => member.id === Number(viewerId));
  const readyCount = members.filter((member) => member.ready).length;
  const pending = isMember ? await pendingInvites(roomId) : [];

  return {
    ...roomBase(row),
    members,
    teams,
    playerCount: members.length,
    readyCount,
    allReady: members.length > 0 && readyCount === members.length,
    full: members.length >= Number(row.max_players),
    isHost: Number(row.host_id) === Number(viewerId),
    isMember,
    pendingInvites: pending,
  };
}

async function listRooms() {
  const rows = await q(
    `SELECT r.*, u.username AS host_username, u.game_name AS host_game_name,
            u.avatar AS host_avatar, u.avatar_url AS host_avatar_url,
            u.role AS host_role, u.combat_level AS host_combat_level,
            s.name AS server_name, s.ip AS server_ip, s.port AS server_port,
            c.victory_type, c.victory_limit,
            (SELECT COUNT(*) FROM challenge_room_players p WHERE p.room_id = r.id) AS player_count,
            (SELECT COUNT(*) FROM challenge_room_players p WHERE p.room_id = r.id AND p.ready = 1) AS ready_count
       FROM challenge_rooms r
       JOIN users u ON u.id = r.host_id
       LEFT JOIN servers s ON s.server_key = r.server_key
       LEFT JOIN challenge_configs c ON c.room_id = r.id
      WHERE r.status = 'waiting'
        AND r.updated_at > (NOW() - INTERVAL ? HOUR)
      ORDER BY r.created_at DESC
      LIMIT 30`,
    [STALE_HOURS]
  );
  return rows.map((row) => ({
    ...roomBase(row),
    playerCount: Number(row.player_count || 0),
    readyCount: Number(row.ready_count || 0),
    full: Number(row.player_count || 0) >= Number(row.max_players),
  }));
}

async function activeRoomOf(userId) {
  return one(
    `SELECT r.id
       FROM challenge_room_players p
       JOIN challenge_rooms r ON r.id = p.room_id
      WHERE p.user_id = ? AND r.status IN ('waiting', 'live')
      ORDER BY r.id DESC
      LIMIT 1`,
    [userId]
  );
}

async function invitesOf(userId) {
  const rows = await q(
    `SELECT i.id, i.created_at,
            r.id AS room_id, r.title, r.mode, r.map, r.status, r.max_players,
            u.id AS from_id, u.username AS from_username, u.game_name AS from_game_name,
            u.avatar AS from_avatar, u.avatar_url AS from_avatar_url, u.role AS from_role,
            (SELECT COUNT(*) FROM challenge_room_players p WHERE p.room_id = r.id) AS player_count
       FROM challenge_invites i
       JOIN challenge_rooms r ON r.id = i.room_id
       JOIN users u ON u.id = i.from_user_id
      WHERE i.to_user_id = ? AND i.status = 'pending'
        AND r.status = 'waiting'
        AND r.updated_at > (NOW() - INTERVAL ? HOUR)
      ORDER BY i.id DESC
      LIMIT 10`,
    [userId, STALE_HOURS]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    from: publicUser({
      id: row.from_id,
      username: row.from_username,
      game_name: row.from_game_name,
      avatar: row.from_avatar,
      avatar_url: row.from_avatar_url,
      role: row.from_role,
      combat_level: 0,
    }),
    room: {
      id: Number(row.room_id),
      title: row.title,
      mode: row.mode,
      map: row.map || null,
      status: row.status,
      maxPlayers: Number(row.max_players),
      playerCount: Number(row.player_count || 0),
    },
  }));
}

async function getState(userId) {
  const active = await activeRoomOf(userId);
  const [myRoom, rooms, invites, lastResult] = await Promise.all([
    active ? getRoom(active.id, userId) : Promise.resolve(null),
    listRooms(),
    invitesOf(userId),
    latestResultOf(userId),
  ]);
  return { myRoom, rooms, invites, lastResult };
}

/** 锁服查询：一台服务器同时只能有一个约战 live。 */
async function activeChallengesByServer() {
  const rows = await q(
    `SELECT r.id, r.server_key, r.mode, r.title, r.host_id,
            c.victory_type, c.victory_limit,
            (SELECT COUNT(*) FROM challenge_room_players p WHERE p.room_id = r.id) AS players
       FROM challenge_rooms r
       LEFT JOIN challenge_configs c ON c.room_id = r.id
      WHERE r.status = 'live' AND r.server_key IS NOT NULL`
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.server_key, {
      id: Number(row.id),
      roomId: Number(row.id),
      serverKey: row.server_key,
      mode: row.mode,
      title: row.title,
      hostId: Number(row.host_id),
      players: Number(row.players || 0),
      victoryType: row.victory_type || 'kills',
      victoryLimit: Number(row.victory_limit || 10),
    });
  }
  return map;
}

async function challengeAccess(userId, serverKey) {
  const row = await one(
    `SELECT r.id, r.mode, r.title, r.status
       FROM challenge_rooms r
      WHERE r.server_key = ? AND r.status = 'live'
      ORDER BY r.id DESC LIMIT 1`,
    [serverKey]
  );
  if (!row) return { active: false, participant: false, room: null };
  const member = await one(
    'SELECT team FROM challenge_room_players WHERE room_id = ? AND user_id = ? LIMIT 1',
    [row.id, userId]
  );
  return {
    active: true,
    participant: Boolean(member),
    team: member ? member.team : null,
    room: { id: Number(row.id), mode: row.mode, title: row.title },
  };
}

async function resultOf(roomId) {
  const row = await one(
    `SELECT r.id, r.title, r.mode, r.server_key, r.status,
            res.winner, res.score_a, res.score_b, res.victory_type,
            res.victory_limit, res.ended_at,
            s.name AS server_name
       FROM challenge_rooms r
       LEFT JOIN challenge_results res ON res.room_id = r.id
       LEFT JOIN servers s ON s.server_key = r.server_key
      WHERE r.id = ? LIMIT 1`,
    [roomId]
  );
  if (!row) return null;
  const members = await roomMembers(roomId);
  return {
    roomId: Number(row.id),
    title: row.title,
    mode: row.mode,
    status: row.status,
    serverKey: row.server_key || null,
    serverName: row.server_name || null,
    winner: row.winner || null,
    scoreA: Number(row.score_a || 0),
    scoreB: Number(row.score_b || 0),
    victoryType: row.victory_type || 'kills',
    victoryLimit: Number(row.victory_limit || 10),
    endedAt: row.ended_at || null,
    players: members,
  };
}

async function latestResultOf(userId) {
  const row = await one(
    `SELECT r.id
       FROM challenge_rooms r
       JOIN challenge_results res ON res.room_id = r.id
      WHERE res.ended_at > (NOW() - INTERVAL 2 HOUR)
        AND (
          EXISTS (SELECT 1 FROM challenge_room_players p WHERE p.room_id = r.id AND p.user_id = ?)
          OR EXISTS (SELECT 1 FROM challenge_spectators s WHERE s.room_id = r.id AND s.user_id = ?)
        )
      ORDER BY res.ended_at DESC LIMIT 1`,
    [userId, userId]
  );
  return row ? resultOf(row.id) : null;
}

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function createRoom(user, fields = {}) {
  const mode = normalizeMode(fields.mode);
  const maxPlayers = MODE_SLOTS[mode] * 2;
  const title = normalizeTitle(fields.title, `${user.game_name || user.username} 的约战`);
  const map = normalizeMap(fields.map);
  const serverKey = String(fields.serverKey || '').trim() || null;
  const victoryType = normalizeVictoryType(fields.victoryType);
  const victoryLimit = normalizeVictoryLimit(fields.victoryLimit);

  if (!serverKey) throw badRequest('请选择一台服务器后再开房');

  if (serverKey) {
    const server = await one('SELECT server_key FROM servers WHERE server_key = ? AND enabled = 1 LIMIT 1', [
      serverKey,
    ]);
    if (!server) throw badRequest('指定的服务器不存在或已停用');
  }

  const roomId = await withTransaction(async (conn) => {
    const [active] = await conn.query(
      `SELECT r.id FROM challenge_room_players p
         JOIN challenge_rooms r ON r.id = p.room_id
        WHERE p.user_id = ? AND r.status IN ('waiting', 'live')
        LIMIT 1 FOR UPDATE`,
      [user.id]
    );
    if (active.length > 0) throw conflict('你已经在约战房间中，先退出当前房间');

    // 房号按自然日重置：锁住当天最后一条，取 next = max + 1
    // 并发下靠 (day_date, day_seq) 唯一键兜底，撞号后重试取号
    let result = null;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
      const [seqRows] = await conn.query(
        `SELECT day_seq FROM challenge_rooms
          WHERE day_date = CURDATE() AND day_seq IS NOT NULL
          ORDER BY day_seq DESC LIMIT 1 FOR UPDATE`
      );
      const daySeq = seqRows.length > 0 ? Number(seqRows[0].day_seq) + 1 : 1;
      try {
        const [inserted] = await conn.query(
          `INSERT INTO challenge_rooms (host_id, day_date, day_seq, title, mode, map, server_key, max_players)
           VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?)`,
          [user.id, daySeq, title, mode, map, serverKey, maxPlayers]
        );
        result = inserted;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY' || attempt === 2) throw err;
      }
    }
    await conn.query(
      `INSERT INTO challenge_room_players (room_id, user_id, team, ready)
       VALUES (?, ?, 'a', 1)`,
      [result.insertId, user.id]
    );
    await conn.query(
      `INSERT INTO challenge_configs (room_id, victory_type, victory_limit)
       VALUES (?, ?, ?)`,
      [result.insertId, victoryType, victoryLimit]
    );
    return result.insertId;
  });

  return getRoom(roomId, user.id);
}

async function joinRoom(userId, roomId) {
  await withTransaction(async (conn) => {
    const [rooms] = await conn.query(
      'SELECT id, status, max_players FROM challenge_rooms WHERE id = ? LIMIT 1 FOR UPDATE',
      [roomId]
    );
    const room = rooms[0];
    if (!room) throw notFound('房间不存在');
    if (room.status !== 'waiting') throw conflict('房间已开赛或已关闭');

    const [members] = await conn.query(
      'SELECT user_id, team FROM challenge_room_players WHERE room_id = ? FOR UPDATE',
      [roomId]
    );
    if (members.some((member) => Number(member.user_id) === Number(userId))) {
      return;
    }

    const active = await conn.query(
      `SELECT r.id FROM challenge_room_players p
         JOIN challenge_rooms r ON r.id = p.room_id
        WHERE p.user_id = ? AND r.status IN ('waiting', 'live') AND r.id <> ?
        LIMIT 1 FOR UPDATE`,
      [userId, roomId]
    );
    if (active[0].length > 0) throw conflict('你已经在另一个约战房间中');

    if (members.length >= Number(room.max_players)) throw conflict('房间已经满了');

    const slots = Number(room.max_players) / 2;
    const countA = members.filter((member) => member.team === 'a').length;
    const countB = members.filter((member) => member.team === 'b').length;
    let team = 'a';
    if (countA >= slots || (countA > countB && countB < slots)) team = 'b';

    await conn.query(
      `INSERT INTO challenge_room_players (room_id, user_id, team, ready)
       VALUES (?, ?, ?, 0)`,
      [roomId, userId, team]
    );
    await conn.query(
      `UPDATE challenge_invites
          SET status = 'accepted', responded_at = NOW()
        WHERE room_id = ? AND to_user_id = ? AND status = 'pending'`,
      [roomId, userId]
    );
  });

  return getRoom(roomId, userId);
}

async function leaveRoom(userId, roomId) {
  const result = await withTransaction(async (conn) => {
    const [rooms] = await conn.query(
      'SELECT id, host_id, status FROM challenge_rooms WHERE id = ? LIMIT 1 FOR UPDATE',
      [roomId]
    );
    const room = rooms[0];
    if (!room) throw notFound('房间不存在');

    const [members] = await conn.query(
      'SELECT user_id FROM challenge_room_players WHERE room_id = ? FOR UPDATE',
      [roomId]
    );
    if (!members.some((member) => Number(member.user_id) === Number(userId))) {
      throw badRequest('你不在这个房间里');
    }

    if (room.status !== 'waiting') {
      // 已开赛后只允许退出座位，房间本身留给其他人收尾
      if (Number(room.host_id) === Number(userId)) {
        await conn.query("UPDATE challenge_rooms SET status = 'closed', closed_at = NOW() WHERE id = ?", [roomId]);
      }
      await conn.query('DELETE FROM challenge_room_players WHERE room_id = ? AND user_id = ?', [
        roomId,
        userId,
      ]);
      return { closed: Number(room.host_id) === Number(userId) };
    }

    if (Number(room.host_id) === Number(userId)) {
      await conn.query("UPDATE challenge_rooms SET status = 'closed', closed_at = NOW() WHERE id = ?", [roomId]);
      await conn.query(
        "UPDATE challenge_invites SET status = 'cancelled', responded_at = NOW() WHERE room_id = ? AND status = 'pending'",
        [roomId]
      );
      return { closed: true };
    }

    await conn.query('DELETE FROM challenge_room_players WHERE room_id = ? AND user_id = ?', [
      roomId,
      userId,
    ]);
    return { closed: false };
  });

  return result;
}

async function closeRoom(user, roomId) {
  const row = await roomRow(roomId);
  if (!row) throw notFound('房间不存在');
  if (Number(row.host_id) !== Number(user.id)) throw forbidden('只有房主可以关闭房间');

  await withTransaction(async (conn) => {
    await conn.query(
      "UPDATE challenge_rooms SET status = 'closed', closed_at = NOW() WHERE id = ? AND status IN ('waiting','live')",
      [roomId]
    );
    await conn.query(
      "UPDATE challenge_invites SET status = 'cancelled', responded_at = NOW() WHERE room_id = ? AND status = 'pending'",
      [roomId]
    );
  });

  return { closed: true };
}

async function invite(user, roomId, targetId) {
  if (Number(targetId) === Number(user.id)) throw badRequest('不能邀请自己');

  await withTransaction(async (conn) => {
    const [rooms] = await conn.query(
      'SELECT id, status, max_players FROM challenge_rooms WHERE id = ? LIMIT 1 FOR UPDATE',
      [roomId]
    );
    const room = rooms[0];
    if (!room) throw notFound('房间不存在');
    if (room.status !== 'waiting') throw conflict('房间已开赛或已关闭');

    const [members] = await conn.query(
      'SELECT user_id FROM challenge_room_players WHERE room_id = ?',
      [roomId]
    );
    if (!members.some((member) => Number(member.user_id) === Number(user.id))) {
      throw forbidden('只有房间成员可以邀请玩家');
    }
    if (members.length >= Number(room.max_players)) throw conflict('房间已经满了');
    if (members.some((member) => Number(member.user_id) === Number(targetId))) {
      throw conflict('对方已经在房间里');
    }

    const [targets] = await conn.query(
      "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
      [targetId]
    );
    if (!targets[0]) throw notFound('被邀请的玩家不存在');

    await conn.query(
      `INSERT INTO challenge_invites (room_id, from_user_id, to_user_id, status)
       VALUES (?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         from_user_id = VALUES(from_user_id),
         status = 'pending',
         created_at = NOW(),
         responded_at = NULL`,
      [roomId, user.id, targetId]
    );
  });

  return { invited: true };
}

async function respond(userId, inviteId, action) {
  const accept = action === 'accept';
  if (!accept && action !== 'decline') throw badRequest('邀请操作只能是 accept / decline');

  const result = await withTransaction(async (conn) => {
    const [invites] = await conn.query(
      `SELECT i.*, r.status AS room_status, r.max_players, r.host_id
         FROM challenge_invites i
         JOIN challenge_rooms r ON r.id = i.room_id
        WHERE i.id = ? LIMIT 1 FOR UPDATE`,
      [inviteId]
    );
    const row = invites[0];
    if (!row) throw notFound('邀请不存在');
    if (Number(row.to_user_id) !== Number(userId)) throw forbidden('这条邀请不是给你的');
    if (row.status !== 'pending') throw conflict('邀请已经处理过了');
    if (row.room_status !== 'waiting') throw conflict('房间已开赛或已关闭');

    if (!accept) {
      await conn.query(
        "UPDATE challenge_invites SET status = 'declined', responded_at = NOW() WHERE id = ?",
        [inviteId]
      );
      return { accepted: false, roomId: Number(row.room_id) };
    }

    const [members] = await conn.query(
      'SELECT user_id FROM challenge_room_players WHERE room_id = ? FOR UPDATE',
      [row.room_id]
    );
    if (members.some((member) => Number(member.user_id) === Number(userId))) {
      await conn.query(
        "UPDATE challenge_invites SET status = 'accepted', responded_at = NOW() WHERE id = ?",
        [inviteId]
      );
      return { accepted: true, roomId: Number(row.room_id) };
    }

    const active = await conn.query(
      `SELECT r.id FROM challenge_room_players p
         JOIN challenge_rooms r ON r.id = p.room_id
        WHERE p.user_id = ? AND r.status IN ('waiting', 'live') AND r.id <> ?
        LIMIT 1 FOR UPDATE`,
      [userId, row.room_id]
    );
    if (active[0].length > 0) throw conflict('你已经在一个约战房间里了');
    if (members.length >= Number(row.max_players)) throw conflict('房间已经满了');

    const slots = Number(row.max_players) / 2;
    const [teamRows] = await conn.query(
      'SELECT team, COUNT(*) AS count FROM challenge_room_players WHERE room_id = ? GROUP BY team',
      [row.room_id]
    );
    const countA = Number((teamRows.find((item) => item.team === 'a') || {}).count || 0);
    const countB = Number((teamRows.find((item) => item.team === 'b') || {}).count || 0);
    let team = 'a';
    if (countA >= slots || (countA > countB && countB < slots)) team = 'b';

    await conn.query(
      `INSERT INTO challenge_room_players (room_id, user_id, team, ready)
       VALUES (?, ?, ?, 0)`,
      [row.room_id, userId, team]
    );
    await conn.query(
      "UPDATE challenge_invites SET status = 'accepted', responded_at = NOW() WHERE id = ?",
      [inviteId]
    );
    return { accepted: true, roomId: Number(row.room_id) };
  });

  return { ...result, room: await getRoom(result.roomId, userId) };
}

async function setReady(userId, roomId, ready) {
  const member = await one(
    'SELECT room_id FROM challenge_room_players WHERE room_id = ? AND user_id = ? LIMIT 1',
    [roomId, userId]
  );
  if (!member) throw forbidden('你不在这个房间里');

  const room = await roomRow(roomId);
  if (!room) throw notFound('房间不存在');
  if (room.status !== 'waiting') throw conflict('房间已开赛或已关闭');

  await q('UPDATE challenge_room_players SET ready = ? WHERE room_id = ? AND user_id = ?', [
    ready ? 1 : 0,
    roomId,
    userId,
  ]);
  return getRoom(roomId, userId);
}

async function startRoom(user, roomId) {
  await withTransaction(async (conn) => {
    const [rooms] = await conn.query(
      'SELECT id, host_id, status, max_players, server_key FROM challenge_rooms WHERE id = ? LIMIT 1 FOR UPDATE',
      [roomId]
    );
    const room = rooms[0];
    if (!room) throw notFound('房间不存在');
    if (Number(room.host_id) !== Number(user.id)) throw forbidden('只有房主可以开始约战');
    if (room.status !== 'waiting') throw conflict('房间状态不允许开赛');
    if (!room.server_key) throw badRequest('请先选择服务器');
    const [configs] = await conn.query(
      'SELECT victory_type, victory_limit FROM challenge_configs WHERE room_id = ? LIMIT 1',
      [roomId]
    );
    if (!configs[0]) throw badRequest('房间缺少胜利条件，请重新开房');

    const [members] = await conn.query(
      'SELECT user_id, ready FROM challenge_room_players WHERE room_id = ?',
      [roomId]
    );
    if (members.length < Number(room.max_players)) throw badRequest('人还没齐，再等等');
    if (members.some((member) => !member.ready)) throw badRequest('还有玩家没有准备');

    const [busy] = await conn.query(
      `SELECT id FROM challenge_rooms
        WHERE server_key = ? AND status = 'live' AND id <> ?
        LIMIT 1 FOR UPDATE`,
      [room.server_key, roomId]
    );
    if (busy.length > 0) throw conflict('该服务器已有约战正在进行');

    await conn.query("UPDATE challenge_rooms SET status = 'live', started_at = NOW() WHERE id = ?", [
      roomId,
    ]);
    await conn.query(
      "UPDATE challenge_invites SET status = 'cancelled', responded_at = NOW() WHERE room_id = ? AND status = 'pending'",
      [roomId]
    );
  });

  return getRoom(roomId, user.id);
}

module.exports = {
  MODES,
  MODE_SLOTS,
  getState,
  getRoom,
  createRoom,
  joinRoom,
  leaveRoom,
  closeRoom,
  invite,
  respond,
  setReady,
  startRoom,
  activeChallengesByServer,
  challengeAccess,
  resultOf,
};
