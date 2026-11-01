#!/usr/bin/env node
'use strict';

/**
 * 建库 + 建表 + 建账号权限。幂等，可以反复跑。
 *
 * 用 root 连接（开发实例是空密码），执行 sql/*.sql，
 * 然后创建两个账号：
 *   esf_app   —— 应用账号，拥有 esf_platform 的全部权限
 *   esf_amxx  —— 游戏服务器账号，只能读白名单视图、消费 token、写在线时长
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../src/env');

const SQL_DIR = path.join(__dirname, '..', 'sql');

function log(...args) {
  console.log('[migrate]', ...args);
}

/**
 * 用 root 连开发实例。
 * 开发实例初始化时只创建了 root@localhost，而 TCP 连接匹配不到它，
 * 所以本地走命名管道（DB_ROOT_SOCKET）；生产环境不设置该变量，直接 TCP + 密码。
 */
function rootConnectionOptions() {
  const base = {
    user: (process.env.DB_ROOT_USER || 'root').trim(),
    password: process.env.DB_ROOT_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  };
  const socket = (process.env.DB_ROOT_SOCKET || '').trim();
  if (socket) {
    return { ...base, socketPath: `\\\\.\\pipe\\${socket}` };
  }
  return { ...base, host: env.db.host, port: env.db.port };
}

async function createAccount(conn, user, host, password) {
  await conn.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED WITH mysql_native_password BY ?', [user, host, password]);
  await conn.query('ALTER USER ?@? IDENTIFIED WITH mysql_native_password BY ?', [user, host, password]);
  log(`账号就绪: '${user}'@'${host}' (mysql_native_password)`);
}

/**
 * 给已有库补列。CREATE TABLE IF NOT EXISTS 不会改动已存在的表，
 * 所以结构演进要靠这里（MySQL 8 的 ADD COLUMN 没有 IF NOT EXISTS）。
 */
async function ensureColumn(conn, dbName, table, column, definition) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1`,
    [dbName, table, column]
  );
  if (rows.length > 0) return false;

  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  log(`已补列: ${table}.${column}`);
  return true;
}

async function main() {
  const conn = await mysql.createConnection(rootConnectionOptions());

  try {
    // 1. 结构 + 初始数据
    const files = fs
      .readdirSync(SQL_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
      await conn.query(sql);
      log(`已执行 ${file}`);
    }

    // 2. 结构演进（给老库补列）
    await ensureColumn(
      conn,
      env.db.name,
      'launch_tokens',
      'authorized_until',
      'DATETIME NULL COMMENT "已在本服放行过的复用窗口" AFTER used_at'
    );
    await ensureColumn(
      conn,
      env.db.name,
      'users',
      'avatar',
      "VARCHAR(16) NOT NULL DEFAULT '' COMMENT '头像（emoji 或留空）' AFTER game_name"
    );
    // 资源封面（支持动图，原样保存）
    const coverColumns = [
      ['cover_name', 'VARCHAR(255) NULL AFTER sha256'],
      ['cover_mime', 'VARCHAR(64) NULL AFTER cover_name'],
      ['cover_size', 'INT UNSIGNED NULL AFTER cover_mime'],
      ['cover_sha256', 'CHAR(64) NULL AFTER cover_size'],
    ];
    for (const [column, definition] of coverColumns) {
      await ensureColumn(conn, env.db.name, 'assets', column, definition);
    }

    // 3. 应用账号
    await createAccount(conn, env.db.user, env.db.allowedHost, env.db.password);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${env.db.name}\`.* TO ?@?`, [
      env.db.user,
      env.db.allowedHost,
    ]);

    // 3. 游戏服务器账号：最小权限
    await createAccount(conn, env.amxx.user, env.amxx.allowedHost, env.amxx.password);
    const db = `\`${env.db.name}\``;
    const grants = [
      `GRANT SELECT ON ${db}.\`v_platform_users\` TO ?@?`,
      `GRANT SELECT, UPDATE ON ${db}.\`launch_tokens\` TO ?@?`,
      `GRANT SELECT, INSERT, UPDATE ON ${db}.\`play_sessions\` TO ?@?`,
      `GRANT SELECT ON ${db}.\`servers\` TO ?@?`,
    ];
    for (const grant of grants) {
      await conn.query(grant, [env.amxx.user, env.amxx.allowedHost]);
    }
    log(`已授予 '${env.amxx.user}' 最小权限（白名单视图 + token 消费 + 在线时长）`);

    // 4. 汇总
    const [[{ tables }]] = await conn.query(
      'SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = ? AND table_type = ?',
      [env.db.name, 'BASE TABLE']
    );
    const [[{ servers }]] = await conn.query(`SELECT COUNT(*) AS servers FROM ${db}.servers`);

    log(`完成：${tables} 张表，${servers} 台服务器`);
    log(`应用账号 : ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name}`);
    log(`AMXX账号 : ${env.amxx.user}@${env.amxx.allowedHost}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate] 失败:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('[migrate] 数据库没起来？先执行: npm run db:start');
  }
  process.exit(1);
});
