import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 生成桌面审核版：直接拿 node_modules\electron\dist + 源码目录，跳过 electron-builder。
// 原因：本机 electron-builder --dir 在 packaging 阶段会长时间卡死（未解），而审核只需要
// 一个能启动、连正式后端、独立 profile、不参与自更新的窗口。
// 目录结构：ESF平台-审核版\ESF 平台.exe + resources\app\（未打包成 asar，改完源码可再看）。

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const target = path.join(os.homedir(), 'Desktop', 'ESF平台-审核版');
const electronDist = path.join(pkgRoot, 'node_modules', 'electron', 'dist');

const APP_FILES = [
  'main.cjs',
  'preload.js',
  'api.cjs',
  'store.cjs',
  'launcher-core.cjs',
  'package.json',
  'build/icon.ico'
];

// 只带运行期依赖，不把 vite / electron-builder 拷进审核版。
const APP_MODULES = [
  'electron-updater',
  'builder-util-runtime',
  'goldsrc-query',
  'react',
  'react-dom',
  'scheduler',
  'fs-extra',
  'js-yaml',
  'lazy-val',
  'lodash.escaperegexp',
  'lodash.isequal',
  'semver',
  'tiny-typed-emitter',
  'debug',
  'sax',
  'graceful-fs',
  'jsonfile',
  'universalify',
  'argparse',
  'ms',
  'lodash.get',
  'lodash.union'
];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: pkgRoot, stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' failed with ' + r.status);
}

function copyInto(src, dest) {
  if (!fs.existsSync(src)) {
    console.log('  ! skip missing ' + path.relative(pkgRoot, src));
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

console.log('[1/5] vite build');
run('npm run build');

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  throw new Error('missing electron.exe in ' + electronDist);
}

console.log('[2/5] clean ' + target);
if (!target.includes('ESF')) throw new Error('refuse to delete unexpected path: ' + target);
if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });

console.log('[3/5] copy electron runtime');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(electronDist, target, { recursive: true, dereference: false });
fs.rmSync(path.join(target, 'resources', 'default_app.asar'), { force: true });

const exe = path.join(target, 'ESF 平台.exe');
fs.renameSync(path.join(target, 'electron.exe'), exe);

console.log('[4/5] stage app sources + runtime deps');
const appDir = path.join(target, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const rel of APP_FILES) copyInto(path.join(pkgRoot, rel), path.join(appDir, rel));
copyInto(path.join(pkgRoot, 'dist'), path.join(appDir, 'dist'));
for (const mod of APP_MODULES) {
  copyInto(path.join(pkgRoot, 'node_modules', mod), path.join(appDir, 'node_modules', mod));
}
// electron-updater 的依赖在它自己的 node_modules 里，整包已经带上了。

console.log('[5/5] desktop shortcut (--review-build)');
const lnk = path.join(os.homedir(), 'Desktop', 'ESF 平台 - 审核版.lnk');
const ps = [
  '$s=(New-Object -ComObject WScript.Shell).CreateShortcut(' + JSON.stringify(lnk) + ');',
  '$s.TargetPath=' + JSON.stringify(exe) + ';',
  '$s.Arguments="--review-build";',
  '$s.WorkingDirectory=' + JSON.stringify(target) + ';',
  '$s.IconLocation=' + JSON.stringify(path.join(appDir, 'build', 'icon.ico') + ',0') + ';',
  '$s.Description="ESF Platform review build";',
  '$s.Save();'
].join(' ');
const enc = Buffer.from(ps, 'utf16le').toString('base64');
run('powershell', ['-NoProfile', '-EncodedCommand', enc]);

function dirSize(dir) {
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) bytes += dirSize(p);
    else if (e.isFile()) bytes += fs.statSync(p).size;
  }
  return bytes;
}

console.log('');
console.log('DONE');
console.log('  folder  : ' + target);
console.log('  exe     : ' + exe + ' --review-build');
console.log('  shortcut: ' + lnk);
console.log('  size    : ' + Math.round(dirSize(target) / 1048576) + ' MB');
