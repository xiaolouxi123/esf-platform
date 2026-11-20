'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { z } = require('zod');

const env = require('../env');
const { pool, q, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, isStaff } = require('../middleware/roles');
const { logAction } = require('../services/audit');
const { badRequest, notFound, forbidden } = require('../lib/errors');

const router = express.Router();
const UPLOAD_ROOT = path.resolve(env.uploadDir);
const INCOMING_ROOT = path.join(UPLOAD_ROOT, 'assets', '.incoming');
const COVER_DIR = path.join(UPLOAD_ROOT, 'covers');

const KINDS = ['map', 'model', 'sound', 'sprite', 'other'];

/** 老式单文件安装只接受这些扩展名（保持上传校验严格） */
const KIND_EXT = {
  map: ['.bsp'],
  model: ['.mdl'],
  sound: ['.wav', '.mp3'],
  sprite: ['.spr'],
  other: ['.tga', '.bmp'],
};

/** 整包允许的扩展名：主文件 + 贴图 / 说明 / 配置 */
const PACKAGE_EXT = {
  map: ['.bsp', '.res', '.txt', '.wad', '.nav', '.bmp', '.tga', '.png', '.jpg', '.jpeg'],
  model: ['.mdl', '.bmp', '.tga', '.png', '.jpg', '.jpeg', '.txt', '.cfg', '.vmt'],
  sound: ['.wav', '.mp3', '.txt'],
  sprite: ['.spr', '.bmp', '.tga', '.png', '.txt'],
  other: ['.tga', '.bmp', '.png', '.jpg', '.jpeg', '.wav', '.mp3', '.spr', '.mdl', '.txt'],
};

const DANGEROUS_EXT = new Set([
  '.exe', '.dll', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.scr', '.lnk', '.msi', '.msp', '.jar', '.sh', '.bash', '.php', '.asp',
  '.aspx', '.cgi', '.so', '.dylib', '.sys', '.drv', '.ocx', '.cpl', '.hta', '.reg',
]);

const MIME = {
  '.bsp': 'application/octet-stream',
  '.mdl': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.spr': 'application/octet-stream',
  '.tga': 'image/x-tga',
  '.bmp': 'image/bmp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.cfg': 'text/plain; charset=utf-8',
  '.res': 'text/plain; charset=utf-8',
};

const COVER_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const COVER_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const COVER_MAX_BYTES = 8 * 1024 * 1024;

const extOf = (name) => path.extname(String(name || '')).toLowerCase();
const posix = (value) => String(value || '').replace(/\\/g, '/');

function slugify(input) {
  const value = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || 'asset-' + Date.now().toString(36);
}

/** 标签：逗号分隔，最多 6 个，每个 1-16 字，去重 */
function parseTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,，]/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const value = String(item || '').trim().replace(/\s+/g, ' ');
    if (!value) continue;
    if (value.length > 16) throw badRequest('单个标签最多 16 个字');
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length > 6) throw badRequest('标签最多 6 个');
  }
  return out;
}

const tagsOf = (row) => String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

/**
 * 校验落地相对路径。整包里的每个文件都要过这一关：
 * 不允许绝对路径、盘符、..、隐藏备份目录、可执行文件。
 */
function normalizeRelPath(kind, raw, options) {
  const legacy = Boolean(options && options.legacy);
  let value = posix(raw).trim();
  while (value.startsWith('./')) value = value.slice(2);
  if (!value) throw badRequest('文件路径不能为空');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw badRequest('文件路径必须是相对模组目录的路径');
  }
  if (value.length > 300) throw badRequest('文件路径过长');
  if (/[\u0000-\u001f<>:"|?*]/.test(value)) throw badRequest('文件路径包含非法字符');

  const parts = value.split('/').filter((part) => part !== '');
  if (!parts.length) throw badRequest('文件路径不能为空');
  for (const part of parts) {
    if (part === '.' || part === '..') throw badRequest('文件路径不能包含 ..');
    if (part.toLowerCase() === '.esf-backup') throw badRequest('不能覆盖平台的备份目录');
  }
  value = parts.join('/');

  if (kind === 'map' && !value.startsWith('maps/')) {
    throw badRequest('地图必须放在 maps/ 下，例如 maps/ape_forestshadow.bsp');
  }

  const ext = extOf(value);
  if (DANGEROUS_EXT.has(ext)) throw badRequest('不允许上传可执行文件 ' + ext);
  const allowed = legacy ? KIND_EXT[kind] || [] : PACKAGE_EXT[kind] || [];
  if (!allowed.includes(ext)) {
    throw badRequest(
      legacy
        ? kind + ' 的落地文件只能是 ' + allowed.join(' / ')
        : kind + ' 整包不接受 ' + (ext || '无扩展名') + '，允许 ' + allowed.join(' / ')
    );
  }
  return value;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function makeToken(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
}

function canManage(user, row) {
  if (!user || !row) return false;
  return isStaff(user) || Number(row.author_id) === Number(user.id);
}

function ratingAverage(row) {
  const count = Number(row.rating_count || 0);
  const sum = Number(row.rating_sum || 0);
  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
}

function publicAsset(row, extra) {
  const options = extra || {};
  const payload = {
    id: Number(row.id),
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    version: row.version,
    compat: row.compat || 'all',
    targetPath: row.target_path,
    description: row.description,
    tags: tagsOf(row),
    featured: Boolean(row.featured),
    fileName: row.file_name,
    fileSize: Number(row.file_size),
    fileCount: Number(row.file_count || 1),
    sha256: row.sha256,
    status: row.status,
    downloads: Number(row.downloads),
    rating: { average: ratingAverage(row), count: Number(row.rating_count || 0) },
    ratingCount: Number(row.rating_count || 0),
    commentCount: Number(row.comment_count || 0),
    authorId: row.author_id ? Number(row.author_id) : null,
    authorName: row.author_name || null,
    authorGameName: row.author_game_name || null,
    authorAvatar: row.author_avatar || null,
    coverUrl: row.cover_name ? '/api/assets/' + row.id + '/cover' : null,
    coverMime: row.cover_mime || null,
    coverSize: row.cover_size ? Number(row.cover_size) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: '/api/assets/' + row.id + '/download',
  };
  if (options.canManage) payload.canManage = true;
  if (options.canManage && row.review_note) payload.reviewNote = row.review_note;
  if (options.myRating) payload.myRating = Number(options.myRating);
  if (options.files) payload.files = options.files;
  if (options.versions) payload.versions = options.versions;
  if (options.pendingVersion) payload.pendingVersion = options.pendingVersion;
  return payload;
}

const SELECT_WITH_AUTHOR = 'SELECT a.*, u.username AS author_name, u.game_name AS author_game_name, ' +
  'u.avatar AS author_avatar FROM assets a LEFT JOIN users u ON u.id = a.author_id';

async function fileRows(assetId, version) {
  const rows = await q(
    'SELECT * FROM asset_files WHERE asset_id = ? AND version = ? ORDER BY sort ASC, id ASC',
    [assetId, version]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    path: row.relative_path,
    size: Number(row.file_size),
    sha256: row.sha256,
    mime: row.mime || MIME[extOf(row.file_name)] || 'application/octet-stream',
  }));
}

