'use strict';

/**
 * 大厅频道：轻量公共聊天。
 * 定位是"大厅里的人互相看见"，不是 IM —— 所以只保留最近 300 条。
 */

const express = require('express');
const { z } = require('zod');

const { q } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const KEEP_MESSAGES = 300;

const sendSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, '消息不能为空')
    .max(200, '消息最多 200 字'),
});

function publicMessage(row) {
  return {
    id: Number(row.id),
    body: row.body,
    createdAt: row.created_at,
    user: {
      id: Number(row.user_id),
      username: row.username,
      gameName: row.game_name,
      avatar: row.avatar || '',
      role: row.role,
    },
  };
}

const BASE_SELECT = `SELECT c.id, c.body, c.created_at, c.user_id,
                            u.username, u.game_name, u.avatar, u.role
                       FROM chat_messages c
                       JOIN users u ON u.id = c.user_id`;

/** 拉消息：不传 after 取最近 60 条，传 after 只取更新的（轮询用） */
router.get('/chat', requireAuth, async (req, res, next) => {
  try {
    const after = Number(req.query.after) || 0;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 60));

    let rows;
    if (after > 0) {
      rows = await q(`${BASE_SELECT} WHERE c.id > ? ORDER BY c.id ASC LIMIT ?`, [after, limit]);
    } else {
      rows = await q(`${BASE_SELECT} ORDER BY c.id DESC LIMIT ?`, [limit]);
      rows.reverse();
    }

    res.json({ ok: true, data: { messages: rows.map(publicMessage) } });
  } catch (err) {
    next(err);
  }
});

router.post('/chat', requireAuth, chatLimiter, async (req, res, next) => {
  try {
    const { body } = sendSchema.parse(req.body || {});
    // 换行会破坏布局，压成空格
    const text = body.replace(/[\r\n\t]+/g, ' ').slice(0, 200);

    const result = await q('INSERT INTO chat_messages (user_id, body) VALUES (?, ?)', [
      req.user.id,
      text,
    ]);

    // 只保留最近 N 条，避免表无限增长
    await q(
      'DELETE FROM chat_messages WHERE id < (SELECT min_id FROM (SELECT MAX(id) - ? AS min_id FROM chat_messages) t)',
      [KEEP_MESSAGES]
    ).catch(() => {});

    const rows = await q(`${BASE_SELECT} WHERE c.id = ? LIMIT 1`, [result.insertId]);
    res.status(201).json({ ok: true, data: { message: publicMessage(rows[0]) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
