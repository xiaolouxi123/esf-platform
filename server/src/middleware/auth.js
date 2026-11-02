'use strict';

const jwt = require('jsonwebtoken');
const env = require('../env');
const { one } = require('../db');
const { unauthorized } = require('../lib/errors');

/**
 * 校验 Bearer JWT。
 * 除了验签，还要回查数据库里的 token_version：
 * 用户改密码/被踢下线/被封禁时，旧 token 立刻失效（JWT 本身是无状态的，靠这个字段补上撤销能力）。
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

    const user = await one(
      'SELECT id, username, game_name, avatar, avatar_url, title_id, role, status, token_version FROM users WHERE id = ? LIMIT 1',
      [payload.sub]
    );
    if (!user) throw unauthorized('账号不存在');
    if (Number(user.token_version) !== Number(payload.tv)) throw unauthorized('登录状态已失效，请重新登录');
    if (user.status !== 'active') throw unauthorized('账号已被封禁');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: Number(user.id), tv: Number(user.token_version), username: user.username },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: env.jwtTtlSeconds }
  );
}

module.exports = { requireAuth, signAccessToken };
