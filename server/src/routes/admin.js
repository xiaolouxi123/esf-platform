'use strict';

/**
 * 管理台接口。
 *
 * 角色（方案 B）：
 *   owner  所有者   唯一；不可被降级/封禁；可转让所有权
 *   admin  管理员   账号与角色、封禁任何人、审计、开发者工具
 *   ops    运营     看账号、处理玩家/作者、审核资源、公告、服务器登记
 *   creator 作者    上传自己的资源
 *   user   玩家
 *
 * 所有写操作都会落 audit_logs（谁、对谁、改前改后）。
 */

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pipeline } = require('stream/promises');
const { z } = require('zod');

const env = require('../env');
const { q, one, pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, isAdmin, ROLES } = require('../middleware/roles');
const { badRequest, notFound, forbidden, conflict } = require('../lib/errors');
const { logAction, listAudit } = require('../services/audit');
const { getPlatformSettings, updatePlatformSettings } = require('../services/platform');

const router = express.Router();

/**
 * 发布更新包：把安装包 / latest.yml / blockmap 直接推到 UPDATE_DIR。
 * 用一个独立的随机令牌鉴权（不是管理员 JWT），方便运维脚本上传大文件。
 */
router.post('/admin/update-upload', async (req, res, next) => {
  try {
    const token = String(req.get('x-update-token') || '');
    if (!env.updateUploadToken || token !== env.updateUploadToken) {
      throw forbidden('上传令牌无效');
    }

    const name = path.basename(String(req.query.name || ''));
    if (!/^[A-Za-z0-9._ -]+\.(exe|blockmap|yml)$/i.test(name)) {
      throw badRequest('文件名不合法，只允许 .exe / .blockmap / .yml');
    }

    await fsp.mkdir(env.updateDir, { recursive: true });
    const dest = path.join(env.updateDir, name);
    await pipeline(req, fs.createWriteStream(dest));
    const stat = await fsp.stat(dest);

    res.json({ ok: true, data: { name, size: stat.size } });
  } catch (err) {
    next(err);
  }
});

router.use('/admin', requireAuth);

// owner 只能通过「转让所有权」交接，不能直接 PATCH 出来
const ASSIGNABLE_ROLES = ['user', 'creator', 'ops', 'admin'];
const STAFF_ROLES = ['ops', 'admin', 'owner'];

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    avatar: row.avatar || '',
    avatarUrl: row.avatar_url || '',
    titleId: row.title_id ? Number(row.title_id) : null,
    role: row.role,
    status: row.status,
    sessions: Number(row.sessions || 0),
    totalSeconds: Number(row.total_seconds || 0),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

async function countActiveAdmins() {
  const row = await one(
    "SELECT COUNT(*) AS c FROM users WHERE role IN ('admin','owner') AND status = 'active'"
  );
  return Number(row.c || 0);
}

/** 平台概览：管理台顶部卡片 */
router.get('/admin/overview', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const users = await one(
      `SELECT COUNT(*) AS total,
              SUM(status = 'active') AS active,
              SUM(status = 'banned') AS banned,
              SUM(role = 'owner')    AS owners,
              SUM(role = 'admin')    AS admins,
              SUM(role = 'ops')      AS ops,
              SUM(role = 'creator')  AS creators
         FROM users
        WHERE deleted_at IS NULL`
    );

    const assets = await one(
      `SELECT SUM(status = 'pending')  AS pending,
              SUM(status = 'approved') AS approved
         FROM assets`
    );

    const servers = await one('SELECT COUNT(*) AS total, SUM(enabled = 1) AS enabled FROM servers');
    const online = await one('SELECT COUNT(*) AS c FROM server_status WHERE online = 1');
    const sessions = await one(
      `SELECT COUNT(*) AS total, SUM(DATE(started_at) = CURDATE()) AS today FROM play_sessions`
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
          owners: Number(users.owners || 0),
          admins: Number(users.admins || 0),
          ops: Number(users.ops || 0),
          creators: Number(users.creators || 0),
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
        sessions: { total: Number(sessions.total || 0), today: Number(sessions.today || 0) },
        tokens: { today: Number(tokens.today || 0) },
      },
    });
  } catch (err) {
    next(err);
  }
});

const SERVER_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

const serverCreateSchema = z.object({
  serverKey: z.string().trim().regex(SERVER_KEY_RE, '服务器标识只能用小写字母、数字、_ 或 -'),
  name: z.string().trim().min(2).max(64),
  ip: z.string().trim().regex(/^[0-9A-Za-z.-]{3,64}$/, 'IP / 域名格式不正确'),
  port: z.coerce.number().int().min(1).max(65535),
  mode: z.string().trim().max(24).default('混战'),
  sort: z.coerce.number().int().min(-9999).max(9999).default(0),
  enabled: z.boolean().default(true),
});

const serverPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(64).optional(),
    ip: z.string().trim().regex(/^[0-9A-Za-z.-]{3,64}$/, 'IP / 域名格式不正确').optional(),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    mode: z.string().trim().max(24).optional(),
    sort: z.coerce.number().int().min(-9999).max(9999).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少修改一项' });

function adminServer(row) {
  return {
    serverKey: row.server_key,
    name: row.name,
    ip: row.ip,
    port: Number(row.port),
    mode: row.mode || '混战',
    sort: Number(row.sort || 0),
    enabled: Boolean(row.enabled),
    online: Boolean(Number(row.online || 0)),
    players: Number(row.players || 0),
    maxPlayers: Number(row.max_players || 0),
    map: row.map || null,
    updatedAt: row.updated_at || null,
  };
}

/** 服务器登记：运营可新增/改名/改地址/上下架，大厅和收藏会立即读到 */
router.get('/admin/servers', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT s.*, st.online, st.players, st.max_players, st.map, st.updated_at
         FROM servers s
         LEFT JOIN server_status st ON st.server_id = s.id
        ORDER BY s.sort ASC, s.id ASC`
    );
    res.json({ ok: true, data: { servers: rows.map(adminServer) } });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/servers', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const body = serverCreateSchema.parse(req.body);
    const exists = await one('SELECT id FROM servers WHERE server_key = ? LIMIT 1', [body.serverKey]);
    if (exists) throw conflict('服务器标识已存在');

    await q(
      `INSERT INTO servers (server_key, name, ip, port, mode, sort, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.serverKey, body.name, body.ip, body.port, body.mode, body.sort, body.enabled ? 1 : 0]
    );
    await logAction(req, {
      action: 'server.add',
      targetType: 'server',
      detail: { serverKey: body.serverKey, name: body.name, address: `${body.ip}:${body.port}` },
    });

    const row = await one(
      `SELECT s.*, st.online, st.players, st.max_players, st.map, st.updated_at
         FROM servers s LEFT JOIN server_status st ON st.server_id = s.id
        WHERE s.server_key = ? LIMIT 1`,
      [body.serverKey]
    );
    res.status(201).json({ ok: true, data: { server: adminServer(row) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/servers/:serverKey', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const serverKey = String(req.params.serverKey || '');
    const before = await one('SELECT * FROM servers WHERE server_key = ? LIMIT 1', [serverKey]);
    if (!before) throw notFound('服务器不存在');

    const patch = serverPatchSchema.parse(req.body);
    const assignments = Object.keys(patch).map((key) => `${key} = ?`).join(', ');
    const values = Object.keys(patch).map((key) => (key === 'enabled' ? (patch[key] ? 1 : 0) : patch[key]));
    await q(`UPDATE servers SET ${assignments} WHERE server_key = ?`, [...values, serverKey]);

    await logAction(req, {
      action: patch.enabled === false ? 'server.disable' : patch.enabled === true && !before.enabled ? 'server.enable' : 'server.update',
      targetType: 'server',
      detail: { serverKey, from: before, to: patch },
    });

    const row = await one(
      `SELECT s.*, st.online, st.players, st.max_players, st.map, st.updated_at
         FROM servers s LEFT JOIN server_status st ON st.server_id = s.id
        WHERE s.server_key = ? LIMIT 1`,
      [serverKey]
    );
    res.json({ ok: true, data: { server: adminServer(row) } });
  } catch (err) {
    next(err);
  }
});

/** 格斗等级配置：管理员自定义名称、颜色和排序 */
const rankSchema = z.object({
  level: z.coerce.number().int().min(0).max(6),
  name: z.string().trim().min(1).max(16),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.coerce.number().int().min(0).max(99),
});

