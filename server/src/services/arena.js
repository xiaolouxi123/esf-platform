'use strict';

const { pool, q, one } = require('../db');

const ARENA_SERVER_KEY = 'fcx-1v1-1';
const SPECTATOR_LIMIT = 4;
const QUEUE_LIMIT = 6;

async function ensureTicket(userId, serverKey, token, purpose = 'join', ip = null) {
  if (!token) return null;
  const existing = await one('SELECT id FROM arena_tickets WHERE token = ? LIMIT 1', [token]);
  if (existing) return Number(existing.id);

  await q(
    `UPDATE arena_tickets
        SET state = 'closed'
      WHERE user_id = ? AND server_key = ?
        AND state IN ('waiting','in_server','queued','spectating','matched')`,
    [userId, serverKey]
  );

  const active = await activeMatch(serverKey);
  let state = 'waiting';
  let matchId = null;
  if (active) {
    matchId = Number(active.id);
    const spectators = await countTickets(serverKey, 'spectating');
    if (purpose === 'spectate' || spectators < SPECTATOR_LIMIT) state = 'spectating';
    else state = 'queued';
  }

  const result = await q(
    `INSERT INTO arena_tickets (token, user_id, server_key, purpose, state, match_id, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token, userId, serverKey, purpose, state, matchId, ip]
  );
  if (!active) await maybeCreateArenaMatch(serverKey);
  return Number(result.insertId);
}

async function maybeCreateArenaMatch(serverKey) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [active] = await conn.query(
      "SELECT id FROM ranked_matches WHERE server_key = ? AND status IN ('waiting','live') ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [serverKey]
    );
    if (active.length) {
      await conn.rollback();
      return Number(active[0].id);
    }

    const [tickets] = await conn.query(
      `SELECT t.id, t.user_id FROM arena_tickets t
        JOIN users u ON u.id = t.user_id
        WHERE t.server_key = ? AND t.purpose = 'join'
          AND (t.state IN ('waiting','in_server') OR (t.state = 'queued' AND t.ready = 1))
          AND t.created_at > (NOW() - INTERVAL 5 MINUTE)
        ORDER BY (t.state = 'queued') ASC, t.id ASC LIMIT 2 FOR UPDATE`,
      [serverKey]
    );
    if (tickets.length < 2) {
      await conn.rollback();
      return null;
    }

    const [serverRows] = await conn.query(
      `SELECT s.server_key, st.map
         FROM servers s
         LEFT JOIN server_status st ON st.server_id = s.id
        WHERE s.server_key = ? AND s.is_match = 1
        LIMIT 1`,
      [serverKey]
    );
    if (!serverRows.length) {
      await conn.rollback();
      return null;
    }

    const [matchResult] = await conn.query(
      `INSERT INTO ranked_matches (mode, server_key, map, status, match_type)
       VALUES ('1v1', ?, ?, 'waiting', 'arena')`,
      [serverKey, serverRows[0].map || null]
    );
    const matchId = matchResult.insertId;
    for (let i = 0; i < tickets.length; i++) {
      const [ratingRows] = await conn.query(
        'SELECT rating FROM ranked_profiles WHERE user_id = ? LIMIT 1',
        [tickets[i].user_id]
      );
      const rating = ratingRows.length ? Number(ratingRows[0].rating) : 1000;
      await conn.query(
        `INSERT INTO ranked_match_players (match_id, user_id, team, slot, ready, rating_before)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [matchId, tickets[i].user_id, i === 0 ? 'a' : 'b', 1, rating]
      );
    }
    await conn.query(
      `UPDATE arena_tickets SET state = 'matched', match_id = ? WHERE id IN (?, ?)`,
      [matchId, tickets[0].id, tickets[1].id]
    );
    await conn.commit();
    return Number(matchId);
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function activeMatch(serverKey) {
  return one(
    `SELECT id, status, match_type, started_at
       FROM ranked_matches
      WHERE server_key = ? AND status IN ('waiting','live')
      ORDER BY id DESC LIMIT 1`,
    [serverKey]
  );
}

async function countTickets(serverKey, state) {
  const row = await one(
    'SELECT COUNT(*) AS total FROM arena_tickets WHERE server_key = ? AND state = ?',
    [serverKey, state]
  );
  return Number(row?.total || 0);
}

async function getArenaState(userId, serverKey) {
  const match = await activeMatch(serverKey);
  const spectatorCount = await countTickets(serverKey, 'spectating');
  const queueLength = await countTickets(serverKey, 'queued');
  const ticket = userId
    ? await one(
        `SELECT id, purpose, state, match_id
           FROM arena_tickets
          WHERE user_id = ? AND server_key = ?
            AND state IN ('waiting','in_server','queued','spectating','matched')
          ORDER BY id DESC LIMIT 1`,
        [userId, serverKey]
      )
    : null;

  const participant = Boolean(match && ticket && Number(ticket.match_id) === Number(match.id));
  return {
    key: serverKey,
    phase: match ? (match.status === 'live' ? 'live' : 'waiting') : 'idle',
    matchId: match ? Number(match.id) : null,
    queueLength,
    queueLimit: QUEUE_LIMIT,
    spectatorCount,
    spectatorLimit: SPECTATOR_LIMIT,
    participant,
    queued: ticket?.state === 'queued',
    spectating: ticket?.state === 'spectating',
    joinMode: !match
      ? 'join'
      : participant
        ? 'join'
        : spectatorCount < SPECTATOR_LIMIT
          ? 'spectate'
          : queueLength < QUEUE_LIMIT
            ? 'queue'
            : 'locked',
  };
}

async function activeArenaByServer() {
  const rows = await q(
    `SELECT id, server_key, status
       FROM ranked_matches
      WHERE status IN ('waiting','live') AND match_type = 'arena'`
  );
  const map = new Map();
  for (const row of rows) map.set(row.server_key, row);
  return map;
}

module.exports = {
  ARENA_SERVER_KEY,
  SPECTATOR_LIMIT,
  QUEUE_LIMIT,
  ensureTicket,
  maybeCreateArenaMatch,
  getArenaState,
  activeArenaByServer,
};