const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage } = require('electron');
const path = require('path');

// 测试版必须在 Chromium 启动前切走 userData，否则 localStorage 里的正式账号
// 仍会被测试版读到（仅切 settings/session 文件不够）。
// 审核版（桌面试用包）与开发测试共用隔离 profile，但审核版连正式后端并把更新关掉，
// 避免绿色包被当成正式安装去自更新。
const IS_REVIEW_BUILD = process.argv.includes('--review-build') || process.env.ESF_REVIEW_BUILD === '1';
const IS_TEST_PROFILE = process.argv.includes('--test-profile') || IS_REVIEW_BUILD;
if (IS_TEST_PROFILE) {
  const testUserData = path.join(app.getPath('appData'), IS_REVIEW_BUILD ? 'esf-launcher-review' : 'esf-launcher-test');
  app.setPath('userData', testUserData);
  app.commandLine.appendSwitch('user-data-dir', testUserData);
}

const fs = require('fs');
const fsp = require('fs/promises');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const core = require('./launcher-core.cjs');
const archive = require('./archive.cjs');
const store = require('./store.cjs');
const api = require('./api.cjs');
const { autoUpdater } = require('electron-updater');
const { CancellationToken } = require('builder-util-runtime');

// ================= 全局状态 =================
let mainWindow = null;
let tray = null;
let gameWatcher = null;
let hiddenForGame = false;
let quitting = false;
let settings = null;
let session = null;
// 最近一次连的是哪台服，用于在线状态里显示"在哪个服玩"
let lastServerKey = '';

function log(...args) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${args.join(' ')}`;
  console.log(line);
  core.appendLog(settings && settings.esfModDir, line);
}

function maskToken(token) {
  const value = String(token || '');
  return value ? `${value.slice(0, 6)}…` : '';
}

// ================= 自动更新（electron-updater） =================
let updateState = { status: 'idle' };
let lastDownloadProgress = { total: 0 };
let updateToken = null;
let updateCancelled = false;

function updateLog(...args) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'update.log'),
      `[${new Date().toISOString()}] ${args.join(' ')}\n`
    );
  } catch {
    /* ignore */
  }
}

function sendUpdate(patch) {
  updateState = { ...updateState, ...patch };
  updateLog('STATE', JSON.stringify(updateState));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', updateState);
  }
}

function localFeedUrl() {
  return String(process.env.ESF_UPDATE_URL || getSettings().updateFeedUrl || '').trim();
}

// 官方更新源不依赖自有服务器；即使 API 暂时不可用也能从 GitHub 检查更新
const DEFAULT_UPDATE_FEED = 'https://github.com/xiaolouxi123/esf-platform/releases/latest/download/';

/** 本地没配就向后端要（服务器可以统一下发更新源） */
async function resolveFeedUrl() {
  const local = localFeedUrl();
  if (local) return local;
  try {
    const config = await api.config(getSettings());
    return String(config.updateFeedUrl || '').trim() || DEFAULT_UPDATE_FEED;
  } catch {
    return DEFAULT_UPDATE_FEED;
  }
}

function startUpdateDownload(version) {
  if (updateToken) return;
  updateCancelled = false;
  updateToken = new CancellationToken();
  sendUpdate({ status: 'downloading', version: version || updateState.version || '', percent: 0, transferred: 0, total: 0 });

  autoUpdater
    .downloadUpdate(updateToken)
    .then(() => {
      if (updateCancelled) {
        sendUpdate({ status: 'paused', version: version || updateState.version || '' });
      }
    })
    .catch((err) => {
      if (updateCancelled) {
        sendUpdate({ status: 'paused', version: version || updateState.version || '' });
      } else {
        sendUpdate({ status: 'error', message: err.message });
      }
    })
    .finally(() => {
      updateToken = null;
    });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  // 关掉「退出时自动装」：绿色整合包里那样会被 NSIS 装到 %LOCALAPPDATA%\Programs，
  // 老目录永不更新。改为用户点「立即重启安装」时走 applyUpdateInPlace() 就地覆盖。
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (...args) => updateLog('INFO', ...args),
    warn: (...args) => updateLog('WARN', ...args),
    error: (...args) => updateLog('ERROR', ...args),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ status: 'available', version: info && info.version });
    setTimeout(() => startUpdateDownload(info && info.version), 300);
  });
  autoUpdater.on('update-not-available', (info) =>
    sendUpdate({ status: 'current', version: info && info.version })
  );
  autoUpdater.on('download-progress', (progress) => {
    const total = Number(progress.total) || 0;
    if (total > 0 && total !== lastDownloadProgress.total) {
      lastDownloadProgress = { total };
      updateLog('INFO', `开始下载更新: 需下载=${total} 字节`);
    }
    sendUpdate({
      status: 'downloading',
      percent: Math.round(Number(progress.percent) || 0),
      transferred: Number(progress.transferred) || 0,
      total,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateToken = null;
    try {
      const file = info && info.downloadedFile ? String(info.downloadedFile) : '';
      const size = file && fs.existsSync(file) ? fs.statSync(file).size : 0;
      const downloaded = lastDownloadProgress.total || 0;
      const mode = size > 0 && downloaded > 0 && downloaded < size * 0.95 ? '差量' : '全量';
      updateLog(
        'INFO',
        `更新已下载 ${(info && info.version) || ''} 方式=${mode} 下载=${downloaded} 安装包=${size}`
      );
    } catch (err) {
      updateLog('WARN', '记录更新下载方式失败:', err.message);
    }
    sendUpdate({
      status: 'downloaded',
      version: info && info.version,
      // 缓存里的安装包绝对路径，就地更新脚本要用
      downloadedFile: info && info.downloadedFile ? String(info.downloadedFile) : '',
    });
  });
  autoUpdater.on('error', (err) => {
    if (updateCancelled) {
      sendUpdate({ status: 'paused', message: '下载已暂停' });
    } else {
      sendUpdate({ status: 'error', message: err.message });
    }
  });
}

function updaterCacheDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('appData'), '..', 'Local');
  return path.join(localAppData, `${app.getName()}-updater`);
}

function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 更新包已经下好却没装上（旧版本「立即重启安装」静默失败，或用户中途退出），
 * 下次启动直接把它捞回来：界面显示「立即重启安装」，不用再等 128MB 重下。
 */
function pendingUpdateOnDisk() {
  try {
    const dir = path.join(updaterCacheDir(), 'pending');
    if (!fs.existsSync(dir)) return null;
    const current = app.getVersion();
    let best = null;
    for (const name of fs.readdirSync(dir)) {
      const match = /^ESF-Platform-Setup-(\d+(?:\.\d+)+)\.exe$/.exec(name);
      if (!match) continue;
      const version = match[1];
      if (compareVersions(version, current) <= 0) continue;
      if (!best || compareVersions(version, best.version) > 0) {
        best = { version, file: path.join(dir, name) };
      }
    }
    return best;
  } catch (err) {
    updateLog('WARN', '扫描已下载更新失败:', err.message);
    return null;
  }
}

/**
 * 差量下载用 current.blockmap 描述旧安装包；如果它和 installer.exe 不是同一个版本，
 * 更新器会拼出坏文件、sha512 校验失败，然后中途退回全量下载（用户看到进度倒退）。
 * 这里做一次轻量一致性校验：blockmap 覆盖的总字节数必须等于 installer.exe 的大小。
 */
function sanitizeUpdaterCache() {
  try {
    const dir = updaterCacheDir();
    const blockMapPath = path.join(dir, 'current.blockmap');
    const installerPath = path.join(dir, 'installer.exe');
    if (!fs.existsSync(blockMapPath) || !fs.existsSync(installerPath)) return;

    const plain = zlib.gunzipSync(fs.readFileSync(blockMapPath)).toString('utf8');
    const data = JSON.parse(plain);
    const file = Array.isArray(data.files) ? data.files[0] : null;
    const total = Array.isArray(file?.sizes)
      ? file.sizes.reduce((sum, size) => sum + Number(size || 0), 0)
      : 0;
    const actual = fs.statSync(installerPath).size;
    if (total > 0 && total !== actual) {
      // 不直接删：留 .bak 方便事后核对，blockmap 缺失时更新器会自己重新拉取
      try {
        fs.renameSync(blockMapPath, `${blockMapPath}.bak`);
      } catch {
        fs.rmSync(blockMapPath, { force: true });
      }
      updateLog('WARN', `更新缓存错位已清理: blockmap=${total} installer=${actual}`);
    }
  } catch (err) {
    updateLog('WARN', '更新缓存校验跳过:', err.message);
  }
}

/**
 * 就地更新：绿色整合包（启动器和 FCX 游戏在同一个文件夹、没有安装记录）走
 * electron-updater 自带的 quitAndInstall 会被 NSIS 装到 %LOCALAPPDATA%\Programs，
 * 老目录永远不更新，玩家等于装了两份。这里自己拉起安装器，用 /S + /D=<当前目录>
 * 静默覆盖到启动器所在目录——安装器自定义脚本（build/installer.nsh）只删启动器
 * 自己的文件，游戏本体不会被碰。
 *
 * NSIS 规定 /D= 必须是最后一个参数且不能带引号（哪怕路径有空格），Node 的 spawn
 * 会自动加引号，所以只能写一个 PowerShell 脚本、用进程参数原文传命令行。
 */
function isWritableDir(dir) {
  try {
    const probe = path.join(dir, `.esf-write-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function writeApplyUpdateScript() {
  const installer = String(updateState.downloadedFile || '');
  if (!installer || !fs.existsSync(installer)) throw new Error('更新包已被清理，请重新检查更新');
  const appDir = path.dirname(app.getPath('exe'));
  const exeName = path.basename(app.getPath('exe'));
  if (!isWritableDir(appDir)) throw new Error(`没有写入权限：${appDir}`);

  const dir = path.join(app.getPath('temp'), `esf-update-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'apply-update.ps1');
  const readyPath = path.join(dir, 'ready.txt');
  // 脚本正文在 launcher-core 里生成，方便单测（含 /D= 不能加引号的说明）
  const body = core.buildApplyUpdateScript({
    installer,
    appDir,
    exeName,
    pid: process.pid,
    readyFile: readyPath,
  });
  // PowerShell 5.1 读无 BOM 的 UTF-8 会按 ANSI 解析，中文路径会变乱码
  fs.writeFileSync(scriptPath, `\ufeff${body}`, 'utf8');
  return { scriptPath, readyPath };
}

async function applyUpdateInPlace() {
  const { scriptPath, readyPath } = writeApplyUpdateScript();
  updateLog('INFO', `就地更新脚本: ${scriptPath}`);
  // 不能给 powershell 设 detached:true：本机实测带 DETACHED_PROCESS 的 powershell 会立刻死掉，
  // 更新静默丢失。改成 cmd /c start /b 分离，再等脚本写出 ready 标记后才退出启动器。
  const cmdLine = ['/c', 'start', '""', '/b', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath];
  const child = spawn('cmd.exe', cmdLine, { stdio: 'ignore', windowsHide: true });
  const spawnError = await new Promise((resolve) => {
    child.once('error', (err) => resolve(err));
    child.once('spawn', () => resolve(null));
    setTimeout(() => resolve(null), 1000);
  });
  if (spawnError) throw new Error(`更新启动失败：${spawnError.message}`);

  for (let i = 0; i < 40; i += 1) {
    if (fs.existsSync(readyPath)) {
      updateLog('INFO', '更新脚本已接管，准备退出启动器');
      setTimeout(() => {
        quitting = true;
        app.quit();
      }, 300);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('更新脚本没有启动起来，请手动下载安装包');
}

async function autoCheckOnce() {
  // 审核版不参与自更新：它没有安装记录，就地覆盖会写坏正在审核的目录。
  if (IS_REVIEW_BUILD) return null;
  const feed = await resolveFeedUrl();
  if (!feed) return null;

  // 已经下好但没装成功的更新包优先复用，避免重复全量下载
  const pending = pendingUpdateOnDisk();
  if (pending) {
    updateLog('INFO', `复用已下载的更新包: ${pending.version} ${pending.file}`);
    sendUpdate({ status: 'downloaded', version: pending.version, downloadedFile: pending.file, feed });
    return updateState;
  }

  sanitizeUpdaterCache();
  autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  sendUpdate({ status: 'checking', feed });
  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (err) {
    sendUpdate({ status: 'error', message: err.message });
    return updateState;
  }
}

function getSettings() {
  if (!settings) settings = store.loadSettings();
  return settings;
}

function getSession() {
  if (!session) session = store.loadSession();
  return session;
}

function modName() {
  const dir = getSettings().esfModDir;
  return dir ? path.basename(dir) : '';
}

function requireToken() {
  const current = getSession();
  if (!current || !current.token) {
    throw new api.ApiError('登录已过期，请重新登录', 'AUTH_REQUIRED', 401);
  }
  return current.token;
}

/** 管理台只对运营/管理员/所有者开放（后端还会再校验一次） */
function requireStaff() {
  const current = getSession();
  const role = current && current.user && current.user.role;
  if (!['ops', 'admin', 'owner'].includes(role)) {
    throw new api.ApiError('没有权限执行该操作', 'FORBIDDEN', 403);
  }
  return role;
}

/** 管理员及以上：改角色、看审计、开发者工具 */
function requireAdminRole() {
  const role = requireStaff();
  if (!['admin', 'owner'].includes(role)) {
    throw new api.ApiError('只有管理员可以执行该操作', 'FORBIDDEN', 403);
  }
  return role;
}

/** 所有者专属：转让所有权 */
function requireOwner() {
  const role = requireStaff();
  if (role !== 'owner') {
    throw new api.ApiError('只有所有者可以转让所有权', 'FORBIDDEN', 403);
  }
  return role;
}

/** 已知的游戏进程名：整合包常见壳是 hl.exe，真正跑起来的可能是 no_hl.exe 等 */
const GAME_IMAGE_NAMES = ['hl.exe', 'no_hl.exe', 'esf.exe', 'esf_mp.exe', 'fcx.exe', 'engine.dll'];
/** 启动时从壳进程的子进程里学到的真实游戏进程名 */
const learnedGameNames = new Set();
/** 启动器自己拉起的进程（壳 + 可能是真游戏），关闭时优先精确杀 */
const spawnedGamePids = new Set();

/** 游戏进程是否在跑（在线状态用它区分"大厅"和"游戏中"） */
/** 游戏进程名：内置常见名 + 壳进程的子进程 + 设置里选的主程序名 */
function gameProcessNames() {
  const names = new Set(GAME_IMAGE_NAMES);
  for (const name of learnedGameNames) names.add(name);
  try {
    const exe = path.basename(getSettings().hlPath || '').toLowerCase();
    if (exe) names.add(exe);
  } catch {
    /* settings 未初始化时只认内置名单 */
  }
  return names;
}

/**
 * 壳进程（hl.exe）会丢弃参数再拉起真正的游戏进程（如 no_hl.exe）。
 * 启动几秒后查一次子进程，把真实进程名记下来，后续 isGameRunning / 关闭才能命中。
 */
function learnGameProcesses(parentPid) {
  try {
    const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(parentPid)}" | Select-Object -ExpandProperty Name`;
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    let learned = false;
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const name = line.trim().toLowerCase();
      if (!name.endsWith('.exe')) continue;
      if (learnedGameNames.has(name)) continue;
      learnedGameNames.add(name);
      learned = true;
    }
    if (learned) log('🧩 识别到游戏进程名:', [...learnedGameNames].join(', '));
  } catch {
    /* 查不到就继续用内置名单 */
  }
}

