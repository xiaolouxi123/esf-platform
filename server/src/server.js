'use strict';

const app = require('./app');
const env = require('./env');
const { ping, close } = require('./db');
const { startPoller, stopPoller } = require('./services/serverPoller');

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
