#!/usr/bin/env node
'use strict';

/**
 * 版本单一来源同步器。
 *
 * 唯一来源：esf-launcher/package.json 的 version。
 * 发版时由 scripts/release.ps1 调用（bump 之后、提交之前），也可手动运行：
 *   node scripts/sync-versions.cjs
 *
 * 会写：
 *   website/version.json          静态官网读取的版本与下载地址
 *   website/index.html            3 处版本展示、JS 兜底值、下载按钮链接、更新记录块
 *   website/sitemap.xml           规范域名
 *   website/robots.txt            sitemap 绝对地址
 *
 * 设计要点：GitHub Pages 无法请求 /api/config，因此静态站必须靠 version.json，
 * 否则会永远停在 HTML 里硬编码的旧版本（0.4.7 事故）。HTML 中的硬编码值只作兜底。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'esf-launcher', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('package.json 的 version 不是 x.y.z:', version);
  process.exit(1);
}

const SITE = 'https://xiaolouxi123.github.io/esf-platform/';
const REPO = 'https://github.com/xiaolouxi123/esf-platform';
const downloadUrl = `${REPO}/releases/download/v${version}/ESF-Platform-Setup-${version}.exe`;
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- 1. version.json ----
const versionFile = path.join(root, 'website', 'version.json');
fs.writeFileSync(
  versionFile,
  JSON.stringify({ version, downloadUrl, site: SITE, updatedAt: today }, null, 2) + '\n',
  'utf8'
);
console.log(`version.json        -> ${version}`);

// ---- 2. index.html ----
const htmlPath = path.join(root, 'website', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// 用回调避免 "$1" 紧邻版本号数字时被解析成捕获组编号；
// 只检查「片段是否存在」，不要求内容变化（重复运行必须是幂等的）
function substitute(re, build) {
  if (!html.match(re)) throw new Error(`index.html 未匹配到预期片段: ${re}`);
  html = html.replace(re, build);
}

substitute(/(<span class="kicker">VERSION <span id="versionCode">)[^<]*(<\/span>)/,
  (m, a, b) => a + version + b);
substitute(/(最新版本 <b id="versionCode2">)[^<]*(<\/b>)/,
  (m, a, b) => a + version + b);
substitute(/(版本 <code id="downloadVersion">)[^<]*(<\/code>)/,
  (m, a, b) => a + version + b);
substitute(/(const DEFAULT_VERSION = ')[^']*(')/,
  (m, a, b) => a + version + b);
substitute(/href="https:\/\/github\.com\/xiaolouxi123\/esf-platform\/releases\/download\/v[^"]+"/g,
  () => `href="${downloadUrl}"`);

// 更新记录：取 releases.json 前 8 条，替换锚点之间的内容
const releases = JSON.parse(
  fs.readFileSync(path.join(root, 'esf-launcher', 'src', 'data', 'releases.json'), 'utf8')
);
if (!Array.isArray(releases) || releases.length === 0) throw new Error('releases.json 为空');
const items = releases.slice(0, 8).map((r) =>
  `        <article class="update-item"><div class="v"><b>${escapeHtml(r.version)}</b><span>${escapeHtml(r.date)}</span></div><p>${escapeHtml(r.summary || '')}</p></article>`
).join('\n');
substitute(/(<!-- UPDATES:START -->)[\s\S]*?(<!-- UPDATES:END -->)/,
  (m, a, b) => `${a}\n${items}\n        ${b}`);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`index.html          -> ${version} / 下载链接 / ${Math.min(8, releases.length)} 条更新记录`);

// ---- 3. sitemap / robots ----
const sitemapPath = path.join(root, 'website', 'sitemap.xml');
fs.writeFileSync(
  sitemapPath,
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  '  <url>\n' +
  `    <loc>${SITE}</loc>\n` +
  '    <changefreq>weekly</changefreq>\n' +
  '    <priority>1.0</priority>\n' +
  '  </url>\n' +
  '</urlset>\n',
  'utf8'
);
const robotsPath = path.join(root, 'website', 'robots.txt');
fs.writeFileSync(
  robotsPath,
  'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + 'sitemap.xml\n',
  'utf8'
);
console.log(`sitemap/robots      -> ${SITE}`);

console.log(`\n完成：全部由 ${path.relative(root, pkgPath)} 的 ${version} 派生。`);
console.log('注意：release/latest.yml、server/updates/latest.yml 是发布产物（含 sha512），');
console.log('      由发布流程生成，本脚本不伪造哈希；用 check-versions.cjs 检查一致性。');
