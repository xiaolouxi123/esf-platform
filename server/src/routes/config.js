'use strict';

const express = require('express');
const env = require('../env');
const { ping } = require('../db');

const router = express.Router();

// 启动器启动时拉一次：公告、维护状态、最低版本
router.get('/config', async (req, res) => {
  const dbUp = await ping();
  res.json({
    ok: true,
    data: {
      notice: env.notice,
      maintenance: env.maintenance,
      minLauncherVersion: env.minLauncherVersion,
      apiVersion: 1,
      version: env.version,
      db: dbUp ? 'up' : 'down',
      inviteRequired: Boolean(env.inviteCode),
    },
  });
});

module.exports = router;