async function versionRows(assetId, includePending) {
  const rows = await q(
    includePending
      ? 'SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY created_at DESC, id DESC'
      : 'SELECT * FROM asset_versions WHERE asset_id = ? AND status = ' + "'approved'" + ' ORDER BY created_at DESC, id DESC',
    [assetId]
  );
  return rows.map((row) => ({
    version: row.version,
    changelog: row.changelog || '',
    totalSize: Number(row.total_size),
    fileCount: Number(row.file_count),
    status: row.status,
    reviewNote: row.review_note || null,
    createdAt: row.created_at,
  }));
}

async function lastPendingVersion(assetId) {
  return one(
    'SELECT * FROM asset_versions WHERE asset_id = ? AND status = ' + "'pending'" + ' ORDER BY id DESC LIMIT 1',
    [assetId]
  );
}

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

// ---------------------------------------------------------------------------
// 上传：multipart 接收 files[]，先落到 .incoming，校验后再移动到 assets/<token>
// ---------------------------------------------------------------------------

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      if (file.fieldname === 'cover') {
        fs.mkdirSync(COVER_DIR, { recursive: true });
        return cb(null, COVER_DIR);
      }
      if (!req._incomingToken) req._incomingToken = makeToken('incoming');
      const dir = path.join(INCOMING_ROOT, req._incomingToken);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const ext = extOf(file.originalname);
    cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: env.uploadMaxBytes,
    files: env.assetPackageMaxFiles + 2,
    fields: 30,
  },
  fileFilter(req, file, cb) {
    const ext = extOf(file.originalname);
    if (file.fieldname === 'cover') {
      if (!COVER_EXT.includes(ext)) {
        const err = badRequest('封面只支持 png / jpg / webp / gif');
        err.status = 400;
        return cb(err);
      }
      return cb(null, true);
    }
    if (DANGEROUS_EXT.has(ext)) {
      const err = badRequest('不允许上传可执行文件');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

const createSchema = z.object({
  kind: z.enum(['map', 'model', 'sound', 'sprite', 'other']),
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
  targetPath: z.string().trim().max(300).optional(),
  description: z.string().trim().max(500).optional(),
  tags: z.string().trim().max(255).optional(),
  compat: z.enum(['all', 'fcx', 'evm']).optional(),
  changelog: z.string().trim().max(1000).optional(),
  assetId: z.string().trim().optional(),
  paths: z.string().trim().max(200000).optional(),
});

router.post(
  '/assets',
  requireAuth,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: env.assetPackageMaxFiles },
    { name: 'cover', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const cover = req.files && req.files.cover ? req.files.cover[0] : null;
    const single = req.files && req.files.file ? req.files.file[0] : null;
    const many = req.files && req.files.files ? req.files.files : [];
    const incomingDir = req._incomingToken ? path.join(INCOMING_ROOT, req._incomingToken) : null;
    let finalDir = null;
    let movedCover = false;
    let conn = null;

    const cleanup = async () => {
      if (conn) await conn.rollback().catch(() => {});
      if (incomingDir) await fsp.rm(incomingDir, { recursive: true, force: true }).catch(() => {});
      if (finalDir) await fsp.rm(finalDir, { recursive: true, force: true }).catch(() => {});
      if (cover && !movedCover) await fsp.unlink(cover.path).catch(() => {});
    };

    try {
      const body = createSchema.parse(req.body);
      const version = body.version || '1.0.0';
      const tags = parseTags(body.tags || '');
      const compat = body.compat || 'all';
      const isLegacy = Boolean(single) && many.length === 0;
      const uploads = isLegacy ? [single] : many;
      if (!uploads.length) throw badRequest('请选择要上传的文件或文件夹');

      if (uploads.length > env.assetPackageMaxFiles) {
        throw badRequest('一次最多 ' + env.assetPackageMaxFiles + ' 个文件');
      }
      if (isLegacy && body.targetPath === undefined) {
        throw badRequest('缺少 targetPath');
      }

      // 路径：整包由客户端传 paths JSON；老式单文件用 targetPath / 原文件名
      let pathList = [];
      if (!isLegacy) {
        if (body.paths) {
          try {
            pathList = JSON.parse(body.paths);
          } catch {
            throw badRequest('paths 必须是 JSON 数组');
          }
          if (!Array.isArray(pathList)) throw badRequest('paths 必须是 JSON 数组');
        }
        if (pathList.length && pathList.length !== uploads.length) {
          throw badRequest('paths 数量必须与文件数量一致');
        }
      }

      const items = [];
      const seen = new Set();
      let totalSize = 0;
      for (let i = 0; i < uploads.length; i += 1) {
        const file = uploads[i];
        let rawPath;
        if (isLegacy) {
          let target = posix(body.targetPath).trim();
          if (body.kind === 'map' && target && !target.includes('/')) target = 'maps/' + target;
          rawPath = target || file.originalname;
        } else {
          rawPath = pathList[i] || file.originalname;
        }
        const relative = normalizeRelPath(body.kind, rawPath, { legacy: isLegacy });
        if (seen.has(relative.toLowerCase())) throw badRequest('文件路径重复: ' + relative);
        seen.add(relative.toLowerCase());
        totalSize += Number(file.size || 0);
        items.push({ file: file, relative: relative });
      }

      if (totalSize > env.assetPackageMaxBytes) {
        throw badRequest('整包不能超过 ' + Math.round(env.assetPackageMaxBytes / 1024 / 1024) + 'MB');
      }

      // 主文件：targetPath 指定，或按 kind 自动挑
      const primaryExt = KIND_EXT[body.kind] || [];
      let primary = null;
      if (body.targetPath) {
        let target = posix(body.targetPath).trim();
        if (body.kind === 'map' && target && !target.includes('/')) target = 'maps/' + target;
        const normalized = normalizeRelPath(body.kind, target, { legacy: isLegacy });
        primary = items.find((item) => item.relative === normalized) || null;
        if (!primary) throw badRequest('targetPath 不在上传文件列表里');
      } else {
        primary = items.find((item) => primaryExt.includes(extOf(item.relative))) || null;
      }
      if (!primary) {
        throw badRequest(body.kind + ' 整包里至少要有一个 ' + primaryExt.join(' / ') + ' 主文件');
      }
      if (body.kind === 'map' && !primary.relative.endsWith('.bsp')) {
        throw badRequest('地图的主文件必须是 .bsp');
      }

      // 新版本 / 新资源
      let existing = null;
      if (body.assetId) {
        existing = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [body.assetId]);
        if (!existing) throw notFound('资源不存在');
        if (!canManage(req.user, existing)) throw forbidden('只能给自己的资源发新版本');
      }
      if (!existing) {
        const collision = await one('SELECT * FROM assets WHERE kind = ? AND slug = ? LIMIT 1', [
          body.kind,
          body.slug || slugify(body.name),
        ]);
        if (collision) {
          throw badRequest('同名资源已存在，请在「我的投稿」里发布新版本');
        }
      }

      const status = isStaff(req.user) ? 'approved' : 'pending';
      const reviewNote = null;
      if (existing) {
        const same = await one('SELECT id FROM asset_versions WHERE asset_id = ? AND version = ? LIMIT 1', [
          existing.id,
          version,
        ]);
        if (same) throw badRequest('版本 ' + version + ' 已经存在');
      }

      // 文件移到最终目录
      const finalToken = makeToken('pkg');
      finalDir = isLegacy
        ? path.join(UPLOAD_ROOT, 'legacy', finalToken)
        : path.join(UPLOAD_ROOT, 'assets', finalToken);
      await fsp.mkdir(finalDir, { recursive: true });

      const stored = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const targetAbs = isLegacy
          ? path.join(finalDir, i + extOf(item.file.originalname))
          : path.join(finalDir, ...item.relative.split('/'));
        if (!targetAbs.startsWith(finalDir + path.sep)) throw badRequest('非法文件路径');
        await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
        await fsp.rename(item.file.path, targetAbs);
        const sha256 = await sha256File(targetAbs);
        const storedPath = path.relative(UPLOAD_ROOT, targetAbs).split(path.sep).join('/');
        stored.push({
          relative: item.relative,
          storedPath: storedPath,
          fileName: item.file.originalname.slice(0, 255),
          size: Number(item.file.size || 0),
          sha256: sha256,
          mime: MIME[extOf(item.relative)] || 'application/octet-stream',
          sort: i,
        });
      }

      const primaryStored = stored.find((item) => item.relative === primary.relative) || stored[0];
      if (!primaryStored) throw badRequest('没有可用的主文件');
      const coverMime = cover ? COVER_MIME[extOf(cover.originalname)] || cover.mimetype : null;
      const coverSha = cover ? await sha256File(cover.path) : null;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      let assetId;
      if (existing) {
        assetId = existing.id;
        await conn.query(
          'INSERT INTO asset_versions ' +
            '(asset_id, version, changelog, total_size, file_count, status, review_note, created_by) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            assetId,
            version,
            body.changelog || null,
            totalSize,
            stored.length,
            status,
            reviewNote,
            req.user.id,
          ]
        );
        if (status === 'approved') {
          await conn.query(
            'UPDATE assets SET version = ?, target_path = ?, description = ?, tags = ?, compat = ?, ' +
              'file_name = ?, stored_name = ?, file_size = ?, sha256 = ?, file_count = ?, ' +
              'status = ' + "'approved'" + ', review_note = NULL, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
            [
              version,
              primary.relative,
              body.description !== undefined ? body.description || null : existing.description,
              tags.length ? tags.join(',') : existing.tags,
              compat,
              primaryStored.fileName,
              primaryStored.storedPath,
              primaryStored.size,
              primaryStored.sha256,
              stored.length,
              req.user.id,
              assetId,
            ]
          );
        }
      } else {
        const slug = body.slug || slugify(body.name);
        const [result] = await conn.query(
          'INSERT INTO assets ' +
            '(kind, name, slug, version, compat, target_path, description, tags, ' +
            'file_name, stored_name, file_size, sha256, file_count, author_id, status, ' +
            'cover_name, cover_mime, cover_size, cover_sha256) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            body.kind,
            body.name,
            slug,
            version,
            compat,
            primary.relative,
            body.description || null,
            tags.join(','),
            primaryStored.fileName,
            primaryStored.storedPath,
            primaryStored.size,
            primaryStored.sha256,
            stored.length,
            req.user.id,
            status,
            cover ? cover.filename : null,
            coverMime,
            cover ? cover.size : null,
            coverSha,
          ]
        );
        assetId = result.insertId;
        await conn.query(
          'INSERT INTO asset_versions ' +
            '(asset_id, version, changelog, total_size, file_count, status, review_note, created_by) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [assetId, version, body.changelog || null, totalSize, stored.length, status, reviewNote, req.user.id]
        );
      }

      for (const file of stored) {
        await conn.query(
          'INSERT INTO asset_files ' +
            '(asset_id, version, relative_path, stored_path, file_name, file_size, sha256, mime, sort) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            assetId,
            version,
            file.relative,
            file.storedPath,
            file.fileName,
            file.size,
            file.sha256,
            file.mime,
            file.sort,
          ]
        );
      }

      await conn.commit();
      conn.release();
      conn = null;
      movedCover = true;

      await logAction(req, {
        action: existing ? 'asset.version' : 'asset.upload',
        targetType: 'asset',
        targetId: assetId,
        detail: {
          kind: body.kind,
          name: body.name,
          version: version,
          files: stored.length,
          totalSize: totalSize,
          status: status,
        },
      });

      const row = await one(SELECT_WITH_AUTHOR + ' WHERE a.id = ? LIMIT 1', [assetId]);
      const files = await fileRows(assetId, row.version);
      res.status(201).json({
        ok: true,
        data: {
          asset: publicAsset(row, { canManage: true, files: files }),
          versionStatus: status,
        },
      });
    } catch (err) {
      await cleanup();
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

function parsePositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

router.get('/assets', async (req, res, next) => {
  try {
    const kind = req.query.kind ? String(req.query.kind) : '';
    if (kind && !KINDS.includes(kind)) throw badRequest('kind 只能是 map / model / sound / sprite / other');
    const keyword = String(req.query.q || '').trim();
    const tag = String(req.query.tag || '').trim();
    const compat = String(req.query.compat || '').trim();
    const sort = String(req.query.sort || 'recent');
    const limit = parsePositiveInt(req.query.limit, 20, 100);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const featured = String(req.query.featured || '') === '1';
    const author = Number(req.query.author) || 0;
    const collection = String(req.query.collection || '').trim();

    const where = ["a.status = 'approved'"];
    const params = [];
    if (kind) {
      where.push('a.kind = ?');
      params.push(kind);
    }
    if (keyword) {
      where.push('(a.name LIKE ? OR a.slug LIKE ? OR a.description LIKE ? OR a.tags LIKE ?)');
      const like = '%' + keyword + '%';
      params.push(like, like, like, like);
    }
    if (tag) {
      where.push('FIND_IN_SET(?, a.tags)');
      params.push(tag);
    }
    if (compat === 'fcx' || compat === 'evm') {
      where.push("(a.compat = ? OR a.compat = 'all')");
      params.push(compat);
    }
    if (featured) where.push('a.featured = 1');
    if (author) {
      where.push('a.author_id = ?');
      params.push(author);
    }
    if (collection) {
      where.push('EXISTS (SELECT 1 FROM asset_collection_items ci JOIN asset_collections c ON c.id = ci.collection_id WHERE ci.asset_id = a.id AND c.slug = ?)');
      params.push(collection);
    }

    let orderBy = 'a.updated_at DESC';
    if (sort === 'downloads') orderBy = 'a.downloads DESC, a.updated_at DESC';
    else if (sort === 'name') orderBy = 'a.name ASC';
    else if (sort === 'rating') orderBy = '(a.rating_sum / NULLIF(a.rating_count, 0)) DESC, a.rating_count DESC, a.updated_at DESC';
    else if (sort !== 'recent') throw badRequest('sort 只能是 recent / downloads / rating / name');

    const rows = await q(
      SELECT_WITH_AUTHOR + ' WHERE ' + where.join(' AND ') + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?',
      params.concat([limit, offset])
    );
    const total = await one('SELECT COUNT(*) AS c FROM assets a WHERE ' + where.join(' AND '), params);
    const statRows = await q(
      "SELECT a.kind, COUNT(*) AS c, COALESCE(SUM(a.downloads), 0) AS downloads FROM assets a WHERE a.status = 'approved' GROUP BY a.kind"
    );
    const authorTotal = await one(
      "SELECT COUNT(DISTINCT author_id) AS c FROM assets WHERE status = 'approved' AND author_id IS NOT NULL"
    );
    const featuredTotal = await one("SELECT COUNT(*) AS c FROM assets WHERE status = 'approved' AND featured = 1");
    const counts = { map: 0, model: 0, sound: 0, sprite: 0, other: 0 };
    let totalDownloads = 0;
    for (const row of statRows) {
      const key = counts[row.kind] === undefined ? 'other' : row.kind;
      counts[key] += Number(row.c);
      totalDownloads += Number(row.downloads);
    }

    res.json({
      ok: true,
      data: {
        assets: rows.map((row) => publicAsset(row)),
        total: Number(total.c),
        limit: limit,
        offset: offset,
        stats: {
          counts: counts,
          totalDownloads: totalDownloads,
          authorCount: Number(authorTotal.c),
          featuredCount: Number(featuredTotal.c),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/tags', async (req, res, next) => {
  try {
    const rows = await q("SELECT tags FROM assets WHERE status = 'approved' AND tags <> ''");
    const counter = new Map();
    for (const row of rows) {
      for (const tag of tagsOf(row)) counter.set(tag, (counter.get(tag) || 0) + 1);
    }
    const tags = [...counter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .slice(0, 40)
      .map(([name, count]) => ({ name: name, count: count }));
    res.json({ ok: true, data: { tags: tags } });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/collections', async (req, res, next) => {
  try {
    const rows = await q(
      'SELECT c.*, COUNT(a.id) AS asset_count ' +
        'FROM asset_collections c ' +
        'LEFT JOIN asset_collection_items ci ON ci.collection_id = c.id ' +
        "LEFT JOIN assets a ON a.id = ci.asset_id AND a.status = 'approved' " +
        'GROUP BY c.id ORDER BY c.sort ASC, c.id ASC'
    );
    res.json({
      ok: true,
      data: {
        collections: rows.map((row) => ({
          id: Number(row.id),
          slug: row.slug,
          title: row.title,
          description: row.description,
          featured: Boolean(row.featured),
          count: Number(row.asset_count),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/collections/:slug', async (req, res, next) => {
  try {
    const collection = await one('SELECT * FROM asset_collections WHERE slug = ? LIMIT 1', [req.params.slug]);
    if (!collection) throw notFound('合集不存在');
    const rows = await q(
      SELECT_WITH_AUTHOR +
        ' JOIN asset_collection_items ci ON ci.asset_id = a.id ' +
        " WHERE ci.collection_id = ? AND a.status = 'approved' " +
        ' ORDER BY ci.sort ASC, a.name ASC',
      [collection.id]
    );
    res.json({
      ok: true,
      data: {
        collection: {
          id: Number(collection.id),
          slug: collection.slug,
          title: collection.title,
          description: collection.description,
          featured: Boolean(collection.featured),
        },
        assets: rows.map((row) => publicAsset(row)),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/mine', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      SELECT_WITH_AUTHOR + ' WHERE a.author_id = ? ORDER BY a.updated_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json({ ok: true, data: { assets: rows.map((row) => publicAsset(row, { canManage: true })) } });
  } catch (err) {
    next(err);
  }
});

router.get('/authors/:id', async (req, res, next) => {
  try {
    const author = await one(
      'SELECT id, username, game_name, avatar, role, created_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );
    if (!author) throw notFound('作者不存在');
    const rows = await q(
      SELECT_WITH_AUTHOR + " WHERE a.author_id = ? AND a.status = 'approved' ORDER BY a.updated_at DESC LIMIT 100",
      [author.id]
    );
    const totals = await one(
      "SELECT COUNT(*) AS c, COALESCE(SUM(downloads),0) AS downloads FROM assets WHERE author_id = ? AND status = 'approved'",
      [author.id]
    );
    res.json({
      ok: true,
      data: {
        author: {
          id: Number(author.id),
          username: author.username,
          gameName: author.game_name || author.username,
          avatar: author.avatar || '',
          role: author.role,
          joinedAt: author.created_at,
          assetCount: Number(totals.c),
          downloads: Number(totals.downloads),
        },
        assets: rows.map((row) => publicAsset(row)),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:id', async (req, res, next) => {
  try {
    const row = await one(SELECT_WITH_AUTHOR + ' WHERE a.id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    const user = await resolveOptionalUser(req);
    const manager = canManage(user, row);
    if (row.status !== 'approved' && !manager) throw notFound('资源不存在');

    const files = await fileRows(row.id, row.version);
    const versions = await versionRows(row.id, manager);
    let pendingVersion = null;
    if (manager) {
      const pending = await lastPendingVersion(row.id);
      if (pending) {
        pendingVersion = {
          version: pending.version,
          changelog: pending.changelog || '',
          fileCount: Number(pending.file_count),
          totalSize: Number(pending.total_size),
          createdAt: pending.created_at,
        };
      }
    }
    let myRating = 0;
    if (user) {
      const rated = await one('SELECT stars FROM asset_ratings WHERE asset_id = ? AND user_id = ? LIMIT 1', [
        row.id,
        user.id,
      ]);
      if (rated) myRating = Number(rated.stars);
    }

    res.json({
      ok: true,
      data: {
        asset: publicAsset(row, {
          canManage: manager,
          files: files,
          versions: versions,
          pendingVersion: pendingVersion,
          myRating: myRating,
        }),
      },
    });
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
      if (!canManage(user, row)) throw notFound('封面不存在');
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

/** 单文件下载：整包安装时逐个拉取 */
router.get('/assets/:id/files/:fileId', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    if (row.status !== 'approved') {
      const user = await resolveOptionalUser(req);
      if (!canManage(user, row)) throw notFound('资源不存在');
    }
    const file = await one('SELECT * FROM asset_files WHERE id = ? AND asset_id = ? LIMIT 1', [
      req.params.fileId,
      row.id,
    ]);
    if (!file) throw notFound('文件不存在');
    if (file.version !== row.version) throw notFound('该文件不属于当前版本');

    const filePath = path.resolve(UPLOAD_ROOT, file.stored_path);
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) throw notFound('文件路径异常');
    if (!fs.existsSync(filePath)) throw notFound('文件已丢失，请联系管理员');

    res.setHeader('Content-Type', file.mime || MIME[extOf(file.file_name)] || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" + encodeURIComponent(file.file_name)
    );
    res.setHeader('Content-Length', String(file.file_size));
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

async function trackDownload(req, assetRow) {
  const user = await resolveOptionalUser(req);
  const day = new Date().toISOString().slice(0, 10);
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const dedupe = user
    ? 'user:' + user.id
    : 'ip:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
  const [result] = await pool.query(
    'INSERT IGNORE INTO asset_downloads (asset_id, day, dedupe_key) VALUES (?, ?, ?)',
    [assetRow.id, day, dedupe]
  );
  if (result.affectedRows > 0) {
    await q('UPDATE assets SET downloads = downloads + 1 WHERE id = ?', [assetRow.id]);
  }
}

router.post('/assets/:id/downloads', async (req, res, next) => {
  try {
    const row = await one('SELECT id, status, author_id FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    if (row.status !== 'approved') {
      const user = await resolveOptionalUser(req);
      if (!canManage(user, row)) throw notFound('资源不存在');
    }
    await trackDownload(req, row);
    res.json({ ok: true, data: { tracked: true } });
  } catch (err) {
    next(err);
  }
});

/** 兼容老接口：单文件资源可直接下载；整包必须走 files 接口 */
router.get('/assets/:id/download', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    if (row.status !== 'approved') {
      const user = await resolveOptionalUser(req);
      if (!canManage(user, row)) throw notFound('资源不存在');
    }
    if (Number(row.file_count || 1) > 1) {
      const error = badRequest('这个资源是整包，请升级启动器后使用文件清单安装');
      error.code = 'ASSET_PACKAGE';
      throw error;
    }
    const file = await one(
      'SELECT * FROM asset_files WHERE asset_id = ? AND version = ? ORDER BY sort ASC, id ASC LIMIT 1',
      [row.id, row.version]
    );
    if (!file) throw notFound('文件已丢失，请联系管理员');
    const filePath = path.resolve(UPLOAD_ROOT, file.stored_path);
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep) || !fs.existsSync(filePath)) {
      throw notFound('文件已丢失，请联系管理员');
    }
    await trackDownload(req, row);
    res.setHeader('Content-Type', file.mime || MIME[extOf(file.file_name)] || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" + encodeURIComponent(file.file_name)
    );
    res.setHeader('Content-Length', String(file.file_size));
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 作者 / 管理员
// ---------------------------------------------------------------------------

router.patch('/assets/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    if (!canManage(req.user, row)) throw forbidden('只能编辑自己的资源');

    const schema = z.object({
      name: z.string().trim().min(1).max(64).optional(),
      description: z.string().trim().max(500).optional(),
      tags: z.string().trim().max(255).optional(),
      compat: z.enum(['all', 'fcx', 'evm']).optional(),
    });
    const body = schema.parse(req.body);
    const sets = [];
    const params = [];
    if (body.name !== undefined) {
      sets.push('name = ?');
      params.push(body.name);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      params.push(body.description || null);
    }
    if (body.tags !== undefined) {
      sets.push('tags = ?');
      params.push(parseTags(body.tags).join(','));
    }
    if (body.compat !== undefined) {
      sets.push('compat = ?');
      params.push(body.compat);
    }
    if (!sets.length) throw badRequest('没有要修改的字段');
    params.push(row.id);
    await q('UPDATE assets SET ' + sets.join(', ') + ' WHERE id = ?', params);
    const updated = await one(SELECT_WITH_AUTHOR + ' WHERE a.id = ? LIMIT 1', [row.id]);
    res.json({ ok: true, data: { asset: publicAsset(updated, { canManage: true }) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/assets/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    const isAuthor = Number(row.author_id) === Number(req.user.id);
    if (!isStaff(req.user) && !isAuthor) throw forbidden('只能删除自己的资源');
    if (!isStaff(req.user) && row.status === 'approved') {
      throw forbidden('已上架资源请联系管理员下架');
    }

    const files = await q('SELECT stored_path FROM asset_files WHERE asset_id = ?', [row.id]);
    for (const file of files) {
      const abs = path.resolve(UPLOAD_ROOT, file.stored_path);
      if (abs.startsWith(UPLOAD_ROOT + path.sep)) await fsp.unlink(abs).catch(() => {});
    }
    if (row.cover_name) await fsp.unlink(path.join(COVER_DIR, row.cover_name)).catch(() => {});
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

router.patch('/assets/:id/status', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['pending', 'approved', 'rejected']),
      note: z.string().trim().max(255).optional(),
    });
    const body = schema.parse(req.body);
    const row = await one('SELECT id, name FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    await q(
      'UPDATE assets SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [body.status, body.note || null, req.user.id, row.id]
    );
    await logAction(req, {
      action: body.status === 'approved' ? 'asset.approve' : body.status === 'rejected' ? 'asset.reject' : 'asset.pending',
      targetType: 'asset',
      targetId: row.id,
      detail: { status: body.status, name: row.name, note: body.note || null },
    });
    const updated = await one(SELECT_WITH_AUTHOR + ' WHERE a.id = ? LIMIT 1', [row.id]);
    res.json({ ok: true, data: { asset: publicAsset(updated, { canManage: true }) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/assets/:id/featured', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const schema = z.object({ featured: z.boolean() });
    const body = schema.parse(req.body);
    const row = await one('SELECT id FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row) throw notFound('资源不存在');
    await q('UPDATE assets SET featured = ? WHERE id = ?', [body.featured ? 1 : 0, row.id]);
    const updated = await one(SELECT_WITH_AUTHOR + ' WHERE a.id = ? LIMIT 1', [row.id]);
    res.json({ ok: true, data: { asset: publicAsset(updated, { canManage: true }) } });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/assets/:id/versions/:version/status',
  requireAuth,
  requireRole('ops', 'admin', 'owner'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        status: z.enum(['approved', 'rejected']),
        note: z.string().trim().max(255).optional(),
      });
      const body = schema.parse(req.body);
      const asset = await one('SELECT * FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
      if (!asset) throw notFound('资源不存在');
      const version = await one('SELECT * FROM asset_versions WHERE asset_id = ? AND version = ? LIMIT 1', [
        asset.id,
        req.params.version,
      ]);
      if (!version) throw notFound('版本不存在');
      if (version.status !== 'pending') throw badRequest('只有待审版本可以审核');

      await q(
        'UPDATE asset_versions SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
        [body.status, body.note || null, req.user.id, version.id]
      );

      if (body.status === 'approved') {
        const primary = await one(
          'SELECT * FROM asset_files WHERE asset_id = ? AND version = ? ORDER BY sort ASC, id ASC LIMIT 1',
          [asset.id, version.version]
        );
        if (!primary) throw badRequest('版本缺少文件');
        await q(
          'UPDATE assets SET version = ?, target_path = ?, file_name = ?, stored_name = ?, ' +
            "file_size = ?, sha256 = ?, file_count = ?, status = 'approved', " +
            'review_note = NULL, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
          [
            version.version,
            primary.relative_path,
            primary.file_name,
            primary.stored_path,
            primary.file_size,
            primary.sha256,
            version.file_count,
            req.user.id,
            asset.id,
          ]
        );
      }

      await logAction(req, {
        action: body.status === 'approved' ? 'asset.version.approve' : 'asset.version.reject',
        targetType: 'asset',
        targetId: asset.id,
        detail: { version: version.version, status: body.status, note: body.note || null },
      });
      const updated = await one(SELECT_WITH_AUTHOR + ' WHERE a.id = ? LIMIT 1', [asset.id]);
      res.json({ ok: true, data: { asset: publicAsset(updated, { canManage: true }) } });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/admin/assets', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw badRequest('status 不合法');
    const where = status === 'all' ? '1 = 1' : 'a.status = ?';
    const params = status === 'all' ? [] : [status];
    const rows = await q(
      SELECT_WITH_AUTHOR + ' WHERE ' + where + ' ORDER BY a.created_at DESC LIMIT 100',
      params
    );
    res.json({ ok: true, data: { assets: rows.map((row) => publicAsset(row, { canManage: true })) } });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/asset-versions', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    if (!['pending', 'approved', 'rejected'].includes(status)) throw badRequest('status 不合法');
    const rows = await q(
      'SELECT v.*, a.name AS asset_name, a.kind AS asset_kind, a.version AS current_version, ' +
        'u.username AS author_name ' +
        'FROM asset_versions v JOIN assets a ON a.id = v.asset_id ' +
        'LEFT JOIN users u ON u.id = a.author_id ' +
        'WHERE v.status = ? ORDER BY v.created_at DESC LIMIT 100',
      [status]
    );
    res.json({
      ok: true,
      data: {
        versions: rows.map((row) => ({
          id: Number(row.id),
          assetId: Number(row.asset_id),
          assetName: row.asset_name,
          kind: row.asset_kind,
          version: row.version,
          currentVersion: row.current_version,
          changelog: row.changelog || '',
          fileCount: Number(row.file_count),
          totalSize: Number(row.total_size),
          status: row.status,
          reviewNote: row.review_note || null,
          authorName: row.author_name || null,
          createdAt: row.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 评分 / 评论 / 举报
// ---------------------------------------------------------------------------

router.post('/assets/:id/rating', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ stars: z.number().int().min(1).max(5) });
    const body = schema.parse(req.body);
    const asset = await one('SELECT id, author_id, status FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!asset || asset.status !== 'approved') throw notFound('资源不存在');
    if (Number(asset.author_id) === Number(req.user.id)) throw badRequest('不能给自己的资源评分');

    await q(
      'INSERT INTO asset_ratings (asset_id, user_id, stars) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE stars = VALUES(stars), updated_at = NOW()',
      [asset.id, req.user.id, body.stars]
    );
    const totals = await one(
      'SELECT COUNT(*) AS c, COALESCE(SUM(stars),0) AS s FROM asset_ratings WHERE asset_id = ?',
      [asset.id]
    );
    await q('UPDATE assets SET rating_count = ?, rating_sum = ? WHERE id = ?', [
      Number(totals.c),
      Number(totals.s),
      asset.id,
    ]);
    res.json({
      ok: true,
      data: {
        rating: { average: Number(totals.s) / Math.max(1, Number(totals.c)), count: Number(totals.c) },
        myRating: body.stars,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:id/comments', async (req, res, next) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 20, 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = await q(
      'SELECT c.*, u.username, u.game_name, u.avatar ' +
        'FROM asset_comments c LEFT JOIN users u ON u.id = c.user_id ' +
        'WHERE c.asset_id = ? AND c.deleted_at IS NULL ' +
        'ORDER BY c.created_at DESC LIMIT ? OFFSET ?',
      [req.params.id, limit, offset]
    );
    const total = await one(
      'SELECT COUNT(*) AS c FROM asset_comments WHERE asset_id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    res.json({
      ok: true,
      data: {
        comments: rows.map((row) => ({
          id: Number(row.id),
          body: row.body,
          createdAt: row.created_at,
          userId: row.user_id ? Number(row.user_id) : null,
          userName: row.game_name || row.username || '已注销玩家',
          avatar: row.avatar || '',
        })),
        total: Number(total.c),
        limit: limit,
        offset: offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ body: z.string().trim().min(1).max(300) });
    const body = schema.parse(req.body);
    const asset = await one('SELECT id, status FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!asset || asset.status !== 'approved') throw notFound('资源不存在');
    const result = await q('INSERT INTO asset_comments (asset_id, user_id, body) VALUES (?, ?, ?)', [
      asset.id,
      req.user.id,
      body.body,
    ]);
    await q('UPDATE assets SET comment_count = comment_count + 1 WHERE id = ?', [asset.id]);
    res.status(201).json({ ok: true, data: { id: Number(result.insertId), body: body.body } });
  } catch (err) {
    next(err);
  }
});

router.delete('/assets/:id/comments/:commentId', requireAuth, async (req, res, next) => {
  try {
    const comment = await one('SELECT * FROM asset_comments WHERE id = ? AND asset_id = ? LIMIT 1', [
      req.params.commentId,
      req.params.id,
    ]);
    if (!comment || comment.deleted_at) throw notFound('评论不存在');
    const asset = await one('SELECT author_id FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    const allowed =
      isStaff(req.user) ||
      Number(comment.user_id) === Number(req.user.id) ||
      (asset && Number(asset.author_id) === Number(req.user.id));
    if (!allowed) throw forbidden('不能删除这条评论');
    await q('UPDATE asset_comments SET deleted_at = NOW() WHERE id = ?', [comment.id]);
    await q('UPDATE assets SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = ?', [req.params.id]);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:id/reports', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ reason: z.string().trim().min(2).max(500) });
    const body = schema.parse(req.body);
    const asset = await one('SELECT id, status FROM assets WHERE id = ? LIMIT 1', [req.params.id]);
    if (!asset || asset.status !== 'approved') throw notFound('资源不存在');
    const recent = await one(
      'SELECT id FROM asset_reports WHERE asset_id = ? AND user_id = ? ' +
        'AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 1',
      [asset.id, req.user.id]
    );
    if (recent) throw badRequest('你今天已经举报过这个资源了');
    await q('INSERT INTO asset_reports (asset_id, user_id, reason) VALUES (?, ?, ?)', [
      asset.id,
      req.user.id,
      body.reason,
    ]);
    res.status(201).json({ ok: true, data: { reported: true } });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/asset-reports', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'open');
    if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) throw badRequest('status 不合法');
    const rows = await q(
      'SELECT r.*, a.name AS asset_name, a.kind AS asset_kind, u.username AS reporter_name ' +
        'FROM asset_reports r JOIN assets a ON a.id = r.asset_id ' +
        'LEFT JOIN users u ON u.id = r.user_id ' +
        (status === 'all' ? '' : 'WHERE r.status = ? ') +
        'ORDER BY r.created_at DESC LIMIT 100',
      status === 'all' ? [] : [status]
    );
    res.json({
      ok: true,
      data: {
        reports: rows.map((row) => ({
          id: Number(row.id),
          assetId: Number(row.asset_id),
          assetName: row.asset_name,
          kind: row.asset_kind,
          reason: row.reason,
          status: row.status,
          reporter: row.reporter_name || '匿名',
          createdAt: row.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/admin/asset-reports/:id',
  requireAuth,
  requireRole('ops', 'admin', 'owner'),
  async (req, res, next) => {
    try {
      const schema = z.object({ status: z.enum(['resolved', 'dismissed']) });
      const body = schema.parse(req.body);
      const report = await one('SELECT id FROM asset_reports WHERE id = ? LIMIT 1', [req.params.id]);
      if (!report) throw notFound('举报不存在');
      await q('UPDATE asset_reports SET status = ?, handled_by = ?, handled_at = NOW() WHERE id = ?', [
        body.status,
        req.user.id,
        report.id,
      ]);
      res.json({ ok: true, data: { status: body.status } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// 合集管理
// ---------------------------------------------------------------------------

const collectionSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/i),
  title: z.string().trim().min(1).max(64),
  description: z.string().trim().max(300).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  featured: z.boolean().optional(),
});

router.get('/admin/asset-collections', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const rows = await q(
      'SELECT c.*, COUNT(ci.asset_id) AS asset_count FROM asset_collections c ' +
        'LEFT JOIN asset_collection_items ci ON ci.collection_id = c.id ' +
        'GROUP BY c.id ORDER BY c.sort ASC, c.id ASC'
    );
    res.json({
      ok: true,
      data: {
        collections: rows.map((row) => ({
          id: Number(row.id),
          slug: row.slug,
          title: row.title,
          description: row.description,
          sort: Number(row.sort),
          featured: Boolean(row.featured),
          count: Number(row.asset_count),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/asset-collections', requireAuth, requireRole('ops', 'admin', 'owner'), async (req, res, next) => {
  try {
    const body = collectionSchema.parse(req.body);
    const exists = await one('SELECT id FROM asset_collections WHERE slug = ? LIMIT 1', [body.slug]);
    if (exists) throw badRequest('合集 slug 已存在');
    const result = await q(
      'INSERT INTO asset_collections (slug, title, description, sort, featured, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [body.slug, body.title, body.description || null, body.sort || 0, body.featured ? 1 : 0, req.user.id]
    );
    res.status(201).json({ ok: true, data: { id: Number(result.insertId) } });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/admin/asset-collections/:id',
  requireAuth,
  requireRole('ops', 'admin', 'owner'),
  async (req, res, next) => {
    try {
      const body = collectionSchema.partial().parse(req.body);
      const collection = await one('SELECT * FROM asset_collections WHERE id = ? LIMIT 1', [req.params.id]);
      if (!collection) throw notFound('合集不存在');
      const sets = [];
      const params = [];
      for (const key of ['slug', 'title', 'description', 'sort', 'featured']) {
        if (body[key] !== undefined) {
          sets.push(key + ' = ?');
          params.push(key === 'featured' ? (body[key] ? 1 : 0) : body[key]);
        }
      }
      if (!sets.length) throw badRequest('没有要修改的字段');
      params.push(collection.id);
      await q('UPDATE asset_collections SET ' + sets.join(', ') + ' WHERE id = ?', params);
      res.json({ ok: true, data: { updated: true } });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/admin/asset-collections/:id',
  requireAuth,
  requireRole('admin', 'owner'),
  async (req, res, next) => {
    try {
      const collection = await one('SELECT id FROM asset_collections WHERE id = ? LIMIT 1', [req.params.id]);
      if (!collection) throw notFound('合集不存在');
      await q('DELETE FROM asset_collections WHERE id = ?', [collection.id]);
      res.json({ ok: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/admin/asset-collections/:id/items',
  requireAuth,
  requireRole('ops', 'admin', 'owner'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        assetId: z.number().int().positive(),
        sort: z.number().int().min(0).max(9999).optional(),
      });
      const body = schema.parse(req.body);
      const collection = await one('SELECT id FROM asset_collections WHERE id = ? LIMIT 1', [req.params.id]);
      if (!collection) throw notFound('合集不存在');
      const asset = await one('SELECT id FROM assets WHERE id = ? LIMIT 1', [body.assetId]);
      if (!asset) throw notFound('资源不存在');
      await q(
        'INSERT INTO asset_collection_items (collection_id, asset_id, sort) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE sort = VALUES(sort)',
        [collection.id, body.assetId, body.sort || 0]
      );
      res.status(201).json({ ok: true, data: { added: true } });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/admin/asset-collections/:id/items/:assetId',
  requireAuth,
  requireRole('ops', 'admin', 'owner'),
  async (req, res, next) => {
    try {
      await q('DELETE FROM asset_collection_items WHERE collection_id = ? AND asset_id = ?', [
        req.params.id,
        req.params.assetId,
      ]);
      res.json({ ok: true, data: { removed: true } });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