function listGameProcesses() {
  const names = gameProcessNames();
  try {
    const result = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const processes = [];
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const matched = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (!matched) continue;
      const image = matched[1].toLowerCase();
      if (names.has(image)) processes.push({ image: matched[1], pid: Number(matched[2]) });
    }
    return processes;
  } catch {
    return [];
  }
}

function isGameRunning() {
  return listGameProcesses().length > 0;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 关游戏/切服前先结束 hl.exe / no_hl.exe（或整合包改名的客户端） */
async function stopGameForSwitch() {
  const processes = listGameProcesses();
  const pids = new Set(processes.map((process) => process.pid));
  // 启动器自己拉起的进程（含已退出但句柄还在的壳）也一并清掉
  for (const pid of spawnedGamePids) {
    try {
      process.kill(pid, 0);
      pids.add(pid);
    } catch {
      spawnedGamePids.delete(pid);
    }
  }
  if (pids.size === 0 && !isGameRunning()) return false;

  log(`🛑 强杀游戏进程: ${[...pids].join(', ')}`);
  // 先杀壳（hl.exe）的整棵进程树，避免子进程被杀后壳又把它拉起来。
  const ordered = [...pids].sort((a, b) => {
    const imageA = String((processes.find((p) => p.pid === a) || {}).image || '').toLowerCase();
    const imageB = String((processes.find((p) => p.pid === b) || {}).image || '').toLowerCase();
    const shellA = imageA === 'hl.exe' ? 0 : 1;
    const shellB = imageB === 'hl.exe' ? 0 : 1;
    return shellA - shellB;
  });
  for (const pid of ordered) {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], {
        windowsHide: true,
        timeout: 5000,
      });
    } catch {
      /* 继续用下面的兜底 */
    }
  }

  for (let i = 0; i < 25; i++) {
    await wait(200);
    if (!isGameRunning()) {
      spawnedGamePids.clear();
      return true;
    }
  }

  throw new api.ApiError(
    '检测到游戏进程仍在运行，平台无法自动关闭。请手动退出游戏后再试。',
    'GAME_STILL_RUNNING'
  );
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  hiddenForGame = false;
  tray?.setToolTip('ESF 平台');
}

function stopGameWatcher() {
  if (gameWatcher) {
    clearInterval(gameWatcher);
    gameWatcher = null;
  }
}

const MATCH_END_FLAG = 'esf_match_end.flag';
const PENDING_RESULT_FILE = 'esf_pending_result.json';

function pendingResultPath() {
  const modDir = settings && settings.esfModDir;
  return modDir ? path.join(modDir, 'addons', 'amxmodx', 'logs', PENDING_RESULT_FILE) : '';
}

let pendingSettleTimer = null;
const PENDING_RETRY_DELAYS = [30000, 120000, 600000];

/** 插件结算落库失败时会把结果写成 JSON；这里补交到平台，带退避重试 */
async function submitPendingResult(attempt = 0) {
  const file = pendingResultPath();
  if (!file || !fs.existsSync(file)) return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    log('❌ 补交结算文件解析失败:', err.message);
    return;
  }
  try {
    const res = await apiCall(api.rankedSettle, getSettings(), requireToken(), payload);
    fs.rmSync(file, { force: true });
    log(`✅ 补交排位结算成功 match=${payload.matchId}${res && res.alreadySettled ? '（平台已结算）' : ''}`);
  } catch (err) {
    if (attempt < PENDING_RETRY_DELAYS.length) {
      const delay = PENDING_RETRY_DELAYS[attempt];
      log(`⚠️ 补交结算失败（${attempt + 1}/${PENDING_RETRY_DELAYS.length}）：${err.message}，${Math.round(delay / 1000)}s 后重试`);
      if (pendingSettleTimer) clearTimeout(pendingSettleTimer);
      pendingSettleTimer = setTimeout(() => submitPendingResult(attempt + 1), delay);
    } else {
      log('❌ 补交结算最终失败，保留文件待下次启动重试');
    }
  }
}


function matchEndFlagPath() {
  const modDir = settings && settings.esfModDir;
  return modDir ? path.join(modDir, 'addons', 'amxmodx', 'logs', MATCH_END_FLAG) : '';
}

function clearMatchEndFlag() {
  const flag = matchEndFlagPath();
  if (!flag) return;
  try {
    fs.rmSync(flag, { force: true });
  } catch {
    /* ignore */
  }
}

/** 游戏启动后收进托盘，等 hl.exe 退出再自动弹回来 */
function hideToTrayForGame() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hiddenForGame = true;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
  tray?.setToolTip('ESF 平台 · 游戏运行中');

  stopGameWatcher();
  const startedAt = Date.now();
  gameWatcher = setInterval(() => {
    if (!hiddenForGame) {
      stopGameWatcher();
      return;
    }
    // 给 hl.exe 一点启动时间，避免刚拉起就误判为已退出
    if (Date.now() - startedAt < 7000) return;

    // 比赛结束标记由 AMXX 插件写入；客户端 quit 被 ESF 拦截，只能由启动器强杀。
    const flag = matchEndFlagPath();
    if (flag && fs.existsSync(flag)) {
      let fresh = false;
      try {
        fresh = fs.statSync(flag).mtimeMs >= startedAt - 2000;
      } catch {
        /* ignore */
      }
      if (fresh) {
        stopGameWatcher();
        log('🏁 检测到比赛结束标记，10 秒后关闭游戏进程');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game:match-end', { seconds: 10 });
        }
        submitPendingResult(0);
        clearMatchEndFlag();
        setTimeout(() => {
          stopGameForSwitch()
            .then((killed) => {
              showMainWindow();
              log(killed ? '🛑 已强制结束游戏进程' : '⚠️ 未找到可结束的游戏进程');
            })
            .catch((err) => {
              showMainWindow();
              log('❌ 强制结束游戏进程失败:', err.message);
            });
        }, 10000);
        return;
      }
    }

    if (!isGameRunning()) {
      stopGameWatcher();
      showMainWindow();
      log('🎮 游戏已退出，平台已恢复');
    }
  }, 2500);
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'build', 'icon.ico');
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('ESF 平台');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示平台', click: showMainWindow },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
  } catch (err) {
    log('⚠️ 托盘创建失败:', err.message);
  }
}

