'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', '..', 'amxx', 'test_ranked.sma');
const source = fs.readFileSync(sourcePath, 'utf8');

test('challenge identification retries after a late room start', () => {
  assert.match(source, /#define TASK_CHALLENGE_RETRY\s+4600/);
  assert.match(source, /set_task\(20\.0, "taskChallengeRetry", TASK_CHALLENGE_RETRY \+ id, _, _, "b"\)/);
  assert.match(source, /public taskChallengeRetry\(taskid\)/);
  assert.match(source, /g_challengeRetry\[id\] >= CHALLENGE_RETRY_LIMIT/);
});

test('challenge retry is cleaned up when the player disconnects', () => {
  assert.match(source, /remove_task\(TASK_CHALLENGE_RETRY \+ id\)/);
});

test('challenge identification still loads the room victory rule', () => {
  assert.match(source, /COALESCE\(c\.victory_type, 'kills'\)/);
  assert.match(source, /COALESCE\(c\.victory_limit, 10\)/);
  assert.match(source, /r\.status = 'live'/);
});

test('challenge disconnect path does not quit before the async result', () => {
  assert.match(
    source,
    /new bool:challengeEnded = checkChallengeFinish\(\);\s*if\(!challengeEnded && checkRankedFinish\(\)\)/,
    '约战断线结算也不能立即 resetAll',
  );
});

test('challenge settlement uses per-death counters instead of engine frags', () => {
  assert.match(source, /new g_challengeKills\[33\]/);
  assert.match(source, /new g_challengeDeaths\[33\]/);
  assert.match(source, /g_challengeDeaths\[victim\]\+\+/);
  assert.match(source, /g_challengeKills\[attack\]\+\+/);
  assert.match(source, /new kills = g_challengeKills\[i\]/);
  assert.match(source, /new deaths = g_challengeDeaths\[i\]/);
  assert.doesNotMatch(
    source,
    /new kills = get_user_frags\(i\) - g_challengeBaseKills\[i\]/,
    '约战不能用 engine frags 计分，部分 ESF 模式 frags 始终为 0',
  );
});

test('1v1 challenge can settle with one identified participant', () => {
  assert.match(source, /new need = \(g_autoTeamSize > 1\) \? g_autoTeamSize : 1/);
});

test('challenge completion forces a return to the platform', () => {
  assert.match(source, /new bool:wasChallenge = g_challengeActive/);
  assert.match(
    source,
    /if\(wasBattle && \(get_pcvar_num\(g_pcQuitEnable\) \|\| wasChallenge\)\)/,
    '约战结束不能因为 battle_quit_enable=0 就卡在游戏里',
  );
});

test('challenge settlement waits for the async result before quitting', () => {
  // 命中结算后不能立刻 resetAll（会排 5 秒 quit），否则数据库慢时平台拿不到结果。
  assert.match(
    source,
    /if\(checkChallengeFinish\(\)\)\s*\{\s*return FMRES_HANDLED;\s*\}/,
    '约战结算应立即返回，不能和排位共用 resetAll 分支',
  );
  assert.match(source, /set_task\(12\.0, "taskForceChallengeEnd", TASK_CHALLENGE_END\)/);
  assert.match(source, /public taskForceChallengeEnd\(\)/);
  assert.match(
    source,
    /remove_task\(TASK_CHALLENGE_END\);\s*resetAll\(\);/,
    '存储过程回调完成后才 resetAll 排 quit',
  );
});
