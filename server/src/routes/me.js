'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const env = require('../env');
const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { unauthorized } = require('../lib/errors');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    data: {
      user: {
        id: Number(req.user.id),
        username: req.user.username,
        gameName: req.user.game_name,
        role: req.user.role,
      },
    },
  });
});

const patchSchema = z
  .object({
    gameName: z.string().trim().min(1).max(16).optional(),
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
