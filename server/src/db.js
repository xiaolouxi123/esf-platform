'use strict';

/**
 * 全项目唯一的数据库入口。
 * 所有 SQL 都走这里，参数化查询，不接受拼串。
 */

const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'local',
  supportBigNumbers: true,
  bigNumberStrings: false,
});

/** 执行查询，返回行数组 */
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** 返回第一行或 null */
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

/** 数据库是否可用（健康检查用，不抛错） */
async function ping() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, q, one, ping, close };
