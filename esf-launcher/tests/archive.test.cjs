'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { extractZip, collectDirectory } = require('../archive.cjs');

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data || '', 'utf8');
    const method = entry.method === undefined ? 8 : entry.method;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const flags = entry.flags || 0;
    const external = entry.external || 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(external, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, eocd]);
}

async function withZip(entries, fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'esf-zip-'));
  const zip = path.join(root, 'test.zip');
  await fsp.writeFile(zip, makeZip(entries));
  try {
    return await fn(zip, root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test('正常解压嵌套文件', async () => {
  await withZip(
    [
      { name: 'models/player/goku/goku.mdl', data: 'MDL' },
      { name: 'models/player/goku/goku.bmp', data: 'BMP' },
      { name: 'readme.txt', data: 'hello' },
    ],
    async (zip, root) => {
      const out = path.join(root, 'out');
      const result = await extractZip(zip, out);
      assert.equal(result.files.length, 3);
      assert.equal(await fsp.readFile(path.join(out, 'models/player/goku/goku.mdl'), 'utf8'), 'MDL');
      assert.equal(await fsp.readFile(path.join(out, 'readme.txt'), 'utf8'), 'hello');
    }
  );
});

test('拒绝 ../ 路径穿越', async () => {
  await withZip([{ name: '../evil.txt', data: 'x' }], async (zip, root) => {
    await assert.rejects(() => extractZip(zip, path.join(root, 'out')), /../);
  });
});

test('拒绝绝对路径', async () => {
  await withZip([{ name: '/evil.txt', data: 'x' }], async (zip, root) => {
    await assert.rejects(() => extractZip(zip, path.join(root, 'out')), /绝对路径/);
  });
});

test('拒绝加密 zip', async () => {
  await withZip([{ name: 'a.txt', data: 'x', flags: 1 }], async (zip, root) => {
    await assert.rejects(() => extractZip(zip, path.join(root, 'out')), /加密/);
  });
});

test('拒绝 zip64 条目数', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'esf-zip64-'));
  const zip = path.join(root, 'test.zip');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8);
  eocd.writeUInt16LE(0xffff, 10);
  await fsp.writeFile(zip, eocd);
  try {
    await assert.rejects(() => extractZip(zip, path.join(root, 'out')), /zip64/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('拒绝符号链接条目', async () => {
  await withZip([{ name: 'link', data: '', external: (0o120777 << 16) >>> 0 }], async (zip, root) => {
    await assert.rejects(() => extractZip(zip, path.join(root, 'out')), /符号链接/);
  });
});

test('总大小超过上限时拒绝', async () => {
  await withZip([{ name: 'a.bin', data: Buffer.alloc(200, 1) }], async (zip, root) => {
    await assert.rejects(
      () => extractZip(zip, path.join(root, 'out'), { limits: { maxTotalBytes: 100 } }),
      /总大小/
    );
  });
});

test('collectDirectory 跳过备份目录与隐藏文件', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'esf-dir-'));
  await fsp.mkdir(path.join(root, 'models'), { recursive: true });
  await fsp.mkdir(path.join(root, '.esf-backup'), { recursive: true });
  await fsp.writeFile(path.join(root, 'models', 'a.mdl'), 'a');
  await fsp.writeFile(path.join(root, '.esf-backup', 'b.mdl'), 'b');
  await fsp.writeFile(path.join(root, '.hidden'), 'h');
  try {
    const files = await collectDirectory(root);
    assert.deepEqual(files.map((file) => file.path), ['models/a.mdl']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
