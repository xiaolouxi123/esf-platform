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

test('guest entry does not forge a platform session', () => {
  const guest = source.match(/stock allowGuestEntry\([\s\S]*?\n\}/);
  assert.ok(guest, '未找到 allowGuestEntry');
  assert.doesNotMatch(guest[0], /g_userId\[id\]\s*=/);
  assert.doesNotMatch(guest[0], /play_sessions/);
  assert.doesNotMatch(guest[0], /g_authed\[id\]\s*=\s*true/);
});
