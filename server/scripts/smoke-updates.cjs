#!/usr/bin/env node
'use strict';

/**
 * 更新源冒烟：health/config/latest.yml/安装包/多段 Range。
 * 用法：API_BASE=http://119.91.99.176:3000 node scripts/smoke-updates.cjs
 */

const base = (process.env.API_BASE || process.env.ESF_API || 'http://127.0.0.1:3000').replace(/\/+$/, '');

let failed = 0;
function pass(name, detail = '') {
  console.log(`  OK  ${name}${detail ? `  ${detail}` : ''}`);
}
function fail(name, detail) {
  failed += 1;
  console.error(`FAIL  ${name}  ${detail}`);
}

async function check(name, fn) {
  try {
    pass(name, (await fn()) || '');
  } catch (err) {
    fail(name, err.message);
  }
}

async function main() {
  console.log(`\n[smoke:updates] ${base}\n`);

  await check('健康检查', async () => {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error('ok=false');
    if (json.data.db !== 'up') throw new Error('db=' + json.data.db);
    return `v${json.data.version}`;
  });

  await check('配置接口', async () => {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data.latestVersion) throw new Error('缺 latestVersion');
    if (!json.data.updateFeedUrl) throw new Error('缺 updateFeedUrl');
    return `latest=${json.data.latestVersion}`;
  });

  let latest = '';
  await check('latest.yml', async () => {
    const res = await fetch(`${base}/updates/latest.yml`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const match = text.match(/^version:\s*(.+)$/m);
    if (!match) throw new Error('没有 version 字段');
    latest = match[1].trim();
    return latest;
  });

  if (latest) {
    await check('安装包可下载', async () => {
      const name = `ESF-Platform-Setup-${latest}.exe`;
      const res = await fetch(`${base}/updates/${name}`, { method: 'HEAD' });
      if (!res.ok) throw new Error(`HTTP ${res.status} (${name})`);
      const size = Number(res.headers.get('content-length') || 0);
      if (size < 10 * 1024 * 1024) throw new Error(`size=${size}`);
      return `${(size / 1048576).toFixed(1)} MB`;
    });

    await check('差量多段 Range', async () => {
      const name = `ESF-Platform-Setup-${latest}.exe`;
      const res = await fetch(`${base}/updates/${name}`, {
        headers: { range: 'bytes=0-99,1000-1099' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('multipart/byteranges')) throw new Error(type);
      await res.arrayBuffer();
      return '206 multipart';
    });
  }

  console.log('');
  if (failed) {
    console.error(`${failed} 项失败`);
    process.exit(1);
  }
  console.log('全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
