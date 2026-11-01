'use strict';

/**
 * 临时集成测试：在临时目录里跑真实的 main.cjs。
 * 只把 electron / child_process / goldsrc-query 换成桩，
 * 不写、不动真实游戏目录，也不会真的启动游戏。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');

const handlers = new Map();
const spawned = [];
let dialogResult = { canceled: true, filePaths: [] };

// ---------- 桩模块 ----------
const electronStub = {
  app: {
    whenReady: () => new Promise(() => {}), // 永不 resolve：不创建窗口
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {},
  dialog: { showOpenDialog: async () => dialogResult },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
};

const cpStub = {
  spawn(exe, args, opts) {
    spawned.push({ exe, args, opts });
    const child = new EventEmitter();
    child.pid = 4242;
    child.unref = () => {};
    setImmediate(() => child.emit('spawn'));
    return child;
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'child_process') return cpStub;
  if (request === 'goldsrc-query') return { Query: class { connect() {} close() {} } };
  return originalLoad.call(this, request, parent, isMain);
};

// ---------- 临时工程副本 ----------
const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'esf-main-'));
for (const f of ['main.cjs', 'launcher-core.cjs']) {
  fs.copyFileSync(path.join(__dirname, '..', f), path.join(tmpProj, f));
}

// 模拟真实的整合包路径：带中文、带空格
const gameRoot = path.join(tmpProj, 'FCX7.02 融合版');
const modDir = path.join(gameRoot, 'esf');
fs.mkdirSync(path.join(modDir, 'maps'), { recursive: true });
fs.writeFileSync(path.join(gameRoot, 'hl.exe'), '');
fs.writeFileSync(path.join(modDir, 'maps', 'esf_cell.bsp'), '');
fs.writeFileSync(path.join(modDir, 'maps', 'esf_arena.bsp'), '');
fs.writeFileSync(
  path.join(modDir, 'config.cfg'),
  'name "啊"\r\nsetinfo "_platform_token" "STALE_TOKEN_FROM_LAST_RUN"\r\nsetinfo "_platform_user" "admin"\r\nsetinfo "_pw" "23"\r\n',
  'utf8'
);

const hlPath = path.join(gameRoot, 'hl.exe');
fs.writeFileSync(
  path.join(tmpProj, 'config.json'),
  JSON.stringify({ hlPath, esfModDir: modDir }, null, 2),
  'utf8'
);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    console.log('  FAIL  ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

(async () => {
  // 加载真实 main.cjs（会执行 loadConfig）
  require(path.join(tmpProj, 'main.cjs'));

  console.log('== 1. IPC 注册 ==');
  check('五个接口都注册了', () => {
    for (const ch of ['scan-maps', 'select-game-dir', 'launch-game', 'query-servers', 'join-server']) {
      assert.ok(handlers.has(ch), '缺少 ' + ch);
    }
  });

  const scanMaps = handlers.get('scan-maps');
  const maps = await scanMaps({});
  check('扫描到 2 张 .bsp 地图', () => {
    assert.deepStrictEqual(maps.sort(), ['esf_arena', 'esf_cell']);
  });

  console.log('== 2. 一键连服（核心） ==');
  const res = await handlers.get('join-server')({}, {
    ip: '114.132.84.150',
    port: 27016,
    username: '悟空"\\x;quit',
  });

  check('返回成功并带 address', () => {
    assert.strictEqual(res.success, true, JSON.stringify(res));
    assert.strictEqual(res.address, '114.132.84.150:27016');
  });

  check('命令参数顺序：-game → +exec → +connect', () => {
    assert.strictEqual(spawned.length, 1);
    const { exe, args } = spawned[0];
    assert.strictEqual(exe, hlPath);
    assert.deepStrictEqual(args, [
      '-game', 'esf', '+exec', 'launcher.cfg', '+connect', '114.132.84.150:27016',
    ]);
    assert.ok(args.indexOf('+exec') < args.indexOf('+connect'), '+exec 必须在 +connect 之前');
  });

  check('cwd 是 hl.exe 所在目录', () => {
    assert.strictEqual(spawned[0].opts.cwd, gameRoot);
  });

  check('launcher.cfg 里有新 Token，且没有 connect', () => {
    const cfg = fs.readFileSync(path.join(modDir, 'launcher.cfg'), 'utf8');
    assert.ok(cfg.includes(`setinfo "_platform_token" "${res.token}"`), cfg);
    assert.ok(cfg.includes('setinfo "_platform_user" "悟空xquit"'), cfg);
    assert.ok(!/connect/i.test(cfg), 'cfg 里不应再有 connect');
  });

  check('config.cfg 里的旧 Token 已被清除，其余内容保留', () => {
    const text = fs.readFileSync(path.join(modDir, 'config.cfg'), 'utf8');
    assert.ok(!text.includes('STALE_TOKEN_FROM_LAST_RUN'), '旧 Token 必须被清掉');
    assert.ok(!text.includes('_platform_user'), '旧用户名必须被清掉');
    assert.ok(text.includes('name "啊"'));
    assert.ok(text.includes('setinfo "_pw" "23"'));
  });
  const badIp = await handlers.get('join-server')({}, { ip: 'a b;quit', port: 27016 });
  check('带空格/分号的地址直接拒绝', () => {
    assert.strictEqual(badIp.success, false);
    assert.strictEqual(spawned.length, 1, '不应该再启动进程');
  });
  const badPort = await handlers.get('join-server')({}, { ip: '1.2.3.4', port: 99999 });
  check('非法端口直接拒绝', () => {
    assert.strictEqual(badPort.success, false);
  });

  console.log('== 3. 本地开图 ==');
  const launch = await handlers.get('launch-game')({}, { map: 'esf_cell', username: '悟空' });
  check('启动参数正确', () => {
    assert.strictEqual(launch.success, true, JSON.stringify(launch));
    assert.deepStrictEqual(spawned[1].args, [
      '-game', 'esf', '+exec', 'launcher.cfg', '+map', 'esf_cell', '+maxplayers', '10',
    ]);
  });
  const noMap = await handlers.get('launch-game')({}, { map: '', username: 'x' });
  check('没有地图时给出提示', () => {
    assert.strictEqual(noMap.success, false);
    assert.ok(noMap.message.includes('地图'));
  });

  console.log('== 4. 重新选择目录 ==');
  dialogResult = { canceled: false, filePaths: [gameRoot] };
  const sel = await handlers.get('select-game-dir')({});
  check('选中整合包根目录能解析出 esf', () => {
    assert.strictEqual(sel.success, true, JSON.stringify(sel));
    assert.strictEqual(sel.hlPath, hlPath);
    assert.strictEqual(sel.modDir, modDir);
  });
  const saved = JSON.parse(fs.readFileSync(path.join(tmpProj, 'config.json'), 'utf8'));
  check('config.json 已保存', () => {
    assert.strictEqual(saved.hlPath, hlPath);
    assert.strictEqual(saved.esfModDir, modDir);
  });

  dialogResult = { canceled: false, filePaths: [path.join(tmpProj, 'empty')] };
  fs.mkdirSync(path.join(tmpProj, 'empty'), { recursive: true });
  const bad = await handlers.get('select-game-dir')({});
  check('无效目录给出错误信息', () => {
    assert.strictEqual(bad.success, false);
    assert.ok(bad.message.includes('无效'));
  });

  console.log('== 5. 日志 ==');
  check('日志写到了模组目录', () => {
    const log = fs.readFileSync(path.join(modDir, 'esf_launcher.log'), 'utf8');
    assert.ok(log.includes('+connect'), '日志里应有启动命令');
    assert.ok(log.includes('已清除旧 Token 残留'), '日志里应记录清理动作');
  });

  fs.rmSync(tmpProj, { recursive: true, force: true });
  console.log(`\n通过 ${passed} 项检查${process.exitCode ? '（存在失败）' : ''}`);
})();
