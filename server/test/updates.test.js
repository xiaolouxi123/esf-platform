'use strict';

/**
 * 更新源 / 差量下载 / 更新包上传 的接口测试。
 * 这个文件自己准备临时 UPDATE_DIR，不依赖真实安装包。
 */

process.env.NODE_ENV = 'test';
process.env.UPDATE_UPLOAD_TOKEN = 'test-update-token';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esf-updates-'));
process.env.UPDATE_DIR = tempDir;

const app = require('../src/app');

let server;
let base;

before(async () => {
  fs.writeFileSync(path.join(tempDir, 'demo.bin'), Buffer.alloc(1000, 7));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('完整下载更新文件', async () => {
  const res = await fetch(`${base}/updates/demo.bin`);
  assert.equal(res.status, 200);
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.length, 1000);
});

test('单段 Range 返回 206', async () => {
  const res = await fetch(`${base}/updates/demo.bin`, {
    headers: { range: 'bytes=0-99' },
  });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-99/1000');
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.length, 100);
});

test('多段 Range 返回 multipart/byteranges（差量更新依赖）', async () => {
  const res = await fetch(`${base}/updates/demo.bin`, {
    headers: { range: 'bytes=0-9,20-29,100-149' },
  });
  assert.equal(res.status, 206);
  assert.match(res.headers.get('content-type') || '', /^multipart\/byteranges;\s*boundary=/);

  const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
  const parts = body.match(/Content-Range: bytes/g) || [];
  assert.equal(parts.length, 3);
  assert.match(body, /Content-Range: bytes 0-9\/1000/);
  assert.match(body, /Content-Range: bytes 20-29\/1000/);
  assert.match(body, /Content-Range: bytes 100-149\/1000/);
});

test('更新包上传需要令牌', async () => {
  const res = await fetch(`${base}/api/admin/update-upload?name=latest.yml`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: 'version: 1.0.0',
  });
  assert.equal(res.status, 403);
});

test('更新包上传成功', async () => {
  const res = await fetch(`${base}/api/admin/update-upload?name=latest.yml`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-update-token': 'test-update-token',
    },
    body: 'version: 1.0.0\n',
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.name, 'latest.yml');
  assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 1.0.0\n');
});

test('拒绝上传非更新文件', async () => {
  const res = await fetch(`${base}/api/admin/update-upload?name=evil.html`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-update-token': 'test-update-token',
    },
    body: '<script>alert(1)</script>',
  });
  assert.equal(res.status, 400);
  assert.equal(fs.existsSync(path.join(tempDir, 'evil.html')), false);
});
