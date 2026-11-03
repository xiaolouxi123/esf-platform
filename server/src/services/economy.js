'use strict';

const { q, one } = require('../db');

async function ensureWallet(userId) {
  await q('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId]);
}

async function getWallet(userId) {
  await ensureWallet(userId);
  const row = await one(
    'SELECT coins, total_earned, last_earned_at, updated_at FROM wallets WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return {
    coins: Number(row?.coins || 0),
    totalEarned: Number(row?.total_earned || 0),
    lastEarnedAt: row?.last_earned_at || null,
  };
}

/**
 * 心跳时按整分钟结算金币：
 *  - 大厅在线 1 金币/分钟
 *  - 游戏中 2 金币/分钟
 * 最长一次补 5 分钟，避免离线很久后一次爆金币。
 */
async function awardPresenceCoins(userId, state) {
  await ensureWallet(userId);
  const row = await one('SELECT last_earned_at FROM wallets WHERE user_id = ? LIMIT 1', [userId]);

  if (!row?.last_earned_at) {
    await q('UPDATE wallets SET last_earned_at = NOW() WHERE user_id = ?', [userId]);
    return getWallet(userId);
  }

  const last = new Date(row.last_earned_at).getTime();
  const minutes = Math.min(5, Math.floor((Date.now() - last) / 60000));
  if (minutes < 1) return getWallet(userId);

  const amount = minutes * (state === 'ingame' ? 2 : 1);
  const result = await q(
    `UPDATE wallets
        SET coins = coins + ?, total_earned = total_earned + ?, last_earned_at = NOW()
      WHERE user_id = ?
        AND (last_earned_at IS NULL OR last_earned_at <= (NOW() - INTERVAL 60 SECOND))`,
    [amount, amount, userId]
  );

  if (result.affectedRows > 0) {
    await q('INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)', [
      userId,
      amount,
      state === 'ingame' ? 'game_time' : 'online_time',
    ]);
  }

  return getWallet(userId);
}

async function recentTransactions(userId, limit = 10) {
  const rows = await q(
    `SELECT amount, reason, created_at
       FROM coin_transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, Math.max(1, Math.min(50, limit))]
  );
  return rows.map((row) => ({
    amount: Number(row.amount),
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

module.exports = { ensureWallet, getWallet, awardPresenceCoins, recentTransactions };
