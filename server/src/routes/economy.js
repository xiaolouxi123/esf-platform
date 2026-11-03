'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { getWallet, recentTransactions } = require('../services/economy');

const router = express.Router();

router.get('/economy/summary', requireAuth, async (req, res, next) => {
  try {
    const wallet = await getWallet(req.user.id);
    const transactions = await recentTransactions(req.user.id, 10);
    res.json({ ok: true, data: { wallet, transactions } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
