'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const env = require('../env');
const { q, one } = require('../db');
const { requireAuth, signAccessToken } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');
const { conflict, unauthorized, forbidden } = require('../lib/errors');

const router = express.Router();

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,20}$/, '账号需 3~20 位字母/数字/下划线'),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最长 72 位'),
  gameName: z.string().trim().min(1).max(16).optional(),
  inviteCode: z.string().trim().max(64).optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(72),
});

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    avatar: row.avatar || '',
    role: row.role,
  };
}

function clientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  return String(raw).split(',')[0].trim().slice(0, 45);
}

async function logLogin(username, userId, ip, success, reason) {
  try {
    await q(
      'INSERT INTO login_logs (username, user_id, ip, success, reason) VALUES (?, ?, ?, ?, ?)',
      [String(username).slice(0, 32), userId, ip, success ? 1 : 0, reason]
    );
  } catch (err) {
    console.error('[auth] 写登录审计失败:', err.message);
  }
}

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    if (env.inviteCode && body.inviteCode !== env.inviteCode) {
      throw forbidden('邀请码不正确');
    }

    const exists = await one('SELECT id FROM users WHERE username = ? LIMIT 1', [body.username]);
    if (exists) throw conflict('账号已被注册');

    const hash = await bcrypt.hash(body.password, env.bcryptRounds);
    const result = await q(
      'INSERT INTO users (username, password_hash, game_name) VALUES (?, ?, ?)',
      [body.username, hash, body.gameName || body.username]
    );

    const user = await one('SELECT id, username, game_name, role FROM users WHERE id = ? LIMIT 1', [
      result.insertId,
    ]);

    res.status(201).json({ ok: true, data: { user: publicUser(user) } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const ip = clientIp(req);

    const user = await one('SELECT * FROM users WHERE username = ? LIMIT 1', [body.username]);
    if (!user) {
      await logLogin(body.username, null, ip, false, 'USER_NOT_FOUND');
      throw unauthorized('账号或密码错误');
    }

    const passwordOk = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordOk) {
      await logLogin(body.username, user.id, ip, false, 'BAD_PASSWORD');
      throw unauthorized('账号或密码错误');
    }

    if (user.status !== 'active') {
      await logLogin(body.username, user.id, ip, false, 'BANNED');
      throw forbidden('账号已被封禁');
    }

    await q('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await logLogin(body.username, user.id, ip, true, null);

    res.json({
      ok: true,
      data: {
        accessToken: signAccessToken(user),
        expiresIn: env.jwtTtlSeconds,
        user: publicUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 退出登录：token_version + 1，让该用户所有已签发的 JWT 立即失效
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
    res.json({ ok: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
