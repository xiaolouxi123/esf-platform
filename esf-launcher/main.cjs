const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const core = require('./launcher-core.cjs');
const store = require('./store.cjs');
const api = require('./api.cjs');

// ================= 全局状态 =================
let mainWindow = null;
let settings = null;
let session = null;

function log(...args) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${args.join(' ')}`;
  console.log(line);
  core.appendLog(settings && settings.esfModDir, line);
}

function maskToken(token) {
  const value = String(token || '');
  return value ? `${value.slice(0, 6)}…` : '';
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
  if (!fs.existsSync(current.hlPath)) throw new Error(`找不到 hl.exe：${current.hlPath}`);
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

function spawnGame(args) {
  const current = getSettings();
  const gameDir = path.dirname(current.hlPath);
  log('🚀 启动命令:', core.formatCommand(current.hlPath, args));

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(current.hlPath, args, {
        cwd: gameDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (err) {
      reject(err);
      return;
    }

    child.once('spawn', () => {
      log(`✅ 已拉起 hl.exe (pid=${child.pid})`);
      child.unref();
      resolve(child.pid);
    });

    child.once('error', (err) => {
      log('❌ 启动 hl.exe 失败:', err.message);
      reject(new Error(`游戏启动失败：${err.message}`));
    });
  });
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
}));

handle('config:get', async () => api.config(getSettings()));

// ---- 设置 ----
handle('settings:get', async () => getSettings());

handle('settings:update', async (patch) => {
  settings = store.saveSettings(patch);
  return settings;
});

handle('dialog:pick-game-dir', async () => {
  const result = await dialog.showOpenDialog({
    title: '请选择包含 hl.exe 的半条命根目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    throw new api.ApiError('已取消选择', 'CANCELED');
  }

  const { hlPath, modDir } = core.resolveGameFiles(result.filePaths[0]);
  if (!hlPath || !modDir) {
    throw new api.ApiError('选择的目录无效，找不到 hl.exe 或 esf 模组文件夹', 'INVALID_GAME_DIR');
  }

  settings = store.saveSettings({ hlPath, esfModDir: modDir });
  log('⚙️ 已更新游戏目录:', `hl.exe=${hlPath}`, `mod=${modDir}`);
  return { hlPath, modDir };
});

// ---- 账号 ----
handle('auth:login', async ({ username, password }) => {
  const data = await apiCall(api.login, getSettings(), username, password);
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

// ---- 数据 ----
handle('stats:get', async () => apiCall(api.stats, getSettings(), requireToken()));

handle('servers:list', async () => apiCall(api.servers, getSettings(), requireToken()));

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

  const issued = await apiCall(api.launchToken, getSettings(), requireToken(), serverKey);
  const username = (current.user && (current.user.gameName || current.user.username)) || 'Player';

  prepareLaunch(issued.token, username);

  const address = `${ip}:${port}`;
  await spawnGame(core.buildJoinArgs(modName(), address));
  log(`🌐 正在连接 ${address}`);
  return { address, maskedToken: maskToken(issued.token) };
});

handle('launch:local', async ({ map }) => {
  const current = getSession();
  requireToken();
  checkGameDir();

  const safeMap = core.sanitizeMapName(map);
  if (!safeMap) throw new Error('请先选择地图');

  const issued = await apiCall(api.launchToken, getSettings(), requireToken(), getSettings().localServerKey);
  const username = (current.user && (current.user.gameName || current.user.username)) || 'Player';

  prepareLaunch(issued.token, username);
  await spawnGame(core.buildLocalArgs(modName(), safeMap));
  return { map: safeMap, maskedToken: maskToken(issued.token) };
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
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