function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => Number(part) || 0);
  const right = String(b).split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 统一处理 401：清掉本地登录态，让界面回到登录页 */
async function apiCall(fn, ...args) {
  try {
    return await fn(...args);
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED' || err.status === 401) {
      store.clearSession();
      session = null;
    }
    throw err;
  }
}

function checkGameDir() {
  const current = getSettings();
  if (!current.hlPath || !current.esfModDir) throw new Error('请先在设置里选择游戏目录');
  if (!fs.existsSync(current.hlPath)) {
    throw new Error(`找不到游戏主程序（hl.exe / esf.exe）：${current.hlPath}`);
  }
  if (!fs.existsSync(current.esfModDir)) throw new Error(`找不到模组目录：${current.esfModDir}`);
  if (!modName()) throw new Error('模组目录不合法');
}

/** 写 Token + 清掉会覆盖它的旧残留 */
function prepareLaunch(token, username) {
  const current = getSettings();
  const safeUser = core.sanitizeInfoValue(username, `Player_${String(token).slice(0, 4)}`);

  core.writeLauncherCfg(current.esfModDir, token, safeUser);
  log(`📝 已写入 launcher.cfg token=${maskToken(token)} user=${safeUser}`);

  const { cleaned, failed } = core.stripStalePlatformInfo(current.esfModDir);
  if (cleaned.length > 0) log('🧹 已清除旧 Token 残留:', cleaned.join(', '));
  for (const item of failed) log(`⚠️ 无法清理 ${item.name}: ${item.error}`);
}

/** 新引擎模式下被改写的 engine.cfg，退出时还原 */
let activeEngineCfg = '';

function spawnGame(args) {
  const current = getSettings();
  const gameDir = path.dirname(current.hlPath);
  clearMatchEndFlag();
  const fullArgs = launchArgsWithCompat(args);

  // 新引擎（ESF Engine 1.0）：ESF.exe 只认 engine.cfg，命令行参数会被丢弃
  let spawnArgs = fullArgs;
  const engineCfg = core.detectEngineCfg(current.hlPath);
  if (engineCfg) {
    try {
      const applied = core.applyEngineArgs(engineCfg, fullArgs);
      activeEngineCfg = engineCfg;
      spawnArgs = [];
      log('🎛 新引擎模式：启动参数已写入 engine.cfg');
      log('   Launcher =', applied.launcher);
    } catch (err) {
      log('⚠️ 写入 engine.cfg 失败，回退为命令行传参:', err.message);
    }
  }

  log('🚀 启动命令:', core.formatCommand(current.hlPath, spawnArgs));
  appendLaunchLog(`launch exe=${current.hlPath} cwd=${gameDir} compat=${!!current.compatMode} args=${JSON.stringify(spawnArgs)}`);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(current.hlPath, spawnArgs, {
        cwd: gameDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (err) {
      appendLaunchLog(`spawn throw: ${err.message}`);
      reject(err);
      return;
    }

    child.once('spawn', () => {
      log(`✅ 已拉起游戏主程序 (pid=${child.pid})`);
      appendLaunchLog(`spawned pid=${child.pid}`);
      spawnedGamePids.add(child.pid);
      // 壳进程通常几秒内拉起真正的游戏进程，认一次名字并持续复用
      for (const delay of [4000, 12000]) {
        const timer = setTimeout(() => learnGameProcesses(child.pid), delay);
        if (typeof timer.unref === 'function') timer.unref();
      }
      child.unref();
      watchGameWindow(gameDir);
      resolve(child.pid);
    });

    child.once('error', (err) => {
      log('❌ 启动游戏主程序失败:', err.message);
      appendLaunchLog(`spawn error: ${err.code || ''} ${err.message}`);
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        reject(new Error(
          `游戏启动失败：没有权限执行 ${path.basename(current.hlPath)}。`
          + '常见原因：文件被杀毒/SmartScreen 拦截、或未解除锁定。'
          + '请右键该 exe → 属性 → 勾选“解除锁定”，或把它加入安全软件白名单后重试。',
        ));
        return;
      }
      reject(new Error(`游戏启动失败：${err.message}`));
    });
  });
}

// ================= 兼容启动（0.5.1） =================
const COMPAT_ARGS = ['-window', '-w', '800', '-h', '600', '-gl', '-heapsize', '262144'];
let noWindowDialogShown = false;

/**
 * 用户显式选择的渲染参数（0.6.2）。
 * auto = 不传，交给游戏内设置；gl/d3d = 强制渲染器；w/h 只传合法尺寸。
 */
function renderArgs(current) {
  const args = [];
  if (current.renderMode === 'gl') args.push('-gl');
  if (current.renderMode === 'd3d') args.push('-d3d');
  const w = Number(current.renderWidth) || 0;
  const h = Number(current.renderHeight) || 0;
  if (w >= 640 && h >= 480) args.push('-w', String(w), '-h', String(h));
  if (current.renderWindowed === true) args.push('-window');
  return args;
}

const DISPLAY_FLAGS = new Set(['-gl', '-d3d', '-soft', '-window', '-fullscreen', '-nomsaa']);
/** 去掉与显式渲染设置冲突的参数（含 -w/-h 的值），避免后者被兼容预设覆盖。 */
function stripDisplayFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '-w' || token === '-h') { i += 1; continue; }
    if (DISPLAY_FLAGS.has(token)) continue;
    out.push(token);
  }
  return out;
}

function launchArgsWithCompat(args) {
  const current = getSettings();
  const explicit = renderArgs(current);
  const base = current.compatMode ? [...args, ...COMPAT_ARGS] : [...args];
  if (explicit.length === 0) return base;
  return [...stripDisplayFlags(base), ...explicit];
}

function launchLogPath() {
  return path.join(app.getPath('userData'), 'launcher.log');
}

function appendLaunchLog(line) {
  try {
    const file = launchLogPath();
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* 日志失败不影响启动 */
  }
}

