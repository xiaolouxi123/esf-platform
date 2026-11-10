'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', '..', 'amxx', 'esf_platform_auth.sma');
const source = fs.readFileSync(sourcePath, 'utf8');

const lockSourcePath = path.join(__dirname, '..', '..', 'amxx', 'esf_ranked_lock.sma');
const lockSource = fs.readFileSync(lockSourcePath, 'utf8');

const AUTH_REJECT_CODES = [
  'PLATFORM_TOKEN_MISSING',
  'PLATFORM_TOKEN_INVALID',
  'PLATFORM_TOKEN_EXPIRED',
  'PLATFORM_DB_UNAVAILABLE',
  'PLATFORM_NAME_MISMATCH',
  'PLATFORM_ACCOUNT_INACTIVE',
];

test('auth plugin exposes the pre-launch guest switch', () => {
  assert.match(
    source,
    /register_cvar\("platform_allow_guest",\s*"0"\)/,
    'platform_allow_guest 必须默认关闭',
  );
});

test('guest switch only bypasses token checks when explicitly enabled', () => {
  const noToken = source.match(/if \(token\[0\] == 0\) \{([\s\S]*?)\n    \}/);
  assert.ok(noToken, '未找到无 token 分支');
  assert.match(noToken[1], /get_pcvar_num\(g_pcAllowGuest\)/);
  assert.match(noToken[1], /allowGuestEntry/);

  const badToken = source.match(/if \(!isValidToken\(token\)\) \{([\s\S]*?)\n    \}/);
  assert.ok(badToken, '未找到非法 token 分支');
  assert.match(badToken[1], /get_pcvar_num\(g_pcAllowGuest\)/);
  assert.match(badToken[1], /allowGuestEntry/);
});

test('expired or unknown token also falls back to guest when enabled', () => {
  const noRows = source.match(/if \(SQL_NumResults\(query\) == 0\) \{([\s\S]*?)\n    \}/);
  assert.ok(noRows, '未找到无查询结果分支');
  assert.match(noRows[1], /get_pcvar_num\(g_pcAllowGuest\)/);
  assert.match(noRows[1], /allowGuestEntry/);
});

