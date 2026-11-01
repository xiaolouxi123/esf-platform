'use strict';

/**
 * 连服 Token 的签发逻辑。
 *
 * 设计要点：
 *  - 32 位 hex（16 字节随机），AMXX 侧只需做正则校验就能防注入
 *  - 绑定 server_key：A 服签的 token 拿到 B 服用不了
 *  - 120 秒有效期 + 单次消费（used_at）
 *  - 10 秒内重复点击复用同一条未过期的 token，避免玩家手抖刷出一串
 */

const crypto = require('crypto');
const { q, one } = require('../db');
const env = require('../env');
const { notFound, badRequest } = require('../lib/errors');

async function requireServer(serverKey) {
  const server = await one(
    'SELECT id, server_key, name, ip, port, enabled FROM servers WHERE server_key = ? LIMIT 1',
    [serverKey]
  );
  if (!server) throw notFound('服务器不存在');
  if (!Number(server.enabled)) throw badRequest('该服务器已停用');
  return server;
}

async function issueLaunchToken(userId, serverKey) {
  await requireServer(serverKey);

  const reusable = await one(
    `SELECT token, expires_at FROM launch_tokens
      WHERE user_id = ? AND server_key = ? AND used_at IS NULL
        AND expires_at > (NOW() + INTERVAL 30 SECOND)
      ORDER BY id DESC LIMIT 1`,
    [userId, serverKey]
  );

  if (reusable) {
    return { token: reusable.token, expiresAt: reusable.expires_at, serverKey, reused: true };
  }

  const token = crypto.randomBytes(16).toString('hex');
  await q(
    'INSERT INTO launch_tokens (token, user_id, server_key, expires_at) VALUES (?, ?, ?, (NOW() + INTERVAL ? SECOND))',
    [token, userId, serverKey, env.launchTokenTtlSeconds]
  );

  const created = await one('SELECT expires_at FROM launch_tokens WHERE token = ? LIMIT 1', [token]);

  // 顺手清理一天前的记录，表不会无限膨胀
  await q('DELETE FROM launch_tokens WHERE created_at < (NOW() - INTERVAL 1 DAY)').catch(() => {});

  return { token, expiresAt: created.expires_at, serverKey, reused: false };
}

module.exports = { issueLaunchToken, requireServer };
