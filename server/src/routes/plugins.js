'use strict';

/**
 * 插件可观测性：把“本地文件 + 游戏服心跳”收敛成一个只读接口。
 *
 * 心跳表 amxx_builds 由 AMXX 插件写入（platform_auth / ranked_lock）。
 * 表不存在时不能 500：客户端面板仍要能显示本地文件与配置。
 */

const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../middleware/auth');
const env = require('../env');

const router = express.Router();

const PLUGIN_LABELS = {
  platform_auth: 'esf_platform_auth',
  ranked_lock: 'esf_ranked_lock',
  test_ranked: 'test_ranked',
  gamemode: 'esf_gamemode',
};

// 这些插件会写心跳；其余插件只做本地文件观测，避免把“未实现心跳”误报成故障。
const HEARTBEAT_PLUGINS = new Set(['platform_auth', 'ranked_lock']);

function heartbeatState(row, expected, staleSeconds) {
  if (!row) {
    return { state: 'missing', build: null, updatedAt: null, ageSec: null };
  }
  const ageSec = row.age_sec === null || row.age_sec === undefined ? null : Number(row.age_sec);
  const build = row.build === null || row.build === undefined ? null : String(row.build);
  const updatedAt = row.updated_at || null;
  if (expected && build !== String(expected)) {
    return { state: 'drift', build, updatedAt, ageSec };
  }
  if (ageSec !== null && ageSec > staleSeconds) {
    return { state: 'stale', build, updatedAt, ageSec };
  }
  return { state: 'ok', build, updatedAt, ageSec };
}

router.get('/plugins/observability', requireAuth, async (req, res, next) => {
  try {
    const requestedKey = String(req.query.serverKey || '').trim();
    const servers = await q(
      `SELECT s.server_key, s.name, s.mode, s.ip, s.port,
              COALESCE(st.online, 0) AS online,
              st.map AS map,
              COALESCE(st.players, 0) AS players,
              COALESCE(st.max_players, 0) AS max_players,
              st.updated_at AS status_updated_at
         FROM servers s
         LEFT JOIN server_status st ON st.server_id = s.id
        WHERE s.enabled = 1
        ORDER BY s.sort, s.id`
    );

    const tableRows = await q("SHOW TABLES LIKE 'amxx_builds'");
    const heartbeatAvailable = tableRows.length > 0;
    let builds = [];
    if (heartbeatAvailable) {
      builds = await q(
        `SELECT server_key, plugin, build, updated_at,
                TIMESTAMPDIFF(SECOND, updated_at, NOW()) AS age_sec
           FROM amxx_builds`
      );
    }

    const byServer = new Map();
    for (const row of builds) {
      const key = String(row.server_key || '');
      if (!byServer.has(key)) byServer.set(key, new Map());
      byServer.get(key).set(String(row.plugin || ''), row);
    }

    const staleSeconds = env.amxx.heartbeatStaleSeconds;
    const expected = env.amxx.expected;
    const now = new Date().toISOString();

    const data = servers
      .filter((srv) => !requestedKey || String(srv.server_key) === requestedKey)
      .map((srv) => {
        const key = String(srv.server_key || '');
        const rows = byServer.get(key) || new Map();
        const plugins = Object.entries(PLUGIN_LABELS).map(([id, label]) => {
          const row = rows.get(id) || null;
          const isHeartbeat = HEARTBEAT_PLUGINS.has(id);
          const state = !isHeartbeat
            ? { state: 'local-only', build: null, updatedAt: null, ageSec: null }
            : heartbeatAvailable
              ? heartbeatState(row, expected[id], staleSeconds)
              : { state: 'unavailable', build: null, updatedAt: null, ageSec: null };
          return {
            id,
            label,
            expected: expected[id] || null,
            heartbeat: isHeartbeat,
            reported: Boolean(row),
            ...state,
            note: isHeartbeat
              ? row
                ? null
                : '尚未收到该插件心跳'
              : '该插件未实现心跳，版本以客户端本地文件为准',
          };
        });

        const auth = plugins.filter((p) => p.heartbeat);
        let state = 'ok';
        if (!Number(srv.online)) state = 'offline';
        else if (auth.some((p) => p.state !== 'ok')) state = 'attention';

        return {
          serverKey: key,
          name: srv.name || key,
          mode: srv.mode || null,
          ip: srv.ip || null,
          port: srv.port || null,
          online: Boolean(Number(srv.online)),
          map: srv.map || null,
          players: Number(srv.players || 0),
          maxPlayers: Number(srv.max_players || 0),
          statusUpdatedAt: srv.status_updated_at || null,
          state,
          plugins,
        };
      });

    const summary = {
      servers: data.length,
      online: data.filter((s) => s.online).length,
      ok: data.filter((s) => s.state === 'ok').length,
      attention: data.filter((s) => s.state === 'attention').length,
      offline: data.filter((s) => s.state === 'offline').length,
    };

    res.json({
      ok: true,
      data: {
        heartbeatAvailable,
        staleSeconds,
        checkedAt: now,
        expected,
        summary,
        servers: data,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
