#!/usr/bin/env node
'use strict';

/**
 * 设置账号角色。
 *
 *   npm run user:role -- yun admin
 *   npm run user:role -- demo user
 *   npm run user:role -- list        # 列出所有账号
 */

const { q, one, ping, close } = require('../src/db');

const ROLES = ['user', 'creator', 'ops', 'admin', 'owner'];

(async () => {
  const [username, role] = process.argv.slice(2);

  if (!(await ping())) {
    console.error('[db] 连不上数据库。先执行: npm run db:start');
    process.exit(1);
  }

  try {
    if (!username || username === 'list') {
      const rows = await q(
        'SELECT id, username, game_name AS gameName, role, status FROM users ORDER BY id'
      );
      console.table(rows);
      console.log('设置角色: npm run user:role -- <用户名> <user|creator|ops|admin|owner>');
      return;
    }

    if (!ROLES.includes(role)) {
      console.error(`[user] 角色只能是 ${ROLES.join(' / ')}`);
      process.exitCode = 1;
      return;
    }

    const user = await one('SELECT id, username, role FROM users WHERE username = ? LIMIT 1', [username]);
    if (!user) {
      console.error(`[user] 没有找到账号: ${username}`);
      process.exitCode = 1;
      return;
    }

    if (user.role === 'owner' && role !== 'owner') {
      console.error('[user] 所有者不能直接降级；确需交接请走管理台的「转让所有权」');
      process.exitCode = 1;
      return;
    }

    // 所有者唯一：已经有 owner 时不允许再造一个
    if (role === 'owner' && user.role !== 'owner') {
      const owners = await one("SELECT COUNT(*) AS c FROM users WHERE role = 'owner'");
      if (Number(owners.c) > 0) {
        console.error('[user] 已经存在所有者；请让现任所有者在管理台使用「转让所有权」');
        process.exitCode = 1;
        return;
      }
    }

    if (user.role === 'admin' && role !== 'admin' && role !== 'owner') {
      const admins = await one("SELECT COUNT(*) AS c FROM users WHERE role IN ('admin','owner') AND status = 'active'");
      if (Number(admins.c) <= 1) {
        console.error('[user] 这是最后一个管理员，不能降级');
        process.exitCode = 1;
        return;
      }
    }

    await q('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?', [role, user.id]);
    console.log(`[user] ${username}: ${user.role} → ${role}（旧登录态已失效）`);
  } catch (err) {
    console.error('[user] 失败:', err.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
