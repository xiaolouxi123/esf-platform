'use strict';

/**
 * 后台轮询服务器状态（A2S），结果写进 server_status。
 * 大厅只读缓存，不直接打游戏服务器 —— 否则每开一次大厅就扫一遍，延迟很高。
 */

const { Query } = require('goldsrc-query');
const { q } = require('../db');

const POLL_INTERVAL_MS = 15_000;
const QUERY_TIMEOUT_MS = 3_000;

let timer = null;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时`)), ms)),
  ]);
}

async function pollServer(server) {
  const query = new Query(server.ip, server.port);
  const startedAt = Date.now();
  try {
    query.connect();
    const info = await withTimeout(query.serverInfo(), QUERY_TIMEOUT_MS, 'A2S_INFO');
    const ping = Date.now() - startedAt;

    await q(
      `INSERT INTO server_status (server_id, name, map, players, max_players, ping_ms, online, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), map = VALUES(map), players = VALUES(players),
         max_players = VALUES(max_players), ping_ms = VALUES(ping_ms),
         online = 1, updated_at = NOW()`,
      [
        server.id,
        (info.name || '').slice(0, 96),
        (info.map || '').slice(0, 64),
        Number(info.players) || 0,
        Number(info.max_players) || 0,
        ping,
      ]
    );
  } catch (err) {
    console.warn(`[poller] ${server.server_key} 查询失败: ${err.message}`);
    await q(
      `INSERT INTO server_status (server_id, online, updated_at) VALUES (?, 0, NOW())
       ON DUPLICATE KEY UPDATE online = 0, updated_at = NOW()`,
      [server.id]
    ).catch(() => {});
  } finally {
    try { query.close(); } catch { /* ignore */ }
  }
}

async function pollOnce() {
  const servers = await q('SELECT id, server_key, ip, port FROM servers WHERE enabled = 1');
  for (const server of servers) {
    await pollServer(server);
  }
}

function startPoller() {
  pollOnce().catch((err) => console.warn('[poller] 首轮轮询失败:', err.message));
  timer = setInterval(() => {
    pollOnce().catch((err) => console.warn('[poller] 轮询失败:', err.message));
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function stopPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startPoller, stopPoller, pollOnce };
