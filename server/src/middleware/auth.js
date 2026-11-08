'use strict';

const jwt = require('jsonwebtoken');
const env = require('../env');
const { one, q } = require('../db');
const { unauthorized } = require('../lib/errors');

/**
 * 校验 Bearer JWT。
 * 除了验签，还要回查数据库里的 token_version 与会话表：
 * 用户改密 / 被踢下线 / 被封禁时，旧 token 立刻失效。
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const matched = /^Bearer\s+(.+)$/i.exec(header);
    if (!matched) throw unauthorized('缺少登录凭证，请先登录');

    let payload;
    try {
      payload = jwt.verify(matched[1], env.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      throw unauthorized(err.name === 'TokenExpiredError' ? '登录已过期，请重新登录' : '登录凭证无效');
    }
    if (payload.scope && payload.scope !== 'access') throw unauthorized('登录凭证无效');

    const session = payload.jti
      ? await one('SELECT id, revoked_at, last_seen_at FROM user_sessions WHERE jti = ? AND user_id = ? LIMIT 1', [
          payload.jti,
          payload.sub,
        ])
      : null;
    if (payload.jti && (!session || session.revoked_at)) {
      throw unauthorized('登录状态已失效，请重新登录');
    }

    const user = await one(
      `SELECT id, username, game_name, avatar, avatar_url, title_id, combat_level, role, status,
              token_version, totp_enabled, email, must_change_password
         FROM users WHERE id = ? LIMIT 1`,
      [payload.sub]
    );
    if (!user) throw unauthorized('账号不存在');
    if (Number(user.token_version) !== Number(payload.tv)) throw unauthorized('登录状态已失效，请重新登录');
    if (user.status !== 'active') throw unauthorized('账号已被封禁');

    if (session) {
      const lastSeen = new Date(session.last_seen_at).getTime();
      if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60 * 1000) {
        q('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = ?', [session.id]).catch(() => {});
      }
    }

    req.user = user;
    req.sessionId = session ? Number(session.id) : null;
    req.jti = payload.jti || null;
    next();
  } catch (err) {
    next(err);
  }
}

function signAccessToken(user, jti) {
  return jwt.sign(
    {
      sub: Number(user.id),
      tv: Number(user.token_version),
      username: user.username,
      jti: jti || undefined,
      scope: 'access',
    },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: env.jwtTtlSeconds }
  );
}

/** 2FA 中间票据：密码通过但还没输动态码，5 分钟内有效。 */
function signChallengeToken(user) {
  return jwt.sign(
    { sub: Number(user.id), tv: Number(user.token_version), scope: '2fa' },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: 5 * 60 }
  );
}

function verifyChallengeToken(token) {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (payload.scope !== '2fa') return null;
    return payload;
  } catch (err) {
    return null;
  }
}

module.exports = { requireAuth, signAccessToken, signChallengeToken, verifyChallengeToken };
