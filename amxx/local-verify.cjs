#!/usr/bin/env node
'use strict';

/**
 * 本机 listen server 验证工具（不经过 Electron，方便调 AMXX）。
 *
 * 做三件事：
 *   1. 用启动器的同一套逻辑清掉 config.cfg 里残留的旧 Token
 *   2. 用给定 Token 写 launcher.cfg
 *   3. 以窗口模式拉起 hl.exe 开本地图，供检查 AMXX 日志
 *
 * 用法：
 *   node local-verify.cjs <token> [游戏昵称] [地图]
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const core = require(path.resolve(__dirname, '..', 'esf-launcher', 'launcher-core.cjs'));

const configPath = path.resolve(__dirname, '..', 'esf-launcher', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const token = process.argv[2];
const username = process.argv[3] || '测试玩家';
const map = process.argv[4] || 'ape_foreshadow';

if (!token) {
  console.error('用法: node local-verify.cjs <token> [昵称] [地图]');
  process.exit(1);
}

const modDir = config.esfModDir;
const hlPath = config.hlPath;

const { cleaned } = core.stripStalePlatformInfo(modDir);
console.log('[verify] 清理旧 Token:', cleaned.length ? cleaned.join(', ') : '无残留');

core.writeLauncherCfg(modDir, token, username);
console.log('[verify] 已写入 launcher.cfg:', token);

const args = [
  '-game', path.basename(modDir),
  '-window', '-w', '1280', '-h', '720', '-console',
  // 把引擎控制台写进 <mod>/qconsole.log，排查启动失败时非常有用
  '-condebug',
  '+exec', 'launcher.cfg',
  '+map', map,
];

console.log('[verify] 启动:', core.formatCommand(hlPath, args));

const child = spawn(hlPath, args, {
  cwd: path.dirname(hlPath),
  detached: true,
  stdio: 'ignore',
});

child.on('error', (err) => console.error('[verify] 启动失败:', err.message));
child.on('exit', (code, signal) => {
  console.log(`[verify] hl.exe 已退出 code=${code} signal=${signal}`);
});

child.unref();
console.log(`[verify] hl.exe pid=${child.pid}，等它加载完地图后再看 AMXX 日志`);