test('platform name sync is enabled by default and uses the verified name', () => {
  assert.match(
    source,
    /register_cvar\("platform_sync_name",\s*"1"\)/,
    'platform_sync_name 应默认开启',
  );
  // r14：同步前先做 31 字节的 UTF-8 安全截断，不再直接把库里的名字塞进
  // userinfo（长中文名会被客户端截成半个字符）。
  assert.match(source, /#define NAME_MAX_BYTES\s+31/);
  assert.match(
    source,
    /utf8SafeCopy\(safeName,\s*charsmax\(safeName\),\s*displayName,\s*NAME_MAX_BYTES\)/,
    '同步前必须按 31 字节 UTF-8 边界截断',
  );
  assert.match(
    source,
    /set_user_info\(id,\s*"name",\s*safeName\)/,
    '验证通过后应把游戏昵称同步为截断后的平台 game_name',
  );
  assert.match(
    source,
    /if \(gameName\[0\] == 0\) \{\s*copy\(displayName, charsmax\(displayName\), username\);/,
    '空 game_name 必须回退 username',
  );
  assert.match(
    source,
    /while \(cut > 0 && \(src\[cut\] & 0xC0\) == 0x80\) cut--;/,
    '截断点落在 UTF-8 续字节上时必须回退，不能截出半个字符',
  );
});

test('guest entry does not forge a platform session', () => {
  const guest = source.match(/stock allowGuestEntry\([\s\S]*?\n\}/);
  assert.ok(guest, '未找到 allowGuestEntry');
  assert.doesNotMatch(guest[0], /g_userId\[id\]\s*=/);
  assert.doesNotMatch(guest[0], /play_sessions/);
  assert.doesNotMatch(guest[0], /g_authed\[id\]\s*=\s*true/);
});

test('auth reject paths carry the stable platform error codes', () => {
  for (const code of AUTH_REJECT_CODES) {
    assert.match(source, new RegExp(`"${code}"`), `缺少错误码 ${code}`);
  }
  assert.match(
    source,
    /rejectPlayer\(id,\s*const reason\[\],\s*const code\[\] = "PLATFORM_TOKEN_INVALID"\)/,
    'rejectPlayer 必须带 code 参数',
  );
  assert.match(source, /u\.status, u\.username/, '查询必须取账号状态与 username 用于分级拒绝/回退昵称');
});

test('auth reject log is unified and the kick reason carries the code', () => {
  assert.match(
    source,
    /log_amx\("\[ESF-REJECT\] code=%s id=%d name=%s ip=%s reason=%s server=%s",\s*code, id, name, ip, reason, serverKey\)/,
    '拒绝日志必须统一为 [ESF-REJECT] code=... id=... name=... ip=...',
  );
  assert.match(
    source,
    /formatex\(g_kickReason\[id\], 127, "%s: %s", code, reason\)/,
    '踢人原因必须是 "<CODE>: <中文短句>"',
  );
  assert.match(
    source,
    /server_cmd\("kick #%d \^"%s\^"", get_user_userid\(id\), g_kickReason\[id\]\)/,
    'kick 命令必须带 coded reason',
  );
});

test('auth never logs the full token', () => {
  assert.match(source, /#define TOKEN_LOG_PREFIX 6/);
  assert.match(source, /stock tokenPrefix\(/);
  assert.match(
    source,
    /tokenPrefix\(token, prefix, charsmax\(prefix\)\)/,
    '调试日志必须用 6 字符前缀',
  );
  const tokenLogs = source
    .split('\n')
    .filter((line) => /log_amx/.test(line) && /token/i.test(line));
  assert.ok(tokenLogs.length > 0, '未找到 token 相关日志');
  for (const line of tokenLogs) {
    assert.match(line, /prefix/, `token 日志只能打印前缀: ${line.trim()}`);
  }
});

test('auth name mismatch path rejects with PLATFORM_NAME_MISMATCH', () => {
  assert.match(source, /register_cvar\("platform_require_name",\s*"0"\)/);
  assert.match(
    source,
    /rejectPlayer\(id, "游戏昵称必须与平台昵称一致，请改名后重新进入", "PLATFORM_NAME_MISMATCH"\)/,
    '强制改名校验必须以 PLATFORM_NAME_MISMATCH 拒绝',
  );
});

test('auth inactive account is rejected with PLATFORM_ACCOUNT_INACTIVE', () => {
  assert.match(source, /if \(!equal\(status, "active"\)\)/);
  assert.match(
    source,
    /rejectPlayer\(id, "平台账号已被停用，请联系管理员", "PLATFORM_ACCOUNT_INACTIVE"\)/,
    '停用账号必须单独归类为 PLATFORM_ACCOUNT_INACTIVE',
  );
});

test('ranked lock rejects with CHALLENGE_LOCKED / RANKED_LOCKED codes', () => {
  assert.match(
    lockSource,
    /rejectPlayer\(id, "本服务器正在进行约战，只有参赛玩家和观战者可以进入", "CHALLENGE_LOCKED"\)/,
    '约战非参赛者必须用 CHALLENGE_LOCKED 拒绝',
  );
  assert.match(
    lockSource,
    /rejectPlayer\(id, "本服务器正在进行排位赛，只有本场参赛玩家可以进入", "RANKED_LOCKED"\)/,
    '排位非参赛者必须用 RANKED_LOCKED 拒绝',
  );
  assert.match(
    lockSource,
    /log_amx\("\[ESF-LOCK\] code=%s id=%d name=%s ip=%s reason=%s", code, id, name, ip, reason\)/,
    'lock 拒绝日志必须统一为 [ESF-LOCK] code=... id=... name=... ip=...',
  );
  assert.match(
    lockSource,
    /formatex\(g_kickReason\[id\], 127, "%s: %s", code, reason\)/,
    'lock 踢人原因必须是 "<CODE>: <中文短句>"',
  );
  assert.match(
    lockSource,
    /server_cmd\("kick #%d \^"%s\^"", get_user_userid\(id\), g_kickReason\[id\]\)/,
    'lock kick 命令必须带 coded reason',
  );
  assert.match(
    lockSource,
    /"LOCK_DB_UNAVAILABLE"\)/,
    '数据库不可用（fail_open=0）必须用 LOCK_DB_UNAVAILABLE，不得混用 RANKED_LOCKED',
  );
});

test('guest lock also checks live challenge rooms', () => {
  const guestFn = lockSource.match(/checkGuestLock\(id\) \{([\s\S]*?)\n\}/);
  assert.ok(guestFn, '未找到 checkGuestLock');
  assert.match(guestFn[1], /FROM challenge_rooms/, 'guest 校验必须查 challenge_rooms');
  assert.match(guestFn[1], /status = 'live'/, '只锁 live 约战');
  assert.match(guestFn[1], /FROM ranked_matches/, '排位校验必须保留');
  assert.match(
    lockSource,
    /hasChallenge > 0\) \{\s*rejectPlayer\(id, "[^"]+", "CHALLENGE_LOCKED"\)/,
    'live 约战期间无 token 的 guest 必须被 CHALLENGE_LOCKED 拒绝',
  );
});

test('local listen host bypass is logged', () => {
  assert.match(
    lockSource,
    /log_amx\("\[ESF-LOCK\] code=%s id=%d name=%s ip=%s local_bypass=1"/,
    '127.0.0.1/::1 跳过踢人必须记录 local_bypass',
  );
  assert.match(lockSource, /if \(equal\(ip, "127\.0\.0\.1"\) \|\| equal\(ip, "::1"\)\)/);
});

test('fail-open paths record verify_timeout=1 (AC-R6-4)', () => {
  assert.match(
    source,
    /log_amx\("\[Platform\] verify_timeout=1 id=%d code=%s reason=%s"/,
    'auth 容灾放行必须写 verify_timeout=1',
  );
  assert.match(
    lockSource,
    /\[ESF-LOCK\] verify_timeout=1 id=%d code=LOCK_DB_UNAVAILABLE/,
    'lock 容灾放行必须写 verify_timeout=1',
  );
});

test('both plugins report version 1.2.0', () => {
  assert.match(source, /#define VERSION "1\.2\.0"/, 'auth 版本必须是 1.2.0');
  assert.match(lockSource, /#define VERSION "1\.2\.0"/, 'lock 版本必须是 1.2.0');
});
