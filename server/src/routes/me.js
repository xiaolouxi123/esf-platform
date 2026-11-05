'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const env = require('../env');
const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { unauthorized, badRequest, conflict } = require('../lib/errors');
const { getWallet } = require('../services/economy');

const router = express.Router();

/**
 * 游戏昵称每天（自然日）只能改一次。
 * 用数据库的 CURDATE() 判断，避免 Node 与 MySQL 时区不同导致跨天判断错位。
 */
async function gameNameState(userId) {
  const row = await one(
    `SELECT game_name_updated_at,
            (game_name_updated_at IS NOT NULL AND DATE(game_name_updated_at) = CURDATE()) AS changed_today,
            DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS next_change_at
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId]
  );

  return {
    gameNameUpdatedAt: row?.game_name_updated_at || null,
    canChangeGameName: !row?.changed_today,
    nextGameNameChangeAt: row?.changed_today ? row.next_change_at : null,
  };
}

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const wallet = await getWallet(req.user.id);
    const gameNameMeta = await gameNameState(req.user.id);
    res.json({
      ok: true,
      data: {
        user: {
          id: Number(req.user.id),
          username: req.user.username,
          gameName: req.user.game_name,
          avatar: req.user.avatar || '',
          avatarUrl: req.user.avatar_url || '',
          titleId: req.user.title_id ? Number(req.user.title_id) : null,
          combatLevel: Number(req.user.combat_level || 0),
          role: req.user.role,
          coins: wallet.coins,
          ...gameNameMeta,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// 个人战绩：大厅右侧面板用。数据来自 AMXX 写的 play_sessions
router.get('/me/stats', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT COUNT(*)                          AS sessions,
              COALESCE(SUM(duration_sec), 0)    AS total_seconds,
              MAX(started_at)                   AS last_played
         FROM play_sessions
        WHERE user_id = ?`,
      [req.user.id]
    );
    const row = rows[0] || {};
    res.json({
      ok: true,
      data: {
        sessions: Number(row.sessions || 0),
        totalSeconds: Number(row.total_seconds || 0),
        lastPlayedAt: row.last_played || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    gameName: z
      .string()
      .trim()
      .min(1, '游戏昵称不能为空')
      .max(16, '游戏昵称最长 16 个字符')
      .regex(/^[^\x00-\x1f"\\]+$/, '游戏昵称不能包含引号、反斜杠或控制字符')
      .optional(),
    avatar: z.string().trim().max(8).optional(),
    avatarData: z.string().max(400000).optional(),
    oldPassword: z.string().min(1).max(72).optional(),
    newPassword: z.string().min(8).max(72).optional(),
  })
  .refine((v) => !v.newPassword || v.oldPassword, {
    message: '修改密码需要提供旧密码',
    path: ['oldPassword'],
  });

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'username')) {
      throw badRequest('账号名不可修改');
    }

    const body = patchSchema.parse(req.body);

    if (body.gameName) {
      const current = await one(
        `SELECT game_name,
                (game_name_updated_at IS NOT NULL AND DATE(game_name_updated_at) = CURDATE()) AS changed_today
           FROM users
          WHERE id = ?
          LIMIT 1`,
        [req.user.id]
      );

      if (!current) throw unauthorized('账号不存在');

      if (body.gameName !== current.game_name) {
        if (current.changed_today) {
          throw badRequest('游戏昵称每天只能修改一次，请明天再试');
        }

        // 游戏昵称不能和别人的账号名/游戏昵称重复；自己的旧昵称除外。
        const taken = await one(
          'SELECT id FROM users WHERE (game_name = ? OR username = ?) AND id <> ? LIMIT 1',
          [body.gameName, body.gameName, req.user.id]
        );
        if (taken) throw conflict('游戏昵称已被使用，请换一个');

        await q('UPDATE users SET game_name = ?, game_name_updated_at = NOW() WHERE id = ?', [
          body.gameName,
          req.user.id,
        ]);
      }
    }

    if (body.avatar !== undefined) {
      // 头像允许是 emoji 或留空（留空则用昵称首字）
      const avatar = body.avatar.replace(/[\r\n\t]/g, '').slice(0, 8);
      await q('UPDATE users SET avatar = ?, avatar_url = NULL WHERE id = ?', [avatar, req.user.id]);
    }

    if (body.avatarData !== undefined) {
      const data = String(body.avatarData || '').trim();
      if (data && !/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(data)) {
        throw badRequest('头像必须是 png / jpg / webp / gif 图片');
      }
      if (data.length > 300000) throw badRequest('头像图片太大，请换一张小一点的');
      await q('UPDATE users SET avatar_url = ?, avatar = ? WHERE id = ?', [
        data || null,
        data ? '' : req.user.avatar || '',
        req.user.id,
      ]);
    }

    if (body.newPassword) {
      const current = await one('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      const ok = await bcrypt.compare(body.oldPassword, current.password_hash);
      if (!ok) throw unauthorized('旧密码不正确');

      const hash = await bcrypt.hash(body.newPassword, env.bcryptRounds);
      // 改密码同时踢掉所有旧登录态
      await q('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [
        hash,
        req.user.id,
      ]);
    }

    res.json({ ok: true, data: { updated: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
