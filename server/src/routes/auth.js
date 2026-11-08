'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const env = require('../env');
const { q, one } = require('../db');
const {
  requireAuth,
  signAccessToken,
  signChallengeToken,
  verifyChallengeToken,
} = require('../middleware/auth');
const {
  loginLimiter,
  registerLimiter,
  forgotLimiter,
  emailCodeLimiter,
} = require('../middleware/rateLimit');
const { conflict, unauthorized, forbidden, badRequest, notFound } = require('../lib/errors');
const mail = require('../services/mail');
const totp = require('../services/totp');
const sessions = require('../services/sessions');
const { checkPassword } = require('../lib/password');

const router = express.Router();

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,20}$/, '账号需 3~20 位字母/数字/下划线'),
  password: z.string().min(10, '密码至少 10 位').max(72, '密码最长 72 位'),
  gameName: z
    .string()
    .trim()
    .min(1, '游戏昵称不能为空')
    .max(16, '游戏昵称最长 16 个字符')
    .regex(/^[^\x00-\x1f"\\]+$/, '游戏昵称不能包含引号、反斜杠或控制字符')
    .optional(),
  inviteCode: z.string().trim().max(64).optional(),
  email: z.string().trim().toLowerCase().email('邮箱格式不正确').max(190).optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(72),
});

const emailSchema = z.string().trim().toLowerCase().email('邮箱格式不正确').max(190);
const codeSchema = z.string().trim().regex(/^\d{6}$/, '验证码是 6 位数字');

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    email: row.email || null,
    emailVerified: Boolean(row.email_verified_at),
    mustChangePassword: Number(row.must_change_password) === 1,
    totpEnabled: Number(row.totp_enabled) === 1,
    avatar: row.avatar || '',
    avatarUrl: row.avatar_url || '',
    titleId: row.title_id ? Number(row.title_id) : null,
    combatLevel: Number(row.combat_level || 0),
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
    console.error('[auth] 写登录审计失败', err.message);
  }
}

function hashCode(code) {
  return crypto.createHash('sha256').update(`${code}:${env.jwtSecret}`).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseBackupCodes(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function makeBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code).toUpperCase()).digest('hex');
}

