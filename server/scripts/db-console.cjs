#!/usr/bin/env node
'use strict';

/**
 * 打开交互式 MySQL 终端（需要本机有 mysql.exe）。
 *
 *   npm run db:console
 *
 * 退出：输入 exit 或 quit
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const env = require('../src/env');

const CANDIDATES = [
  process.env.MYSQL_BIN,
  'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe',
  'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe',
  'mysql',
].filter(Boolean);

const bin = CANDIDATES.find((candidate) => {
  if (candidate === 'mysql') return false;
  return fs.existsSync(candidate);
});

if (!bin) {
  console.error('[db] 找不到 mysql.exe，可用环境变量 MYSQL_BIN 指定完整路径');
  process.exit(1);
}

console.log(`[db] 连接 ${env.db.host}:${env.db.port}/${env.db.name}（账号 ${env.db.user}）`);
console.log('[db] 输入 exit 退出\n');

const child = spawn(
  bin,
  [
    '-h', env.db.host,
    '-P', String(env.db.port),
    '-u', env.db.user,
    env.db.name,
    '--default-character-set=utf8mb4',
    '--table',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, MYSQL_PWD: env.db.password },
    windowsHide: false,
  }
);

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[db] 启动 mysql 客户端失败:', err.message);
  process.exit(1);
});