/** 带重试的启动：失败最多重试 2 次（1.5s / 3s），仍失败才抛错 */
async function spawnGameWithRetry(args) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await spawnGame(args);
    } catch (err) {
      lastError = err;
      appendLaunchLog(`attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await wait(attempt * 1500);
    }
  }
  throw lastError || new Error('游戏启动失败');
}

/** 查当前是否有带主窗口的游戏进程（PowerShell MainWindowHandle） */
function hasGameWindow() {
  const names = [...gameProcessNames()].filter((name) => name.endsWith('.exe'));
  if (names.length === 0) return false;
  const filter = names
    .map((name) => `$_.ProcessName -ieq '${name.replace(/\.exe$/i, '')}'`)
    .join(' -or ');
  const script = `Get-Process -ErrorAction SilentlyContinue | Where-Object { ${filter} } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 -ExpandProperty Id`;
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    return Boolean(String(result.stdout || '').trim());
  } catch {
    return false;
  }
}

/** 拉起后 15s / 25s 各检查一次；进程在但没窗口 → 给出回退与日志入口 */
async function watchGameWindow(gameDir) {
  noWindowDialogShown = false;
  await wait(15000);
  if (!isGameRunning()) {
    appendLaunchLog('no game process 15s after spawn');
    return;
  }
  if (hasGameWindow()) {
    appendLaunchLog('window detected');
    return;
  }
  await wait(10000);
  if (hasGameWindow()) {
    appendLaunchLog('window detected late');
    return;
  }
  appendLaunchLog('process running but no window after 25s');
  showNoWindowDialog(gameDir);
}

function launchDirectNoHl(gameDir) {
  const exe = path.join(gameDir, 'no_hl.exe');
  if (!fs.existsSync(exe)) return false;
  try {
    const child = spawn(exe, launchArgsWithCompat(['-game', modName()]), {
      cwd: gameDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      appendLaunchLog(`fallback direct no_hl.exe pid=${child.pid}`);
      spawnedGamePids.add(child.pid);
      child.unref();
    });
    child.once('error', (err) => appendLaunchLog(`fallback direct error: ${err.message}`));
    return true;
  } catch (err) {
    appendLaunchLog(`fallback direct throw: ${err.message}`);
    return false;
  }
}

function showNoWindowDialog(gameDir) {
  if (noWindowDialogShown) return;
  noWindowDialogShown = true;
  const canDirect = fs.existsSync(path.join(gameDir, 'no_hl.exe'));
  const buttons = [...(canDirect ? ['直接启动 no_hl.exe'] : []), '打开启动日志', '关闭'];
  dialog.showMessageBox({
    type: 'warning',
    title: '游戏已启动但没有窗口',
    message: '游戏进程已经起来了，但 25 秒内没有检测到窗口。',
    detail: '常见原因：显卡驱动/渲染模式不兼容、杀毒或 Overlay 拦截、Windows 兼容性问题。\n'
      + '可以先试“直接启动 no_hl.exe”，或在设置里打开兼容模式（窗口化 800×600 + OpenGL）。',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  }).then(({ response }) => {
    const choice = buttons[response];
    if (choice === '直接启动 no_hl.exe') {
      if (!launchDirectNoHl(gameDir)) {
        dialog.showErrorBox('没找到 no_hl.exe', '游戏目录下没有 no_hl.exe，请检查整合包是否完整。');
      }
    } else if (choice === '打开启动日志') {
      shell.openPath(launchLogPath());
    }
  }).catch(() => {});
}

// ================= 窗口 =================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1180,
    minHeight: 780,
    backgroundColor: '#0a0b10',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 开发时连 Vite dev server，打包后加载 dist（file:// 需要 vite base: './'）
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ================= IPC =================

/** 统一信封：渲染层只需要 try/catch，错误信息不会被 Electron 包一层前缀 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (err) {
      const code = err.code || 'INTERNAL';
      log(`[ipc] ${channel} 失败:`, err.message);
      return { ok: false, code, message: err.message };
    }
  });
}

handle('app:info', async () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  apiBaseUrl: getSettings().apiBaseUrl,
  userDataDir: store.baseDir(),
  packaged: app.isPackaged,
  // 审核版在界面上明确标出来，避免和正式安装混淆。
  review: IS_REVIEW_BUILD,
}));

// 导出诊断包：启动日志 + 设置 + 系统信息，方便老电脑排障
handle('app:export-diagnosis', async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出诊断包',
    defaultPath: path.join(app.getPath('desktop'), `ESF诊断-${stamp}.txt`),
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const current = getSettings();
  const lines = [];
  lines.push('ESF 平台诊断包');
  lines.push(`生成时间: ${new Date().toISOString()}`);
  lines.push(`启动器版本: ${app.getVersion()}  Electron: ${process.versions.electron}`);
  lines.push(`系统: ${process.getSystemVersion()} ${process.arch}  Node: ${process.versions.node}`);
  lines.push('');
  lines.push('--- 设置（已隐藏敏感字段） ---');
  lines.push(JSON.stringify({
    hlPath: current.hlPath,
    esfModDir: current.esfModDir,
    apiBaseUrl: current.apiBaseUrl,
    compatMode: Boolean(current.compatMode),
    soundEnabled: current.soundEnabled,
    localServerKey: current.localServerKey,
  }, null, 2));
  lines.push('');
  lines.push('--- 游戏进程 ---');
  try {
    lines.push(JSON.stringify(listGameProcesses()));
  } catch {
    lines.push('(读取失败)');
  }
  lines.push('');
  lines.push('--- launcher.log（最近 300 行） ---');
  try {
    const text = fs.readFileSync(launchLogPath(), 'utf8');
    lines.push(text.split(/\r?\n/).slice(-300).join('\n'));
  } catch {
    lines.push('(没有启动日志)');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { path: filePath };
});

handle('config:get', async () => api.config(getSettings()));

// ---- 设置 ----
handle('settings:get', async () => getSettings());

handle('settings:update', async (patch) => {
  settings = store.saveSettings(patch);
  return settings;
});


// ---- 自动寻找游戏目录 ----
function driveLetters() {
  const out = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    try {
      if (fs.existsSync(letter + ':\\')) out.push(letter + ':');
    } catch {
      /* 读不到盘符就跳过 */
    }
  }
  return out;
}

function registryGameHints() {
  const hints = [];
  const pushHint = (p) => {
    if (p && typeof p === 'string' && p.trim()) hints.push(p.trim().replace(/^"|"$/g, ''));
  };
  const regQuery = (args) => {
    try {
      const res = spawnSync('reg', args, { encoding: 'utf8', timeout: 4000, windowsHide: true });
      return res && res.status === 0 ? String(res.stdout || '') : '';
    } catch {
      return '';
    }
  };

  // 卸载表里名字像半条命/CS 的安装目录
  for (const name of ['Half-Life', 'Counter-Strike']) {
    const text = regQuery([
      'query',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      '/s',
      '/f',
      name,
      '/d',
    ]);
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
      if (m) pushHint(m[1]);
    }
  }

  return hints;
}

/** 启动器自己所在目录：整合包最常见的形态就是启动器和 hl.exe 同级 */
function launcherDirPath() {
  if (app.isPackaged) return path.dirname(process.execPath);
  // 开发时 process.execPath 是 electron.exe，退回仓库根目录，避免把 node_modules 当线索
  return path.resolve(app.getAppPath(), '..');
}

handle('dialog:auto-find-game-dir', async () => {
  const found = core.detectGameDir({
    env: process.env,
    extraDirs: registryGameHints(),
    drives: driveLetters(),
    launcherDir: launcherDirPath(),
  });
  if (!found || !found.hlPath) {
    throw new api.ApiError('没有自动找到游戏目录，请点「选择目录」手动指定整合包根目录（含 hl.exe / esf.exe）', 'GAME_DIR_NOT_FOUND');
  }
  if (!found.modDir) {
    settings = store.saveSettings({ hlPath: found.hlPath });
    log('⚙️ 自动找到游戏主程序，但没找到 esf 模组:', found.hlPath);
    return { hlPath: found.hlPath, modDir: '', partial: true };
  }
  settings = store.saveSettings({ hlPath: found.hlPath, esfModDir: found.modDir });
  log('⚙️ 自动找到游戏目录:', found.hlPath);
  return { hlPath: found.hlPath, modDir: found.modDir, root: found.root };
});

handle('dialog:pick-game-dir', async () => {
  const result = await dialog.showOpenDialog({
    title: '请选择包含 hl.exe / esf.exe 的半条命根目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    throw new api.ApiError('已取消选择', 'CANCELED');
  }

  const { hlPath, modDir } = core.resolveGameFiles(result.filePaths[0]);
  if (!hlPath || !modDir) {
    throw new api.ApiError(
      '选择的目录无效，找不到游戏主程序（hl.exe / esf.exe）或 esf 模组文件夹',
      'INVALID_GAME_DIR'
    );
  }

  settings = store.saveSettings({ hlPath, esfModDir: modDir });
  log('⚙️ 已更新游戏目录:', `${path.basename(hlPath)}=${hlPath}`, `mod=${modDir}`);
  return { hlPath, modDir };
});

// ---- 账号 ----
handle('auth:login', async ({ username, password }) => {
  const data = await apiCall(api.login, getSettings(), username, password);
  if (data.twoFactorRequired) {
    log(`👤 需要两步验证: ${username}`);
    return { twoFactorRequired: true, challengeToken: data.challengeToken };
  }
  session = { token: data.accessToken, user: data.user, savedAt: Date.now() };
  store.saveSession(session);
  log(`👤 登录成功: ${data.user.username}`);
  return { user: data.user, expiresIn: data.expiresIn };
});

handle('auth:register', async ({ username, password, gameName, inviteCode }) =>
  apiCall(api.register, getSettings(), { username, password, gameName, inviteCode })
);

handle('auth:me', async () => {
  const current = getSession();
  if (!current || !current.token) {
    throw new api.ApiError('未登录', 'AUTH_REQUIRED', 401);
  }
  const data = await apiCall(api.me, getSettings(), current.token);
  session = { ...current, user: data.user };
  store.saveSession(session);
  return { user: data.user };
});

handle('auth:logout', async () => {
  const current = getSession();
  if (current && current.token) {
    try {
      await api.logout(getSettings(), current.token);
    } catch (err) {
      log('注销接口失败（本地照常清理）:', err.message);
    }
  }
  store.clearSession();
  session = null;
  return { loggedOut: true };
});

// ---- 忘记密码 / 邮箱绑定（不需要登录态）----
handle('auth:forgot-send', async ({ account }) => apiCall(api.forgotSend, getSettings(), account));

handle('auth:forgot-verify', async ({ account, code }) =>
  apiCall(api.forgotVerify, getSettings(), account, code)
);

handle('auth:forgot-reset', async ({ token, password }) =>
  apiCall(api.forgotReset, getSettings(), token, password)
);

handle('auth:email-code', async ({ email }) =>
  apiCall(api.bindEmailCode, getSettings(), requireToken(), email)
);

handle('auth:email-bind', async ({ email, code }) =>
  apiCall(api.bindEmail, getSettings(), requireToken(), email, code)
);

// ---- 0.4.16 两步验证 / 设备会话 ----
handle('auth:2fa-verify', async ({ challengeToken, code }) => {
  const data = await apiCall(api.twoFactorVerify, getSettings(), challengeToken, code);
  session = { token: data.accessToken, user: data.user, savedAt: Date.now() };
  store.saveSession(session);
  log(`👤 两步验证通过: ${data.user.username}`);
  return { user: data.user, expiresIn: data.expiresIn };
});

handle('auth:2fa-setup', async () => apiCall(api.totpSetup, getSettings(), requireToken()));

handle('auth:2fa-enable', async ({ code }) =>
  apiCall(api.totpEnable, getSettings(), requireToken(), code)
);

handle('auth:2fa-disable', async ({ password }) =>
  apiCall(api.totpDisable, getSettings(), requireToken(), password)
);

handle('auth:sessions', async () => apiCall(api.listSessions, getSettings(), requireToken()));

handle('auth:revoke-session', async ({ id }) =>
  apiCall(api.revokeSession, getSettings(), requireToken(), id)
);

handle('auth:revoke-others', async () =>
  apiCall(api.revokeOtherSessions, getSettings(), requireToken())
);

handle('auth:update-profile', async (patch = {}) => {
  await apiCall(api.updateProfile, getSettings(), requireToken(), patch);
  const data = await apiCall(api.me, getSettings(), requireToken());
  session = { ...getSession(), user: data.user };
  store.saveSession(session);
  log(`👤 资料已更新: ${JSON.stringify(patch)}`);
  return { user: data.user };
});

// ---- 数据 ----
handle('stats:get', async () => apiCall(api.stats, getSettings(), requireToken()));

handle('servers:list', async () => apiCall(api.servers, getSettings(), requireToken()));

handle('servers:lookup', async ({ address }) => {
  const value = String(address || '').trim();
  if (!value) throw new Error('请输入服务器地址，例如 114.132.84.150:27016');

  const data = await apiCall(api.lookupServer, getSettings(), requireToken(), value);
  return data.server;
});

handle('servers:detail', async (params = {}) =>
  apiCall(api.serverDetail, getSettings(), requireToken(), params)
);
// ---- 玩家自建服务器：只存在本机，不进平台登记 ----
handle('servers:custom-list', async () => ({ servers: store.loadCustomServers() }));

handle('servers:custom-add', async ({ name, address } = {}) => {
  requireToken();
  const value = String(address || '').trim();
  if (!/^[0-9A-Za-z.-]{3,64}:\d{2,5}$/.test(value)) {
    throw new Error('地址格式应为 IP:端口，例如 1.2.3.4:27016');
  }

  const list = store.loadCustomServers();
  if (list.some((item) => item.address === value)) throw new Error('这个地址已经在列表里了');

  const next = store.saveCustomServers([
    ...list,
    { name: String(name || '').trim() || value, address: value, addedAt: new Date().toISOString() },
  ]);

  const added = next.find((item) => item.address === value) || null;
  log(`➕ 添加自定义服务器 ${value}`);
  return { server: added, servers: next };
});

handle('servers:custom-remove', async ({ address } = {}) => {
  const value = String(address || '').trim();
  const next = store.saveCustomServers(
    store.loadCustomServers().filter((item) => item.address !== value)
  );
  log(`➖ 移除自定义服务器 ${value}`);
  return { servers: next };
});

handle('ranks:list', async () => apiCall(api.ranksList, getSettings()));

handle('favorites:list', async () => apiCall(api.favoritesList, getSettings(), requireToken()));
handle('favorites:set', async ({ serverKeys } = {}) =>
  apiCall(api.favoritesSet, getSettings(), requireToken(), Array.isArray(serverKeys) ? serverKeys : [])
);

handle('favorites:add', async ({ serverKey } = {}) =>
  apiCall(api.favoriteAdd, getSettings(), requireToken(), serverKey)
);

handle('favorites:remove', async ({ serverKey } = {}) =>
  apiCall(api.favoriteRemove, getSettings(), requireToken(), serverKey)
);

// ---- 在线状态 / 大厅频道 ----
handle('presence:ping', async () => {
  requireToken();

  const running = isGameRunning();
  const state = running ? 'ingame' : 'lobby';
  const serverKey = running ? lastServerKey || getSettings().localServerKey : undefined;

  return apiCall(api.pingPresence, getSettings(), requireToken(), { state, serverKey });
});

handle('presence:list', async () => apiCall(api.presenceList, getSettings(), requireToken()));

handle('members:list', async () => apiCall(api.membersList, getSettings(), requireToken()));

handle('members:presence', async () => apiCall(api.membersPresence, getSettings(), requireToken()));

handle('members:detail', async ({ id } = {}) =>
  apiCall(api.memberDetail, getSettings(), requireToken(), id)
);

handle('members:set-combat-level', async ({ id, combatLevel } = {}) =>
  apiCall(api.setCombatLevel, getSettings(), requireToken(), id, combatLevel)
);

handle('members:set-status', async ({ text } = {}) =>
  apiCall(api.setMemberStatus, getSettings(), requireToken(), String(text ?? ''))
);

handle('economy:summary', async () =>
  apiCall(api.economySummary, getSettings(), requireToken())
);

handle('ranked:state', async () => apiCall(api.rankedState, getSettings(), requireToken()));
handle('ranked:queue', async ({ mode } = {}) =>
  apiCall(api.rankedQueue, getSettings(), requireToken(), mode)
);
handle('ranked:cancel', async ({ matchId } = {}) =>
  apiCall(api.rankedCancel, getSettings(), requireToken(), matchId)
);
handle('ranked:ready', async () => apiCall(api.rankedReady, getSettings(), requireToken()));
handle('ranked:bet', async ({ matchId, team, amount } = {}) =>
  apiCall(api.rankedBet, getSettings(), requireToken(), matchId, team, amount)
);
handle('ranked:spectate', async ({ matchId } = {}) =>
  apiCall(api.rankedSpectate, getSettings(), requireToken(), matchId)
);
handle('ranked:finish', async ({ matchId, winner } = {}) =>
  apiCall(api.rankedFinish, getSettings(), requireToken(), matchId, winner)
);
handle('ranked:leaderboard', async ({ limit } = {}) =>
  apiCall(api.rankedLeaderboard, getSettings(), requireToken(), limit)
);
handle('ranked:history', async ({ limit } = {}) =>
  apiCall(api.rankedHistory, getSettings(), requireToken(), limit)
);

handle('challenges:state', async () =>
  apiCall(api.challengeState, getSettings(), requireToken())
);
handle('challenges:create', async (payload = {}) =>
  apiCall(api.challengeCreate, getSettings(), requireToken(), payload)
);
handle('challenges:join', async ({ id } = {}) =>
  apiCall(api.challengeJoin, getSettings(), requireToken(), id)
);
handle('challenges:leave', async ({ id } = {}) =>
  apiCall(api.challengeLeave, getSettings(), requireToken(), id)
);
handle('challenges:close', async ({ id } = {}) =>
  apiCall(api.challengeClose, getSettings(), requireToken(), id)
);
handle('challenges:invite', async ({ id, userId } = {}) =>
  apiCall(api.challengeInvite, getSettings(), requireToken(), id, userId)
);
handle('challenges:respond', async ({ id, action } = {}) =>
  apiCall(api.challengeRespond, getSettings(), requireToken(), id, action)
);
handle('challenges:ready', async ({ id, ready } = {}) =>
  apiCall(api.challengeReady, getSettings(), requireToken(), id, ready !== false)
);
handle('challenges:team', async ({ id, team } = {}) =>
  apiCall(api.challengeTeam, getSettings(), requireToken(), id, team)
);
handle('challenges:start', async ({ id } = {}) =>
  apiCall(api.challengeStart, getSettings(), requireToken(), id)
);
handle('challenges:spectate', async ({ id } = {}) =>
  apiCall(api.challengeSpectate, getSettings(), requireToken(), id)
);
handle('challenges:queue-join', async ({ serverKey, kind } = {}) =>
  apiCall(api.challengeQueueJoin, getSettings(), requireToken(), serverKey, kind)
);
handle('challenges:queue-leave', async ({ serverKey } = {}) =>
  apiCall(api.challengeQueueLeave, getSettings(), requireToken(), serverKey)
);
handle('challenges:queue', async ({ serverKey } = {}) =>
  apiCall(api.challengeQueue, getSettings(), requireToken(), serverKey)
);

handle('titles:list', async () => apiCall(api.titles, getSettings(), requireToken()));

handle('titles:create', async (payload = {}) =>
  apiCall(api.createTitle, getSettings(), requireToken(), payload)
);

handle('titles:update', async ({ id, ...payload } = {}) =>
  apiCall(api.updateTitle, getSettings(), requireToken(), id, payload)
);

handle('titles:remove', async ({ id } = {}) =>
  apiCall(api.removeTitle, getSettings(), requireToken(), id)
);

handle('titles:assign', async ({ userId, titleId } = {}) =>
  apiCall(api.assignTitle, getSettings(), requireToken(), userId, titleId)
);

handle('chat:list', async ({ after } = {}) =>
  apiCall(api.chatList, getSettings(), requireToken(), after || 0)
);

handle('chat:send', async ({ body } = {}) => {
  const text = String(body || '').trim();
  if (!text) throw new Error('消息不能为空');
  return apiCall(api.chatSend, getSettings(), requireToken(), text);
});

// ---- 版本更新 ----
handle('update:check', async () => {
  const config = await api.config(getSettings());
  const current = app.getVersion();
  const latest = config.latestVersion || config.version || current;

  return {
    current,
    latest,
    hasUpdate: compareVersions(current, latest) < 0,
    releaseNotes: config.releaseNotes || '',
    downloadUrl: config.downloadUrl || '',
  };
});

handle('update:status', async () => updateState);

handle('update:auto-check', async () => {
  if (!app.isPackaged) {
    return { status: 'dev', message: '开发模式不执行自动更新' };
  }
  const result = await autoCheckOnce();
  if (!result) {
    return { status: 'unconfigured', message: '还没有配置更新源（UPDATE_FEED_URL）' };
  }
  return result;
});

handle('update:auto-install', async () => {
  if (updateState.status !== 'downloaded') throw new Error('还没有下载完成的更新');
  try {
    await applyUpdateInPlace();
  } catch (err) {
    // 不再退回 quitAndInstall：绿色包会被装到 %LOCALAPPDATA%\Programs，等于更新失败
    updateLog('ERROR', '就地更新启动失败:', err.message);
    sendUpdate({ status: 'error', message: err.message });
    throw err;
  }
  return true;
});

handle('update:pause', async () => {
  if (updateToken) {
    updateCancelled = true;
    updateToken.cancel();
    updateToken = null;
  }
  if (updateState.status === 'downloading' || updateState.status === 'available') {
    sendUpdate({ status: 'paused' });
  }
  return updateState;
});

handle('update:resume', async () => {
  if (updateToken) return updateState;
  startUpdateDownload(updateState.version);
  return updateState;
});

handle('update:dismiss', async () => {
  if (updateToken) {
    updateCancelled = true;
    updateToken.cancel();
    updateToken = null;
  }
  sendUpdate({ status: 'dismissed', percent: 0, transferred: 0, total: 0 });
  return true;
});
handle('shell:open-external', async ({ url } = {}) => {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value)) throw new Error('只允许打开 http/https 链接');
  await shell.openExternal(value);
  return true;
});

handle('maps:scan', async () => {
  const dir = getSettings().esfModDir;
  if (!dir) return [];
  try {
    return fs
      .readdirSync(path.join(dir, 'maps'))
      .filter((file) => file.toLowerCase().endsWith('.bsp'))
      .map((file) => file.replace(/\.bsp$/i, ''))
      .sort();
  } catch (err) {
    log('扫描地图失败:', err.message);
    return [];
  }
});

// ---- 启动 ----
handle('launch:token', async ({ serverKey }) => {
  const key = serverKey || getSettings().localServerKey;
  const data = await apiCall(api.launchToken, getSettings(), requireToken(), key);
  return { serverKey: data.serverKey, expiresAt: data.expiresAt, maskedToken: maskToken(data.token) };
});

handle('launch:join', async ({ serverKey, ip, port }) => {
  const current = getSession();
  requireToken();
  checkGameDir();

  const switched = await stopGameForSwitch();
  const issued = await apiCall(api.launchToken, getSettings(), requireToken(), serverKey);
  const username = (current.user && (current.user.gameName || current.user.username)) || 'Player';

  prepareLaunch(issued.token, username);

  const address = `${ip}:${port}`;
  lastServerKey = serverKey;
  await spawnGameWithRetry(core.buildJoinArgs(modName(), address));
  hideToTrayForGame();
  log(`🌐 正在连接 ${address}`);
  return { address, maskedToken: maskToken(issued.token), switched };
});

handle('launch:spectate', async ({ serverKey, ip, port }) => {
  const current = getSession();
  requireToken();
  checkGameDir();
  if (!serverKey) throw new Error('观战需要指定服务器');

  const switched = await stopGameForSwitch();
  const issued = await apiCall(api.launchToken, getSettings(), requireToken(), serverKey, {
    purpose: 'spectate',
  });
  const username = (current.user && (current.user.gameName || current.user.username)) || 'Player';

  prepareLaunch(issued.token, username);

  const address = `${ip}:${port}`;
  lastServerKey = serverKey;
  await spawnGameWithRetry(core.buildJoinArgs(modName(), address));
  hideToTrayForGame();
  log(`👁 观战 ${address}`);
  return { address, spectator: true, maskedToken: maskToken(issued.token), switched };
});

// 未登记服务器：直接 connect，不带平台身份（AMXX 不会做身份校验）
handle('launch:join-custom', async ({ address } = {}) => {
  requireToken();
  checkGameDir();

  const value = String(address || '').trim();
  const matched = /^([0-9A-Za-z.-]{3,64}):(\d{2,5})$/.exec(value);
  if (!matched) throw new Error('地址格式应为 IP:端口');

  const target = `${matched[1]}:${matched[2]}`;
  const switched = await stopGameForSwitch();
  await spawnGameWithRetry(['-game', modName(), '+connect', target]);
  hideToTrayForGame();
  log(`🌐 自定义服务器直连 ${target}（不带平台身份）`);
  return { address: target, platform: false, switched };
});
handle('launch:local', async ({ map, mode }) => {  const current = getSession();
  requireToken();
  checkGameDir();

  const safeMap = core.sanitizeMapName(map);
  if (!safeMap) throw new Error('请先选择地图');

  const switched = await stopGameForSwitch();
  const issued = await apiCall(api.launchToken, getSettings(), requireToken(), getSettings().localServerKey);
  const username = (current.user && (current.user.gameName || current.user.username)) || 'Player';

  prepareLaunch(issued.token, username);
  lastServerKey = getSettings().localServerKey;
  const modeInfo = core.applyLocalGameMode(getSettings().esfModDir, mode);
  log(`🎮 本地模式 mp_gamemode=${modeInfo.mode}（写入 ${modeInfo.changed.join(', ') || '无'}）`);
  await spawnGameWithRetry(core.buildLocalArgs(modName(), safeMap, mode));
  hideToTrayForGame();
  return { map: safeMap, mode: mode === 'deathmatch' ? 'deathmatch' : 'team', gameMode: modeInfo.mode, changedFiles: modeInfo.changed, maskedToken: maskToken(issued.token), switched };
});

// 游客模式：不登录平台，直接拉起游戏主菜单（插件开放时可进服）
handle('launch:guest', async () => {
  checkGameDir();
  const switched = await stopGameForSwitch();
  await spawnGameWithRetry(['-game', modName()]);
  hideToTrayForGame();
  return { guest: true, switched };
});

handle('launch:stop', async () => {
  let killed = false;
  try {
    killed = await stopGameForSwitch();
  } finally {
    // 约战结果已落库：即便客户端卡住，也强制关游戏并恢复平台窗口。
    stopGameWatcher();
    showMainWindow();
  }
  return { killed };
});

// ---- 本地 AMXX 插件 ----
const LOCAL_AMXX_PLUGINS = [
  {
    id: 'platform_auth',
    file: 'esf_platform_auth.amxx',
    label: '身份 / 心跳',
    expected: '0.47',
    sha256: '7eef5125ce11c1f606fe5b864f8bcf0e70e6b3208a53855efc283c2e7e004f01',
  },
  {
    id: 'ranked_lock',
    file: 'esf_ranked_lock.amxx',
    label: '排位 / 约战锁服',
    expected: '1.3.0',
    sha256: 'd11cd63308d96464dba5a854195182036ff3a30cb5eeb7f9c607b24bd93fc5f0',
  },
  {
    id: 'test_ranked',
    file: 'test_ranked.amxx',
    label: '排位 / 约战流程',
    expected: '1.3.4-teamtest',
    sha256: '5466b626c64ee06a10b746e79d36d5606669f7beff9cc7d939af2df4cfb09cef',
  },
  {
    id: 'gamemode',
    file: 'esf_gamemode.amxx',
    label: '模式守卫',
    expected: '1.0.0',
    sha256: 'c878f71d86cb8286348fcd4bfc62b23ecdc4c874158471c36f649efccdee6a2c',
  },
];

const LOCAL_AMXX_CVARS = [
  'platform_enforce',
  'platform_allow_guest',
  'platform_server_key',
  'ranked_auto_team',
  'ranked_lock',
];

function findPluginConfig() {
  const mod = getSettings().esfModDir;
  if (!mod || !fs.existsSync(mod)) return '';
  const candidates = [
    path.join(mod, 'addons', 'amxmodx', 'configs', 'amxx.cfg'),
    path.join(mod, 'addons', 'amxx', 'configs', 'amxx.cfg'),
    path.join(mod, 'amxx', 'configs', 'amxx.cfg'),
  ];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function pluginRootFromConfig(cfg) {
  // <mod>/addons/amxx/configs/amxx.cfg -> <mod>/addons/amxx
  return path.dirname(path.dirname(cfg));
}

function parseAmxxCvars(text) {
  const out = {};
  for (const name of LOCAL_AMXX_CVARS) {
    const matched = new RegExp(`^\\s*${name}\\s+"?([^"\\r\\n]*)"?`, 'im').exec(text);
    out[name] = matched ? matched[1].trim() : null;
  }
  return out;
}

