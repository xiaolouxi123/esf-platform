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

console.log('== 约战 0.6.61：锁服与在线服 ==');
const challengePage = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'ChallengePage.jsx'),
  'utf8'
);
const challengesService = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server', 'src', 'services', 'challenges.js'),
  'utf8'
);
check('页面文案承认开赛锁服', () => {
  assert.match(challengePage, /开赛锁服/);
  assert.doesNotMatch(challengePage, /也不会锁服/);
});
check('创建和开赛都校验服务器在线', () => {
  const onlineChecks = challengesService.match(/Number\(server\.online\)/g) || [];
  assert.strictEqual(onlineChecks.length, 2);
  assert.match(challengesService, /这台约战服当前离线/);
  assert.match(challengesService, /这台约战服已离线/);
});
check('离线服在创建下拉里被禁用', () => {
  assert.match(challengePage, /onlineChallengeServers/);
  assert.match(challengePage, /disabled:\s*!server\.online/);
});
check('三个原生 select 已换成 SelectMenu', () => {
  assert.match(challengePage, /import SelectMenu from '\.\/SelectMenu'/);
  assert.doesNotMatch(challengePage, /<select\b/);
  assert.match(challengePage, /ariaLabel="比赛服务器"/);
  assert.match(challengePage, /ariaLabel="胜利条件"/);
  assert.match(challengePage, /ariaLabel="胜利次数"/);
});
check('轮询有竞态保护并尊重页面可见性', () => {
  assert.match(challengePage, /refreshSeq\.current/);
  assert.match(challengePage, /document\.visibilityState === 'visible'/);
  assert.match(challengePage, /setPollError/);
});
check('邀请弹层具备 Esc 与焦点陷阱', () => {
  assert.match(challengePage, /aria-labelledby="challenge-invite-title"/);
  assert.match(challengePage, /aria-label="关闭邀请面板"/);
  assert.match(challengePage, /inviteDialogRef/);
  assert.match(challengePage, /event\.key === 'Escape'/);
});

console.log('== 2v2 换队 ==');
const challengesRoute = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server', 'src', 'routes', 'challenges.js'),
  'utf8'
);
check('换队只允许等待中的 2v2，并取消准备', () => {
  assert.match(challengesService, /1v1 房间不需要换队/);
  assert.match(challengesService, /目标队伍已经满了/);
  assert.match(challengesService, /SET team = \?, ready = 0/);
});
check('换队贯通路由、IPC 与界面', () => {
  assert.match(challengesRoute, /router\.post\('\/challenges\/:id\/team'/);
  assert.match(main, /handle\('challenges:team'/);
  assert.match(preload, /team: \(id, team\) => call\('challenges:team'/);
  assert.match(challengePage, /challenge-team-switch/);
});

console.log('== 房间搜索 ==');
check('房间搜索按关键词过滤并有清除入口', () => {
  assert.match(challengePage, /roomKeyword/);
  assert.match(challengePage, /aria-label="搜索约战房间"/);
  assert.match(challengePage, /没有匹配的房间/);
  assert.match(challengePage, /setRoomKeyword\(''\)/);
});

console.log(`\n${passed} checks passed`);
