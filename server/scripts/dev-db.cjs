#!/usr/bin/env node
'use strict';

/**
 * 项目自带的开发用 MySQL 实例（默认 127.0.0.1:3307）。
 *
 * 为什么不用本机已有的 MySQL80 服务：
 *  1. 它的 root 密码我们不知道，也不该去动别人的服务
 *  2. 独立实例可以随时 `reset`，不污染任何现有数据
 *  3. 数据目录在 .devdb/ 里，已 gitignore
 *
 * 用法：
 *   node scripts/dev-db.cjs init     # 首次初始化数据目录（一次性）
 *   node scripts/dev-db.cjs start    # 后台启动
 *   node scripts/dev-db.cjs stop
 *   node scripts/dev-db.cjs status
 *   node scripts/dev-db.cjs reset    # 删库重来
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const MYSQL_BASE = process.env.MYSQL_BASE || 'C:\\Program Files\\MySQL\\MySQL Server 8.0';
const BIN = path.join(MYSQL_BASE, 'bin');
const MYSQLD = path.join(BIN, 'mysqld.exe');
const MYSQLADMIN = path.join(BIN, 'mysqladmin.exe');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // server/scripts → esf-launcher
const DATA_DIR = path.join(PROJECT_ROOT, '.devdb', 'data');
const RUN_DIR = path.join(PROJECT_ROOT, '.run');
const PORT = Number(process.env.DEV_DB_PORT || 3307);
// Windows 命名管道：初始化只创建了 root@localhost，而 TCP+skip-name-resolve 匹配不到 localhost 账号。
// 迁移脚本通过这个管道用 root 连一次，应用和 AMXX 仍然走 TCP + IP 账号。
const PIPE_NAME = process.env.DEV_DB_PIPE || 'ESFDevMySQL';

function ensureDirs() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
}

/**
 * 端口是否在监听。
 * 不用 mysqladmin ping —— 它需要账号权限，root 只允许 localhost 时会误判成"没启动"。
 * 直接测 TCP 端口，与账号无关。
 */
function ping() {
  const probe = `
    const net = require('net');
    const s = net.connect({ host: '127.0.0.1', port: ${PORT} });
    s.on('connect', () => { s.destroy(); process.exit(0); });
    s.on('error', () => process.exit(1));
    s.setTimeout(1500, () => process.exit(1));
  `;
  const r = spawnSync(process.execPath, ['-e', probe], { windowsHide: true });
  return r.status === 0;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitReady(timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (ping()) return true;
    sleepSync(400);
  }
  return false;
}

function isInitialized() {
  return fs.existsSync(path.join(DATA_DIR, 'mysql'));
}

function init() {
  ensureDirs();
  if (isInitialized()) {
    console.log(`[db] 数据目录已存在，跳过初始化: ${DATA_DIR}`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[db] 初始化数据目录: ${DATA_DIR}`);
  const r = spawnSync(
    MYSQLD,
    ['--no-defaults', '--initialize-insecure', `--basedir=${MYSQL_BASE}`, `--datadir=${DATA_DIR}`],
    { stdio: 'inherit', windowsHide: true }
  );
  if (r.status !== 0) {
    console.error('[db] 初始化失败，退出码', r.status);
    process.exit(r.status || 1);
  }
  console.log('[db] 初始化完成（root 空密码，仅监听 127.0.0.1）');
}

function start() {
  if (ping()) {
    console.log(`[db] 已在运行: 127.0.0.1:${PORT}`);
    return;
  }
  if (!isInitialized()) {
    console.error('[db] 还没初始化，先执行: node scripts/dev-db.cjs init');
    process.exit(1);
  }
  ensureDirs();

  const errLog = path.join(RUN_DIR, 'mysqld.err');
  const pidFile = path.join(RUN_DIR, 'mysqld.pid');

  const child = spawn(
    MYSQLD,
    [
      '--no-defaults',
      `--basedir=${MYSQL_BASE}`,
      `--datadir=${DATA_DIR}`,
      `--port=${PORT}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=OFF',
      '--skip-name-resolve',
      '--enable-named-pipe',
      `--socket=${PIPE_NAME}`,
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_0900_ai_ci',
      `--log-error=${errLog}`,
      `--pid-file=${pidFile}`,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();

  if (!waitReady()) {
    console.error(`[db] 启动超时，查看错误日志: ${errLog}`);
    process.exit(1);
  }
  console.log(`[db] 已启动: 127.0.0.1:${PORT}  (pid=${child.pid}, 日志 ${errLog})`);
}

function stop() {
  if (!ping()) {
    console.log('[db] 没有在运行');
    return;
  }

  const attempts = [
    ['-h', '127.0.0.1', '-P', String(PORT), '-u', 'root'],
    ['--protocol=PIPE', `--socket=${PIPE_NAME}`, '-u', 'root'],
  ];
  for (const args of attempts) {
    const r = spawnSync(MYSQLADMIN, [...args, '--connect-timeout=2', 'shutdown'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (r.status === 0) {
      console.log('[db] 已停止');
      return;
    }
  }

  // 兜底：按 pid 文件结束（只可能是本项目在 .devdb 里跑的那个实例）
  const pidFile = path.join(RUN_DIR, 'mysqld.pid');
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (pid > 0) {
      try {
        process.kill(pid);
        sleepSync(1500);
        console.log(`[db] 已强制结束 pid=${pid}`);
        return;
      } catch (err) {
        console.error('[db] 结束进程失败:', err.message);
      }
    }
  }
  console.error('[db] 停止失败，请手动检查');
  process.exitCode = 1;
}

function status() {
  const up = ping();
  console.log(`[db] ${up ? '运行中' : '未运行'}  地址 127.0.0.1:${PORT}`);
  console.log(`[db] 数据目录 ${DATA_DIR}`);
  if (!up) process.exitCode = 1;
}

function reset() {
  stop();
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('[db] 数据目录已删除');
  }
  init();
}

const cmd = process.argv[2];
const actions = { init, start, stop, status, reset };
if (!actions[cmd]) {
  console.log('用法: node scripts/dev-db.cjs <init|start|stop|status|reset>');
  process.exit(1);
}
actions[cmd]();
