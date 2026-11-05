'use strict';

// 回归：约战 live 自动进服、结果落库后强制收游戏。读源码而不是复制逻辑，
// 防止这两个在真实环境里才能暴露的故障被无意删掉。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    console.log('  FAIL  ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

const lobby = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Lobby.jsx'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

console.log('== 约战自动进服 ==');
check('live 房间会调用 joinServerRef', () => {
  assert.match(lobby, /status === 'live'[\s\S]{0,220}joinServerRef\.current/);
});
check('同一房间只自动进一次', () => {
  assert.match(lobby, /autoJoinRef\.current !== roomId/);
});
check('轮询周期为 5 秒', () => {
  assert.match(lobby, /setInterval\(checkResult, 5000\)/);
});

console.log('== 结果收尾 ==');
check('新结果先结束游戏再弹结果', () => {
  assert.match(lobby, /launch\.stop\(\)[\s\S]{0,160}setChallengeResult/);
});
check('旧结果不会误杀新游戏进程', () => {
  assert.match(lobby, /10 \* 60 \* 1000/);
});
check('主进程提供 launch:stop', () => {
  assert.match(main, /handle\('launch:stop'/);
  assert.match(preload, /stop:\s*\(\)\s*=>\s*call\('launch:stop'\)/);
});

console.log(`\n${passed} checks passed`);
