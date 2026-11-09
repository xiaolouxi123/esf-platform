'use strict';

const express = require('express');
const { Query } = require('goldsrc-query');

const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { badRequest, notFound } = require('../lib/errors');
const { activeMatchesByServer } = require('../services/ranked');
const {
  activeChallengesByServer,
  challengeAccess,
  spectatorCount,
  SPECTATOR_LIMIT,
} = require('../services/challenges');

const router = express.Router();
const QUERY_TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('A2S 查询超时')), ms)),
  ]);
}

router.get('/servers', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT s.server_key, s.name AS display_name, s.mode, s.ip, s.port,
              COALESCE(st.online, 0)      AS online,
              COALESCE(st.players, 0)     AS players,
              COALESCE(st.max_players, 0) AS max_players,
              COALESCE(st.ping_ms, 0)     AS ping_ms,
              st.name AS live_name,
              st.map,
              st.updated_at
         FROM servers s
         LEFT JOIN server_status st ON st.server_id = s.id
        WHERE s.enabled = 1
        ORDER BY s.sort ASC, s.id ASC`
    );

    const activeRanked = await activeMatchesByServer();
    const activeChallenges = await activeChallengesByServer();
    const servers = await Promise.all(
      rows.map(async (row) => {
        const ranked = activeRanked.get(row.server_key) || null;
        const challenge = activeChallenges.get(row.server_key) || null;
        let challengeInfo = null;
        if (challenge) {
          const access = await challengeAccess(req.user.id, row.server_key);
          const spectators = await spectatorCount(challenge.id);
          challengeInfo = {
            ...challenge,
            participant: access.participant,
            team: access.team || null,
            spectatorCount: spectators,
            spectatorLimit: SPECTATOR_LIMIT,
            spectatorAllowed: Boolean(Number(row.online)) && spectators < SPECTATOR_LIMIT,
          };
        }
        return {
          serverKey: row.server_key,
          name: row.live_name || row.display_name,
          mode: row.mode || '混战',
          ip: row.ip,
          port: Number(row.port),
          online: Boolean(Number(row.online)),
          players: Number(row.players),
          maxPlayers: Number(row.max_players),
          ping: Number(row.ping_ms),
          map: row.map || null,
          updatedAt: row.updated_at,
          ranked,
          challenge: challengeInfo,
          locked: Boolean(ranked || challenge),
          lockType: ranked ? 'ranked' : challenge ? 'challenge' : null,
          canJoin: !ranked && !challenge,
          canSpectate: Boolean(challenge),
        };
      })
    );

    res.json({ ok: true, data: { servers } });
  } catch (err) {
    next(err);
  }
});

/**
 * 按 IP:端口 现场查询一台服务器（不进数据库、不改列表）。
 * 用途：玩家在启动器里输入地址，立刻看到这台服活没活、在跑什么图；
 * 如果这台服已经在 servers 表里登记过，就顺带告诉前端能不能带平台身份加入。
 */
router.get('/servers/lookup', requireAuth, async (req, res, next) => {
  try {
    const address = String(req.query.address || '').trim();
    const matched = /^([0-9A-Za-z.-]{3,64}):(\d{2,5})$/.exec(address);
    if (!matched) throw badRequest('地址格式应为 IP:端口，例如 114.132.84.150:27016');

    const host = matched[1];
    const port = Number(matched[2]);
    if (port < 1 || port > 65535) throw badRequest('端口不合法');

    const registered = await one(
      'SELECT server_key, name FROM servers WHERE ip = ? AND port = ? AND enabled = 1 LIMIT 1',
      [host, port]
    );

    const result = {
      address: `${host}:${port}`,
      ip: host,
      port,
      registered: Boolean(registered),
      serverKey: registered ? registered.server_key : null,
      registryName: registered ? registered.name : null,
      online: false,
      name: null,
      map: null,
      players: 0,
      maxPlayers: 0,
      ping: -1,
    };

    const query = new Query(host, port);
    const startedAt = Date.now();
    try {
      query.connect();
      const info = await withTimeout(query.serverInfo(), QUERY_TIMEOUT_MS);
      result.online = true;
      result.name = info.name || null;
      result.map = info.map || null;
      result.players = Number(info.players) || 0;
      result.maxPlayers = Number(info.max_players) || 0;
      result.ping = Date.now() - startedAt;
    } catch (err) {
      result.error = err.message;
    } finally {
      try {
        query.close();
      } catch {
        /* ignore */
      }
    }

    res.json({ ok: true, data: { server: result } });
  } catch (err) {
    next(err);
  }
});

/** 单个房间详情：实时 A2S 查询 + 玩家列表（展开行用） */
router.get('/servers/detail', requireAuth, async (req, res, next) => {
  try {
    const serverKey = String(req.query.serverKey || '').trim();
    const address = String(req.query.address || '').trim();

    let host;
    let port;
    let registered = null;

    if (serverKey) {
      registered = await one(
        'SELECT server_key, name, ip, port FROM servers WHERE server_key = ? AND enabled = 1 LIMIT 1',
        [serverKey]
      );
      if (!registered) throw notFound('服务器不存在');
      host = registered.ip;
      port = Number(registered.port);
    } else if (address) {
      const matched = /^([0-9A-Za-z.-]{3,64}):(\d{2,5})$/.exec(address);
      if (!matched) throw badRequest('地址格式应为 IP:端口');
      host = matched[1];
      port = Number(matched[2]);
      registered = await one(
        'SELECT server_key, name FROM servers WHERE ip = ? AND port = ? AND enabled = 1 LIMIT 1',
        [host, port]
      );
    } else {
      throw badRequest('需要 serverKey 或 address');
    }

    const result = {
      serverKey: registered ? registered.server_key : null,
      address: `${host}:${port}`,
      registered: Boolean(registered),
      online: false,
      name: registered ? registered.name : null,
      map: null,
      players: 0,
      maxPlayers: 0,
      ping: -1,
      playerList: [],
      note: 'A2S 只提供玩家名、分数与在线时长；击杀/死亡需要 AMXX 统计插件上报',
    };

    const query = new Query(host, port);
    const startedAt = Date.now();
    try {
      query.connect();
      const info = await withTimeout(query.serverInfo(), QUERY_TIMEOUT_MS);
      result.online = true;
      result.name = info.name || result.name;
      result.map = info.map || null;
      result.players = Number(info.players) || 0;
      result.maxPlayers = Number(info.max_players) || 0;
      result.ping = Date.now() - startedAt;

      try {
        const list = await withTimeout(query.players(), 2500);
        result.playerList = (list || []).slice(0, 64).map((player) => ({
          name: String(player.name || '').slice(0, 32),
          score: Number(player.score) || 0,
          durationSec: Number(player.time) || 0,
        }));
      } catch (err) {
        result.playersError = err.message;
      }
    } catch (err) {
      result.error = err.message;
    } finally {
      try {
        query.close();
      } catch {
        /* ignore */
      }
    }

    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
