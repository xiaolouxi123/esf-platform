'use strict';

/**
 * ESF 启动器 —— 纯 Node 逻辑层
 *
 * 这里刻意不 require('electron')，所有函数都是可单测的纯逻辑，
 * main.cjs 只负责 IPC 和窗口，方便排查「连服失败」这类问题。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ================= 常量 =================
const CFG_NAME = 'launcher.cfg';
const LOG_NAME = 'esf_launcher.log';
const MAX_LOG_BYTES = 256 * 1024;

const PLATFORM_TOKEN_KEY = '_platform_token';
const PLATFORM_USER_KEY = '_platform_user';

/**
 * 匹配残留在 config.cfg / autoexec.cfg 里的平台字段。
 * 关键点：GoldSrc 退出时会把自定义 setinfo 写回 config.cfg，
 * 下次启动又会在 `exec config.cfg` 时把它们塞回 userinfo，
 * 从而把启动器刚写进去的新 Token 覆盖成上一次的旧值。
 */
const STALE_PLATFORM_RE = /^\s*setinfo\s+"?(?:_platform_token|_platform_user)\b/i;

// 会覆盖 userinfo 的配置文件的检查顺序
const STALE_SCAN_FILES = ['config.cfg', 'autoexec.cfg', 'userconfig.cfg'];

// 整合包根目录下不当作模组的特殊文件夹
const NON_MOD_DIRS = new Set([
  'valve', 'platform', 'bin', 'steamapps', 'common', 'config',
  'captionmod', 'resource', 'sound', 'media', 'maps', 'addons',
]);

// ================= Token / 字段清洗 =================

/** 生成 22 位 URL 安全的随机 Token（不含引号、反斜杠等会破坏 info 串的字符） */
function createToken() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * 清洗要写进 userinfo 的字符串。
 *
 * GoldSrc 的 userinfo 是 "key\\value\\key\\value" 结构：
 *  - 双引号会把 setinfo 指令截断
 *  - 反斜杠本身就是分隔符，必须去掉
 *  - 分号 / 换行可以在 cfg 里注入新指令
 */
