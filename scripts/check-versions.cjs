#!/usr/bin/env node
'use strict';

/**
 * 版本一致性校验（CI 与发版前跑）。
 *   node scripts/check-versions.cjs
 *
 * 唯一来源仍是 esf-launcher/package.json 的 version。
 * 任何一项不一致都 exit 1；发布产物 latest.yml 只在本地存在时给 WARN（CI 上没有这些文件）。
 * 不校验 sha512 —— 那是发布流程生成的真实值，仓库里不该有占位哈希。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const version = JSON.parse(read('esf-launcher/package.json')).version;
const SITE = 'https://xiaolouxi123.github.io/esf-platform/';

const results = [];
const warns = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ name, ok: false, msg: err.message });
    console.log(`[FAIL] ${name} — ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function warn(msg) {
  warns.push(msg);
  console.log(`[WARN] ${msg}`);
}

check('package.json 版本格式', () => {
  assert(/^\d+\.\d+\.\d+$/.test(version || ''), `非法版本: ${version}`);
});

check('website/version.json 与唯一来源一致', () => {
  const v = JSON.parse(read('website/version.json'));
  assert(v.version === version, `version.json=${v.version}，应为 ${version}`);
  assert(String(v.downloadUrl).includes(`v${version}/ESF-Platform-Setup-${version}.exe`), '下载地址未指向当前版本');
});

const html = read('website/index.html');
check('官网 3 处版本展示', () => {
  const ids = ['versionCode', 'versionCode2', 'downloadVersion'];
  for (const id of ids) {
    const re = new RegExp(`id="${id}"[^>]*>([^<]*)<`);
    const m = html.match(re);
    assert(m && m[1].trim() === version, `${id} 显示 ${m ? m[1] : '未找到'}，应为 ${version}`);
  }
});

check('官网 JS 兜底版本与下载链接', () => {
  assert(html.includes(`const DEFAULT_VERSION = '${version}'`), 'DEFAULT_VERSION 未同步');
  assert(html.includes(`v${version}/ESF-Platform-Setup-${version}.exe`), '下载按钮未指向当前版本');
  assert(html.includes("fetch('./version.json'"), '静态托管未读取 version.json');
});

check('官网更新记录首条为当前版本', () => {
  const m = html.match(/<!-- UPDATES:START -->\s*<article[^>]*>\s*<div class="v"><b>([^<]+)<\/b>/);
  assert(m && m[1].trim() === version, `更新记录首条 ${m ? m[1] : '未找到'}，应为 ${version}`);
});

check('客户端 releases.json 首项', () => {
  const list = JSON.parse(read('esf-launcher/src/data/releases.json'));
  assert(Array.isArray(list) && list[0] && list[0].version === version, 'releases.json 首项不是当前版本');
});

check('官网规范域名（不再用未备案域名）', () => {
  assert(!html.includes('https://esfcn.cn/'), 'index.html 仍写 esfcn.cn');
  assert(!read('website/sitemap.xml').includes('esfcn.cn'), 'sitemap 仍写 esfcn.cn');
  assert(!read('website/robots.txt').includes('esfcn.cn'), 'robots 仍写 esfcn.cn');
  assert(read('website/sitemap.xml').includes(SITE), 'sitemap 未指向 GitHub Pages');
});

check('electron-builder 发布源不是占位地址', () => {
  const pkg = JSON.parse(read('esf-launcher/package.json'));
  const url = pkg.build && pkg.build.publish && pkg.build.publish[0] && pkg.build.publish[0].url;
  assert(url && !url.includes('example.com'), `publish.url 仍是占位: ${url}`);
});

check('部署脚本版本与服务器地址', () => {
  const s = read('deploy/deploy-esf-server.ps1');
  assert(s.includes(`$LatestVer = '${version}'`), '部署脚本 $LatestVer 未同步');
  assert(!s.includes("'119.91.99.176'"), '部署脚本仍指向老平台机');
});

check('KB 客户端版本与监控地址', () => {
  const servers = read('docs/kb/environment/servers.md');
  assert(servers.includes(`最新 ${version}`), 'KB servers.md 客户端版本未同步');
  for (const f of ['.github/workflows/uptime.yml', 'docs/MONITORING.md']) {
    assert(!read(f).includes('119.91.99.176'), `${f} 仍探测老平台机`);
  }
});

check('官网 README 无过期版本/IP', () => {
  const s = read('website/README.md');
  assert(!s.includes('0.4.2'), 'website/README.md 仍写 0.4.2');
  assert(!s.includes('119.91.99.176'), 'website/README.md 仍写老平台机');
});

check('部署包由当前源码重建（防止 0.1.0 旧后端事故）', () => {
  const m = JSON.parse(read('deploy/esf-server-bundle.manifest.json'));
  assert(m.launcherVersion === version, `bundle 由 ${m.launcherVersion} 构建，当前是 ${version}`);
  assert(m.hasSettlementProcedures === true, 'bundle 缺 settle_* 结算存储过程');
  assert(m.sqlCount >= 16, `bundle 只有 ${m.sqlCount} 个 SQL`);
  assert(m.routeCount >= 19, `bundle 只有 ${m.routeCount} 个路由`);
  assert(m.envTemplateVars >= 50, `bundle 的 env 模板只有 ${m.envTemplateVars} 个变量`);
  const digest = require('crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'deploy', 'esf-server-bundle.zip')))
    .digest('hex');
  assert(digest === m.sha256, 'bundle 的 sha256 与 manifest 不符，需重跑 scripts/build-server-bundle.py');
});

// 发布产物：只在本地存在时提示，不纳入 CI 判定
for (const f of ['esf-launcher/release/latest.yml', 'server/updates/latest.yml']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const m = fs.readFileSync(p, 'utf8').match(/^version:\s*(\S+)/m);
  if (!m || m[1] !== version) {
    warn(`${f} 为 ${m ? m[1] : '未知'}（本地历史构建产物，含 sha512，由发布流程覆盖；仓库不跟踪）`);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed} PASS / ${failed} FAIL / ${warns.length} WARN（唯一来源 ${version}）`);
if (failed) process.exitCode = 1;
