'use strict';

/**
 * 账号密码策略：长度 >= 10，至少包含三类字符，拒绝常见弱密码，
 * 且不能包含账号名。注册、改密、重置都会走这里。
 */

const COMMON = new Set([
  '123456789',
  '1234567890',
  '12345678',
  'password',
  'password1',
  'password123',
  'qwertyuiop',
  'qwerty123',
  '1qaz2wsx',
  'abc123456',
  'iloveyou',
  'woaini1314',
  'a123456789',
  'admin12345',
  'esf123456',
  'dragonball',
]);

function classesOf(password) {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}

/**
 * @param {string} password
 * @param {{ username?: string, email?: string }} context
 * @returns {{ ok: boolean, message?: string }}
 */
function checkPassword(password, context = {}) {
  const value = String(password || '');
  if (value.length < 10) return { ok: false, message: '密码至少 10 位' };
  if (value.length > 72) return { ok: false, message: '密码最长 72 位' };
  if (classesOf(value) < 3) return { ok: false, message: '密码需包含大小写字母、数字、符号中的至少三类' };
  if (COMMON.has(value.toLowerCase())) return { ok: false, message: '密码过于常见，请换一个' };

  const username = String(context.username || '').toLowerCase();
  if (username && value.toLowerCase().includes(username)) {
    return { ok: false, message: '密码不能包含账号名' };
  }
  const emailName = String(context.email || '').split('@')[0].toLowerCase();
  if (emailName && emailName.length >= 3 && value.toLowerCase().includes(emailName)) {
    return { ok: false, message: '密码不能包含邮箱名' };
  }
  return { ok: true };
}

module.exports = { checkPassword, classesOf };
