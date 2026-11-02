'use strict';

const express = require('express');
const { z } = require('zod');

const { q } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ONLINE_WINDOW_SECONDS = 75;

const pingSchema = z.object({
  state: z.enum(['lobby', 'ingame']).default('lobby'),
  serverKey: z.string().trim().max(32).optional(),
});

/** 心跳：客户端每 20 秒调一次，带上当前状态（大厅 / 游戏中） */
router.post('/presence', requireAuth, async (req, res, next) => {
  try {
    const body = pingSchema.parse(req.body || {});

    await q(
      `INSERT INTO presence (user_id, state, server_key)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state),
         server_key = VALUES(server_key),
         updated_at = NOW()`,
      [req.user.id, body.state, body.serverKey || null]
    );

    res.json({ ok: true, data: { state: body.state, serverKey: body.serverKey || null } });
  } catch (err) {
    next(err);
  }
});

/** 在线列表：75 秒内有心跳的账号 */
router.get('/presence', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.title_id, u.role,
              p.state, p.server_key, p.updated_at,
              s.name AS server_name, st.map AS server_map
         FROM presence p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN servers s ON s.server_key = p.server_key
         LEFT JOIN server_status st ON st.server_id = s.id
        WHERE p.updated_at > (NOW() - INTERVAL ? SECOND)
          AND u.status = 'active'
        ORDER BY (p.state = 'ingame') DESC, p.updated_at DESC
        LIMIT 50`,
      [ONLINE_WINDOW_SECONDS]
    );

    res.json({
      ok: true,
      data: {
        online: rows.map((row) => ({
          id: Number(row.id),
          username: row.username,
          gameName: row.game_name,
          avatar: row.avatar || '',
          avatarUrl: row.avatar_url || '',
          titleId: row.title_id ? Number(row.title_id) : null,
          role: row.role,
          state: row.state,
          serverKey: row.server_key || null,
          serverName: row.server_name || null,
          serverMap: row.server_map || null,
          updatedAt: row.updated_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
