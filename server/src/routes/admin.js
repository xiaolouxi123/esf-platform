'use strict';

/**
 * 管理台接口（admin / gm）。
 *
 * 权限模型：
 *   admin —— 全部：改角色、封禁任何人、强制下线、审资源
 *   gm    —— 运营：只能处理普通玩家（封禁/解封/强制下线），不能改角色
 *
 * 防呆：
 *   - 不能改自己（避免把自己降级/封禁后没人管）
 *   - 不能把最后一个管理员降级或封禁
 */

const express = require('express');
const { z } = require('zod');

const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, isAdmin } = require('../middleware/roles');
const { badRequest, notFound, forbidden, conflict } = require('../lib/errors');

const router = express.Router();

router.use(requireAuth);

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    role: row.role,
    status: row.status,
    sessions: Number(row.sessions || 0),
    totalSeconds: Number(row.total_seconds || 0),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

/** 平台概览：管理台顶部的四张卡 */
router.get('/admin/overview', requireRole('admin', 'gm'), async (req, res, next) => {
  try {
    const users = await one(
      `SELECT COUNT(*) AS total,
              SUM(status = 'active') AS active,
              SUM(status = 'banned') AS banned,
              SUM(role = 'admin')    AS admins,
              SUM(role = 'gm')       AS gms
         FROM users`
    );

    const assets = await one(
      `SELECT SUM(status = 'pending')  AS pending,
              SUM(status = 'approved') AS approved
         FROM assets`
    );

    const servers = await one(
      `SELECT COUNT(*) AS total, SUM(enabled = 1) AS enabled FROM servers`
    );
    const online = await one('SELECT COUNT(*) AS c FROM server_status WHERE online = 1');

    const sessions = await one(
      `SELECT COUNT(*) AS total,
              SUM(DATE(started_at) = CURDATE()) AS today
         FROM play_sessions`
    );

    const tokens = await one(
      'SELECT COUNT(*) AS today FROM launch_tokens WHERE DATE(created_at) = CURDATE()'
    );

    res.json({
      ok: true,
      data: {
        users: {
          total: Number(users.total || 0),
          active: Number(users.active || 0),
          banned: Number(users.banned || 0),
          admins: Number(users.admins || 0),
          gms: Number(users.gms || 0),
        },
        assets: {
          pending: Number(assets.pending || 0),
          approved: Number(assets.approved || 0),
        },
        servers: {
          total: Number(servers.total || 0),
          enabled: Number(servers.enabled || 0),
          online: Number(online.c || 0),
        },
        sessions: {
          total: Number(sessions.total || 0),
          today: Number(sessions.today || 0),
        },
        tokens: { today: Number(tokens.today || 0) },
      },
    });
  } catch (err) {
    next(err);
  }
});

/** 玩家列表 */
router.get('/admin/users', requireRole('admin', 'gm'), async (req, res, next) => {
  try {
    const keyword = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = ['1 = 1'];
    const params = [];

    if (keyword) {
      where.push('(u.username LIKE ? OR u.game_name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (role && ['user', 'gm', 'admin'].includes(role)) {
      where.push('u.role = ?');
      params.push(role);
    }
    if (status && ['active', 'banned'].includes(status)) {
      where.push('u.status = ?');
      params.push(status);
    }

    const rows = await q(
      `SELECT u.id, u.username, u.game_name, u.role, u.status, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM play_sessions p WHERE p.user_id = u.id) AS sessions,
              (SELECT COALESCE(SUM(p.duration_sec), 0) FROM play_sessions p WHERE p.user_id = u.id) AS total_seconds
         FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY u.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = await one(`SELECT COUNT(*) AS c FROM users u WHERE ${where.join(' AND ')}`, params);

    res.json({
      ok: true,
      data: { users: rows.map(publicUser), total: Number(total.c || 0), limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z
  .object({
    role: z.enum(['user', 'gm', 'admin']).optional(),
    status: z.enum(['active', 'banned']).optional(),
  })
  .refine((v) => v.role || v.status, { message: '至少要改 role 或 status 其中一项' });

/** 改角色 / 封禁 */
router.patch('/admin/users/:id', requireRole('admin', 'gm'), async (req, res, next) => {
  try {
    const target = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    if (!target) throw notFound('账号不存在');

    const body = updateSchema.parse(req.body);

    if (Number(target.id) === Number(req.user.id)) {
      throw badRequest('不能修改自己的权限或状态');
    }

    if (body.role && body.role !== target.role) {
      if (!isAdmin(req.user)) throw forbidden('只有管理员可以调整权限');

      // 不允许把最后一个管理员降级
      if (target.role === 'admin') {
        const admins = await one(
          "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'"
        );
        if (Number(admins.c) <= 1) throw conflict('至少要保留一个管理员');
      }
    }

    if (body.status && body.status !== target.status) {
      if (req.user.role === 'gm' && target.role !== 'user') {
        throw forbidden('运营只能封禁普通玩家');
      }
      if (target.role === 'admin' && body.status === 'banned') {
        const admins = await one(
          "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'"
        );
        if (Number(admins.c) <= 1) throw conflict('至少要保留一个可用的管理员');
      }
    }

    const patch = {};
    if (body.role) patch.role = body.role;
    if (body.status) patch.status = body.status;

    const assignments = Object.keys(patch).map((key) => `${key} = ?`).join(', ');
    await q(`UPDATE users SET ${assignments} WHERE id = ?`, [...Object.values(patch), target.id]);

    // 被封禁/降级后，已经签发的 JWT 立刻失效
    if (patch.status === 'banned' || patch.role) {
      await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [target.id]);
    }

    const updated = await one(
      `SELECT u.id, u.username, u.game_name, u.role, u.status, u.created_at, u.last_login_at,
              0 AS sessions, 0 AS total_seconds
         FROM users u WHERE u.id = ? LIMIT 1`,
      [target.id]
    );

    res.json({ ok: true, data: { user: publicUser(updated) } });
  } catch (err) {
    next(err);
  }
});

/** 强制下线（token_version + 1） */
router.post('/admin/users/:id/kick', requireRole('admin', 'gm'), async (req, res, next) => {
  try {
    const target = await one('SELECT id, role FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    if (!target) throw notFound('账号不存在');
    if (Number(target.id) === Number(req.user.id)) throw badRequest('不能把自己踢下线');
    if (req.user.role === 'gm' && target.role !== 'user') throw forbidden('运营只能处理普通玩家');

    await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [target.id]);
    res.json({ ok: true, data: { kicked: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
