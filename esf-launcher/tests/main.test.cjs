'use strict';

/**
 * 启动器主进程集成测试。
 *
 * 只把 electron / child_process / fetch 换成桩：
 *   - 不会真的开窗口
 *   - 不会真的拉起 hl.exe
 *   - 不会碰真实的安装目录（settings 与 session 都写在临时 userData 里）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');

const handlers = new Map();
const spawned = [];
const openedPaths = [];
let dialogResult = { canceled: true, filePaths: [] };

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'esf-userdata-'));
const gameRoot = path.join(tmpUserData, 'FCX7.02 融合版');
const modDir = path.join(gameRoot, 'esf');
const hlPath = path.join(gameRoot, 'hl.exe');

// ---------- 假的游戏目录 ----------
fs.mkdirSync(path.join(modDir, 'maps'), { recursive: true });
fs.writeFileSync(hlPath, '');
fs.writeFileSync(path.join(modDir, 'maps', 'esf_cell.bsp'), '');
fs.writeFileSync(path.join(modDir, 'maps', 'ape_ocean.bsp'), '');
fs.writeFileSync(
  path.join(modDir, 'config.cfg'),
  'name "啊"\r\nsetinfo "_platform_token" "STALE_TOKEN"\r\nsetinfo "_platform_user" "admin"\r\nsetinfo "_pw" "23"\r\n',
  'utf8'
);

// ---------- 临时 userData：设置 + 登录态 ----------
const fakeUser = { id: 2, username: 'demo', gameName: '测试玩家', role: 'user' };

fs.writeFileSync(
  path.join(tmpUserData, 'settings.json'),
  JSON.stringify(
    {
      hlPath,
      esfModDir: modDir,
      apiBaseUrl: 'http://127.0.0.1:3000',
      localServerKey: 'fcx-1v1-1',
    },
    null,
    2
  ),
  'utf8'
);
fs.writeFileSync(
  path.join(tmpUserData, 'session.bin'),
  JSON.stringify({ token: 'test-jwt', user: fakeUser }),
  'utf8'
);

// ---------- 桩模块 ----------
const electronStub = {
  app: {
    isPackaged: false,
    getVersion: () => '0.1.0',
    getPath: () => tmpUserData,
    requestSingleInstanceLock: () => true,
    on: () => {},
    whenReady: () => new Promise(() => {}), // 永不 resolve：不创建窗口
    quit: () => {},
  },
  BrowserWindow: class {},
  dialog: { showOpenDialog: async () => dialogResult },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  Menu: { setApplicationMenu: () => {} },
  shell: {
    openPath: async (target) => {
      openedPaths.push(target);
      return '';
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
};

const cpStub = {
  spawn(exe, args, options) {
    spawned.push({ exe, args, options });
    const child = new EventEmitter();
    child.pid = 4321;
    child.unref = () => {};
    setImmediate(() => child.emit('spawn'));
    return child;
  },
};

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'child_process') return cpStub;
  return originalLoad.call(this, request, parent, isMain);
};

// ---------- 假后端 ----------
global.fetch = async (url, options = {}) => {
  const { pathname } = new URL(url);
  const body = options.body ? JSON.parse(options.body) : null;

  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
  const fail = (status, code, message) => ({
    ok: false,
    status,
    json: async () => ({ ok: false, code, message }),
  });

  if (pathname === '/api/me') return ok({ user: fakeUser });
  if (pathname === '/api/me/stats') return ok({ sessions: 3, totalSeconds: 5400, lastPlayedAt: null });
  if (pathname === '/api/servers/lookup') {
    const address = new URL(url).searchParams.get('address');
    return ok({
      server: {
        address,
        ip: '114.132.84.150',
        port: 27016,
        registered: true,
        serverKey: 'fcx-1v1-1',
        registryName: '[ESF-FCX]单挑房[1]',
        online: true,
        name: '[ESF-FCX]单挑房[1]',
        map: 'ape_ocean',
        players: 3,
        maxPlayers: 12,
        ping: 20,
      },
    });
  }
  if (pathname === '/api/servers') {
    return ok({
      servers: [
        {
          serverKey: 'fcx-1v1-1',
          name: '[ESF-FCX]单挑房[1]',
          ip: '114.132.84.150',
          port: 27016,
          online: true,
          players: 3,
          maxPlayers: 12,
          ping: 18,
          map: 'ape_ocean',
        },
      ],
    });
  }
  if (pathname === '/api/launch-token') {
    if (!body || !body.serverKey) return fail(400, 'VALIDATION_FAILED', '缺少 serverKey');
    return ok({
      token: 'abcdef0123456789abcdef0123456789',
      serverKey: body.serverKey,
      expiresAt: '2026-01-01T00:00:00.000Z',
      reused: false,
    });
  }
  if (pathname === '/api/config') return ok({ version: '0.1.0', db: 'up', notice: '' });
  if (pathname === '/api/auth/logout') return ok({ loggedOut: true });
  if (pathname === '/api/auth/login') return ok({ accessToken: 'new-jwt', expiresIn: 60, user: fakeUser });
  if (pathname === '/api/health') return ok({ db: 'up' });

  return fail(404, 'NOT_FOUND', `没有桩: ${pathname}`);
};

// ---------- 断言辅助 ----------
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.log('  FAIL  ' + name + ' -> ' + err.message);
    process.exitCode = 1;
  }
}

function ipc(channel, payload) {
  const handler = handlers.get(channel);
  assert.ok(handler, `IPC 未注册: ${channel}`);
  return handler({}, payload);
}

(async () => {
  require(path.join(__dirname, '..', 'main.cjs'));

  console.log('== 1. IPC 全部注册 ==');
  check('主进程接口齐全', () => {
    const expected = [
      'app:info', 'config:get', 'settings:get', 'settings:update', 'dialog:pick-game-dir',
      'auth:login', 'auth:register', 'auth:me', 'auth:logout',
      'stats:get', 'servers:list', 'maps:scan',
      'launch:token', 'launch:join', 'launch:local',
      'shell:open-data-dir', 'shell:open-game-dir',
      'window:minimize', 'window:close',
    ];
    for (const channel of expected) assert.ok(handlers.has(channel), '缺少 ' + channel);
  });

  console.log('== 2. 基础信息 / 设置 / 地图 ==');
  const info = await ipc('app:info');
  check('app:info 返回版本与数据目录', () => {
    assert.equal(info.ok, true);
    assert.equal(info.data.version, '0.1.0');
    assert.equal(info.data.userDataDir, tmpUserData);
  });

  const settings = await ipc('settings:get');
  check('设置来自 userData 而非安装目录', () => {
    assert.equal(settings.data.hlPath, hlPath);
    assert.equal(settings.data.esfModDir, modDir);
  });

  const maps = await ipc('maps:scan');
  check('扫描地图', () => {
    assert.deepEqual(maps.data, ['ape_ocean', 'esf_cell']);
  });

  console.log('== 3. 账号态 ==');
  const me = await ipc('auth:me');
  check('auth:me 走真实接口并返回用户', () => {
    assert.equal(me.ok, true);
    assert.equal(me.data.user.username, 'demo');
    assert.equal(me.data.user.gameName, '测试玩家');
  });

  const stats = await ipc('stats:get');
  check('个人战绩', () => {
    assert.equal(stats.data.sessions, 3);
  });

  console.log('== 4. 服务器与连服（核心） ==');
  const servers = await ipc('servers:list');
  check('服务器列表来自后端', () => {
    assert.equal(servers.ok, true);
    assert.equal(servers.data.servers[0].serverKey, 'fcx-1v1-1');
  });

  const lookup = await ipc('servers:lookup', { address: '114.132.84.150:27016' });
  check('直连查询返回在线信息与登记状态', () => {
    assert.equal(lookup.ok, true, JSON.stringify(lookup));
    assert.equal(lookup.data.online, true);
    assert.equal(lookup.data.registered, true);
    assert.equal(lookup.data.serverKey, 'fcx-1v1-1');
    assert.equal(lookup.data.address, '114.132.84.150:27016');
  });

  const lookupEmpty = await ipc('servers:lookup', { address: '   ' });
  check('空地址被拒绝', () => assert.equal(lookupEmpty.ok, false));

  const join = await ipc('launch:join', { serverKey: 'fcx-1v1-1', ip: '114.132.84.150', port: 27016 });
  check('连服成功并返回地址', () => {
    assert.equal(join.ok, true, JSON.stringify(join));
    assert.equal(join.data.address, '114.132.84.150:27016');
  });

  check('启动参数：-game → +exec → +connect', () => {
    const last = spawned[spawned.length - 1];
    assert.deepEqual(last.args, [
      '-game', 'esf', '+exec', 'launcher.cfg', '+connect', '114.132.84.150:27016',
    ]);
    assert.equal(last.exe, hlPath);
    assert.equal(last.options.cwd, gameRoot);
  });

  check('launcher.cfg 用的是后端签发的 Token', () => {
    const cfg = fs.readFileSync(path.join(modDir, 'launcher.cfg'), 'utf8');
    assert.ok(cfg.includes('setinfo "_platform_token" "abcdef0123456789abcdef0123456789"'), cfg);
    assert.ok(cfg.includes('setinfo "_platform_user" "测试玩家"'), cfg);
    assert.ok(!/connect/i.test(cfg));
  });

  check('config.cfg 里的旧 Token 已被清掉', () => {
    const cfg = fs.readFileSync(path.join(modDir, 'config.cfg'), 'utf8');
    assert.ok(!cfg.includes('STALE_TOKEN'));
    assert.ok(cfg.includes('name "啊"'));
    assert.ok(cfg.includes('setinfo "_pw" "23"'));
  });

  console.log('== 5. 本地开图 ==');
  const local = await ipc('launch:local', { map: 'esf_cell' });
  check('本地开图参数', () => {
    assert.equal(local.ok, true, JSON.stringify(local));
    const last = spawned[spawned.length - 1];
    assert.deepEqual(last.args, [
      '-game', 'esf', '+exec', 'launcher.cfg', '+map', 'esf_cell', '+maxplayers', '10',
    ]);
  });

  const badMap = await ipc('launch:local', { map: '' });
  check('空地图被拒绝', () => assert.equal(badMap.ok, false));

  console.log('== 6. 目录选择 ==');
  dialogResult = { canceled: false, filePaths: [gameRoot] };
  const picked = await ipc('dialog:pick-game-dir');
  check('选择根目录能解析出 esf', () => {
    assert.equal(picked.ok, true, JSON.stringify(picked));
    assert.equal(picked.data.hlPath, hlPath);
    assert.equal(picked.data.modDir, modDir);
  });

  dialogResult = { canceled: true, filePaths: [] };
  const canceled = await ipc('dialog:pick-game-dir');
  check('取消选择返回 CANCELED', () => {
    assert.equal(canceled.ok, false);
    assert.equal(canceled.code, 'CANCELED');
  });

  console.log('== 7. 打开目录 / 窗口 ==');
  await ipc('shell:open-data-dir');
  await ipc('shell:open-game-dir');
  check('openPath 只打开受控目录', () => {
    assert.deepEqual(openedPaths, [tmpUserData, modDir]);
  });

  const min = await ipc('window:minimize');
  check('最小化不报错', () => assert.equal(min.ok, true));

  console.log('== 8. 退出登录 ==');
  const logout = await ipc('auth:logout');
  check('退出返回成功', () => assert.equal(logout.ok, true));

  const meAfter = await ipc('auth:me');
  check('退出后 auth:me 返回 AUTH_REQUIRED', () => {
    assert.equal(meAfter.ok, false);
    assert.equal(meAfter.code, 'AUTH_REQUIRED');
  });

  const joinAfter = await ipc('launch:join', { serverKey: 'fcx-1v1-1', ip: '1.2.3.4', port: 27015 });
  check('未登录不能连服', () => {
    assert.equal(joinAfter.ok, false);
    assert.equal(joinAfter.code, 'AUTH_REQUIRED');
  });

  fs.rmSync(tmpUserData, { recursive: true, force: true });
  console.log(`\n通过 ${passed} 项检查${process.exitCode ? '（存在失败）' : ''}`);
})();
