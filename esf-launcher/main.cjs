const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Query } = require('goldsrc-query');
const core = require('./launcher-core.cjs');

// ================= 全局配置 =================
const CONFIG_PATH = path.join(__dirname, 'config.json');

let HL_EXE_PATH = '';
let ESF_MOD_DIR = '';

// 统一日志：控制台 + 模组目录下的 esf_launcher.log（打包后没有控制台，靠这个排查）
function log(...args) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${args.join(' ')}`;
  console.log(line);
  core.appendLog(ESF_MOD_DIR, line);
}

// 读取本地配置
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log('ℹ️ 未找到 config.json，请先在启动器里设置游戏目录');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    HL_EXE_PATH = data.hlPath || '';
    ESF_MOD_DIR = data.esfModDir || '';
    log('✅ 已加载配置:', JSON.stringify({ hlPath: HL_EXE_PATH, esfModDir: ESF_MOD_DIR }));

    if (HL_EXE_PATH && !fs.existsSync(HL_EXE_PATH)) log('⚠️ 配置里的 hl.exe 不存在:', HL_EXE_PATH);
    if (ESF_MOD_DIR && !fs.existsSync(ESF_MOD_DIR)) log('⚠️ 配置里的模组目录不存在:', ESF_MOD_DIR);
  } catch (e) {
    console.error('读取配置失败', e);
  }
}

function saveConfig() {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ hlPath: HL_EXE_PATH, esfModDir: ESF_MOD_DIR }, null, 2),
    'utf8'
  );
}

function getModName() {
  return ESF_MOD_DIR ? path.basename(ESF_MOD_DIR) : '';
}

/**
 * 拉起 hl.exe。
 * 用 spawn + 参数数组而不是 exec + 拼接字符串：
 * 路径里有中文/空格（G:\FCX1\FCX7.02融合版）也不会被 shell 改写，
 * 同时不会闪一个 cmd 黑框。
 */
function spawnGame(args) {
  const gameDir = path.dirname(HL_EXE_PATH);
  log('🚀 启动命令:', core.formatCommand(HL_EXE_PATH, args));

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(HL_EXE_PATH, args, {
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
      reject(err);
    });
  });
}

/** 启动前的通用检查，返回错误信息（正常时返回空串） */
function checkGameDir() {
  if (!HL_EXE_PATH || !ESF_MOD_DIR) return '请先设置游戏目录！';
  if (!fs.existsSync(HL_EXE_PATH)) return `找不到 hl.exe：${HL_EXE_PATH}`;
  if (!fs.existsSync(ESF_MOD_DIR)) return `找不到模组目录：${ESF_MOD_DIR}`;
  if (!getModName()) return '模组目录不合法';
  return '';
}

/**
 * 写入 Token + 清理旧 Token。
 * 返回 { token, username } 或抛出错误。
 */
function prepareLaunch(username) {
  const token = core.createToken();
  const safeUser = core.sanitizeInfoValue(username, `Player_${token.slice(0, 4)}`);

  const cfgPath = core.writeLauncherCfg(ESF_MOD_DIR, token, safeUser);
  log(`📝 已写入 ${path.basename(cfgPath)}`, `token=${token}`, `user=${safeUser}`);

  // 关键修复：config.cfg 里若残留上一次的 Token，会在 exec 时把新 Token 覆盖掉
  const { cleaned, failed } = core.stripStalePlatformInfo(ESF_MOD_DIR);
  if (cleaned.length > 0) log('🧹 已清除旧 Token 残留:', cleaned.join(', '));
  for (const item of failed) log(`⚠️ 无法清理 ${item.name}: ${item.error}`);

  return { token, username: safeUser };
}

// 创建窗口
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 1024,
    useContentSize: true,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 开发时连 Vite dev server，打包后直接加载 dist（file:// 需要 vite base: './'）
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  }
}

// ================= IPC 接口 =================

// 1. 扫描地图
ipcMain.handle('scan-maps', async () => {
  if (!ESF_MOD_DIR) return [];
  const mapsDir = path.join(ESF_MOD_DIR, 'maps');
  try {
    const files = fs.readdirSync(mapsDir);
    return files
      .filter(f => f.toLowerCase().endsWith('.bsp'))
      .map(f => f.replace(/\.bsp$/i, ''));
  } catch (error) {
    console.error("找不到地图目录", error);
    return [];
  }
});

// 2. 选择游戏目录
ipcMain.handle('select-game-dir', async () => {
  const result = await dialog.showOpenDialog({
    title: '请选择包含 hl.exe 的半条命根目录',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '已取消选择' };
  }

  const selectedDir = result.filePaths[0];
  const { hlPath, modDir } = core.resolveGameFiles(selectedDir);

  if (!hlPath || !modDir) {
    return {
      success: false,
      message: '选择的目录无效，找不到 hl.exe 或 esf 模组文件夹！'
    };
  }

  HL_EXE_PATH = hlPath;
  ESF_MOD_DIR = modDir;
  saveConfig();
  log('⚙️ 已更新游戏目录:', `hl.exe=${HL_EXE_PATH}`, `mod=${ESF_MOD_DIR}`);

  return { success: true, path: selectedDir, hlPath, modDir };
});

// 3. 启动游戏（本地开图）
ipcMain.handle('launch-game', async (event, config = {}) => {
  const { map, username } = config;

  const problem = checkGameDir();
  if (problem) return { success: false, message: problem };

  const safeMap = core.sanitizeMapName(map);
  if (!safeMap) return { success: false, message: '请先选择地图！' };

  let token;
  try {
    ({ token } = prepareLaunch(username));
  } catch (err) {
    return { success: false, message: '写入配置失败: ' + err.message };
  }

  const args = core.buildLocalArgs(getModName(), safeMap);
  try {
    await spawnGame(args);
  } catch (err) {
    return { success: false, message: '游戏启动失败: ' + err.message };
  }

  return { success: true, token, map: safeMap };
});

// 4. 查询服务器列表
ipcMain.handle('query-servers', async () => {
  const testServers = [
    { ip: '114.132.84.150', port: 27016, name: 'FCX 单挑房[1]' }
  ];

  const results = [];

  for (const server of testServers) {
    let isOnline = false;
    let serverData = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const query = new Query(server.ip, server.port);

      try {
        query.connect();

        // 🚀 自己计算 Ping：记录发送请求前的时间
        const startTime = Date.now();

        const info = await Promise.race([
          query.serverInfo(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Info Timeout')), 3000))
        ]);

        // 🚀 计算真实 Ping
        const pingVal = Date.now() - startTime;

        // 🚀 获取玩家列表
        let playersList = [];
        try {
          playersList = await Promise.race([
            query.players(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Players Timeout')), 2000))
          ]);
        } catch (e) {
          console.log(`获取玩家列表失败: ${server.ip}`);
        }

        serverData = {
          ip: server.ip,
          port: server.port,
          name: info.name || server.name,
          map: info.map,
          players: info.players,
          maxPlayers: info.max_players,
          ping: pingVal,
          online: true,
          // 整理玩家数据
          playerList: playersList.map(p => ({
            name: p.name,
            score: p.score,
            time: p.time // 在线时长
          }))
        };

        isOnline = true;
        break;
      } catch (err) {
        console.log(`[第${attempt}次尝试] 查询 ${server.ip} 失败:`, err.message);
      } finally {
        query.close();
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (isOnline && serverData) {
      results.push(serverData);
    } else {
      results.push({
        ip: server.ip, port: server.port, name: server.name,
        map: 'N/A', players: 0, maxPlayers: 0, ping: -1, online: false, playerList: []
      });
    }
  }
  return results;
});

// 5. 一键加入服务器
ipcMain.handle('join-server', async (event, payload = {}) => {
  const { ip, port, username } = payload;

  const problem = checkGameDir();
  if (problem) return { success: false, message: problem };

  // 校验地址，防止拼出奇怪的东西交给引擎
  const host = String(ip || '').trim();
  const portNum = Number.parseInt(port, 10);
  if (!/^[0-9A-Za-z.-]+$/.test(host)) return { success: false, message: '服务器地址不合法。' };
  if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
    return { success: false, message: '服务器端口不合法。' };
  }
  const address = `${host}:${portNum}`;

  let token;
  try {
    ({ token } = prepareLaunch(username));
  } catch (err) {
    return { success: false, message: '写入配置失败: ' + err.message };
  }

  // 核心：+exec 先把 Token 放进 userinfo，+connect 再连过去
  const args = core.buildJoinArgs(getModName(), address);
  try {
    await spawnGame(args);
  } catch (err) {
    return { success: false, message: '连服失败: ' + err.message };
  }

  log(`🌐 正在连接 ${address}`);
  return { success: true, token, address };
});

// ================= 启动 Electron =================
loadConfig();

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
