#!/usr/bin/env node
'use strict';

/**
 * 冒烟测试：把「注册 → 登录 → 看大厅 → 拿连服 Token」整条链跑一遍。
 * 用法：npm run smoke [用户名] [密码]
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
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

function line(label, value) {
  console.log(`  ${label.padEnd(12)} ${value}`);
}

(async () => {
  const username = process.argv[2] || 'demo';
  const password = process.argv[3] || 'demo12345';

  console.log(`\n[smoke] 目标服务 ${BASE}\n`);

  const health = await call('GET', '/api/health');
  line('health', `db=${health.body?.data?.db} version=${health.body?.data?.version}`);

  const reg = await call('POST', '/api/auth/register', {
    body: { username, password, gameName: '测试玩家' },
  });
  if (reg.status === 201) line('注册', `成功 id=${reg.body.data.user.id}`);
  else if (reg.status === 409) line('注册', '账号已存在，直接用已有账号登录');
  else {
    console.error('[smoke] 注册失败:', reg.status, JSON.stringify(reg.body));
    process.exit(1);
  }

  const login = await call('POST', '/api/auth/login', { body: { username, password } });
  if (login.status !== 200) {
    console.error('[smoke] 登录失败:', login.status, JSON.stringify(login.body));
    process.exit(1);
  }
  const token = login.body.data.accessToken;
  line('登录', `成功，JWT 有效期 ${login.body.data.expiresIn}s`);

  const me = await call('GET', '/api/me', { token });
  line('GET /me', `${me.body.data.user.username} / ${me.body.data.user.gameName}`);

  const servers = await call('GET', '/api/servers', { token });
  for (const s of servers.body.data.servers) {
    line('服务器', `${s.serverKey} ${s.name} ${s.ip}:${s.port} online=${s.online} ${s.players}/${s.maxPlayers}`);
  }

  const target = servers.body.data.servers.find((s) => s.online) || servers.body.data.servers[0];
  if (!target) {
    console.error('[smoke] 没有任何服务器，先跑 npx node scripts/migrate.js');
    process.exit(1);
  }

  const lt = await call('POST', '/api/launch-token', {
    token,
    body: { serverKey: target.serverKey },
  });
  if (lt.status !== 200) {
    console.error('[smoke] 签发 Token 失败:', lt.status, JSON.stringify(lt.body));
    process.exit(1);
  }

  const { token: launchToken, expiresAt, reused } = lt.body.data;
  line('连服Token', launchToken);
  line('过期时间', expiresAt);
  line('复用旧值', String(reused));

  console.log(`\n[smoke] 全部通过。可直接用于游戏内验证：`);
  console.log(`  setinfo "_platform_token" "${launchToken}"`);
  console.log(`  setinfo "_platform_user" "${me.body.data.user.gameName}"\n`);
})();
