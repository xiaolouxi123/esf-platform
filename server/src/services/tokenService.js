'use strict';

/**
 * 连服 Token 的签发逻辑。
 *
 * 设计要点：
 *  - 32 位 hex（16 字节随机），AMXX 侧只需做正则校验就能防注入
 *  - 绑定 server_key：A 服签的 token 拿到 B 服用不了
 *  - 120 秒有效期 + 单次消费（used_at）
 *  - 约战期间普通玩家签不到 token；参赛者签 join，观战者签 spectate
 *  - 10 秒内重复点击复用同一条未过期 token，避免玩家手抖刷出一串
 */

const crypto = require('crypto');
const { q, one } = require('../db');
const env = require('../env');
const { notFound, badRequest, ApiError } = require('../lib/errors');
const { canEnterServer } = require('./ranked');
const { challengeAccess } = require('./challenges');

async function requireServer(serverKey) {
  const server = await one(
    'SELECT id, server_key, name, ip, port, enabled, mode FROM servers WHERE server_key = ? LIMIT 1',
    [serverKey]
  );
  if (!server) throw notFound('服务器不存在');
  if (!Number(server.enabled)) throw badRequest('该服务器已停用');
  return server;
}

async function issueLaunchToken(userId, serverKey, options = {}) {
  const server = await requireServer(serverKey);
  const purpose = options.purpose === 'spectate' ? 'spectate' : 'join';
  const challenge = await challengeAccess(userId, serverKey);

  if (purpose === 'spectate') {
    if (!challenge.active) throw badRequest('这台服务器当前没有进行中的约战');
    if (challenge.participant) throw badRequest('参赛玩家不能以观战身份进入');
  } else if (challenge.active) {
    if (!challenge.participant) {
      throw new ApiError(409, 'CHALLENGE_LOCKED', '该服务器正在进行约战，只有参赛玩家或观战者可以进入');
    }
  } else {
    const access = await canEnterServer(userId, serverKey);
    if (!access.allowed) {
      throw new ApiError(400, 'RANKED_LOCKED', '该服务器正在进行排位赛，只有本场参赛玩家可以进入');
    }
  }

  if (server.mode === '新手') {
    const user = await one('SELECT combat_level FROM users WHERE id = ? LIMIT 1', [userId]);
    if (Number(user?.combat_level || 0) > 0) {
      throw badRequest('你已有格斗等级，不能进入新手房');
    }
  }

  const reusable = await one(
    `SELECT token, expires_at FROM launch_tokens
      WHERE user_id = ? AND server_key = ? AND used_at IS NULL AND purpose = ?
        AND expires_at > (NOW() + INTERVAL 30 SECOND)
      ORDER BY id DESC LIMIT 1`,
    [userId, serverKey, purpose]
  );

  if (reusable) {
    return { token: reusable.token, expiresAt: reusable.expires_at, serverKey, reused: true, purpose };
  }

  const token = crypto.randomBytes(16).toString('hex');
  await q(
    'INSERT INTO launch_tokens (token, user_id, server_key, purpose, expires_at) VALUES (?, ?, ?, ?, (NOW() + INTERVAL ? SECOND))',
    [token, userId, serverKey, purpose, env.launchTokenTtlSeconds]
  );

  const created = await one('SELECT expires_at FROM launch_tokens WHERE token = ? LIMIT 1', [token]);

  // 顺手清理一天前的记录，表不会无限膨胀
  await q('DELETE FROM launch_tokens WHERE created_at < (NOW() - INTERVAL 1 DAY)').catch(() => {});

  return { token, expiresAt: created.expires_at, serverKey, reused: false, purpose };
}

module.exports = { issueLaunchToken, requireServer };
