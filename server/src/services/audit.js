'use strict';

/**
 * 操作审计。
 *
 * 设计原则：
 *   - 审计写失败不能影响业务（只打日志），否则管理员操作会被审计拖死
 *   - actor_name 存快照：账号被删后日志依然可读
 *   - detail 存变更前后值，便于"谁把他从 admin 降成 user"这类追溯
 */

const { q } = require('../db');

function clientIp(req) {
  const raw = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '';
  return String(raw).split(',')[0].trim().slice(0, 45);
}

async function logAction(req, { action, targetType, targetId, detail } = {}) {
  try {
    const actor = req && req.user ? req.user : null;
    await q(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actor ? actor.id : null,
        actor ? actor.username : null,
        action,
        targetType || null,
        targetId || null,
        detail ? JSON.stringify(detail) : null,
        req ? clientIp(req) : null,
      ]
    );
  } catch (err) {
    console.error('[audit] 写入失败:', err.message);
  }
}

function publicAudit(row) {
  let detail = row.detail;
  if (typeof detail === 'string') {
    try {
      detail = JSON.parse(detail);
    } catch {
      /* 保持原样 */
    }
  }

  return {
    id: Number(row.id),
    actorId: row.actor_id ? Number(row.actor_id) : null,
    actorName: row.actor_name || null,
    action: row.action,
    targetType: row.target_type || null,
    targetId: row.target_id ? Number(row.target_id) : null,
    detail: detail || null,
    ip: row.ip || null,
    createdAt: row.created_at,
  };
}

async function listAudit({ action, actor, limit = 50, offset = 0 } = {}) {
  const where = ['1 = 1'];
  const params = [];

  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (actor) {
    where.push('(actor_name = ? OR action LIKE ?)');
    params.push(actor, `%${actor}%`);
  }

  const rows = await q(
    `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(100, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0)]
  );

  const total = await q(`SELECT COUNT(*) AS c FROM audit_logs WHERE ${where.join(' AND ')}`, params);

  return { logs: rows.map(publicAudit), total: Number(total[0].c || 0) };
}

module.exports = { logAction, listAudit, publicAudit };