/** AMXX 编译产物里版本字符串是明文；只在命中已知版本时返回，避免误报。 */
function detectAmxxVersion(buffer, expected) {
  if (!expected) return null;
  return buffer.includes(Buffer.from(expected, 'latin1')) ? expected : null;
}

function readLocalPluginState() {
  const cfg = findPluginConfig();
  const mod = getSettings().esfModDir;
  const dir = cfg ? pluginRootFromConfig(cfg) : mod ? path.join(mod, 'addons', 'amxx') : '';
  let text = '';
  if (cfg) {
    try {
      text = fs.readFileSync(cfg, 'utf8');
    } catch {
      text = '';
    }
  }

  const plugins = LOCAL_AMXX_PLUGINS.map((item) => {
    const file = dir ? path.join(dir, 'plugins', item.file) : '';
    let stat = null;
    let sha256 = null;
    let version = null;
    let versionSource = 'unknown';
    if (file) {
      try {
        stat = fs.statSync(file);
        if (stat.isFile()) {
          const buffer = fs.readFileSync(file);
          sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          if (item.sha256 && sha256 === item.sha256) {
            version = item.expected;
            versionSource = 'known-build';
          } else {
            version = detectAmxxVersion(buffer, item.expected);
            if (version) versionSource = 'binary-string';
          }
        }
      } catch {
        stat = null;
      }
    }
    return {
      id: item.id,
      file: item.file,
      label: item.label,
      expected: item.expected,
      path: file,
      present: Boolean(stat && stat.isFile()),
      size: stat && stat.isFile() ? stat.size : null,
      mtime: stat && stat.isFile() ? stat.mtime.toISOString() : null,
      sha256,
      version,
      versionSource,
      versionMatch: Boolean(version && version === item.expected),
    };
  });

  const enforceMatch = /^\s*platform_enforce\s+"?(\d+)"?/im.exec(text);
  return {
    found: Boolean(cfg),
    path: cfg,
    dir,
    pluginsDir: dir ? path.join(dir, 'plugins') : '',
    enforce: enforceMatch ? enforceMatch[1] === '1' : true,
    cvars: parseAmxxCvars(text),
    plugins,
    scannedAt: new Date().toISOString(),
  };
}

