'use strict';

const express = require('express');
const { z } = require('zod');

const { pool, q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { badRequest, notFound } = require('../lib/errors');

const router = express.Router();

router.use('/favorites', requireAuth);

async function listKeys(userId) {
  const rows = await q(
    'SELECT server_key FROM server_favorites WHERE user_id = ? ORDER BY created_at ASC',
    [userId]
  );
  return rows.map((row) => row.server_key);
}

router.get('/favorites', async (req, res, next) => {
  try {
    res.json({ ok: true, data: { serverKeys: await listKeys(req.user.id) } });
  } catch (err) {
    next(err);
  }
});

const bulkSchema = z.object({
  serverKeys: z.array(z.string().trim().max(32)).max(50),
});

/** 全量同步：老客户端把 localStorage 里的收藏一次性迁到账号上 */
router.put('/favorites', async (req, res, next) => {
  try {
    const { serverKeys } = bulkSchema.parse(req.body || {});
    const unique = [...new Set(serverKeys.map((key) => key.trim()).filter(Boolean))];
    for (const key of unique) {
      const server = await one('SELECT server_key FROM servers WHERE server_key = ? LIMIT 1', [key]);
      if (!server) throw badRequest(`服务器 ${key} 不存在`);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM server_favorites WHERE user_id = ?', [req.user.id]);
      for (const key of unique) {
        await conn.query('INSERT INTO server_favorites (user_id, server_key) VALUES (?, ?)', [
          req.user.id,
          key,
        ]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ ok: true, data: { serverKeys: await listKeys(req.user.id) } });
  } catch (err) {
    next(err);
  }
});

router.post('/favorites/:serverKey', async (req, res, next) => {
  try {
    const serverKey = String(req.params.serverKey || '').trim();
    const server = await one('SELECT server_key FROM servers WHERE server_key = ? AND enabled = 1 LIMIT 1', [
      serverKey,
    ]);
    if (!server) throw notFound('服务器不存在或已下架');

    await q('INSERT IGNORE INTO server_favorites (user_id, server_key) VALUES (?, ?)', [
      req.user.id,
      serverKey,
    ]);
    res.json({ ok: true, data: { serverKeys: await listKeys(req.user.id) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/favorites/:serverKey', async (req, res, next) => {
  try {
    await q('DELETE FROM server_favorites WHERE user_id = ? AND server_key = ?', [
      req.user.id,
      String(req.params.serverKey || ''),
    ]);
    res.json({ ok: true, data: { serverKeys: await listKeys(req.user.id) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
