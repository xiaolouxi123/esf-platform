'use strict';

const express = require('express');
const env = require('../env');
const { ping } = require('../db');
const { getPlatformSettings } = require('../services/platform');

const router = express.Router();

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
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
