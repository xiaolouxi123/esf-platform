#!/usr/bin/env node
'use strict';

/**
 * 登记一台游戏服务器（登记后启动器列表能看到、且连服能带平台身份）。
 *
 *   npm run server:add -- --key fcx-1v1-2 --name "[ESF-FCX]单挑房[2]" --ip 1.2.3.4 --port 27017
 *   npm run server:add -- --key fcx-1v1-2 --disable      # 下架
 */

const { q, one, ping, close } = require('../src/db');

/** 命令行操作也进审计，保持"谁改了什么"完整 */
async function auditCli(action, targetId, detail) {
  try {
    await q(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (NULL, 'cli', ?, 'server', ?, ?, 'cli')`,
      [action, targetId || null, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.warn('[server] 审计写入失败:', err.message);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.key) {
    console.error(
      '用法: npm run server:add -- --key <key> --name <名称> --ip <IP> --port <端口> [--mode 单挑] [--sort 10]\n' +
        '       npm run server:add -- --key <key> --disable'
    );
    process.exit(1);
  }

  if (!(await ping())) {
    console.error('[db] 连不上数据库。先执行: npm run db:start');
    process.exit(1);
  }

  try {
    if (args.disable) {
      const result = await q('UPDATE servers SET enabled = 0 WHERE server_key = ?', [args.key]);
      if (!result.affectedRows) throw new Error(`没有 server_key = ${args.key} 的服务器`);
      await auditCli('server.disable', null, { serverKey: args.key });
      console.log(`[server] 已下架 ${args.key}`);
      return;
    }

    if (!args.name || !args.ip || !args.port) {
      throw new Error('新增/更新需要同时提供 --name --ip --port');
    }

    const port = Number(args.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port 不合法');
    const mode = String(args.mode || '混战').trim() || '混战';

    await q(
      `INSERT INTO servers (server_key, name, ip, port, mode, enabled, sort)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), ip = VALUES(ip), port = VALUES(port),
         mode = VALUES(mode), enabled = 1, sort = VALUES(sort)`,
      [args.key, args.name, args.ip, port, mode, Number(args.sort) || 0]
    );

    const row = await one('SELECT id FROM servers WHERE server_key = ? LIMIT 1', [args.key]);
    await auditCli('server.add', row && row.id, {
      serverKey: args.key,
      name: args.name,
      mode,
      address: `${args.ip}:${port}`,
    });

    console.log(`[server] 已登记 ${args.key} → ${args.ip}:${port}（${args.name} · ${mode}）`);
    console.log('[server] 后台 15 秒内会自动查询一次状态，启动器刷新列表即可看到');
  } catch (err) {
    console.error('[server] 失败:', err.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
