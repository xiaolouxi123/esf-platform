'use strict';

const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/servers', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT s.server_key, s.name AS display_name, s.ip, s.port,
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

    const servers = rows.map((row) => ({
      serverKey: row.server_key,
      name: row.live_name || row.display_name,
      ip: row.ip,
      port: Number(row.port),
      online: Boolean(Number(row.online)),
      players: Number(row.players),
      maxPlayers: Number(row.max_players),
      ping: Number(row.ping_ms),
      map: row.map || null,
      updatedAt: row.updated_at,
    }));

    res.json({ ok: true, data: { servers } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
