'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { z } = require('zod');

const env = require('../env');
const { q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { badRequest, notFound, forbidden } = require('../lib/errors');

const router = express.Router();
const UPLOAD_ROOT = path.resolve(env.uploadDir);

/** kind → 允许的落地扩展名 */
const KIND_EXT = {
  model: ['.mdl'],
  sound: ['.wav', '.mp3'],
  other: ['.zip', '.spr', '.tga', '.bmp'],
};

const MIME = {
  '.mdl': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.spr': 'application/octet-stream',
  '.tga': 'image/x-tga',
  '.bmp': 'image/bmp',
};

const extOf = (name) => path.extname(String(name || '')).toLowerCase();

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden('没有权限执行该操作'));
    next();
  };
}

/**
 * 落地路径必须是模组目录内的相对路径：
 * 防止作者把文件写到 C:\ 或 ..\..\ 里去。
 */
function assertSafeTarget(kind, targetPath) {
  const value = String(targetPath || '').replace(/\\/g, '/').trim();
  if (!value) throw badRequest('targetPath 不能为空');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw badRequest('targetPath 必须是相对模组目录的路径，例如 models/player/goku/goku.mdl');
  }
  if (value.split('/').some((part) => part === '..')) {
    throw badRequest('targetPath 不能包含 ..');
  }
  if (value.length > 255) throw badRequest('targetPath 过长');

  const allowed = KIND_EXT[kind] || [];
  if (!allowed.includes(extOf(value))) {
    throw badRequest(`${kind} 的落地文件只能是 ${allowed.join(' / ')}`);
  }
  return value;
}

