'use strict';

/**
 * 频道成员名册：所有正常账号 + 在线状态。
 * 和 /presence 的区别：这里包含离线成员，供 Discord 式成员列表使用。
 */

const express = require('express');

const { q } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const ONLINE_WINDOW_SECONDS = 75;

router.get('/members', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.title_id, u.role,
              p.state, p.server_key, p.updated_at,
              s.name AS server_name, st.map AS server_map
         FROM users u
         LEFT JOIN presence p
           ON p.user_id = u.id
          AND p.updated_at > (NOW() - INTERVAL ? SECOND)
         LEFT JOIN servers s ON s.server_key = p.server_key
         LEFT JOIN server_status st ON st.server_id = s.id
        WHERE u.status = 'active'
        ORDER BY u.id ASC
        LIMIT 500`,
      [ONLINE_WINDOW_SECONDS]
    );

    res.json({
      ok: true,
      data: {
        members: rows.map((row) => ({
          id: Number(row.id),
          username: row.username,
          gameName: row.game_name,
          avatar: row.avatar || '',
          avatarUrl: row.avatar_url || '',
          titleId: row.title_id ? Number(row.title_id) : null,
          role: row.role,
          online: Boolean(row.updated_at),
          state: row.online ? row.state : 'offline',
          serverKey: row.server_key || null,
          serverName: row.server_name || null,
          serverMap: row.server_map || null,
          updatedAt: row.updated_at || null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
