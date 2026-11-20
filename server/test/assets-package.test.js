'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { q, ping, close } = require('../src/db');

const stamp = Date.now().toString(36);
const password = 'AssetPack_1';
const ownerName = 't_asset_owner_' + stamp;
const authorName = 't_asset_author_' + stamp;
let server;
let base;
let ownerToken;
let authorToken;
let ownerId;
let authorId;
let assetId;
let collectionId;

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? form : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, bytes: text };
}

async function login(username) {
  const res = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

function packageForm({ kind, name, version, targetPath, files, tags, compat, changelog, assetId: id }) {
  const form = new FormData();
  form.set('kind', kind);
  form.set('name', name);
  form.set('version', version);
  form.set('targetPath', targetPath);
  if (tags) form.set('tags', tags);
  if (compat) form.set('compat', compat);
  if (changelog) form.set('changelog', changelog);
  if (id) form.set('assetId', String(id));
  form.set('paths', JSON.stringify(files.map((f) => f.path)));
  for (const f of files) {
    form.append('files', new Blob([f.body], { type: 'application/octet-stream' }), f.path.split('/').pop());
  }
  return form;
}

before(async () => {
  assert.ok(await ping(), '数据库不可用');
  const hash = bcrypt.hashSync(password, 4);
  const owner = await q(
    'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
    [ownerName, hash, '资源审核', 'owner']
  );
  const author = await q(
    'INSERT INTO users (username, password_hash, game_name, role) VALUES (?, ?, ?, ?)',
    [authorName, hash, '资源作者', 'user']
  );
  ownerId = owner.insertId;
  authorId = author.insertId;
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  ownerToken = await login(ownerName);
  authorToken = await login(authorName);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (collectionId) await q('DELETE FROM asset_collections WHERE id = ?', [collectionId]);
  if (assetId) await q('DELETE FROM assets WHERE id = ?', [assetId]);
  if (ownerId) await q('DELETE FROM users WHERE id IN (?, ?)', [ownerId, authorId]);
  await close();
});

test('整包上传：多文件、标签、兼容版本与待审状态', async () => {
  const form = packageForm({
    kind: 'model',
    name: '悟空整包测试 ' + stamp,
    version: '1.0.0',
    targetPath: 'models/player/goku/goku.mdl',
    tags: '龙珠,模型',
    compat: 'fcx',
    files: [
      { path: 'models/player/goku/goku.mdl', body: 'MDL-BYTES-' + stamp },
      { path: 'models/player/goku/goku.bmp', body: 'BMP-BYTES-' + stamp },
      { path: 'models/player/goku/readme.txt', body: 'hello' },
    ],
  });
  const res = await api('POST', '/api/assets', { token: authorToken, form });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assetId = res.body.data.asset.id;
  assert.equal(res.body.data.asset.status, 'pending');
  assert.equal(res.body.data.asset.fileCount, 3);
  assert.deepEqual(res.body.data.asset.tags.sort(), ['模型', '龙珠'].sort());
  assert.equal(res.body.data.asset.compat, 'fcx');
  assert.equal(res.body.data.asset.files.length, 3);
});

test('审核通过后公开列表、统计与详情包含包清单', async () => {
  const pending = await api('GET', '/api/admin/assets?status=pending', { token: ownerToken });
  assert.equal(pending.status, 200);
  assert.ok(pending.body.data.assets.some((a) => a.id === assetId));

  const approved = await api('PATCH', '/api/assets/' + assetId + '/status', {
    token: ownerToken,
    body: { status: 'approved', note: '整包验收通过' },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const list = await api('GET', '/api/assets?q=' + encodeURIComponent('悟空整包测试'), { token: authorToken });
  assert.equal(list.status, 200);
  const item = list.body.data.assets.find((a) => a.id === assetId);
  assert.ok(item, '公开列表应包含资源');
  assert.equal(item.fileCount, 3);
  assert.ok(list.body.data.stats.totalDownloads >= 0);

  const detail = await api('GET', '/api/assets/' + assetId, { token: authorToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.asset.files.length, 3);
  assert.equal(detail.body.data.asset.canManage, true);
});

test('逐文件下载返回原始字节与对应文件名', async () => {
  const detail = await api('GET', '/api/assets/' + assetId, { token: authorToken });
  const mdl = detail.body.data.asset.files.find((f) => f.path.endsWith('.mdl'));
  assert.ok(mdl);
  const res = await fetch(base + '/api/assets/' + assetId + '/files/' + mdl.id);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /goku\.mdl/);
  const text = await res.text();
  assert.equal(text, 'MDL-BYTES-' + stamp);
});

test('作者编辑元数据、发布新版本、审核切版本', async () => {
  const patched = await api('PATCH', '/api/assets/' + assetId, {
    token: authorToken,
    body: { name: '悟空整包测试 ' + stamp + ' v2', tags: '龙珠,模型,整包', compat: 'all' },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.data.asset.compat, 'all');

  const form = packageForm({
    assetId,
    kind: 'model',
    name: '悟空整包测试 ' + stamp,
    version: '1.1.0',
    targetPath: 'models/player/goku/goku.mdl',
    changelog: '补全贴图',
    files: [
      { path: 'models/player/goku/goku.mdl', body: 'MDL-V2-' + stamp },
      { path: 'models/player/goku/goku.bmp', body: 'BMP-V2-' + stamp },
    ],
  });
  const pending = await api('POST', '/api/assets', { token: authorToken, form });
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  assert.equal(pending.body.data.versionStatus, 'pending');

  const detail = await api('GET', '/api/assets/' + assetId, { token: authorToken });
  assert.equal(detail.body.data.asset.pendingVersion.version, '1.1.0');
  assert.equal(detail.body.data.asset.version, '1.0.0');

  const review = await api('PATCH', '/api/assets/' + assetId + '/versions/1.1.0/status', {
    token: ownerToken,
    body: { status: 'approved' },
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const after = await api('GET', '/api/assets/' + assetId, { token: authorToken });
  assert.equal(after.body.data.asset.version, '1.1.0');
  assert.equal(after.body.data.asset.files.length, 2);
});

test('评分、评论、举报与合集闭环', async () => {
  const rating = await api('POST', '/api/assets/' + assetId + '/rating', {
    token: ownerToken,
    body: { stars: 5 },
  });
  assert.equal(rating.status, 200, JSON.stringify(rating.body));
  assert.equal(rating.body.data.rating.average, 5);

  const comment = await api('POST', '/api/assets/' + assetId + '/comments', {
    token: ownerToken,
    body: { body: '整包安装正常' },
  });
  assert.equal(comment.status, 201, JSON.stringify(comment.body));
  const comments = await api('GET', '/api/assets/' + assetId + '/comments');
  assert.ok(comments.body.data.comments.some((c) => c.body === '整包安装正常'));

  const report = await api('POST', '/api/assets/' + assetId + '/reports', {
    token: ownerToken,
    body: { reason: '测试举报原因' },
  });
  assert.equal(report.status, 201, JSON.stringify(report.body));
  const reports = await api('GET', '/api/admin/asset-reports', { token: ownerToken });
  assert.ok(reports.body.data.reports.some((r) => r.assetId === assetId));

  const coll = await api('POST', '/api/admin/asset-collections', {
    token: ownerToken,
    body: { title: '测试合集 ' + stamp, slug: 'test-pack-' + stamp, description: '合集' },
  });
  assert.equal(coll.status, 201, JSON.stringify(coll.body));
  collectionId = coll.body.data.id;
  const add = await api('POST', '/api/admin/asset-collections/' + collectionId + '/items', {
    token: ownerToken,
    body: { assetId },
  });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const bySlug = await api('GET', '/api/assets/collections/test-pack-' + stamp);
  assert.equal(bySlug.status, 200);
  assert.ok(bySlug.body.data.assets.some((a) => a.id === assetId));
});
