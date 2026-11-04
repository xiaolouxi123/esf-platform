'use strict';

const express = require('express');
const { z } = require('zod');

const { requireAuth } = require('../middleware/auth');
const { issueLaunchToken } = require('../services/tokenService');

const router = express.Router();

const schema = z.object({
  serverKey: z.string().trim().min(1).max(32),
  purpose: z.enum(['join', 'spectate']).default('join'),
});

router.post('/launch-token', requireAuth, async (req, res, next) => {
  try {
    const { serverKey, purpose } = schema.parse(req.body);
    const result = await issueLaunchToken(req.user.id, serverKey, { purpose });
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
