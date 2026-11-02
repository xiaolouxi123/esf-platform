'use strict';

/**
 * 环境变量集中解析。任何缺失的关键配置都在启动时直接报错，
 * 不要等到运行到一半才炸。
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function str(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

const env = {
  nodeEnv: str(process.env.NODE_ENV, 'development'),
  host: str(process.env.HOST, '127.0.0.1'),
  apiPort: num(process.env.API_PORT, 3000),
  versionLabel: str(process.env.VERSION_LABEL, 'dev'),
  version: require('../package.json').version,

  jwtSecret: str(process.env.JWT_SECRET),
  jwtTtlSeconds: num(process.env.JWT_TTL_SECONDS, 7 * 24 * 3600),

  inviteCode: str(process.env.INVITE_CODE),
  launchTokenTtlSeconds: num(process.env.LAUNCH_TOKEN_TTL_SECONDS, 120),
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),

  // 启动器公告位（先留空，运营时填）
  notice: str(process.env.NOTICE),
  maintenance: str(process.env.MAINTENANCE, '0') === '1',
  minLauncherVersion: str(process.env.MIN_LAUNCHER_VERSION, '0.0.0'),

  // 版本更新：启动器拿它和自身版本比较
  latestVersion: str(process.env.LATEST_VERSION, require('../package.json').version),
  releaseNotes: str(process.env.RELEASE_NOTES),
  updateFeedUrl: process.env.UPDATE_FEED_URL || '',
  downloadUrl: str(process.env.DOWNLOAD_URL),

  // 资源库：模型 / 声音上传
  uploadDir: str(process.env.UPLOAD_DIR, path.join(__dirname, '..', 'uploads')),
  uploadMaxBytes: num(process.env.UPLOAD_MAX_MB, 64) * 1024 * 1024,

  // 启动器更新源目录（放 latest.yml 与安装包，通过 /updates 静态提供）
  updateDir: str(process.env.UPDATE_DIR, path.join(__dirname, '..', 'updates')),

  // 发布更新包用的一次性令牌（POST /api/admin/update-upload）
  updateUploadToken: str(process.env.UPDATE_UPLOAD_TOKEN),

  db: {
    host: str(process.env.DB_HOST, '127.0.0.1'),
    port: num(process.env.DB_PORT, 3306),
    name: str(process.env.DB_NAME, 'esf_platform'),
    user: str(process.env.DB_USER, 'esf_app'),
    password: str(process.env.DB_PASSWORD),
    allowedHost: str(process.env.DB_ALLOWED_HOST, '127.0.0.1'),
  },

  amxx: {
    user: str(process.env.AMXX_DB_USER, 'esf_amxx'),
    password: str(process.env.AMXX_DB_PASSWORD),
    allowedHost: str(process.env.AMXX_ALLOWED_HOST, '127.0.0.1'),
  },
};

if (!env.jwtSecret || env.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET 缺失或少于 16 字符，请检查 server/.env（参考 .env.example）');
}

module.exports = env;
