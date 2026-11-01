#!/usr/bin/env node
'use strict';

/**
 * 重置账号密码（忘记密码、或给管理员换密码）。
 *
 *   npm run user:passwd -- yun 新密码至少8位
 *
 * 会同时 token_version + 1，把该账号所有已登录的设备踢下线。
 */

const bcrypt = require('bcryptjs');
const { q, one, ping, close } = require('../src/db');

const [username, password] = process.argv.slice(2);

(async () => {
  if (!username || !password) {
    console.error('用法: npm run user:passwd -- <用户名> <新密码>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('[user] 密码至少 8 位');
    process.exit(1);
  }

  if (!(await ping())) {
    console.error('[db] 连不上数据库。先执行: npm run db:start');
    process.exit(1);
  }

  try {
    const user = await one('SELECT id, username FROM users WHERE username = ? LIMIT 1', [username]);
    if (!user) {
      console.error(`[user] 没有找到账号: ${username}`);
      process.exitCode = 1;
      return;
    }

    await q(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
      [bcrypt.hashSync(password, 10), user.id]
    );

    console.log(`[user] 已重置 ${username} 的密码，并让所有旧登录态失效`);
  } catch (err) {
    console.error('[user] 失败:', err.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