function sixDigits() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function findAccount(account) {
  const value = String(account || '').trim();
  if (!value) return null;
  return one('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [value, value.toLowerCase()]);
}

/** 发一个验证码并落库（同一邮箱+用途只保留最新一条未用码） */
async function issueCode(user, email, purpose) {
  if (!mail.mailEnabled()) {
    throw Object.assign(badRequest('邮件服务尚未配置，请联系管理员重置密码'), { status: 503 });
  }

  const code = sixDigits();
  const ttlMs = env.resetCodeTtlMinutes * 60 * 1000;

  await q(
    `UPDATE email_codes SET used_at = NOW()
      WHERE email = ? AND purpose = ? AND used_at IS NULL`,
    [email, purpose]
  );
  await q(
    `INSERT INTO email_codes (user_id, email, code_hash, purpose, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [user ? user.id : null, email, hashCode(code), purpose, Math.floor(ttlMs / 1000)]
  );

  await mail.sendCode(email, code, purpose);
  return ttlMs / 60000;
}

/** 校验验证码，成功返回对应记录 */
async function consumeCode(email, purpose, code) {
  const row = await one(
    `SELECT * FROM email_codes
      WHERE email = ? AND purpose = ? AND used_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );
  if (!row) throw badRequest('验证码已失效，请重新获取');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('验证码已过期，请重新获取');
  }
  if (Number(row.attempts) >= 5) {
    await q('UPDATE email_codes SET used_at = NOW() WHERE id = ?', [row.id]);
    throw badRequest('尝试次数过多，请重新获取验证码');
  }

  const ok = crypto.timingSafeEqual(Buffer.from(hashCode(code), 'hex'), Buffer.from(row.code_hash, 'hex'));
  if (!ok) {
    await q('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw badRequest('验证码不正确');
  }

  await q('UPDATE email_codes SET used_at = NOW() WHERE id = ?', [row.id]);
  return row;
}

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    const strength = checkPassword(body.password, { username: body.username, email: body.email });
    if (!strength.ok) throw badRequest(strength.message);

    if (env.inviteCode && body.inviteCode !== env.inviteCode) {
      throw forbidden('邀请码不正确');
    }

    const exists = await one('SELECT id FROM users WHERE username = ? LIMIT 1', [body.username]);
    if (exists) throw conflict('账号已被注册');

    // 账号是唯一且不可改的；游戏昵称也查重，避免大厅里出现两个同名玩家。
    const gameName = body.gameName || body.username;
    const nameTaken = await one(
      'SELECT id FROM users WHERE game_name = ? OR username = ? LIMIT 1',
      [gameName, gameName]
    );
    if (nameTaken) throw conflict('游戏昵称已被使用，请换一个');

    if (body.email) {
      const emailTaken = await one('SELECT id FROM users WHERE email = ? LIMIT 1', [body.email]);
      if (emailTaken) throw conflict('邮箱已被其它账号绑定');
    }

    const hash = await bcrypt.hash(body.password, env.bcryptRounds);
    const result = await q(
      `INSERT INTO users (username, password_hash, game_name, role, email, email_verified_at)
       VALUES (?, ?, ?, 'user', ?, ${body.email ? 'NOW()' : 'NULL'})`,
      [body.username, hash, gameName, body.email || null]
    );

    const user = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [result.insertId]);
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

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000));
      await logLogin(body.username, user.id, ip, false, 'LOCKED');
      throw Object.assign(
        forbidden(`密码错误次数过多，账号已锁定，请 ${minutes} 分钟后再试或使用「忘记密码」`),
        { code: 'ACCOUNT_LOCKED' }
      );
    }

    const passwordOk = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordOk) {
      const failed = Number(user.failed_login_count || 0) + 1;
      if (failed >= env.loginMaxFailures) {
        await q(
          'UPDATE users SET failed_login_count = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
          [env.loginLockMinutes, user.id]
        );
        await logLogin(body.username, user.id, ip, false, 'LOCKED_NOW');
        throw Object.assign(
          forbidden(`密码连续输错 ${env.loginMaxFailures} 次，账号锁定 ${env.loginLockMinutes} 分钟`),
          { code: 'ACCOUNT_LOCKED' }
        );
      }
      await q('UPDATE users SET failed_login_count = ? WHERE id = ?', [failed, user.id]);
      await logLogin(body.username, user.id, ip, false, 'BAD_PASSWORD');
      throw unauthorized('账号或密码错误');
    }

    if (user.status !== 'active') {
      await logLogin(body.username, user.id, ip, false, 'BANNED');
      throw forbidden('账号已被封禁');
    }

    // 已开启两步验证：先发一张 5 分钟的中间票据，动态码校验通过后才发正式 token。
    if (Number(user.totp_enabled) === 1) {
      await logLogin(body.username, user.id, ip, true, 'TWO_FACTOR_REQUIRED');
      return res.json({
        ok: true,
        data: {
          twoFactorRequired: true,
          challengeToken: signChallengeToken(user),
          expiresInSeconds: 300,
        },
      });
    }

    await q(
      'UPDATE users SET last_login_at = NOW(), failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [user.id]
    );
    await logLogin(body.username, user.id, ip, true, null);

    const jti = await sessions.createSession(user.id, req);
    res.json({
      ok: true,
      data: {
        accessToken: signAccessToken(user, jti),
        expiresIn: env.jwtTtlSeconds,
        user: publicUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** 2FA 第二步：用中间票据 + 6 位动态码换正式 token；也接受备用码（一次性）。 */
router.post('/2fa/verify', loginLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const payload = verifyChallengeToken(String(body.challengeToken || ''));
    if (!payload) throw unauthorized('验证已过期，请重新登录');

    const user = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [payload.sub]);
    if (!user || user.status !== 'active') throw unauthorized('账号不可用');
    if (Number(user.token_version) !== Number(payload.tv)) throw unauthorized('登录状态已失效，请重新登录');

    const ip = clientIp(req);
    const code = String(body.code || '').trim();
    let ok = totp.verify(user.totp_secret, code);

    if (!ok && /^[A-Za-z0-9-]{8,64}$/.test(code)) {
      const hashes = parseBackupCodes(user.totp_backup_codes);
      const digest = crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
      const idx = hashes.indexOf(digest);
      if (idx >= 0) {
        hashes.splice(idx, 1);
        await q('UPDATE users SET totp_backup_codes = ? WHERE id = ?', [JSON.stringify(hashes), user.id]);
        ok = true;
      }
    }

    if (!ok) {
      await logLogin(user.username, user.id, ip, false, 'BAD_2FA');
      throw unauthorized('动态验证码不正确');
    }

    await q('UPDATE users SET last_login_at = NOW(), failed_login_count = 0, locked_until = NULL WHERE id = ?', [
      user.id,
    ]);
    await logLogin(user.username, user.id, ip, true, 'TWO_FACTOR');

    const jti = await sessions.createSession(user.id, req);
    res.json({
      ok: true,
      data: {
        accessToken: signAccessToken(user, jti),
        expiresIn: env.jwtTtlSeconds,
        user: publicUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 退出登录：撤销当前会话并 token_version + 1，让该用户所有已签发的 JWT 立即失效
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    if (req.sessionId) {
      await q('UPDATE user_sessions SET revoked_at = NOW() WHERE id = ?', [req.sessionId]);
    }
    await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
    res.json({ ok: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

/** 两步验证：生成密钥（尚未启用） */
router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const user = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (Number(user.totp_enabled) === 1) throw conflict('两步验证已开启');

    const secret = totp.generateSecret();
    await q('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, user.id]);
    res.json({
      ok: true,
      data: {
        secret,
        otpauth: totp.otpauthUrl(secret, user.username),
        digits: 6,
        period: 30,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** 两步验证：校验一次动态码后开启，返回 10 个一次性备用码 */
router.post('/2fa/enable', requireAuth, async (req, res, next) => {
  try {
    const code = String((req.body || {}).code || '').trim();
    const user = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (Number(user.totp_enabled) === 1) throw conflict('两步验证已开启');
    if (!user.totp_secret) throw badRequest('请先生成密钥');
    if (!totp.verify(user.totp_secret, code)) throw badRequest('动态验证码不正确');

    const backupCodes = makeBackupCodes(10);
    const hashes = backupCodes.map(hashBackupCode);
    await q('UPDATE users SET totp_enabled = 1, totp_backup_codes = ? WHERE id = ?', [
      JSON.stringify(hashes),
      user.id,
    ]);
    res.json({ ok: true, data: { enabled: true, backupCodes } });
  } catch (err) {
    next(err);
  }
});

/** 两步验证：关闭（需要当前密码） */
router.post('/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const password = String((req.body || {}).password || '');
    const user = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (Number(user.totp_enabled) !== 1) throw badRequest('两步验证未开启');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw forbidden('密码不正确');

    await q('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = NULL WHERE id = ?', [
      user.id,
    ]);
    res.json({ ok: true, data: { enabled: false } });
  } catch (err) {
    next(err);
  }
});

/** 当前账号的登录设备列表 */
router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const list = await sessions.listSessions(req.user.id, req.jti);
    res.json({ ok: true, data: { sessions: list } });
  } catch (err) {
    next(err);
  }
});

/** 撤销指定设备会话 */
router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('会话 ID 无效');
    const ok = await sessions.revokeSession(req.user.id, id);
    if (!ok) throw notFound('会话不存在或已失效');
    res.json({ ok: true, data: { revoked: id } });
  } catch (err) {
    next(err);
  }
});

/** 撤销除当前设备外的其它会话 */
router.post('/sessions/revoke-others', requireAuth, async (req, res, next) => {
  try {
    await sessions.revokeAll(req.user.id, req.sessionId);
    res.json({ ok: true, data: { revoked: true } });
  } catch (err) {
    next(err);
  }
});

/** 给当前账号绑定邮箱：发验证码 */
router.post('/email/code', requireAuth, emailCodeLimiter, async (req, res, next) => {
  try {
    const email = emailSchema.parse((req.body || {}).email);
    const taken = await one('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [
      email,
      req.user.id,
    ]);
    if (taken) throw conflict('该邮箱已被其它账号绑定');

    const ttlMinutes = await issueCode(req.user, email, 'bind');
    res.json({ ok: true, data: { sent: true, ttlMinutes } });
  } catch (err) {
    next(err);
  }
});

/** 绑定邮箱：提交验证码 */
router.post('/email/bind', requireAuth, emailCodeLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = emailSchema.parse(body.email);
    const code = codeSchema.parse(body.code);

    await consumeCode(email, 'bind', code);
    const taken = await one('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [
      email,
      req.user.id,
    ]);
    if (taken) throw conflict('该邮箱已被其它账号绑定');

    await q('UPDATE users SET email = ?, email_verified_at = NOW() WHERE id = ?', [email, req.user.id]);
    res.json({ ok: true, data: { email, verified: true } });
  } catch (err) {
    next(err);
  }
});