function newestAmxxLog(dir) {
  if (!dir) return null;
  const logsDir = path.join(dir, 'logs');
  if (!fs.existsSync(logsDir)) return null;
  let best = null;
  let bestDay = '';
  for (const name of fs.readdirSync(logsDir)) {
    if (!/\.log$/i.test(name)) continue;
    const file = path.join(logsDir, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      // 优先按 LYYYYMMDD.log 的日期取“最新一天”，mtime 只做兜底。
      // 整合包里的旧日志可能被复制成新 mtime，按 mtime 会读到 2022 年的日志。
      const day = (/^L(\d{8})\.log$/i.exec(name) || [])[1] || '';
      if (day > bestDay || (day === bestDay && (!best || stat.mtimeMs > best.mtimeMs))) {
        best = { file, stat };
        bestDay = day;
      } else if (!day && !bestDay && (!best || stat.mtimeMs > best.mtimeMs)) {
        best = { file, stat };
      }
    } catch {
      /* ignore unreadable log */
    }
  }
  return best;
}

handle('plugins:status', async () => readLocalPluginState());

handle('plugins:observe', async ({ serverKey } = {}) => {
  const local = readLocalPluginState();
  let server = null;
  let serverError = '';
  try {
    const key = serverKey || getSettings().localServerKey || '';
    server = await apiCall(api.pluginObservability, getSettings(), requireToken(), key);
  } catch (err) {
    // 服务端不可达不能拖垮本地面板；登录过期仍由 apiCall 统一清 session。
    serverError = err && err.message ? err.message : String(err);
  }
  return { ...local, server, serverError };
});

handle('plugins:set-enforce', async ({ enforce } = {}) => {
  const cfg = findPluginConfig();
  if (!cfg) throw new Error('没有找到本地 AMXX 配置（addons/amxx/configs/amxx.cfg）');
  const value = enforce ? '1' : '0';
  const text = fs.readFileSync(cfg, 'utf8');
  const line = `platform_enforce "${value}"`;
  const next = /^\s*platform_enforce\s+"?\d+"?\s*$/im.test(text)
    ? text.replace(/^\s*platform_enforce\s+"?\d+"?\s*$/im, line)
    : `${text.replace(/\s*$/, '')}\r\n${line}\r\n`;
  fs.writeFileSync(cfg, next, 'utf8');
  log(`🧩 本地插件平台校验已${enforce ? '开启' : '关闭'}`);
  return { enforce: Boolean(enforce), path: cfg };
});

handle('plugins:open-dir', async () => {
  const cfg = findPluginConfig();
  if (!cfg) throw new Error('没有找到本地 AMXX 插件目录');
  const dir = pluginRootFromConfig(cfg);
  const error = await shell.openPath(dir);
  if (error) throw new Error(`打开目录失败：${error}`);
  return { dir };
});

handle('plugins:open-logs', async () => {
  const status = readLocalPluginState();
  const logsDir = status.dir ? path.join(status.dir, 'logs') : '';
  if (!logsDir || !fs.existsSync(logsDir)) throw new Error('没有找到 AMXX 日志目录（addons/amxx/logs）');
  const error = await shell.openPath(logsDir);
  if (error) throw new Error(`打开日志目录失败：${error}`);
  return { dir: logsDir };
});

handle('plugins:tail-log', async () => {
  const status = readLocalPluginState();
  const newest = newestAmxxLog(status.dir);
  if (!newest) return { found: false, path: '', name: '', lines: [] };
  const raw = fs.readFileSync(newest.file, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean).slice(-40);
  return { found: true, path: newest.file, name: path.basename(newest.file), lines };
});

// ---- 打开目录（只允许这两个受控路径，不接受渲染层传任意路径）----
handle('shell:open-data-dir', async () => {
  const error = await shell.openPath(store.baseDir());
  if (error) throw new Error(`打开目录失败：${error}`);
  return true;
});

handle('shell:open-game-dir', async () => {
  checkGameDir();
  const error = await shell.openPath(getSettings().esfModDir);
  if (error) throw new Error(`打开目录失败：${error}`);
  return true;
});

