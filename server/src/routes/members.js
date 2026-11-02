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
          state: row.updated_at ? row.state : 'offline',
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

/** 单个成员详情：公开资料 + 战绩统计 */
router.get('/members/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, code: 'BAD_REQUEST', message: '成员 ID 不合法' });
      return;
    }

    const rows = await q(
      `SELECT u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.title_id, u.role,
              u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM play_sessions p WHERE p.user_id = u.id) AS sessions,
              (SELECT COALESCE(SUM(p.duration_sec), 0) FROM play_sessions p WHERE p.user_id = u.id) AS total_seconds,
              p.state, p.server_key, p.updated_at,
              s.name AS server_name, st.map AS server_map
         FROM users u
         LEFT JOIN presence p
           ON p.user_id = u.id
          AND p.updated_at > (NOW() - INTERVAL ? SECOND)
         LEFT JOIN servers s ON s.server_key = p.server_key
         LEFT JOIN server_status st ON st.server_id = s.id
        WHERE u.id = ? AND u.status = 'active'
        LIMIT 1`,
      [ONLINE_WINDOW_SECONDS, id]
    );

    const row = rows[0];
    if (!row) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '成员不存在' });
      return;
    }

    res.json({
      ok: true,
      data: {
        member: {
          id: Number(row.id),
          username: row.username,
          gameName: row.game_name,
          avatar: row.avatar || '',
          avatarUrl: row.avatar_url || '',
          titleId: row.title_id ? Number(row.title_id) : null,
          role: row.role,
          online: Boolean(row.updated_at),
          state: row.updated_at ? row.state : 'offline',
          serverName: row.server_name || null,
          serverMap: row.server_map || null,
          sessions: Number(row.sessions || 0),
          totalSeconds: Number(row.total_seconds || 0),
          createdAt: row.created_at,
          lastLoginAt: row.last_login_at || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;