/** 忘记密码第一步：发验证码（账号存在且已绑邮箱才真发，其余情况返回统一文案防枚举） */
router.post('/forgot/send', forgotLimiter, async (req, res, next) => {
  try {
    const account = String((req.body || {}).account || '').trim();
    if (!account) throw badRequest('请输入账号或邮箱');

    const user = await findAccount(account);
    const generic = {
      sent: true,
      message: '如果该账号已绑定邮箱，验证码会在 1 分钟内送达',
    };

    if (!user) return res.json({ ok: true, data: generic });
    if (!user.email) {
      const err = badRequest('该账号还没有绑定邮箱，请联系管理员重置密码');
      err.code = 'EMAIL_NOT_BOUND';
      err.status = 409;
      throw err;
    }

    const ttlMinutes = await issueCode(user, user.email, 'reset');
    res.json({ ok: true, data: { sent: true, ttlMinutes, maskedEmail: maskEmail(user.email) } });
  } catch (err) {
    next(err);
  }
});

/** 忘记密码第二步：验证码换取一次性重置令牌 */
router.post('/forgot/verify', forgotLimiter, async (req, res, next) => {
  try {
    const account = String((req.body || {}).account || '').trim();
    const code = codeSchema.parse((req.body || {}).code);

    const user = await findAccount(account);
    if (!user || !user.email) throw badRequest('账号或邮箱不正确');

    await consumeCode(user.email, 'reset', code);

    const token = randomToken();
    await q(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [user.id, hashCode(token)]
    );
    res.json({ ok: true, data: { resetToken: token, expiresInMinutes: 15 } });
  } catch (err) {
    next(err);
  }
});