function sanitizeInfoValue(value, fallback = '') {
  const cleaned = String(value === null || value === undefined ? '' : value)
    .replace(/["\\;]/g, '')
    .replace(/\/\//g, '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, 32);
  return cleaned || fallback;
}

/** 地图名只做防注入处理：地图文件名允许中文、下划线、短横线等 */
function sanitizeMapName(map) {
  const cleaned = String(map === null || map === undefined ? '' : map)
    .replace(/["\\;\r\n\t]/g, '')
    .replace(/\/\//g, '')
    .trim();
  // 带空格的名字无法作为命令行参数安全传递
  return /\s/.test(cleaned) ? '' : cleaned;
}

// ================= launcher.cfg =================

/**
 * 生成 launcher.cfg 内容：**只放 setinfo**。
 *
 * 原来的实现把 `connect` 写在 cfg 里再 `+exec`，连接指令在客户端
 * 还没初始化完时就被执行，容易被丢掉；改为命令行 `+connect` 更可靠。
 */
function buildLauncherCfg(token, username) {
  return [
    '// 本文件由 ESF 启动器自动生成，每次启动都会覆盖',
    `setinfo "${PLATFORM_TOKEN_KEY}" "${token}"`,
    `setinfo "${PLATFORM_USER_KEY}" "${username}"`,
    '',
  ].join('\r\n');
}

function writeLauncherCfg(modDir, token, username) {
  const cfgPath = path.join(modDir, CFG_NAME);
  fs.writeFileSync(cfgPath, buildLauncherCfg(token, username), 'utf8');
  return cfgPath;
}

/**
 * 删掉其它 cfg 里残留的 `_platform_token` / `_platform_user`，
 * 保证「谁最后执行都不会覆盖启动器写的新 Token」。
 *
 * 以 latin1 读写是为了逐字节保留原文件（config.cfg 里可能存着 GBK/UTF-8 的
 * 中文玩家名），我们只删除纯 ASCII 的那两行。
 */
function stripStalePlatformInfo(modDir) {
  const cleaned = [];
  const failed = [];

  for (const name of STALE_SCAN_FILES) {
    const file = path.join(modDir, name);

    let raw;
    try {
      if (!fs.existsSync(file)) continue;
      raw = fs.readFileSync(file, 'latin1');
    } catch (err) {
      failed.push({ name, error: err.message });
      continue;
    }

    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const kept = lines.filter((line) => !STALE_PLATFORM_RE.test(line));

    if (kept.length === lines.length) continue;

    try {
      fs.writeFileSync(file, kept.join(eol), 'latin1');
      cleaned.push(name);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }

  return { cleaned, failed };
}

// ================= 启动参数 =================

/** 启动本地地图：先 exec 应用 Token，再开图；mp_gamemode 2=组队，0=混战 */
function buildLocalArgs(modName, map, mode = 'team') {
  const gameMode = mode === 'deathmatch' ? '0' : '2';
  return [
    '-game',
    modName,
    '+exec',
    CFG_NAME,
    '+map',
    map,
    '+maxplayers',
    '10',
    '+sv_lan',
    '1',
    '+mp_gamemode',
    gameMode,
  ];
}

/**
 * 启动前写入 game.cfg / listenserver.cfg。
 * GoldSrc 退出时会把 mp_gamemode 写回 game.cfg，启动参数会被它覆盖；
 * 只改命令行无法稳定切换模式，必须在拉起 hl.exe 前改文件。
 */
function applyLocalGameMode(modDir, mode = 'team') {
  const value = mode === 'deathmatch' ? '0' : '2';
  const changed = [];
  const files = ['game.cfg', 'listenserver.cfg', 'server.cfg'];

  const setCvar = (text) => {
    let next = text;
    let found = false;
    next = next.replace(/^(\s*"?mp_gamemode"?\s+).*$/im, (line, prefix) => {
      found = true;
      return `${prefix}"${value}"`;
    });
    if (!found) {
      next = `${next.replace(/\s*$/, '')}\r\nmp_gamemode "${value}"\r\n`;
    }
    // AMXX 模式守卫读取这个 cvar；没有插件也不影响游戏
    next = next.replace(/^(\s*"?esf_force_gamemode"?\s+).*$/im, (line, prefix) => {
      return `${prefix}"${value}"`;
    });
    if (!/^\s*"?esf_force_gamemode"?\s+/im.test(next)) {
      next = `${next.replace(/\s*$/, '')}\r\nesf_force_gamemode "${value}"\r\n`;
    }
    return next;
  };

  for (const name of files) {
    const file = path.join(modDir, name);
    if (!fs.existsSync(file)) {
      if (name !== 'game.cfg') continue;
      try {
        fs.writeFileSync(file, `mp_gamemode "${value}"\r\nesf_force_gamemode "${value}"\r\n`, 'latin1');
        changed.push(name);
      } catch {
        /* ignore */
      }
      continue;
    }
    try {
      const text = fs.readFileSync(file, 'latin1');
      const next = setCvar(text);
      if (next !== text) {
        fs.writeFileSync(file, next, 'latin1');
        changed.push(name);
      }
    } catch {
      /* 权限/占用时仍保留命令行参数，不阻塞启动 */
    }
  }

  return { mode: Number(value), changed };
}

/** 一键连服：先 exec 应用 Token，再 connect，顺序不能反 */
function buildJoinArgs(modName, address) {
  return ['-game', modName, '+exec', CFG_NAME, '+connect', address];
}

/** 拼成方便看日志的一行命令 */
function formatCommand(exePath, args) {
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
  return `"${exePath}" ${quoted}`;
}

// ================= 目录识别 =================

/** 部分 FCX 引擎改过主程序名（没有 hl.exe，只有 esf.exe / fcx.exe） */
const GAME_EXE_CANDIDATES = ['hl.exe', 'esf.exe', 'fcx.exe'];

/** 在目录里找游戏主程序（Windows 不区分大小写） */
function findHlExe(root) {
  try {
    const files = fs.readdirSync(root);
    for (const name of GAME_EXE_CANDIDATES) {
      const hit = files.find((f) => f.toLowerCase() === name);
      if (hit) return path.join(root, hit);
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 找模组文件夹：优先 `esf`，否则找带 liblist.gam / maps 里含 .bsp 的目录。
 * 这样整合包把文件夹改名（fcx / esf_fcx ...）也能用，`-game` 不再写死 esf。
 */
function findModDir(root) {
  const esfDir = path.join(root, 'esf');
  if (fs.existsSync(esfDir)) return esfDir;

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return '';
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (NON_MOD_DIRS.has(entry.name.toLowerCase())) continue;

    const dir = path.join(root, entry.name);
    const hasLiblist = fs.existsSync(path.join(dir, 'liblist.gam'));

    let hasMaps = false;
    try {
      const mapsDir = path.join(dir, 'maps');
      hasMaps = fs.existsSync(mapsDir)
        && fs.readdirSync(mapsDir).some((f) => f.toLowerCase().endsWith('.bsp'));
    } catch {
      hasMaps = false;
    }

    if (hasLiblist || hasMaps) {
      candidates.push({ dir, score: (hasLiblist ? 2 : 0) + (hasMaps ? 1 : 0) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].dir : '';
}

// ================= 新引擎（ESF Engine 1.0）=================
// 这类整合包没有 hl.exe，只有 ESF.exe + engine\engine.cfg。
// ESF.exe 是 Steam 启动壳：读 engine.cfg 的 Launcher= 行再 CreateProcess，
// 命令行参数会被它忽略——所以参数必须写进 engine.cfg。

const ENGINE_CFG_REL = path.join('engine', 'engine.cfg');
const ENGINE_CFG_BASE_SUFFIX = '.esf-base';

/** 命中新引擎布局时返回 engine.cfg 的绝对路径，否则空串 */
function detectEngineCfg(exePath) {
  if (!exePath) return '';
  const root = path.dirname(exePath);
  const cfg = path.join(root, ENGINE_CFG_REL);
  if (!fs.existsSync(cfg)) return '';
  if (!fs.existsSync(path.join(root, 'ESF_mp.exe'))) return '';
  return cfg;
}

/**
 * 把启动参数并进 engine.cfg 的 Launcher 行。
 * 首次调用先把原始配置备份成 engine.cfg.esf-base，之后每次都从备份重建，避免参数叠加。
 */
function applyEngineArgs(cfgPath, args) {
  const basePath = cfgPath + ENGINE_CFG_BASE_SUFFIX;
  if (!fs.existsSync(basePath)) {
    fs.copyFileSync(cfgPath, basePath);
  }

  const base = fs.readFileSync(basePath, 'latin1');
  const matched = base.match(/^([ \t]*Launcher[ \t]*=[ \t]*)(.*)$/im);
  if (!matched) throw new Error('engine.cfg 缺少 Launcher= 行');

  let rest = (args || []).slice();
  // Launcher 里已经带 -game <mod>，避免重复
  if (/^-game$/i.test(rest[0] || '')) rest = rest.slice(2);

  const launcher = rest.length ? `${matched[2].trim()} ${rest.join(' ')}`.trim() : matched[2].trim();
  const next = base.replace(/^([ \t]*Launcher[ \t]*=[ \t]*)(.*)$/im, (line, prefix) => `${prefix}${launcher}`);

  fs.writeFileSync(cfgPath, next, 'latin1');
  return { cfgPath, launcher };
}

/** 退出时把 engine.cfg 还原成备份内容（备份保留，下次启动仍从它重建） */
function restoreEngineCfg(cfgPath) {
  const basePath = cfgPath + ENGINE_CFG_BASE_SUFFIX;
  if (!cfgPath || !fs.existsSync(basePath)) return false;
  try {
    fs.copyFileSync(basePath, cfgPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 根据用户选中的目录推断 hl.exe 与模组目录。
 * 兼容两种情况：选中整合包根目录、或直接选中了模组文件夹。
 */
function resolveGameFiles(selectedDir) {
  const root = path.resolve(selectedDir);

  const hlPath = findHlExe(root);
  if (hlPath) {
    return { hlPath, modDir: findModDir(root), root };
  }

  // 用户可能选到了 esf 模组文件夹，往上一级找 hl.exe
  const parent = path.resolve(root, '..');
  const parentHl = findHlExe(parent);
  if (parentHl) {
    return { hlPath: parentHl, modDir: root, root: parent };
  }

  return { hlPath: '', modDir: '', root };
}

// ================= 自动寻找游戏目录 =================

/**
 * 社区分发的整合包形态：启动器和游戏主程序（hl.exe / esf.exe / fcx.exe）在同一个文件夹，
 * 或者文件夹名里带 FCX。Steam 正版库在本平台没有使用场景，所以不把 Steam 当线索。
 *
 * 搜索顺序（命中即返回）：
 *   1. 启动器自己所在目录 / 上一级 / 附近的子目录 —— 整包最常见的形态
 *   2. 外部线索（注册表卸载记录里登记的安装位置）
 *   3. 各盘目录名带关键字的文件夹（FCX），深度不超过 3
 *   4. 各盘根目录下常见的整合包名字（Half-Life / 半条命 / CS1.6\Half-Life ...）
 *   5. 各盘一、二级目录兜底（只看有没有游戏主程序）
 * 全程有预算（验证目录数 / 读取目录数 / 时间），最坏几秒内返回，绝不卡住启动器。
 */
const DIR_KEYWORDS = ['fcx'];

/** 各盘根目录下常见的整合包放置位置（老玩家手动整理过的目录） */
const DRIVE_SUBDIR_HINTS = [
  'Half-Life',
  'hl',
  '半条命',
  'CS1.6',
  'cs1.6',
  'CS1.6\\Half-Life',
  'Half-Life\\Half-Life',
  'Games\\Half-Life',
  'Games\\CS1.6',
  '游戏\\Half-Life',
  '游戏\\半条命',
  'ESF\\Half-Life',
  'Program Files\\Half-Life',
  'Program Files (x86)\\Half-Life',
];

/** 扫描时永远不进入的系统目录 */
const SKIP_SCAN_DIRS = new Set([
  'windows', '$recycle.bin', 'system volume information', 'programdata', 'users',
  'perflogs', 'recovery', 'intel', 'amd', 'nvidia', 'msocache', 'node_modules',
  'appdata', 'onedrive', 'temp',
]);

/** 列出子目录名（读不到就当空目录，自动寻找不能因为权限问题炸掉） */
function subDirNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function matchDirKeyword(name, keywords) {
  const low = String(name || '').toLowerCase();
  return keywords.some((keyword) => low.includes(keyword));
}

/** 启动器周围最可能的几个目录：自己、上一级、自己和上一级的直接子目录 */
function launcherNearbyDirs(launcherDir) {
  if (!launcherDir) return [];
  const self = path.resolve(launcherDir);
  const parent = path.resolve(self, '..');
  const out = [self, parent];
  for (const name of subDirNames(self)) out.push(path.join(self, name));
  for (const name of subDirNames(parent)) {
    if (SKIP_SCAN_DIRS.has(name.toLowerCase())) continue;
    out.push(path.join(parent, name));
  }
  return out;
}

/** 各盘常见整合包名字（不含 Steam） */
function commonGameDirs({ env = {}, drives = [] } = {}) {
  const out = [];
  for (const drive of drives) {
    for (const sub of DRIVE_SUBDIR_HINTS) out.push(path.join(drive + '\\', sub));
  }
  const programFiles = [env['ProgramFiles(x86)'], env.ProgramFiles, env.ProgramW6432].filter(Boolean);
  for (const base of programFiles) {
    out.push(path.join(base, 'Half-Life'));
    out.push(path.join(base, 'CS1.6', 'Half-Life'));
  }
  return out;
}

/**
 * 平铺后的候选顺序（调试与单测用）。关键字目录需要现场扫描，不在这里展开。
 */
function gameDirCandidates({ env = {}, extraDirs = [], drives = [], launcherDir = '' } = {}) {
  const list = [];
  const seen = new Set();
  const push = (dir) => {
    if (!dir || typeof dir !== 'string') return;
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (!trimmed) return;
    const key = path.resolve(trimmed).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(path.resolve(trimmed));
  };

  launcherNearbyDirs(launcherDir).forEach(push);
  extraDirs.forEach(push);
  commonGameDirs({ env, drives }).forEach(push);
  return list;
}

function detectGameDir({
  env = {},
  extraDirs = [],
  drives = [],
  launcherDir = '',
  budgetMs = 6000,
  maxScans = 800,
  maxDirReads = 2500,
} = {}) {
  const deadline = Date.now() + budgetMs;
  let scans = 0;
  let dirReads = 0;
  let searched = 0;
  let hlOnly = null;

  const overBudget = () => scans >= maxScans || dirReads >= maxDirReads || Date.now() > deadline;

  const scan = (dir) => {
    if (dirReads >= maxDirReads || Date.now() > deadline) return [];
    dirReads += 1;
    return subDirNames(dir);
  };

  const tryDir = (dir) => {
    if (!dir || overBudget()) return null;
    scans += 1;
    searched += 1;
    const found = resolveGameFiles(dir);
    if (found.hlPath && found.modDir) return { ...found, searched, scans };
    if (found.hlPath && !hlOnly) hlOnly = { ...found, searched, scans };
    return null;
  };

  // 1. 启动器周围：整包解压后启动器就在 hl.exe 旁边，这一步通常直接命中
  const nearby = launcherNearbyDirs(launcherDir);
  for (const dir of nearby) {
    const hit = tryDir(dir);
    if (hit) return hit;
  }

  // 2. 外部线索（注册表登记的安装位置）
  for (const dir of extraDirs) {
    const hit = tryDir(dir);
    if (hit) return hit;
  }

  // 3. 目录名带 FCX 的文件夹：逐盘广度优先，深度 3
  if (drives.length > 0) {
    for (const drive of drives) {
      if (overBudget()) break;
      const root = drive.endsWith('\\') ? drive : drive + '\\';
      const queue = scan(root)
        .filter((name) => !SKIP_SCAN_DIRS.has(name.toLowerCase()))
        .filter((name) => !name.toLowerCase().startsWith('program files'))
        .map((name) => ({ dir: path.join(root, name), depth: 1 }));

      while (queue.length > 0 && !overBudget()) {
        const item = queue.shift();
        if (matchDirKeyword(path.basename(item.dir), DIR_KEYWORDS)) {
          const hit = tryDir(item.dir);
          if (hit) return hit;
        }
        if (item.depth >= 3) continue;
        for (const name of scan(item.dir)) {
          if (SKIP_SCAN_DIRS.has(name.toLowerCase())) continue;
          queue.push({ dir: path.join(item.dir, name), depth: item.depth + 1 });
        }
      }
    }
  }

  // 4. 常见整合包名字
  for (const dir of commonGameDirs({ env, drives })) {
    const hit = tryDir(dir);
    if (hit) return hit;
  }

  // 5. 各盘一、二级目录兜底
  for (const drive of drives) {
    if (overBudget()) break;
    const root = drive.endsWith('\\') ? drive : drive + '\\';
    for (const top of scan(root)) {
      if (overBudget()) break;
      const low = top.toLowerCase();
      if (SKIP_SCAN_DIRS.has(low) || low.startsWith('program files')) continue;
      const topDir = path.join(root, top);
      const topHit = tryDir(topDir);
      if (topHit) return topHit;
      for (const sub of scan(topDir)) {
        const hit = tryDir(path.join(topDir, sub));
        if (hit) return hit;
      }
    }
  }

  return hlOnly;
}

// ================= 资源落地 =================

/**
 * 把资源库里的 targetPath 解析成模组目录内的绝对路径。
 *
 * 这是防止"模型作者把文件写到 C:\ 或 ..\..\" 的最后一道闸：
 * 后端已经校验过一次，但客户端写入磁盘前必须再校验一次（纵深防御）。
 */
function resolveInstallPath(modDir, targetPath) {
  const normalized = String(targetPath || '')
    .replace(/\\/g, '/')
    .trim();

  if (!normalized) throw new Error('资源落地路径为空');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('资源落地路径必须是相对模组目录的路径');
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('资源落地路径不能包含 ..');
  }

  const root = path.resolve(modDir);
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('资源落地路径越界');
  }

  return { relative: normalized, absolute };
}

// ================= 日志 =================

/** 追加一行日志到模组目录（超过 256KB 自动清空），写失败静默忽略 */
function appendLog(modDir, line) {
  if (!modDir) return;
  try {
    const logPath = path.join(modDir, LOG_NAME);
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.writeFileSync(logPath, '');
    }
    fs.appendFileSync(logPath, line + '\r\n', 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

// ================= 就地更新 =================

/**
 * 生成「等启动器退出 → 静默覆盖安装到当前目录 → 重新打开」的 PowerShell 脚本。
 *
 * 为什么不直接用 electron-updater 的 quitAndInstall：绿色整合包没有安装记录，
 * NSIS 会装到 %LOCALAPPDATA%\Programs，启动器所在目录永远不更新。
 * 为什么不把 /D 交给 Node spawn：NSIS 规定 /D= 必须是最后一个参数且不能带引号，
 * 而 Node 会给含空格的参数自动加引号，安装器就忽略 /D 装回默认目录。脚本里改用
 * ProcessStartInfo.Arguments 原样拼命令行，路径里的空格不会被加引号。
 */
function buildApplyUpdateScript({ installer, appDir, exeName, pid }) {
  const psString = (value) => `'${String(value == null ? '' : value).replace(/'/g, "''")}'`;
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$targetPid = ${Number(pid) || 0}`,
    `$appDir = ${psString(appDir)}`,
    `$exeName = ${psString(exeName)}`,
    `$installer = ${psString(installer)}`,
    "$log = Join-Path $env:TEMP 'esf-update-apply.log'",
    'function Write-EsfLog($msg) { Add-Content -LiteralPath $log -Value ("[{0}] {1}" -f (Get-Date -Format \'s\'), $msg) -Encoding UTF8 }',
    'Write-EsfLog "wait launcher exit pid=$targetPid"',
    'while ($targetPid -gt 0 -and (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 700 }',
    'Write-EsfLog "install $installer -> $appDir"',
    '$psi = New-Object System.Diagnostics.ProcessStartInfo',
    '$psi.FileName = $installer',
    '$psi.Arguments = "/S /D=" + $appDir',
    '$psi.UseShellExecute = $false',
    '$psi.WorkingDirectory = $env:TEMP',
    'try {',
    '  $proc = [System.Diagnostics.Process]::Start($psi)',
    '  $proc.WaitForExit()',
    '  Write-EsfLog "installer exit $($proc.ExitCode)"',
    '} catch { Write-EsfLog ("install failed: " + $_.Exception.Message) }',
    'Start-Sleep -Seconds 1',
    'try {',
    '  $exePath = Join-Path $appDir $exeName',
    '  if (Test-Path -LiteralPath $exePath) {',
    '    $running = Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($exeName)) -ErrorAction SilentlyContinue',
    '    if (-not $running) { Write-EsfLog "relaunch $exePath"; Start-Process -FilePath $exePath }',
    '  }',
    '} catch { Write-EsfLog ("relaunch failed: " + $_.Exception.Message) }',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  ];
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  CFG_NAME,
  LOG_NAME,
  createToken,
  sanitizeInfoValue,
  sanitizeMapName,
  buildLauncherCfg,
  writeLauncherCfg,
  stripStalePlatformInfo,
  buildLocalArgs,
  applyLocalGameMode,
  buildJoinArgs,
  formatCommand,
  resolveInstallPath,
  findHlExe,
  findModDir,
  resolveGameFiles,
  gameDirCandidates,
  detectGameDir,
  detectEngineCfg,
  applyEngineArgs,
  restoreEngineCfg,
  appendLog,
  buildApplyUpdateScript,
};