// ---- 资源库 ----
const ASSET_KIND_EXT = {
  map: ['bsp'],
  model: ['mdl'],
  sound: ['wav', 'mp3'],
  sprite: ['spr'],
  other: ['tga', 'bmp'],
};

const ASSET_PACKAGE_MAX_FILES = 200;
const ASSET_PACKAGE_MAX_BYTES = 256 * 1024 * 1024;
const ASSET_FILE_MAX_BYTES = 64 * 1024 * 1024;

function assetKindOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  for (const [kind, list] of Object.entries(ASSET_KIND_EXT)) {
    if (list.includes(ext.replace('.', ''))) return kind;
  }
  return 'other';
}

function sendAssetProgress(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('assets:upload-progress', payload);
}

async function collectPackageFiles(mode, kind) {
  const picked = await dialog.showOpenDialog({
    title: mode === 'folder' ? '选择资源文件夹（模型 / 地图 / 音效整包）' : '选择资源压缩包（.zip）',
    properties: mode === 'folder' ? ['openDirectory'] : ['openFile'],
    filters: mode === 'folder' ? undefined : [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
  });
  if (picked.canceled || picked.filePaths.length === 0) {
    throw new api.ApiError('已取消选择', 'CANCELED');
  }

  const source = picked.filePaths[0];
  let root = source;
  let tempDir = '';
  if (mode === 'zip') {
    tempDir = path.join(app.getPath('temp'), 'esf-asset-' + Date.now().toString(36));
    await archive.extractZip(source, tempDir, {
      limits: {
        maxFiles: ASSET_PACKAGE_MAX_FILES,
        maxFileBytes: ASSET_FILE_MAX_BYTES,
        maxTotalBytes: ASSET_PACKAGE_MAX_BYTES,
      },
    });
    root = tempDir;
  }

  try {
    const entries = await archive.collectDirectory(root);
    if (!entries.length) throw new Error('这个文件夹里没有可上传的文件');
    if (entries.length > ASSET_PACKAGE_MAX_FILES) {
      throw new Error('一次最多 ' + ASSET_PACKAGE_MAX_FILES + ' 个文件');
    }
    let total = 0;
    for (const entry of entries) {
      if (entry.size > ASSET_FILE_MAX_BYTES) throw new Error('单个文件不能超过 64MB: ' + entry.path);
      total += entry.size;
    }
    if (total > ASSET_PACKAGE_MAX_BYTES) throw new Error('整包不能超过 256MB');

    const files = [];
    for (const entry of entries) {
      files.push({
        path: entry.path,
        size: entry.size,
        name: path.basename(entry.path),
        buffer: await fsp.readFile(entry.absolute),
      });
    }
    return { files, total, source, tempDir };
  } catch (err) {
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

handle('assets:list', async ({ kind, q, tag, compat, sort, author, collection, featured, limit, offset } = {}) =>
  api.assets(getSettings(), { kind, q, tag, compat, sort, author, collection, featured, limit, offset })
);

const COVER_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

handle('assets:pick-cover', async () => {
  requireToken();
  const picked = await dialog.showOpenDialog({
    title: '选择资源封面（支持 GIF / 动态 WebP）',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  if (picked.canceled || picked.filePaths.length === 0) {
    throw new api.ApiError('已取消选择', 'CANCELED');
  }
  const filePath = picked.filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > 8 * 1024 * 1024) throw new Error('封面不能超过 8MB');
  const mime = COVER_MIME[path.extname(filePath).toLowerCase()];
  if (!mime) throw new Error('封面只支持 png / jpg / webp / gif');
  return {
    name: path.basename(filePath),
    mime,
    size: stat.size,
    base64: fs.readFileSync(filePath).toString('base64'),
  };
});

handle('assets:upload', async (payload = {}) => {
  requireToken();
  const mode = payload.mode === 'folder' || payload.mode === 'zip' ? payload.mode : 'single';
  const kind = payload.kind || 'other';
  if (!ASSET_KIND_EXT[kind]) throw new Error('资源类型不合法');

  let files = [];
  let tempDir = '';
  if (mode === 'single') {
    const picked = await dialog.showOpenDialog({
      title: kind === 'map' ? '选择要上传的地图（.bsp）' : '选择要上传的资源文件',
      properties: ['openFile'],
      filters: [{ name: kind, extensions: ASSET_KIND_EXT[kind] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      throw new api.ApiError('已取消选择', 'CANCELED');
    }
    const filePath = picked.filePaths[0];
    const stat = fs.statSync(filePath);
    if (stat.size > ASSET_FILE_MAX_BYTES) throw new Error('文件超过 64MB 上限');
    let relative = String(payload.targetPath || path.basename(filePath)).replace(/\\/g, '/');
    if (kind === 'map' && !relative.includes('/')) relative = 'maps/' + relative;
    files = [{
      path: relative,
      size: stat.size,
      name: path.basename(filePath),
      buffer: fs.readFileSync(filePath),
    }];
  } else {
    const collected = await collectPackageFiles(mode, kind);
    files = collected.files;
    tempDir = collected.tempDir;
  }

  const cover = payload.coverBase64
    ? {
        buffer: Buffer.from(payload.coverBase64, 'base64'),
        fileName: payload.coverName || 'cover.png',
        mime: payload.coverMime || 'image/png',
      }
    : null;

  try {
    sendAssetProgress({ phase: 'prepare', current: 0, total: files.length });
    const data = await apiCall(
      api.uploadAssetPackage,
      getSettings(),
      requireToken(),
      { ...payload, kind, mode },
      files,
      cover,
      (progress) => sendAssetProgress(progress)
    );
    const asset = data.asset;
    log('📦 资源已提交: ' + asset.name + ' ' + asset.version + ' (' + asset.status + ', ' + files.length + ' 个文件)');
    return data;
  } finally {
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

function backupFile(modDir, relative, absolute) {
  const backup = path.join(modDir, '.esf-backup', ...relative.split('/'));
  const existed = fs.existsSync(absolute);
  if (existed && !fs.existsSync(backup)) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(absolute, backup);
  }
  return { existed, backedUp: existed, backup };
}

/** 下载 → 校验 sha256 → 逐文件备份 → 写进模组目录；失败回滚 */
handle('assets:install', async ({ id } = {}) => {
  requireToken();
  checkGameDir();
  const detail = await apiCall(api.assetDetail, getSettings(), id);
  const asset = detail.asset;
  const modDir = getSettings().esfModDir;
  let files = Array.isArray(asset.files) ? asset.files : [];
  if (!files.length) {
    files = [{ id: 0, path: asset.targetPath, size: asset.fileSize, sha256: asset.sha256 }];
  }

  const written = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const resolved = core.resolveInstallPath(modDir, file.path);
      const info = backupFile(modDir, resolved.relative, resolved.absolute);
      sendAssetProgress({ phase: 'install', current: index, total: files.length, name: resolved.relative });

      let buffer;
      if (file.id) {
        buffer = await apiCall(api.downloadAssetFile, getSettings(), requireToken(), id, file.id);
      } else {
        buffer = await apiCall(api.downloadAsset, getSettings(), requireToken(), id);
      }
      const digest = crypto.createHash('sha256').update(buffer).digest('hex');
      if (file.sha256 && digest !== file.sha256) {
        throw new Error('文件校验失败（' + resolved.relative + '），请重试或联系作者');
      }

      const temp = resolved.absolute + '.esf-tmp';
      fs.mkdirSync(path.dirname(resolved.absolute), { recursive: true });
      fs.writeFileSync(temp, buffer);
      fs.renameSync(temp, resolved.absolute);
      written.push({
        path: resolved.relative,
        size: buffer.length,
        sha256: digest,
        existed: info.existed,
        backedUp: info.backedUp,
      });
    }

    await apiCall(api.trackAssetDownload, getSettings(), requireToken(), id).catch(() => {});
    const receipt = store.saveAssetReceipt({
      id: asset.id,
      slug: asset.slug,
      name: asset.name,
      version: asset.version,
      files: written,
      installedAt: new Date().toISOString(),
    });
    sendAssetProgress({ phase: 'done', current: files.length, total: files.length });
    log('📥 资源已安装: ' + asset.name + ' ' + asset.version + '（' + written.length + ' 个文件）');
    return { files: written, bytes: receipt ? receipt.bytes : 0, backedUp: written.some((file) => file.backedUp) };
  } catch (err) {
    for (const file of written.reverse()) {
      const resolved = core.resolveInstallPath(modDir, file.path);
      const backup = path.join(modDir, '.esf-backup', ...resolved.relative.split('/'));
      if (file.existed && fs.existsSync(backup)) {
        fs.copyFileSync(backup, resolved.absolute);
      } else if (fs.existsSync(resolved.absolute)) {
        fs.unlinkSync(resolved.absolute);
      }
    }
    throw err;
  }
});

handle('assets:receipts', async () => {
  const modDir = getSettings().esfModDir;
  const claims = new Map();
  const receipts = store.loadAssetReceipts().map((receipt) => {
    const files = (receipt.files || []).map((file) => {
      let exists = false;
      let backupAvailable = false;
      if (modDir) {
        try {
          const resolved = core.resolveInstallPath(modDir, file.path);
          exists = fs.existsSync(resolved.absolute);
          backupAvailable = fs.existsSync(path.join(modDir, '.esf-backup', ...resolved.relative.split('/')));
        } catch {
          /* 路径失效 */
        }
      }
      const key = file.path.toLowerCase();
      claims.set(key, (claims.get(key) || 0) + 1);
      return { ...file, exists, backupAvailable };
    });
    return { ...receipt, files, exists: files.some((file) => file.exists), backupAvailable: files.some((file) => file.backupAvailable) };
  });
  return {
    receipts,
    modDir,
    conflicts: Array.from(claims.entries()).filter(([, count]) => count > 1).map(([filePath]) => filePath),
  };
});

async function restoreReceiptFiles(receipt, removeReceipt) {
  checkGameDir();
  const modDir = getSettings().esfModDir;
  const restored = [];
  for (const file of receipt.files || []) {
    const resolved = core.resolveInstallPath(modDir, file.path);
    const backup = path.join(modDir, '.esf-backup', ...resolved.relative.split('/'));
    if (file.existed && fs.existsSync(backup)) {
      fs.mkdirSync(path.dirname(resolved.absolute), { recursive: true });
      fs.copyFileSync(backup, resolved.absolute);
      restored.push(resolved.relative);
    } else if (!file.existed && fs.existsSync(resolved.absolute)) {
      fs.unlinkSync(resolved.absolute);
      restored.push(resolved.relative);
    }
  }
  if (removeReceipt) store.removeAssetReceipt(receipt.id);
  return restored;
}

handle('assets:restore', async ({ id } = {}) => {
  const receipt = store.loadAssetReceipts().find((item) => Number(item.id) === Number(id));
  if (!receipt) throw new Error('没有这个资源的安装记录');
  const restored = await restoreReceiptFiles(receipt, false);
  log('↩️ 资源已恢复原文件: ' + receipt.name + '（' + restored.length + ' 个文件）');
  return { files: restored };
});

handle('assets:uninstall', async ({ id } = {}) => {
  const receipt = store.loadAssetReceipts().find((item) => Number(item.id) === Number(id));
  if (!receipt) throw new Error('没有这个资源的安装记录');
  const removed = await restoreReceiptFiles(receipt, true);
  log('🗑️ 资源已卸载: ' + receipt.name + '（' + removed.length + ' 个文件）');
  return { files: removed };
});

handle('assets:detail', async ({ id } = {}) =>
  apiCall(api.assetDetail, getSettings(), id)
);

handle('assets:tags', async () => apiCall(api.assetTags, getSettings()));
handle('assets:collections', async () => apiCall(api.assetCollections, getSettings()));
handle('assets:collection', async ({ slug } = {}) =>
  apiCall(api.assetCollection, getSettings(), slug)
);
handle('assets:mine', async () => apiCall(api.myAssets, getSettings(), requireToken()));
handle('assets:author', async ({ id } = {}) => apiCall(api.assetAuthor, getSettings(), id));

handle('assets:rate', async ({ id, stars } = {}) => {
  requireToken();
  return apiCall(api.rateAsset, getSettings(), requireToken(), id, Number(stars));
});

handle('assets:comments', async ({ id, params } = {}) =>
  apiCall(api.assetComments, getSettings(), id, params || {})
);
handle('assets:comment', async ({ id, body } = {}) => {
  requireToken();
  return apiCall(api.postAssetComment, getSettings(), requireToken(), id, body);
});
handle('assets:delete-comment', async ({ id, commentId } = {}) => {
  requireToken();
  return apiCall(api.deleteAssetComment, getSettings(), requireToken(), id, commentId);
});
handle('assets:report', async ({ id, reason } = {}) => {
  requireToken();
  return apiCall(api.reportAsset, getSettings(), requireToken(), id, reason);
});

handle('assets:update', async ({ id, patch } = {}) => {
  requireToken();
  return apiCall(api.updateAsset, getSettings(), requireToken(), id, patch || {});
});
handle('assets:remove', async ({ id } = {}) => {
  requireToken();
  const data = await apiCall(api.deleteAsset, getSettings(), requireToken(), id);
  store.removeAssetReceipt(id);
  return data;
});
handle('assets:set-featured', async ({ id, featured } = {}) => {
  requireStaff();
  return apiCall(api.setAssetFeatured, getSettings(), requireToken(), id, Boolean(featured));
});
handle('assets:set-version-status', async ({ id, version, status, note } = {}) => {
  requireStaff();
  return apiCall(api.setAssetVersionStatus, getSettings(), requireToken(), id, version, status, note);
});

handle('admin:asset-versions', async ({ status } = {}) => {
  requireStaff();
  return apiCall(api.adminAssetVersions, getSettings(), requireToken(), status || 'pending');
});
handle('admin:asset-reports', async ({ status } = {}) => {
  requireStaff();
  return apiCall(api.adminAssetReports, getSettings(), requireToken(), status || 'open');
});
handle('admin:resolve-report', async ({ id, status } = {}) => {
  requireStaff();
  return apiCall(api.resolveAssetReport, getSettings(), requireToken(), id, status);
});
handle('admin:collections', async () => {
  requireStaff();
  return apiCall(api.adminCollections, getSettings(), requireToken());
});
handle('admin:collection-create', async (body = {}) => {
  requireStaff();
  return apiCall(api.adminCreateCollection, getSettings(), requireToken(), body);
});
handle('admin:collection-update', async ({ id, patch } = {}) => {
  requireStaff();
  return apiCall(api.adminUpdateCollection, getSettings(), requireToken(), id, patch || {});
});
handle('admin:collection-delete', async ({ id } = {}) => {
  requireStaff();
  return apiCall(api.adminDeleteCollection, getSettings(), requireToken(), id);
});
handle('admin:collection-add', async ({ id, assetId, sort } = {}) => {
  requireStaff();
  return apiCall(api.adminAddCollectionItem, getSettings(), requireToken(), id, assetId, sort);
});
handle('admin:collection-remove', async ({ id, assetId } = {}) => {
  requireStaff();
  return apiCall(api.adminRemoveCollectionItem, getSettings(), requireToken(), id, assetId);
});

// ---- 管理台 ----
handle('admin:overview', async () => {
  requireStaff();
  return apiCall(api.adminOverview, getSettings(), requireToken());
});

handle('admin:occupancy', async () => {
  requireStaff();
  return apiCall(api.adminOccupancy, getSettings(), requireToken());
});

handle('admin:users', async (params = {}) => {
  requireStaff();
  return apiCall(api.adminUsers, getSettings(), requireToken(), params);
});

handle('admin:update-user', async ({ id, role, status } = {}) => {
  requireStaff();
  const patch = {};
  if (role) patch.role = role;
  if (status) patch.status = status;

  const data = await apiCall(api.adminUpdateUser, getSettings(), requireToken(), id, patch);
  log(`🛡️ 账号 ${id} 更新: ${JSON.stringify(patch)}`);
  return data;
});

handle('admin:kick-user', async ({ id } = {}) => {
  requireStaff();
  const data = await apiCall(api.adminKickUser, getSettings(), requireToken(), id);
  log(`🛡️ 账号 ${id} 已被强制下线`);
  return data;
});

handle('admin:reset-password', async ({ id } = {}) => {
  requireStaff();
  const data = await apiCall(api.adminResetPassword, getSettings(), requireToken(), id);
  log(`🛡️ 账号 ${id} 密码已重置为临时密码`);
  return data;
});

handle('admin:delete-user', async ({ id } = {}) => {
  requireOwner();
  const data = await apiCall(api.adminDeleteUser, getSettings(), requireToken(), id);
  log(`🛡️ 账号 ${id} 已被注销`);
  return data;
});

handle('admin:invites', async () => {
  requireOwner();
  return apiCall(api.adminInvites, getSettings(), requireToken());
});

handle('admin:invite-create', async ({ count } = {}) => {
  requireOwner();
  const data = await apiCall(api.adminCreateInvites, getSettings(), requireToken(), count || 1);
  log(`🛡️ 已生成 ${data.codes?.length || 0} 个邀请码`);
  return data;
});

handle('admin:invite-toggle', async ({ enabled } = {}) => {
  requireOwner();
  const data = await apiCall(api.adminToggleInvites, getSettings(), requireToken(), Boolean(enabled));
  log(`🛡️ 邀请注册已${data.required ? '开启' : '关闭'}`);
  return data;
});

handle('admin:invite-disable', async ({ code } = {}) => {
  requireOwner();
  const data = await apiCall(api.adminDisableInvite, getSettings(), requireToken(), code);
  log(`🛡️ 邀请码 ${code} 已停用`);
  return data;
});

handle('admin:assets', async ({ status } = {}) => {
  requireStaff();
  return apiCall(api.adminAssets, getSettings(), requireToken(), status || 'pending');
});

handle('admin:asset-status', async ({ id, status } = {}) => {
  requireStaff();
  const data = await apiCall(api.setAssetStatus, getSettings(), requireToken(), id, status);
  log(`🛡️ 资源 ${id} 状态: ${status}`);
  return data.asset;
});

handle('admin:audit', async (params = {}) => {
  requireAdminRole();
  return apiCall(api.adminAudit, getSettings(), requireToken(), params);
});

handle('admin:transfer-owner', async ({ userId } = {}) => {
  requireOwner();
  const data = await apiCall(api.adminTransferOwner, getSettings(), requireToken(), userId);
  log(`🛡️ 所有权已转让给 ${data.owner}`);
  return data;
});
handle('admin:platform', async () => {
  requireStaff();
  return apiCall(api.adminPlatform, getSettings(), requireToken());
});

handle('admin:update-platform', async (patch = {}) => {
  requireStaff();
  const data = await apiCall(api.adminUpdatePlatform, getSettings(), requireToken(), patch);
  log('🛠️ 运营设置已更新（公告 / 维护模式）');
  return data;
});

handle('admin:servers', async () => {
  requireStaff();
  return apiCall(api.adminServers, getSettings(), requireToken());
});

handle('admin:ranks', async () => {
  requireAdminRole();
  return apiCall(api.adminRanks, getSettings(), requireToken());
});

handle('admin:save-ranks', async ({ ranks } = {}) => {
  requireAdminRole();
  const data = await apiCall(api.adminSaveRanks, getSettings(), requireToken(), ranks);
  log('🏅 更新格斗等级配置');
  return data;
});

handle('admin:create-server', async (payload = {}) => {
  requireStaff();
  const data = await apiCall(api.adminCreateServer, getSettings(), requireToken(), payload);
  log(`🖥️ 新增服务器 ${payload.serverKey || ''}`);
  return data;
});

handle('admin:update-server', async ({ serverKey, ...patch } = {}) => {
  requireStaff();
  const data = await apiCall(api.adminUpdateServer, getSettings(), requireToken(), serverKey, patch);
  log(`🖥️ 更新服务器 ${serverKey}`);
  return data;
});

// ---- 开发者工具 ----
handle('devtools:open', async () => {
  requireAdminRole();
  if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
  return true;
});

// ---- 窗口 ----
handle('window:minimize', async () => {
  if (mainWindow) mainWindow.minimize();
  return true;
});

handle('window:close', async () => {
  if (mainWindow) mainWindow.close();
  return true;
});

// ================= 启动 =================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    getSettings();
    getSession();
    log(`🧩 启动器 v${app.getVersion()} 就绪，API=${getSettings().apiBaseUrl}`);
    setupAutoUpdater();
    createWindow();
    createTray();
    setTimeout(() => submitPendingResult(0), 6000);

    // 启动 8 秒后静默检查一次；没配更新源就跳过
    setTimeout(() => {
      if (!app.isPackaged) return;
      autoCheckOnce().catch((err) => updateLog('auto check failed', err.message));
    }, 8000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    stopGameWatcher();
    if (activeEngineCfg && core.restoreEngineCfg(activeEngineCfg)) {
      log('🎛 已还原 engine.cfg');
      activeEngineCfg = '';
    }
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
