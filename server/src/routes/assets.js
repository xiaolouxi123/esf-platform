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
const { requireRole, isStaff } = require('../middleware/roles');
const { logAction } = require('../services/audit');
const { badRequest, notFound, forbidden } = require('../lib/errors');

const router = express.Router();
const UPLOAD_ROOT = path.resolve(env.uploadDir);

/** 封面：允许动图（gif / 动态 webp），原样保存不压缩 */
const COVER_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const COVER_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const COVER_MAX_BYTES = 8 * 1024 * 1024;
const COVER_DIR = path.join(UPLOAD_ROOT, 'covers');

/** kind → 允许的落地扩展名 */
const KIND_EXT = {
  model: ['.mdl'],
  sound: ['.wav', '.mp3'],
  sprite: ['.spr'],
  other: ['.zip', '.tga', '.bmp'],
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
    const dir = file.fieldname === 'cover'
      ? COVER_DIR
      : path.join(UPLOAD_ROOT, KIND_EXT[kind] ? kind : 'other');
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
  limits: { fileSize: env.uploadMaxBytes, files: 2 },
  fileFilter(req, file, cb) {
    if (file.fieldname === 'cover') {
      if (!COVER_EXT.includes(extOf(file.originalname))) {
        const err = badRequest('封面只支持 png / jpg / webp / gif');
        err.status = 400;
        return cb(err);
      }
      return cb(null, true);
    }

    const kind = String((req.body && req.body.kind) || '').toLowerCase();
    const allowed = KIND_EXT[kind];
    if (!allowed) {
      const err = badRequest('kind 必须是 model / sound / sprite / other，并且要在 file 之前传');
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
    coverUrl: row.cover_name ? `/api/assets/${row.id}/cover` : null,
    coverMime: row.cover_mime || null,
    coverSize: row.cover_size ? Number(row.cover_size) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: `/api/assets/${row.id}/download`,
  };
}

const SELECT_WITH_AUTHOR = `SELECT a.*, u.username AS author_name
  FROM assets a LEFT JOIN users u ON u.id = a.author_id`;

const createSchema = z.object({
  kind: z.enum(['model', 'sound', 'sprite', 'other']),
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
 * 字段：kind, name, slug?, version?, targetPath, description?, file, cover?
 * cover 支持 png / jpg / webp / gif（动图原样保存，不做压缩）
 */
router.post(
  '/assets',
  requireAuth,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const file = req.files && req.files.file ? req.files.file[0] : null;
    const cover = req.files && req.files.cover ? req.files.cover[0] : null;

    const cleanup = async () => {
      if (file) await fsp.unlink(file.path).catch(() => {});
      if (cover) await fsp.unlink(cover.path).catch(() => {});
    };

    try {
      if (!file) throw badRequest('缺少文件字段 file（Content-Type 用 multipart/form-data）');
      if (cover && cover.size > COVER_MAX_BYTES) throw badRequest('封面不能超过 8MB');

      const body = createSchema.parse(req.body);
      const targetPath = assertSafeTarget(body.kind, body.targetPath);
      const version = body.version || '1.0.0';
      const slug = body.slug || slugify(body.name);
      const sha256 = await sha256File(file.path);

      const coverMime = cover ? COVER_MIME[extOf(cover.originalname)] || cover.mimetype : null;
      const coverSha256 = cover ? await sha256File(cover.path) : null;

      // 管理员 / 运营 / 所有者直接上架，作者与玩家进待审队列
      const status = isStaff(req.user) ? 'approved' : 'pending';

      const result = await q(
        `INSERT INTO assets
           (kind, name, slug, version, target_path, description,
            file_name, stored_name, file_size, sha256, author_id, status,
            cover_name, cover_mime, cover_size, cover_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.kind,
          body.name,
          slug,
          version,
          targetPath,
          body.description || null,
          file.originalname.slice(0, 255),
          file.filename,
          file.size,
          sha256,
          req.user.id,
          status,
          cover ? cover.filename : null,
          coverMime,
          cover ? cover.size : null,
          coverSha256,
        ]
      );

      await logAction(req, {
        action: 'asset.upload',
        targetType: 'asset',
        targetId: result.insertId,
        detail: {
          kind: body.kind,
          name: body.name,
          version,
          targetPath,
          status,
          cover: Boolean(cover),
        },
      });

      const row = await one(`${SELECT_WITH_AUTHOR} WHERE a.id = ? LIMIT 1`, [result.insertId]);
      res.status(201).json({ ok: true, data: { asset: publicAsset(row) } });
    } catch (err) {
      await cleanup();
      next(err);
    }
  }
);
/** 公开列表：只返回已上架的 */
router.get('/assets', async (req, res, next) => {
  try {
    const kind = req.query.kind ? String(req.query.kind) : '';
    if (kind && !KIND_EXT[kind]) throw badRequest('kind 只能是 model / sound / sprite / other');

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
router.get('/admin/assets', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
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

/** 封面：公开资源人人可看；待审资源只有作者 / staff 能看 */
router.get('/assets/:id/cover', async (req, res, next) => {
  try {
    const row = await one(
      'SELECT id, status, author_id, cover_name, cover_mime FROM assets WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!row || !row.cover_name) throw notFound('封面不存在');

    if (row.status !== 'approved') {
      const user = await resolveOptionalUser(req);
      const isAuthor = user && Number(user.id) === Number(row.author_id);
      const isStaffViewer = user && ['ops', 'admin', 'owner'].includes(user.role);
      if (!isAuthor && !isStaffViewer) throw notFound('封面不存在');
    }

    const filePath = path.join(COVER_DIR, row.cover_name);
    if (!fs.existsSync(filePath)) throw notFound('封面文件已丢失');

    res.setHeader('Content-Type', row.cover_mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
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
      const isAuthor = user && Number(user.id) === Number(row.author_id);
      const isStaffViewer = user && ['ops', 'admin', 'owner'].includes(user.role);
      if (!isAuthor && !isStaffViewer) throw notFound('资源不存在');
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
router.patch('/assets/:id/status', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
    const { status } = schema.parse(req.body);

    const row = await one('SELECT id, name FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');

    await q('UPDATE assets SET status = ? WHERE id = ?', [status, row.id]);

    await logAction(req, {
      action: status === 'approved' ? 'asset.approve' : status === 'rejected' ? 'asset.reject' : 'asset.pending',
      targetType: 'asset',
      targetId: row.id,
      detail: { status, name: row.name },
    });

    const updated = await one(`${SELECT_WITH_AUTHOR} WHERE a.id = ? LIMIT 1`, [row.id]);
    res.json({ ok: true, data: { asset: publicAsset(updated) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/assets/:id', requireAuth, requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');

    const kindDir = KIND_EXT[row.kind] ? row.kind : 'other';
    await fsp.unlink(path.join(UPLOAD_ROOT, kindDir, row.stored_name)).catch(() => {});
    if (row.cover_name) {
      await fsp.unlink(path.join(COVER_DIR, row.cover_name)).catch(() => {});
    }
    await q('DELETE FROM assets WHERE id = ?', [row.id]);

    await logAction(req, {
      action: 'asset.delete',
      targetType: 'asset',
      targetId: row.id,
      detail: { kind: row.kind, name: row.name, version: row.version },
    });

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
