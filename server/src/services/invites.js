'use strict';

/**
 * 注册邀请码（数据库版，可随时开关）。
 *
 * 设计（2026-11 所有者确认）：
 * - 邀请码可重复使用，永久有效；
 * - 关闭邀请制后已生成的码保留，再打开仍可用；
 * - 旧的 .env INVITE_CODE 兼容码停用，只认数据库。
 */

const crypto = require('crypto');
const { q, one } = require('../db');
const { getPlatformSettings, updatePlatformSettings } = require('./platform');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 I/O/0/1，便于口头传播
const CODE_LENGTH = 8;
const MAX_BATCH = 50;

function randomCode() {
  let out = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function isRequired() {
  const settings = await getPlatformSettings();
  return Boolean(settings.inviteRequired);
}

async function setRequired(enabled) {
  await updatePlatformSettings({ inviteRequired: Boolean(enabled) });
  return isRequired();
}

async function listCodes() {
  const rows = await q(
    `SELECT code, used_count, last_used_at, disabled, created_at
       FROM invite_codes
      ORDER BY created_at DESC, code ASC
      LIMIT 500`
  );
  return rows.map((row) => ({
    code: row.code,
    usedCount: Number(row.used_count || 0),
    lastUsedAt: row.last_used_at || null,
    disabled: Number(row.disabled) === 1,
    createdAt: row.created_at || null,
  }));
}

async function createCodes(count = 1, createdBy = null) {
  const total = Math.max(1, Math.min(MAX_BATCH, Number(count) || 1));
  const created = [];

  for (let i = 0; i < total; i += 1) {
    let code = randomCode();
    // 极小概率碰撞：最多重试 5 次
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const exists = await one('SELECT code FROM invite_codes WHERE code = ? LIMIT 1', [code]);
      if (!exists) break;
      code = randomCode();
    }
    await q(
      `INSERT INTO invite_codes (code, created_by) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE disabled = 0`,
      [code, createdBy || null]
    );
    created.push(code);
  }

  return created;
}

async function disableCode(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) return false;
  const result = await q('UPDATE invite_codes SET disabled = 1 WHERE code = ?', [value]);
  return Number(result.affectedRows || 0) > 0;
}

/**
 * 注册校验：邀请制关闭时直接通过；开启时必须命中未停用的码。
 * 命中后使用次数 +1（可重复使用，不消耗）。
 */
async function checkRegistration(inviteCode) {
  if (!(await isRequired())) return { ok: true };

  const value = String(inviteCode || '').trim().toUpperCase();
  if (!value) return { ok: false, message: '本平台当前开启邀请注册，请填写邀请码' };

  const row = await one(
    'SELECT code FROM invite_codes WHERE code = ? AND disabled = 0 LIMIT 1',
    [value]
  );
  if (!row) return { ok: false, message: '邀请码无效或已停用' };

  await q(
    'UPDATE invite_codes SET used_count = used_count + 1, last_used_at = NOW() WHERE code = ?',
    [value]
  );
  return { ok: true };
}

module.exports = {
  isRequired,
  setRequired,
  listCodes,
  createCodes,
  disableCode,
  checkRegistration,
};
