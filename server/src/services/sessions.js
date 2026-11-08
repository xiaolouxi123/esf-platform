'use strict';

const crypto = require('crypto');
const { q, one } = require('../db');

function uaOf(req) {
  return String(req.headers['user-agent'] || '').slice(0, 255) || null;
}

function ipOf(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  return String(raw).split(',')[0].trim().slice(0, 45) || null;
}

async function createSession(userId, req) {
  const jti = crypto.randomBytes(16).toString('hex');
  await q('INSERT INTO user_sessions (user_id, jti, user_agent, ip) VALUES (?, ?, ?, ?)', [
    userId,
    jti,
    uaOf(req),
    ipOf(req),
  ]);
  return jti;
}

async function listSessions(userId, currentJti) {
  const rows = await q(
    `SELECT id, jti, user_agent, ip, created_at, last_seen_at
       FROM user_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
      ORDER BY last_seen_at DESC
      LIMIT 20`,
    [userId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    current: row.jti === currentJti,
    userAgent: row.user_agent || '',
    ip: row.ip || '',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

async function revokeSession(userId, id) {
  const row = await one('SELECT id FROM user_sessions WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
  if (!row) return false;
  await q('UPDATE user_sessions SET revoked_at = NOW() WHERE id = ?', [id]);
  return true;
}

async function revokeAll(userId, keepId) {
  if (keepId) {
    await q('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [
      userId,
      keepId,
    ]);
  } else {
    await q('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
  }
}

module.exports = { createSession, listSessions, revokeSession, revokeAll, ipOf };
