'use strict';

/**
 * 远程维护通道（pull 模式）。
 *
 * 背景：114 游戏服的入站 5985 被云安全组挡着，WinRM 走不通；RDP 里跑的临时脚本
 * 又依赖人工。这里改成「agent 主动来领」：
 *   - 运营/管理员在平台排队一条命令（POST /api/ops）
 *   - 114 上的计划任务每分钟带 key 来 claim
 *   - 执行完把 exitCode / stdout / stderr 回传
 *
 * 安全：x-ops-key 等价于 114 的 root 权限，只放在 server/.env 与 114 的
 * C:\esf-agent\ops-key.txt（ACL 只给 SYSTEM/Administrators）。
 */

const crypto = require('crypto');
const express = require('express');
const env = require('../env');
const { pool, q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAtLeast } = require('../middleware/roles');
const { badRequest, unauthorized, notFound, ApiError } = require('../lib/errors');

const router = express.Router();

const OUTPUT_LIMIT = 32 * 1024;
const MAX_TIMEOUT_SEC = 600;

function clampText(text) {
  const value = text == null ? '' : String(text);
  if (value.length <= OUTPUT_LIMIT) return value;
  return `${value.slice(0, OUTPUT_LIMIT)}\n…（超出 ${OUTPUT_LIMIT} 字符已截断）`;
}

function keyMatches(provided) {
  if (!env.opsAgentKey || !provided) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(env.opsAgentKey)).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireAgentKey(req, res, next) {
  if (!env.opsAgentKey) {
    return next(new ApiError(503, 'OPS_DISABLED', '服务端未配置 OPS_AGENT_KEY，维护通道未启用'));
  }
  if (!keyMatches(req.headers['x-ops-key'])) {
    return next(unauthorized('维护密钥无效'));
  }
  next();
}

/** agent 领任务：一次只领一条，用 SKIP LOCKED 避免两个 agent 抢同一条 */
router.post('/ops/claim', requireAgentKey, async (req, res, next) => {
  let conn;
  try {
    const agentId = String(req.body?.agent || 'unknown').slice(0, 64);
    const hostname = String(req.body?.hostname || '').slice(0, 64) || null;
    const version = String(req.body?.version || '').slice(0, 16) || null;
    const ip = String(req.ip || '').slice(0, 45) || null;

    await q(
      `INSERT INTO ops_agents (agent, hostname, last_ip, version)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE hostname = VALUES(hostname), last_ip = VALUES(last_ip),
         version = VALUES(version), last_seen_at = CURRENT_TIMESTAMP`,
      [agentId, hostname, ip, version]
    );

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, cmd, cwd, timeout_sec FROM ops_jobs
       WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!rows.length) {
      await conn.commit();
      return res.json({ ok: true, data: { job: null } });
    }
    const job = rows[0];
    await conn.query(
      "UPDATE ops_jobs SET status = 'running', claimed_at = CURRENT_TIMESTAMP, agent = ? WHERE id = ?",
      [agentId, job.id]
    );
    await conn.commit();

    res.json({
      ok: true,
      data: {
        job: {
          id: Number(job.id),
          cmd: job.cmd,
          cwd: job.cwd || '',
          timeoutSec: Number(job.timeout_sec) || 120,
        },
      },
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

/** agent 回传执行结果 */
router.post('/ops/:id/result', requireAgentKey, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('任务 id 不合法');

    const job = await one('SELECT id, status FROM ops_jobs WHERE id = ? LIMIT 1', [id]);
    if (!job) throw notFound('任务不存在');
    if (job.status !== 'running') throw badRequest(`任务当前状态是 ${job.status}，不能回传结果`);

    const exitCode = Number.isFinite(Number(req.body?.exitCode)) ? Number(req.body.exitCode) : null;
    const ok = exitCode === 0;
    await q(
      `UPDATE ops_jobs SET status = ?, exit_code = ?, stdout = ?, stderr = ?, finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [ok ? 'done' : 'failed', exitCode, clampText(req.body?.stdout), clampText(req.body?.stderr), id]
    );
    res.json({ ok: true, data: { id, status: ok ? 'done' : 'failed' } });
  } catch (err) {
    next(err);
  }
});

/** 平台侧：排一条命令（仅 admin/owner） */
router.post('/ops', requireAuth, requireAtLeast('admin'), async (req, res, next) => {
  try {
    const cmd = String(req.body?.cmd || '').trim();
    if (!cmd) throw badRequest('cmd 不能为空');
    if (cmd.length > 4000) throw badRequest('cmd 太长（上限 4000 字符）');

    const cwd = req.body?.cwd ? String(req.body.cwd).trim().slice(0, 255) : null;
    let timeoutSec = Number(req.body?.timeoutSec);
    if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) timeoutSec = 120;
    timeoutSec = Math.min(Math.round(timeoutSec), MAX_TIMEOUT_SEC);

    const rows = await q(
      'INSERT INTO ops_jobs (cmd, cwd, timeout_sec, created_by) VALUES (?, ?, ?, ?)',
      [cmd, cwd, timeoutSec, req.user.id]
    );
    res.status(201).json({ ok: true, data: { id: Number(rows.insertId), status: 'pending' } });
  } catch (err) {
    next(err);
  }
});

/** 平台侧：看最近任务与 agent 心跳 */
router.get('/ops', requireAuth, requireAtLeast('admin'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const jobs = await q(
      `SELECT id, cmd, status, exit_code, agent, created_at, claimed_at, finished_at,
              CHAR_LENGTH(IFNULL(stdout, '')) AS stdout_len
       FROM ops_jobs ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    const agents = await q('SELECT * FROM ops_agents ORDER BY last_seen_at DESC');
    res.json({ ok: true, data: { jobs, agents } });
  } catch (err) {
    next(err);
  }
});

/** 平台侧：看单条任务的完整输出 */
router.get('/ops/:id', requireAuth, requireAtLeast('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('任务 id 不合法');
    const job = await one('SELECT * FROM ops_jobs WHERE id = ? LIMIT 1', [id]);
    if (!job) throw notFound('任务不存在');
    res.json({ ok: true, data: job });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
