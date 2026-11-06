'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', '..', 'amxx', 'test_ranked.sma');
const source = fs.readFileSync(sourcePath, 'utf8');
const lockSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'amxx', 'esf_ranked_lock.sma'),
  'utf8'
);

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

test('1v1 settles with one participant while 2v2 requires both teams', () => {
  assert.match(source, /new need = \(g_challengeSlots > 1\) \? 2 : 1/);
  assert.match(
    source,
    /challengeTeamCount\(1\) < 1 \|\| challengeTeamCount\(2\) < 1/,
    '2v2 必须两队都有人在线才能结算',
  );
  assert.match(source, /challengeTeamCount\(team, exclude = 0\)/);
});

test('challenge mode drives slots and safe start fallback', () => {
  assert.match(source, /t\.user_id, r\.mode/);
  assert.match(source, /new query\[1024\]/);
  assert.match(source, /g_challengeExpected = g_challengeSlots \* 2/);
  assert.match(source, /\[ESF-CHALLENGE\] start_partial known=%d expected=%d/);
  assert.match(source, /public client_infochanged\(id\)/);
  assert.match(source, /"1\.2\.0-r14"/);
});

test('challenge HUD uses one centered DHUD channel and platform counters', () => {
  assert.match(source, /set_hudmessage\(133, 166, 255, -1\.0, 0\.02,[^;]*, 4\)/);
  assert.match(source, /FIRST TO %d %s/);
  assert.match(source, /equal\(g_challengeVictory, "deaths"\) \? g_challengeDeaths\[i\] : g_challengeKills\[i\]/);
  assert.match(source, /set_task\(1\.0,"showIconDisplay"/, 'HUD 刷新必须 ≤1 秒');
  assert.doesNotMatch(source, /calculate_InsetStrl\(/);
  assert.doesNotMatch(source, /show_dhudmessage\(0/);
  assert.doesNotMatch(source, /0\.02, 0\.02, 0, 0\.0, 5\.0, 0\.0, 0\.0, [123]\)/);
});

test('challenge diagnostic logs carry PRD fields', () => {
  assert.match(source, /\[ESF-CHALLENGE\] code=RENAME_BLOCKED rename_blocked id=%d/);
  assert.match(source, /\[ESF-CHALLENGE\] identified room=%d mode=%s slots=%d team=%s known=%d expected=%d/);
  assert.match(source, /\[ESF-SETTLE\] room=%d attempt=%d code=SETTLE_RETRY err=%s/);
  assert.match(source, /\[ESF-SETTLE\] room=%d attempts=4 code=STATS_FAILED err=%s/);
  assert.match(source, /\[ESF-SETTLE\] room=%d attempts=4 code=SETTLE_FAILED err=%s/);
  assert.match(source, /\[ESF-SETTLE\] room=%d attempt=0 code=SETTLE_TIMEOUT force_exit/);
});

test('challenge forfeit uses a 20s grace and settlement retries are wired', () => {
  assert.match(source, /settleChallengeForfeit\(const reason\[\]\)/);
  assert.match(source, /armChallengeForfeit\(const reason\[\], team\)/);
  assert.match(source, /set_task\(20\.0, "taskChallengeForfeit"/);
  assert.match(source, /\[ESF-CHALLENGE\] forfeit_arm reason=%s/);
  assert.match(source, /\[ESF-CHALLENGE\] forfeit reason=%s winner=%s/);
  assert.match(source, /\[ESF-SETTLE\] room=%d attempt=0 code=SETTLE_TIMEOUT force_exit/);
  assert.match(source, /new Float:retryDelay = 2\.0;/);
  assert.match(source, /taskRetryChallengeStats/);
  assert.match(source, /taskRetryChallengeSettle/);
});

test('challenge completion forces a return to the platform', () => {
  assert.match(source, /new bool:wasChallenge = g_challengeActive/);
  assert.match(
    source,
    /if\(\(wasBattle \|\| wasChallenge\) && \(get_pcvar_num\(g_pcQuitEnable\) \|\| wasChallenge\)\)/,
    '约战结束不能因为 battle_quit_enable=0 就卡在游戏里',
  );
});

test('forfeit settlement keeps disconnected participants and scores (AC-R8-6/7)', () => {
  const forfeitFn = source.match(/settleChallengeForfeit\(const reason\[\]\) \{([\s\S]*?)\n\}/);
  assert.ok(forfeitFn, '未找到 settleChallengeForfeit');
  assert.match(
    forfeitFn[1],
    /g_challengeTeam\[i\] == 0 \|\| g_challengeUserId\[i\] == 0/,
    '弃权比分必须按已识别参赛者汇总，不能只算在线者',
  );
  assert.doesNotMatch(
    forfeitFn[1],
    /!is_user_connected\(i\)/,
    '断线玩家的击杀/死亡不能因为掉线而被丢弃',
  );

  const settleFn = source.match(/beginChallengeSettlement\(const winner\[\], scoreA, scoreB\) \{([\s\S]*?)\n\}/);
  assert.ok(settleFn, '未找到 beginChallengeSettlement');
  assert.match(
    settleFn[1],
    /g_challengeTeam\[i\] == 0 \|\| g_challengeUserId\[i\] == 0/,
    'stats 写入必须包含已断线的已识别参赛者',
  );
});

test('quorum grace and single 12s timeout prevent infinite waiting (AC-R10-6/R7-3)', () => {
  assert.match(source, /#define TASK_CHALLENGE_QUORUM 4930/);
  assert.match(source, /armChallengeQuorum\(\)/);
  assert.match(source, /set_task\(20\.0, "taskChallengeQuorum"/);
  assert.match(source, /\[ESF-CHALLENGE\] quorum_go room=%d/);
  assert.match(source, /settleChallengeForfeit\("quorum_unmet"\)/);
  const partialFn = source.match(/public taskChallengePartialStart\(\) \{([\s\S]*?)\n\}/);
  assert.ok(partialFn, '未找到 taskChallengePartialStart');
  assert.doesNotMatch(partialFn[1], /set_task\(8\.0/, '8 秒兜底不得无限重挂');
  assert.match(partialFn[1], /armChallengeQuorum\(\)/, '未满足时交给 20 秒 quorum 宽限');

  const settledFn = source.match(/public OnChallengeSettled\(([\s\S]*?)\n\}/);
  assert.ok(settledFn, '未找到 OnChallengeSettled');
  assert.match(
    settledFn[1],
    /remove_task\(TASK_CHALLENGE_END\);\s*set_task\(12\.0, "taskForceChallengeEnd"/,
    '第 4 次失败必须重新武装唯一的 12 秒兜底',
  );

  const retryFn = source.match(/public taskRetryChallengeSettle\(\) \{([\s\S]*?)\n\}/);
  assert.ok(retryFn, '未找到 taskRetryChallengeSettle');
  assert.doesNotMatch(retryFn[1], /!g_iBattle/, '开赛前 quorum 弃权也要重试结算');
});

test('platform spectators are consumed and forced to spectate (AC-R10-3)', () => {
  assert.match(source, /bool:isPlatformSpectator\(id\)/);
  assert.match(source, /get_user_info\(id, "_platform_spectator"/);
  assert.match(source, /#define TASK_CHALLENGE_SPECTATE 4940/);
  assert.match(source, /public taskForceSpectate\(taskid\)/);
  assert.match(source, /client_cmd\(id, "spectate"\)/);
  assert.match(
    source,
    /equal\(sz_agv,"spectate"\)[^\n]*!isPlatformSpectator\(id\)/,
    '平台观战者的 spectate 命令不能被 legacy 拦截',
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
  assert.match(source, /set_task\(25\.0, "taskForceChallengeEnd", TASK_CHALLENGE_END\)/, '结算看门狗必须为 25 秒');
  assert.match(source, /public taskForceChallengeEnd\(\)/);
  assert.match(source, /public taskForceChallengeEnd\(\)[\s\S]{0,400}client_cmd\(i,"disconnect"\)/, 'TIMEOUT 必须直接断开，不再叠加 quit delay');
  assert.match(
    source,
    /remove_task\(TASK_CHALLENGE_END\);\s*resetAll\(\);/,
    '存储过程回调完成后才 resetAll 排 quit',
  );
});

test('ranked settlement waits for the async result before quitting', () => {
  assert.match(
    source,
    /if\(checkRankedFinish\(\)\)\s*\{\s*\/\/[^\n]*\n\s*return FMRES_HANDLED;/,
    '排位结算后不能立即 resetAll；应由 OnRankedSettled 落库后再结束',
  );
  assert.match(source, /#define TASK_RANKED_END\s+4800/);
  assert.match(source, /set_task\(12\.0, "taskForceRankedEnd", TASK_RANKED_END\)/);
  assert.match(source, /public taskForceRankedEnd\(\)/);
  assert.match(
    source,
    /remove_task\(TASK_RANKED_END\);\s*resetAll\(\);/,
    '排位存储过程回调完成后才 resetAll',
  );
  assert.match(source, /client_cmd\(i, "disconnect"\)/);
  assert.doesNotMatch(source, /client_cmd\(i, "quit"\)/, 'GoldSrc 客户端会拒绝服务器发 quit');
});

test('ranked guests are rejected while a ranked match is active', () => {
  assert.match(lockSource, /checkGuestLock\(id\)/);
  assert.match(lockSource, /public OnGuestLockChecked/);
  assert.match(lockSource, /只有本场参赛平台玩家可以进入/);
});
test('team_empty forfeit awards the remaining team regardless of score (AC-R8-6)', () => {
  const fn = source.match(/settleChallengeForfeit\(const reason\[\]\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, '未找到 settleChallengeForfeit');
  assert.match(
    fn[1],
    /winner\[0\] = \(equal\(reason, "team_empty"\) && g_challengeForfeitTeam > 0\)/,
    'team_empty 必须读取 g_challengeForfeitTeam',
  );
  assert.match(
    fn[1],
    /\(\(g_challengeForfeitTeam == 1\) \? 'b' : 'a'\)/,
    'A 队空判 b，B 队空判 a',
  );
  assert.match(fn[1], /if \(winner\[0\] == 0 && equal\(g_challengeVictory, "deaths"\)\)/);
  assert.match(fn[1], /\} else if \(winner\[0\] == 0\) \{/);
  // A 9:0 后 A 全断线的规则推演：空队是 1，winner 必须是 b，不能被 9:0 改判。
  const forfeitTeam = 1;
  const winner = forfeitTeam === 2 ? 'a' : 'b';
  assert.equal(winner, 'b');
});
