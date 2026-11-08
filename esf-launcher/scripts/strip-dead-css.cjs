// 一次性清理：删除已被重写页面淘汰的 CSS 规则块。
// 判定条件：选择器里出现的类名，全部落在 DEAD 集合内。
// 用法：node scripts/strip-dead-css.cjs [--write]
const fs = require('node:fs');
const path = require('node:path');

const DEAD = new Set([
  'lobby-command',
  'lobby-quick-list',
  'lobby-action',
  'hero-side',
  'hero-stat',
  'asset-grid',
  'asset-card',
  'asset-card-head',
  'asset-cover',
  'asset-cover-fallback',
  'asset-desc',
  'asset-foot',
  'asset-author',
  'asset-actions',
  'asset-install',
  'hall-head',
  'hall-stats',
  'hall-modes',
  'hall-toolbar',
  'challenge-head',
  'challenge-grid',
  'challenge-card',
  'challenge-create-copy',
  'admin-head',
  'admin-cards',
  'admin-card',
  'admin-card-icon',
  'upload-grid',
]);

const root = path.resolve(__dirname, '..');
const srcFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(jsx?|cjs)$/.test(entry.name)) srcFiles.push(full);
  }
})(path.join(root, 'src'));

const sources = srcFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

// 精确类名使用检测：出现 "class-name" 形式（不加前缀/后缀）。
const isUsed = (name) => new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(sources);

const cssPath = path.join(root, 'src', 'App.css');
const css = fs.readFileSync(cssPath, 'utf8');
const lines = css.split('\n');

const kept = [];
const removed = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  // 规则起点：行内含 "{"，且不在注释里，且不是 @media/@keyframes/@font-face 的开头
  const open = line.indexOf('{');
  if (open === -1 || line.trim().startsWith('/*') || line.trim().startsWith('*') || line.trim().startsWith('@')) {
    kept.push(line);
    i += 1;
    continue;
  }

  // 收集选择器（可能跨行到 "{" 之前）
  let selector = '';
  let j = i;
  while (j < lines.length && !lines[j].includes('{')) {
    selector += lines[j];
    j += 1;
  }
  if (j >= lines.length) {
    kept.push(line);
    i += 1;
    continue;
  }
  selector += lines[j].slice(0, lines[j].indexOf('{'));

  // 找规则结束（匹配花括号层级）
  let depth = 0;
  let end = j;
  for (; end < lines.length; end += 1) {
    for (const ch of lines[end]) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth === 0) break;
  }

  const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
  const allDead = classes.length > 0 && classes.every((name) => DEAD.has(name));
  const anyUsed = classes.some((name) => !DEAD.has(name) && isUsed(name));

  if (allDead && !anyUsed) {
    removed.push(selector.trim().replace(/\s+/g, ' '));
    i = end + 1;
    continue;
  }

  for (let k = i; k <= end; k += 1) kept.push(lines[k]);
  i = end + 1;
}

const output = kept.join('\n');
if (process.argv.includes('--write')) fs.writeFileSync(cssPath, output, 'utf8');

console.log(`removed ${removed.length} rules, ${lines.length - kept.length} lines, ${css.length} → ${output.length} bytes`);
for (const sel of removed.slice(0, 60)) console.log('  - ' + sel);
