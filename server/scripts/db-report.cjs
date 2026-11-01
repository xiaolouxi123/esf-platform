#!/usr/bin/env node
'use strict';

/**
 * 数据库巡检报告：一条命令看清库里有什么。
 *
 *   npm run db:report
 */

const env = require('../src/env');
const { q, one, ping, close } = require('../src/db');

function line(title) {
  console.log('\n' + title);
  console.log('─'.repeat(Math.max(28, title.length + 4)));
}

function num(value) {
  return Number(value || 0);
}

(async () => {
  if (!(await ping())) {
    console.error('[db] 连不上数据库。先执行: npm run db:start');
    process.exit(1);
  }

  const version = await one('SELECT VERSION() AS v, DATABASE() AS db');
  line('连接');
  console.log(`  地址    ${env.db.host}:${env.db.port}`);
  console.log(`  库名    ${version.db}`);
  console.log(`  版本    MySQL ${version.v}`);

  const tables = await q(
    `SELECT table_name AS name, table_rows AS rows_estimate
       FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [env.db.name]
  );
  line('表（行数为估算值）');
  for (const t of tables) console.log(`  ${String(t.name).padEnd(18)} ~${t.rows_estimate} 行`);

  const counts = await one(
    `SELECT
       (SELECT COUNT(*) FROM users)                                   AS users,
       (SELECT COUNT(*) FROM servers)                                 AS servers,
       (SELECT COUNT(*) FROM assets)                                  AS assets,
       (SELECT COUNT(*) FROM launch_tokens)                           AS tokens_total,
       (SELECT COUNT(*) FROM launch_tokens
         WHERE used_at IS NULL AND expires_at > NOW())               AS tokens_valid,
       (SELECT COUNT(*) FROM play_sessions)                           AS sessions,
       (SELECT COUNT(*) FROM login_logs)                               AS logins`
  );

  line('关键计数');
  console.log(`  账号          ${num(counts.users)}`);
  console.log(`  服务器        ${num(counts.servers)}`);
  console.log(`  资源          ${num(counts.assets)}`);
  console.log(`  连服 Token    ${num(counts.tokens_total)}（其中未过期未使用 ${num(counts.tokens_valid)}）`);
  console.log(`  在线记录      ${num(counts.sessions)}`);
  console.log(`  登录日志      ${num(counts.logins)}`);

  const users = await q(
    `SELECT id, username, game_name AS gameName, role, status,
            DATE_FORMAT(last_login_at, '%m-%d %H:%i') AS lastLogin
       FROM users ORDER BY id DESC LIMIT 5`
  );
  line('最近 5 个账号');
  console.table(users);

  const logins = await q(
    `SELECT id, username, ip, IF(success = 1, '成功', '失败') AS result,
            IFNULL(reason, '') AS reason, DATE_FORMAT(created_at, '%m-%d %H:%i:%s') AS at
       FROM login_logs ORDER BY id DESC LIMIT 5`
  );
  line('最近 5 条登录审计');
  console.table(logins);

  const servers = await q(
    `SELECT s.server_key AS serverKey, s.name, CONCAT(s.ip, ':', s.port) AS address,
            IF(COALESCE(st.online, 0) = 1, '在线', '离线') AS state,
            CONCAT(COALESCE(st.players, 0), '/', COALESCE(st.max_players, 0)) AS players,
            COALESCE(st.map, '-') AS map,
            CONCAT(COALESCE(st.ping_ms, 0), 'ms') AS ping
       FROM servers s LEFT JOIN server_status st ON st.server_id = s.id
      ORDER BY s.sort, s.id`
  );
  line('服务器列表');
  console.table(servers);

  const sessions = await q(
    `SELECT p.id, u.username, p.server_key AS serverKey,
            DATE_FORMAT(p.started_at, '%m-%d %H:%i') AS started,
            IFNULL(p.duration_sec, 0) AS seconds
       FROM play_sessions p LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.id DESC LIMIT 5`
  );
  line('最近 5 条在线记录');
  console.table(sessions);

  const tokens = await q(
    `SELECT id, LEFT(token, 8) AS tokenPrefix, user_id AS userId, server_key AS serverKey,
            IF(used_at IS NULL, '未使用', '已使用') AS used,
            DATE_FORMAT(expires_at, '%m-%d %H:%i:%s') AS expires,
            IF(authorized_until IS NULL, '-', DATE_FORMAT(authorized_until, '%m-%d %H:%i')) AS reuseUntil
       FROM launch_tokens ORDER BY id DESC LIMIT 5`
  );
  line('最近 5 个连服 Token');
  console.table(tokens);

  console.log('\n提示：改数据用 npm run db:query -- "SELECT ..."，进交互式终端用 npm run db:console\n');
  await close();
})().catch(async (err) => {
  console.error('[db] 巡检失败:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
