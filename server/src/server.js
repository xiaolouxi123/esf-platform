'use strict';

const app = require('./app');
const env = require('./env');
const { ping, close } = require('./db');
const { startPoller, stopPoller } = require('./services/serverPoller');

// A2S 查询库收到短包会越界读取，先打补丁再启动轮询。
require('./lib/query-guard').install();

/**
 * 进程级兜底：底层库（例如 A2S 查询）可能在事件回调里抛出越界读取这类异常。
 * 记录下来并以非零码退出，交给计划任务「失败后自动重启」把进程拉起来，
 * 避免进程带着损坏状态继续运行或直接消失。
 */
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('[fatal] unhandledRejection:', err);
});

async function main() {
  const dbUp = await ping();

  const server = app.listen(env.apiPort, env.host, () => {
    console.log('──────────────────────────────────────────────');
    console.log(` ESF 平台后端 v${env.version} (${env.nodeEnv})`);
    console.log(` 监听    http://${env.host}:${env.apiPort}`);
    console.log(` 健康    http://${env.host}:${env.apiPort}/api/health`);
    console.log(` 数据库  ${env.db.host}:${env.db.port}/${env.db.name} → ${dbUp ? 'up' : 'DOWN'}`);
    console.log(` 注册    ${env.inviteCode ? '需要邀请码' : '开放'}`);
    console.log('──────────────────────────────────────────────');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] 端口 ${env.apiPort} 已被占用，请改 .env 里的 API_PORT`);
    } else {
      console.error('[server] 监听失败:', err.message);
    }
    process.exit(1);
  });

  startPoller();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] 收到 ${signal}，正在退出…`);
    stopPoller();
    server.close();
    await close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});
