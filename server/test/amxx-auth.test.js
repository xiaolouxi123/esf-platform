'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', '..', 'amxx', 'esf_platform_auth.sma');
const source = fs.readFileSync(sourcePath, 'utf8');

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
  assert.match(
    source,
    /set_user_info\(id,\s*"name",\s*name\)/,
    '验证通过后应把游戏昵称同步为平台 game_name',
  );
});

test('guest entry does not forge a platform session', () => {
  const guest = source.match(/stock allowGuestEntry\([\s\S]*?\n\}/);
  assert.ok(guest, '未找到 allowGuestEntry');
  assert.doesNotMatch(guest[0], /g_userId\[id\]\s*=/);
  assert.doesNotMatch(guest[0], /play_sessions/);
  assert.doesNotMatch(guest[0], /g_authed\[id\]\s*=\s*true/);
});
