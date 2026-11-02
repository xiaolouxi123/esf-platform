'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const env = require('../env');
const { ping } = require('../db');
const { getPlatformSettings } = require('../services/platform');

const router = express.Router();

/**
 * 更新源地址：
 *  - 优先 .env 的 UPDATE_FEED_URL
 *  - 没配就读 UPDATE_DIR/public-url.txt（隧道地址会变，守护脚本会更新它）
 */
function resolveFeedUrl(req) {
  // 本机访问时用本机更新源，避免自己更新自己也绕公网隧道
  const host = String((req && req.headers && req.headers.host) || '');
  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    return `http://${host}/updates/`;
  }

  if (env.updateFeedUrl) return env.updateFeedUrl;
  try {
    const value = fs
      .readFileSync(path.join(env.updateDir, 'public-url.txt'), 'utf8')
      .trim()
      .replace(/\/+$/, '');
    if (/^https?:\/\//i.test(value)) return `${value}/updates/`;
  } catch {
    /* ignore */
  }
  return '';
}

// 启动器启动时拉一次：公告、维护状态、版本信息
router.get('/config', async (req, res, next) => {
  try {
    const dbUp = await ping();
    const platform = await getPlatformSettings();

    res.json({
      ok: true,
      data: {
        notice: platform.notice,
        maintenance: platform.maintenance,
        maintenanceText: platform.maintenanceText,
        minLauncherVersion: env.minLauncherVersion,
        apiVersion: 1,
        version: env.version,
        db: dbUp ? 'up' : 'down',
        inviteRequired: Boolean(env.inviteCode),
        latestVersion: env.latestVersion,
        releaseNotes: env.releaseNotes,
        downloadUrl: env.downloadUrl,
        updateFeedUrl: resolveFeedUrl(req),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
