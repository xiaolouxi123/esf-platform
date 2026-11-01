'use strict';

const express = require('express');
const env = require('../env');
const { ping } = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  const dbUp = await ping();
  res.json({
    ok: true,
    data: {
      version: env.version,
      env: env.nodeEnv,
      db: dbUp ? 'up' : 'down',
      uptimeSec: Math.round(process.uptime()),
    },
  });
});

module.exports = router;