function slugify(input) {
  const value = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || `asset-${Date.now().toString(36)}`;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const kind = String((req.body && req.body.kind) || 'other').toLowerCase();
    const dir = path.join(UPLOAD_ROOT, KIND_EXT[kind] ? kind : 'other');
    try {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${extOf(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploadMaxBytes, files: 1 },
  fileFilter(req, file, cb) {
    const kind = String((req.body && req.body.kind) || '').toLowerCase();
    const allowed = KIND_EXT[kind];
    if (!allowed) {
      const err = badRequest('kind 必须是 model / sound / other，并且要在 file 之前传');
      err.status = 400;
      return cb(err);
    }
    if (!allowed.includes(extOf(file.originalname))) {
      const err = badRequest(`${kind} 只接受 ${allowed.join(' / ')}，收到 ${extOf(file.originalname) || '无扩展名'}`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function publicAsset(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    version: row.version,
    targetPath: row.target_path,
    description: row.description,
    fileName: row.file_name,
    fileSize: Number(row.file_size),
    sha256: row.sha256,
    status: row.status,
    downloads: Number(row.downloads),
    authorId: row.author_id ? Number(row.author_id) : null,
    authorName: row.author_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: `/api/assets/${row.id}/download`,
  };
}

const SELECT_WITH_AUTHOR = `SELECT a.*, u.username AS author_name
  FROM assets a LEFT JOIN users u ON u.id = a.author_id`;

const createSchema = z.object({
  kind: z.enum(['model', 'sound', 'other']),
  name: z.string().trim().min(1).max(64),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{1,63}$/i, 'slug 只能是字母数字下划线短横线')
    .optional(),
  version: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+){0,3}$/, 'version 形如 1.0.0')
    .optional(),
  targetPath: z.string().trim().min(1).max(255),
  description: z.string().trim().max(500).optional(),
});

/**
 * 上传资源（multipart/form-data）
 * 字段：kind, name, slug?, version?, targetPath, description?, file
 * 注意：kind 必须排在 file 前面，multer 靠它决定落盘目录与扩展名校验。
 */
router.post('/assets', requireAuth, upload.single('file'), async (req, res, next) => {
  const filePath = req.file && req.file.path;

  try {
    if (!req.file) throw badRequest('缺少文件字段 file（Content-Type 用 multipart/form-data）');

    const body = createSchema.parse(req.body);
    const targetPath = assertSafeTarget(body.kind, body.targetPath);
    const version = body.version || '1.0.0';
    const slug = body.slug || slugify(body.name);
    const sha256 = await sha256File(req.file.path);

    // 管理员/游戏管理员直接上架，普通作者进待审队列
    const status = ['admin', 'gm'].includes(req.user.role) ? 'approved' : 'pending';

    const result = await q(
      `INSERT INTO assets
         (kind, name, slug, version, target_path, description,
          file_name, stored_name, file_size, sha256, author_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.kind,
        body.name,
        slug,
        version,
        targetPath,
        body.description || null,
        req.file.originalname.slice(0, 255),
        req.file.filename,
        req.file.size,
        sha256,
        req.user.id,
        status,
      ]
    );

    const row = await one(`${SELECT_WITH_AUTHOR} WHERE a.id = ? LIMIT 1`, [result.insertId]);
    res.status(201).json({ ok: true, data: { asset: publicAsset(row) } });
  } catch (err) {
    if (filePath) await fsp.unlink(filePath).catch(() => {});
    next(err);
  }
});

/** 公开列表：只返回已上架的 */
router.get('/assets', async (req, res, next) => {
  try {
    const kind = req.query.kind ? String(req.query.kind) : '';
    if (kind && !KIND_EXT[kind]) throw badRequest('kind 只能是 model / sound / other');

    const keyword = String(req.query.q || '').trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = ["a.status = 'approved'"];
    const params = [];
    if (kind) {
      where.push('a.kind = ?');
      params.push(kind);
    }
    if (keyword) {
      where.push('(a.name LIKE ? OR a.slug LIKE ? OR a.description LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }

    const rows = await q(
      `${SELECT_WITH_AUTHOR} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = await one(`SELECT COUNT(*) AS c FROM assets a WHERE ${where.join(' AND ')}`, params);

    res.json({
      ok: true,
      data: { assets: rows.map(publicAsset), total: Number(total.c), limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

/** 管理端：按状态查看（含待审） */
router.get('/admin/assets', requireAuth, requireRole('admin', 'gm'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw badRequest('status 不合法');

    const where = status === 'all' ? '1 = 1' : 'a.status = ?';
    const params = status === 'all' ? [] : [status];
    const rows = await q(
      `${SELECT_WITH_AUTHOR} WHERE ${where} ORDER BY a.created_at DESC LIMIT 100`,
      params
    );
    res.json({ ok: true, data: { assets: rows.map(publicAsset) } });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:id', async (req, res, next) => {
  try {
    const row = await one(`${SELECT_WITH_AUTHOR} WHERE a.id = ? LIMIT 1`, [req.params.id]);
    if (!row || row.status !== 'approved') throw notFound('资源不存在');
    res.json({ ok: true, data: { asset: publicAsset(row) } });
  } catch (err) {
    next(err);
  }
});

/** 下载：未上架的资源只有作者/管理员能取 */
router.get('/assets/:id/download', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');

    if (row.status !== 'approved') {
      const user = await resolveOptionalUser(req);
      const isOwner = user && Number(user.id) === Number(row.author_id);
      const isAdmin = user && ['admin', 'gm'].includes(user.role);
      if (!isOwner && !isAdmin) throw notFound('资源不存在');
    }

    const kindDir = KIND_EXT[row.kind] ? row.kind : 'other';
    const filePath = path.join(UPLOAD_ROOT, kindDir, row.stored_name);
    if (!fs.existsSync(filePath)) throw notFound('文件已丢失，请联系管理员');

    await q('UPDATE assets SET downloads = downloads + 1 WHERE id = ?', [row.id]);

    res.setHeader('Content-Type', MIME[extOf(row.file_name)] || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`
    );
    res.setHeader('Content-Length', String(row.file_size));
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

/** 审核 */
router.patch('/assets/:id/status', requireAuth, requireRole('admin', 'gm'), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
    const { status } = schema.parse(req.body);

    const row = await one('SELECT id FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');

    await q('UPDATE assets SET status = ? WHERE id = ?', [status, row.id]);
    const updated = await one(`${SELECT_WITH_AUTHOR} WHERE a.id = ? LIMIT 1`, [row.id]);
    res.json({ ok: true, data: { asset: publicAsset(updated) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/assets/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');

    const kindDir = KIND_EXT[row.kind] ? row.kind : 'other';
    await fsp.unlink(path.join(UPLOAD_ROOT, kindDir, row.stored_name)).catch(() => {});
    await q('DELETE FROM assets WHERE id = ?', [row.id]);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/** 可选鉴权：有 token 就解析，没有也不报错 */
async function resolveOptionalUser(req) {
  const header = req.headers.authorization || '';
  const matched = /^Bearer\s+(.+)$/i.exec(header);
  if (!matched) return null;

  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(matched[1], env.jwtSecret, { algorithms: ['HS256'] });
    return await one(
      'SELECT id, username, role FROM users WHERE id = ? AND token_version = ? LIMIT 1',
      [payload.sub, payload.tv]
    );
  } catch {
    return null;
  }
}

module.exports = router;