router.get('/admin/ranks', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const rows = await q(
      'SELECT level, name, color, sort_order FROM combat_ranks ORDER BY sort_order ASC, level ASC'
    );
    res.json({
      ok: true,
      data: {
        ranks: rows.map((row) => ({
          level: Number(row.level),
          name: row.name,
          color: row.color,
          sortOrder: Number(row.sort_order),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/ranks', requireRole('admin', 'owner'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const ranks = z.array(rankSchema).length(7).parse(req.body?.ranks);
    const levels = new Set(ranks.map((rank) => rank.level));
    if (levels.size !== 7 || [...levels].some((level) => level < 0 || level > 6)) {
      throw badRequest('格斗等级必须完整包含 0-6 七个等级');
    }

    await conn.beginTransaction();
    for (const rank of ranks) {
      await conn.query(
        'UPDATE combat_ranks SET name = ?, color = ?, sort_order = ? WHERE level = ?',
        [rank.name, rank.color, rank.sortOrder, rank.level]
      );
    }
    await conn.commit();

    await logAction(req, {
      action: 'rank.update',
      targetType: 'settings',
      detail: { ranks },
    });

    const rows = await q(
      'SELECT level, name, color, sort_order FROM combat_ranks ORDER BY sort_order ASC, level ASC'
    );
    res.json({
      ok: true,
      data: {
        ranks: rows.map((row) => ({
          level: Number(row.level),
          name: row.name,
          color: row.color,
          sortOrder: Number(row.sort_order),
        })),
      },
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* 忽略回滚失败，保留原始错误 */
    }
    next(err);
  } finally {
    conn.release();
  }
});

/** 玩家列表 */
router.get('/admin/users', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const keyword = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = ['u.deleted_at IS NULL'];
    const params = [];

    if (keyword) {
      where.push('(u.username LIKE ? OR u.game_name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (role && ROLES.includes(role)) {
      where.push('u.role = ?');
      params.push(role);
    }
    if (status && ['active', 'banned'].includes(status)) {
      where.push('u.status = ?');
      params.push(status);
    }

    const rows = await q(
      `SELECT u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.title_id, u.role, u.status, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM play_sessions p WHERE p.user_id = u.id) AS sessions,
              (SELECT COALESCE(SUM(p.duration_sec), 0) FROM play_sessions p WHERE p.user_id = u.id) AS total_seconds
         FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(u.role, 'owner', 'admin', 'ops', 'creator', 'user'), u.id DESC
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
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    status: z.enum(['active', 'banned']).optional(),
  })
  .refine((v) => v.role || v.status, { message: '至少要改 role 或 status 其中一项' });

/** 改角色 / 封禁 */
router.patch('/admin/users/:id', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const target = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    if (!target) throw notFound('账号不存在');

    const body = updateSchema.parse(req.body);

    if (Number(target.id) === Number(req.user.id)) {
      throw badRequest('不能修改自己的权限或状态');
    }
    if (target.role === 'owner') {
      throw forbidden('不能修改所有者；如需交接请使用「转让所有权」');
    }

    if (body.role && body.role !== target.role) {
      if (!isAdmin(req.user)) throw forbidden('只有管理员可以调整权限');

      // 不允许把最后一个管理员降级（owner 也算管理权限）
      if (target.role === 'admin' && (await countActiveAdmins()) <= 1) {
        throw conflict('至少要保留一个管理员');
      }
    }

    if (body.status && body.status !== target.status) {
      if (req.user.role === 'ops' && !['user', 'creator'].includes(target.role)) {
        throw forbidden('运营只能封禁玩家或作者');
      }
      if (!isAdmin(req.user) && ['admin', 'owner'].includes(target.role)) {
        throw forbidden('只有管理员可以处理管理员账号');
      }
      if (body.status === 'banned' && target.role === 'admin' && (await countActiveAdmins()) <= 1) {
        throw conflict('至少要保留一个可用管理员');
      }
    }

    const patch = {};
    if (body.role) patch.role = body.role;
    if (body.status) patch.status = body.status;

    const assignments = Object.keys(patch).map((key) => `${key} = ?`).join(', ');
    await q(`UPDATE users SET ${assignments} WHERE id = ?`, [...Object.values(patch), target.id]);

    // 降级或封禁后，旧 JWT 立即失效
    if (patch.role || patch.status === 'banned') {
      await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [target.id]);
    }

    const action = body.role
      ? 'user.role'
      : body.status === 'banned'
        ? 'user.ban'
        : 'user.unban';

    await logAction(req, {
      action,
      targetType: 'user',
      targetId: target.id,
      detail: {
        username: target.username,
        from: { role: target.role, status: target.status },
        to: { role: patch.role || target.role, status: patch.status || target.status },
      },
    });

    const updated = await one(
      `SELECT u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.title_id, u.role, u.status, u.created_at, u.last_login_at,
              0 AS sessions, 0 AS total_seconds
         FROM users u WHERE u.id = ? LIMIT 1`,
      [target.id]
    );

    res.json({ ok: true, data: { user: publicUser(updated) } });
  } catch (err) {
    next(err);
  }
});

/** 管理员重置密码：生成一次性临时密码，强制下次登录修改 */
router.post('/admin/users/:id/reset-password', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const target = await one('SELECT id, username, role FROM users WHERE id = ? LIMIT 1', [
      req.params.id,
    ]);
    if (!target) throw notFound('账号不存在');
    if (target.role === 'owner' && Number(target.id) !== Number(req.user.id)) {
      throw forbidden('不能重置所有者的密码');
    }

    const tempPassword = `ESF-${crypto.randomBytes(6).toString('base64url')}`;
    const hash = await bcrypt.hash(tempPassword, env.bcryptRounds);

    await q(
      `UPDATE users
          SET password_hash = ?, must_change_password = 1,
              token_version = token_version + 1,
              failed_login_count = 0, locked_until = NULL
        WHERE id = ?`,
      [hash, target.id]
    );

    await logAction(req, {
      action: 'user.reset_password',
      targetType: 'user',
      targetId: target.id,
      detail: { username: target.username, self: Number(target.id) === Number(req.user.id) },
    });

    res.json({ ok: true, data: { tempPassword, mustChangePassword: true } });
  } catch (err) {
    next(err);
  }
});

/** 注销账号（仅所有者）：软删除并匿名化，保留历史对局引用 */
router.delete('/admin/users/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('账号无效');
    if (id === Number(req.user.id)) throw badRequest('不能注销自己的账号');

    const target = await one('SELECT id, username, game_name, role FROM users WHERE id = ? LIMIT 1', [
      id,
    ]);
    if (!target) throw notFound('账号不存在');
    if (target.role === 'owner') throw forbidden('不能注销所有者账号');

    const suffix = crypto.randomBytes(3).toString('hex');
    await q(
      `UPDATE users
          SET status = 'banned', role = 'user', title_id = NULL,
              username = CONCAT('deleted_', id, '_', ?),
        deleted_at = NOW(),
              game_name = '已注销账号',
              email = NULL, email_verified_at = NULL, status_text = NULL,
              must_change_password = 0, failed_login_count = 0, locked_until = NULL,
              token_version = token_version + 1
        WHERE id = ?`,
      [suffix, id]
    );
    // 清掉会话与验证码；对局历史通过 user_id 保留引用
    await q('DELETE FROM user_sessions WHERE user_id = ?', [id]).catch(() => {});
    await q('DELETE FROM email_codes WHERE user_id = ?', [id]).catch(() => {});
    await q('DELETE FROM password_reset_tokens WHERE user_id = ?', [id]).catch(() => {});

    await logAction(req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: target.id,
      detail: { username: target.username, gameName: target.game_name, role: target.role },
    });

    res.json({ ok: true, data: { deleted: true, id: target.id } });
  } catch (err) {
    next(err);
  }
});

/** 强制下线 */
router.post('/admin/users/:id/kick', requireRole(...STAFF_ROLES), async (req, res, next) => {
  try {
    const target = await one('SELECT id, username, role FROM users WHERE id = ? LIMIT 1', [
      req.params.id,
    ]);
    if (!target) throw notFound('账号不存在');
    if (target.role === 'owner') throw forbidden('不能强制所有者下线');
    if (Number(target.id) === Number(req.user.id)) throw badRequest('不能把自己踢下线');
    if (req.user.role === 'ops' && !['user', 'creator'].includes(target.role)) {
      throw forbidden('运营只能处理玩家或作者');
    }

    await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [target.id]);
    await logAction(req, {
      action: 'user.kick',
      targetType: 'user',
      targetId: target.id,
      detail: { username: target.username, role: target.role },
    });

    res.json({ ok: true, data: { kicked: true } });
  } catch (err) {
    next(err);
  }
});

/** 转让所有权：owner → 目标账号，自己降为 admin，双方旧 JWT 立即失效 */
router.post('/admin/owner/transfer', requireRole('owner'), async (req, res, next) => {
  try {
    const schema = z.object({ userId: z.coerce.number().int().positive() });
    const { userId } = schema.parse(req.body);

    if (Number(userId) === Number(req.user.id)) throw badRequest('你已经是所有者');
    const target = await one('SELECT id, username, role FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!target) throw notFound('账号不存在');
    if (target.role === 'owner') throw conflict('对方已经是所有者');

    await q("UPDATE users SET role = 'admin', token_version = token_version + 1 WHERE id = ?", [
      req.user.id,
    ]);
    await q("UPDATE users SET role = 'owner', token_version = token_version + 1 WHERE id = ?", [
      target.id,
    ]);

    await logAction(req, {
      action: 'owner.transfer',
      targetType: 'user',
      targetId: target.id,
      detail: { from: req.user.username, to: target.username },
    });

    res.json({ ok: true, data: { owner: target.username } });
  } catch (err) {
    next(err);
  }
});

/** 运营设置：公告 / 维护模式（ops 及以上） */
router.get('/admin/platform', requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await getPlatformSettings() });
  } catch (err) {
    next(err);
  }
});

const platformSchema = z
  .object({
    notice: z.string().trim().max(300).optional(),
    maintenance: z.boolean().optional(),
    maintenanceText: z.string().trim().max(120).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少修改一项' });

router.patch('/admin/platform', requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const patch = platformSchema.parse(req.body);
    const data = await updatePlatformSettings(patch);

    await logAction(req, {
      action: 'platform.update',
      targetType: 'platform',
      detail: patch,
    });

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

/** 审计日志（admin / owner 可见） */router.get('/admin/audit', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const data = await listAudit({
      action: String(req.query.action || '').trim() || undefined,
      actor: String(req.query.actor || '').trim() || undefined,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
