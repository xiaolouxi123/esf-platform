'use strict';

/**
 * 频道头衔：名称 / 颜色 / 排序权重。
 * - 所有人可读
 * - admin / owner 可增删改
 * - ops 以上可给玩家授予头衔
 */

const express = require('express');
const { z } = require('zod');

const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAtLeast } = require('../middleware/roles');
const { badRequest, notFound, conflict } = require('../lib/errors');

const router = express.Router();

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB');

const titleSchema = z.object({
  name: z.string().trim().min(1, '头衔名不能为空').max(16, '头衔名最多 16 字'),
  color: colorSchema,
  rank: z.coerce.number().int().min(-999).max(999).default(0),
});

function publicTitle(row) {
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color,
    rank: Number(row.sort_rank),
    memberCount: Number(row.member_count || 0),
  };
}

router.get('/titles', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT t.id, t.name, t.color, t.sort_rank, COUNT(u.id) AS member_count
         FROM titles t
         LEFT JOIN users u ON u.title_id = t.id
        GROUP BY t.id
        ORDER BY t.sort_rank DESC, t.id ASC`
    );
    res.json({ ok: true, data: { titles: rows.map(publicTitle) } });
  } catch (err) {
    next(err);
  }
});

router.post('/titles', requireAuth, requireAtLeast('admin'), async (req, res, next) => {
  try {
    const body = titleSchema.parse(req.body);
    const exists = await one('SELECT id FROM titles WHERE name = ? LIMIT 1', [body.name]);
    if (exists) throw conflict('已存在同名头衔');

    const result = await q('INSERT INTO titles (name, color, sort_rank) VALUES (?, ?, ?)', [
      body.name,
      body.color.toUpperCase(),
      body.rank,
    ]);
    const row = await one('SELECT * FROM titles WHERE id = ? LIMIT 1', [result.insertId]);
    res.status(201).json({ ok: true, data: { title: publicTitle(row) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/titles/:id', requireAuth, requireAtLeast('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = titleSchema.parse(req.body);
    const exists = await one('SELECT id FROM titles WHERE id = ? LIMIT 1', [id]);
    if (!exists) throw notFound('头衔不存在');

    const sameName = await one('SELECT id FROM titles WHERE name = ? AND id <> ? LIMIT 1', [
      body.name,
      id,
    ]);
    if (sameName) throw conflict('已存在同名头衔');

    await q('UPDATE titles SET name = ?, color = ?, sort_rank = ? WHERE id = ?', [
      body.name,
      body.color.toUpperCase(),
      body.rank,
      id,
    ]);
    const row = await one('SELECT * FROM titles WHERE id = ? LIMIT 1', [id]);
    res.json({ ok: true, data: { title: publicTitle(row) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/titles/:id', requireAuth, requireAtLeast('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const exists = await one('SELECT id FROM titles WHERE id = ? LIMIT 1', [id]);
    if (!exists) throw notFound('头衔不存在');

    await q('UPDATE users SET title_id = NULL WHERE title_id = ?', [id]);
    await q('DELETE FROM titles WHERE id = ?', [id]);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/** 授予/取消头衔：ops 以上 */
router.patch('/assign-title', requireAuth, requireAtLeast('ops'), async (req, res, next) => {
  try {
    const schema = z.object({
      userId: z.coerce.number().int().positive(),
      titleId: z.coerce.number().int().positive().nullable(),
    });
    const body = schema.parse(req.body);

    const user = await one('SELECT id, username, role FROM users WHERE id = ? LIMIT 1', [body.userId]);
    if (!user) throw notFound('玩家不存在');

    if (body.titleId !== null) {
      const title = await one('SELECT id, name, sort_rank FROM titles WHERE id = ? LIMIT 1', [body.titleId]);
      if (!title) throw badRequest('头衔不存在');
      if (user.role === 'owner') throw badRequest('不能修改所有者的头衔');
    }

    await q('UPDATE users SET title_id = ? WHERE id = ?', [body.titleId, body.userId]);
    res.json({ ok: true, data: { userId: body.userId, titleId: body.titleId } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
