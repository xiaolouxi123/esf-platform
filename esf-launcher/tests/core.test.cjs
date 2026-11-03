'use strict';

// 临时自测：直接加载 launcher-core.cjs（跑的就是线上代码，不是复制品）
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const core = require('../launcher-core.cjs');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esf-core-'));

console.log('== 1. Token 生成 ==');
check('22 位且每次不同', () => {
  const a = core.createToken();
  const b = core.createToken();
  assert.strictEqual(a.length, 22);
  assert.notStrictEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

console.log('== 2. userinfo 清洗 ==');
check('去掉引号/反斜杠/分号', () => {
  const out = core.sanitizeInfoValue('he"ll\\o;wo', 'fb');
  assert.ok(!/["\\;]/.test(out), '危险字符必须消失: ' + out);
  assert.strictEqual(out, 'hellowo');
});
check('去掉换行、双斜杠，不产生 cfg 注入', () => {
  const out = core.sanitizeInfoValue('a\nb//c', 'fb');
  assert.ok(!/[\r\n]/.test(out), '不能残留换行');
  assert.ok(!out.includes('//'), '不能残留注释符');
  assert.strictEqual(out, 'a bc');
});
check('空值回退到 fallback', () => {
  assert.strictEqual(core.sanitizeInfoValue('   ', 'Player_x'), 'Player_x');
  assert.strictEqual(core.sanitizeInfoValue(null, 'Player_x'), 'Player_x');
});
check('中文名保留', () => {
  assert.strictEqual(core.sanitizeInfoValue('悟空'), '悟空');
});
check('地图名防注入但保留中文', () => {
  assert.strictEqual(core.sanitizeMapName('esf_arena'), 'esf_arena');
  assert.strictEqual(core.sanitizeMapName('地图"1\n'), '地图1');
  assert.strictEqual(core.sanitizeMapName('has space'), '');
});

console.log('== 3. launcher.cfg 内容 ==');
check('只含 setinfo，不含 connect/map', () => {
  const cfg = core.buildLauncherCfg('TOKEN123', '悟空');
  assert.ok(cfg.includes('setinfo "_platform_token" "TOKEN123"'));
  assert.ok(cfg.includes('setinfo "_platform_user" "悟空"'));
  assert.ok(!/connect/i.test(cfg), 'cfg 里不应再有 connect');
  assert.ok(!/^map\s/m.test(cfg), 'cfg 里不应再有 map');
});

console.log('== 4. 清理残留 Token ==');
const mod = path.join(tmp, 'esf');
fs.mkdirSync(mod, { recursive: true });

// 模拟真实 config.cfg：UTF-8 中文名 + 旧的平台字段 + 其他 setinfo
const configLines = [
  'unbindall',
  'name "啊"',
  'setinfo "_platform_token" "STALE_TOKEN_OLD"',
  'setinfo "_platform_user" "admin"',
  'setinfo "_pw" "23"',
  'exec userconfig.cfg',
  '',
];
fs.writeFileSync(path.join(mod, 'config.cfg'), configLines.join('\r\n'), 'utf8');
fs.writeFileSync(path.join(mod, 'autoexec.cfg'), 'sv_lan "0"\r\nsetinfo _platform_token "OLD2"\r\n', 'utf8');
fs.writeFileSync(path.join(mod, 'userconfig.cfg'), 'cam_snapto "1"\r\n', 'utf8');

const before = fs.readFileSync(path.join(mod, 'config.cfg'));
const result = core.stripStalePlatformInfo(mod);
const after = fs.readFileSync(path.join(mod, 'config.cfg'));

check('识别到需要清理的文件', () => {
  assert.deepStrictEqual(result.cleaned.sort(), ['autoexec.cfg', 'config.cfg']);
  assert.strictEqual(result.failed.length, 0);
});
check('旧 Token 行已删除', () => {
  const text = after.toString('utf8');
  assert.ok(!text.includes('_platform_token'));
  assert.ok(!text.includes('_platform_user'));
});
check('其他行与中文名字节完全保留', () => {
  const text = after.toString('utf8');
  assert.ok(text.includes('name "啊"'));
  assert.ok(text.includes('setinfo "_pw" "23"'));
  assert.ok(text.includes('exec userconfig.cfg'));
  // 逐字节校验：只少了那两行
  const expected = Buffer.from(
    ['unbindall', 'name "啊"', 'setinfo "_pw" "23"', 'exec userconfig.cfg', ''].join('\r\n'),
    'utf8'
  );
  assert.strictEqual(Buffer.compare(after, expected), 0);
  assert.ok(before.length > after.length);
});
check('清理是幂等的（第二次不再改动）', () => {
  const again = core.stripStalePlatformInfo(mod);
  assert.deepStrictEqual(again.cleaned, []);
  assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(mod, 'config.cfg')), after), 0);
});

console.log('== 5. 启动参数顺序 ==');
check('连服：+exec 在 +connect 之前，且 -game 用真实目录名', () => {
  const args = core.buildJoinArgs('esf', '1.2.3.4:27015');
  assert.deepStrictEqual(args, ['-game', 'esf', '+exec', 'launcher.cfg', '+connect', '1.2.3.4:27015']);
  assert.ok(args.indexOf('+exec') < args.indexOf('+connect'));
});
check('本地开图参数', () => {
  assert.deepStrictEqual(
    core.buildLocalArgs('esf', 'esf_cell'),
    [
      '-game', 'esf', '+exec', 'launcher.cfg', '+map', 'esf_cell',
      '+maxplayers', '10', '+sv_lan', '1', '+mp_gamemode', '2',
    ]
  );
  assert.equal(core.buildLocalArgs('esf', 'esf_cell', 'deathmatch').at(-1), '0');
});
check('启动前写入 game.cfg 的模式', () => {
  fs.writeFileSync(path.join(mod, 'game.cfg'), '"mp_gamemode" "2"\r\n', 'latin1');
  const result = core.applyLocalGameMode(mod, 'deathmatch');
  const text = fs.readFileSync(path.join(mod, 'game.cfg'), 'latin1');
  assert.equal(result.mode, 0);
  assert.match(text, /"mp_gamemode" "0"/);
  assert.match(text, /esf_force_gamemode "0"/);

  core.applyLocalGameMode(mod, 'team');
  assert.match(fs.readFileSync(path.join(mod, 'game.cfg'), 'latin1'), /"mp_gamemode" "2"/);
});
check('命令格式化会加引号', () => {
  assert.strictEqual(
    core.formatCommand('C:\\a b\\hl.exe', ['-game', 'esf']),
    '"C:\\a b\\hl.exe" -game esf'
  );
});

console.log('== 6. 目录识别 ==');
check('esf 目录优先', () => {
  fs.mkdirSync(path.join(mod, 'maps'), { recursive: true });
  fs.writeFileSync(path.join(mod, 'maps', 'a.bsp'), '');
  assert.strictEqual(core.findModDir(tmp), mod);
});
check('选中根目录能解析出 hl.exe + modDir', () => {
  fs.writeFileSync(path.join(tmp, 'HL.EXE'), ''); // 大小写混写，验证不区分大小写
  const r = core.resolveGameFiles(tmp);
  assert.strictEqual(r.hlPath, path.join(tmp, 'HL.EXE'));
  assert.strictEqual(r.modDir, mod);
});
check('直接选中 esf 文件夹也能解析', () => {
  const r = core.resolveGameFiles(mod);
  assert.strictEqual(r.hlPath, path.join(tmp, 'HL.EXE'));
  assert.strictEqual(r.modDir, mod);
});
check('整合包改了模组名也能认出来（不写死 esf）', () => {
  const other = path.join(tmp, 'fcx');
  fs.mkdirSync(path.join(other, 'maps'), { recursive: true });
  fs.writeFileSync(path.join(other, 'liblist.gam'), '');
  // 删掉 esf 以模拟没有 esf 目录的整合包
  fs.rmSync(mod, { recursive: true, force: true });
  assert.strictEqual(core.findModDir(tmp), other);
  assert.strictEqual(core.resolveGameFiles(tmp).modDir, other);
});
check('无效目录返回空', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'esf-none-'));
  assert.deepStrictEqual(core.resolveGameFiles(empty), { hlPath: '', modDir: '', root: empty });
  fs.rmSync(empty, { recursive: true, force: true });
});

console.log('== 7. 日志写入 ==');
check('写日志且超限自动清空', () => {
  const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'esf-log-'));
  core.appendLog(ldir, 'hello');
  assert.ok(fs.readFileSync(path.join(ldir, core.LOG_NAME), 'utf8').includes('hello'));
  fs.writeFileSync(path.join(ldir, core.LOG_NAME), 'x'.repeat(core.MAX_LOG_BYTES ? 300 * 1024 : 0));
  core.appendLog(ldir, 'after-rotate');
  const text = fs.readFileSync(path.join(ldir, core.LOG_NAME), 'utf8');
  assert.strictEqual(text, 'after-rotate\r\n');
  fs.rmSync(ldir, { recursive: true, force: true });
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n通过 ${passed} 项检查${process.exitCode ? '（存在失败）' : ''}`);
