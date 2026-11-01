#!/usr/bin/env node
'use strict';

/**
 * 开发小工具：登录并签发一个连服 Token，打印出来供游戏内手工验证。
 * 用法：node scripts/issue-token.cjs [用户名] [密码] [serverKey]
 */

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  const username = process.argv[2] || 'demo';
  const password = process.argv[3] || 'demo12345';
  const serverKey = process.argv[4] || 'fcx-1v1-1';

  const login = await call('POST', '/api/auth/login', { body: { username, password } });
  if (login.status !== 200) {
    console.error('[token] 登录失败:', login.status, JSON.stringify(login.body));
    process.exit(1);
  }

  const issued = await call('POST', '/api/launch-token', {
    token: login.body.data.accessToken,
    body: { serverKey },
  });
  if (issued.status !== 200) {
    console.error('[token] 签发失败:', issued.status, JSON.stringify(issued.body));
    process.exit(1);
  }

  const { token, expiresAt, reused } = issued.body.data;
  console.log(JSON.stringify({
    username: login.body.data.user.username,
    gameName: login.body.data.user.gameName,
    serverKey,
    token,
    expiresAt,
    reused,
  }, null, 2));
})();
