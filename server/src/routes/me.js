'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const env = require('../env');
const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { unauthorized, badRequest } = require('../lib/errors');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    data: {
      user: {
        id: Number(req.user.id),
        username: req.user.username,
        gameName: req.user.game_name,
        avatar: req.user.avatar || '',
    avatarUrl: req.user.avatar_url || '',
    titleId: req.user.title_id ? Number(req.user.title_id) : null,
        role: req.user.role,
      },
    },
  });
});

// 个人战绩：大厅右侧面板用。数据来自 AMXX 写的 play_sessions
router.get('/me/stats', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT COUNT(*)                          AS sessions,
              COALESCE(SUM(duration_sec), 0)    AS total_seconds,
              MAX(started_at)                   AS last_played
         FROM play_sessions
        WHERE user_id = ?`,
      [req.user.id]
    );
    const row = rows[0] || {};
    res.json({
      ok: true,
      data: {
        sessions: Number(row.sessions || 0),
        totalSeconds: Number(row.total_seconds || 0),
        lastPlayedAt: row.last_played || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    gameName: z.string().trim().min(1).max(16).optional(),
    avatar: z.string().trim().max(8).optional(),
    avatarData: z.string().max(400000).optional(),
    oldPassword: z.string().min(1).max(72).optional(),
    newPassword: z.string().min(8).max(72).optional(),
  })
  .refine((v) => !v.newPassword || v.oldPassword, {
    message: '修改密码需要提供旧密码',
    path: ['oldPassword'],
  });

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const body = patchSchema.parse(req.body);

    if (body.gameName) {
      await q('UPDATE users SET game_name = ? WHERE id = ?', [body.gameName, req.user.id]);
    }

    if (body.avatar !== undefined) {
      // 头像允许是 emoji 或留空（留空则用昵称首字）
      const avatar = body.avatar.replace(/[\r\n\t]/g, '').slice(0, 8);
      await q('UPDATE users SET avatar = ?, avatar_url = NULL WHERE id = ?', [avatar, req.user.id]);
    }

    if (body.avatarData !== undefined) {
      const data = String(body.avatarData || '').trim();
      if (data && !/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(data)) {
        throw badRequest('头像必须是 png / jpg / webp / gif 图片');
      }
      if (data.length > 300000) throw badRequest('头像图片太大，请换一张小一点的');
      await q('UPDATE users SET avatar_url = ?, avatar = ? WHERE id = ?', [
        data || null,
        data ? '' : req.user.avatar || '',
        req.user.id,
      ]);
    }

    if (body.newPassword) {
      const current = await one('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      const ok = await bcrypt.compare(body.oldPassword, current.password_hash);
      if (!ok) throw unauthorized('旧密码不正确');

      const hash = await bcrypt.hash(body.newPassword, env.bcryptRounds);
      // 改密码同时踢掉所有旧登录态
      await q('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [
        hash,
        req.user.id,
      ]);
    }

    res.json({ ok: true, data: { updated: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