/** 忘记密码第三步：用令牌设置新密码（同时解锁并踢掉所有旧登录） */
router.post('/forgot/reset', forgotLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!/^[a-f0-9]{64}$/i.test(token)) throw badRequest('重置令牌无效');
    if (password.length < 10 || password.length > 72) throw badRequest('密码需 10~72 位');

    const row = await one(
      `SELECT * FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1`,
      [hashCode(token)]
    );
    if (!row) throw badRequest('重置令牌无效或已使用，请重新获取验证码');
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw badRequest('重置令牌已过期，请重新获取验证码');
    }

    const target = await one('SELECT username, email FROM users WHERE id = ? LIMIT 1', [row.user_id]);
    const strength = checkPassword(password, { username: target && target.username, email: target && target.email });
    if (!strength.ok) throw badRequest(strength.message);

    const hash = await bcrypt.hash(password, env.bcryptRounds);
    await q(
      `UPDATE users
          SET password_hash = ?, token_version = token_version + 1,
              must_change_password = 0, failed_login_count = 0, locked_until = NULL
        WHERE id = ?`,
      [hash, row.user_id]
    );
    await q('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [row.id]);
    await q(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [row.user_id]
    );

    res.json({ ok: true, data: { reset: true } });
  } catch (err) {
    next(err);
  }
});

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${'*'.repeat(Math.max(1, name.length - head.length))}@${domain}`;
}

module.exports = router;
