'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { badRequest, forbidden } = require('../lib/errors');
const ranked = require('../services/ranked');

const router = express.Router();

function fail(err, next) {
  next(err.status ? err : badRequest(err.message));
}

router.get('/ranked/state', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await ranked.getState(req.user.id) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/queue', requireAuth, async (req, res, next) => {
  try {
    const mode = String(req.body?.mode || '1v1');
    if (!ranked.MODES.includes(mode)) throw badRequest('排位模式只能是 1v1 / 2v2');
    res.json({ ok: true, data: await ranked.joinQueue(req.user.id, mode) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/cancel', requireAuth, async (req, res, next) => {
  try {
    const cancelMatch = Boolean(req.body?.matchId);
    res.json({
      ok: true,
      data: cancelMatch ? await ranked.cancelMatch(req.user.id) : await ranked.leaveQueue(req.user.id),
    });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/ready', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await ranked.setReady(req.user.id) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/bet', requireAuth, async (req, res, next) => {
  try {
    const matchId = Number(req.body?.matchId);
    const team = String(req.body?.team || '');
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(matchId) || matchId <= 0) throw badRequest('比赛 ID 不合法');
    res.json({ ok: true, data: await ranked.placeBet(req.user.id, matchId, team, amount) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/spectate', requireAuth, async (req, res, next) => {
  try {
    const matchId = Number(req.body?.matchId);
    if (!Number.isInteger(matchId) || matchId <= 0) throw badRequest('比赛 ID 不合法');
    res.json({ ok: true, data: await ranked.spectate(req.user.id, matchId) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/finish', requireAuth, async (req, res, next) => {
  try {
    if (!['admin', 'owner'].includes(req.user.role)) throw forbidden('只有管理员可以结算排位赛');
    const matchId = Number(req.body?.matchId);
    const winner = String(req.body?.winner || '');
    if (!Number.isInteger(matchId) || matchId <= 0) throw badRequest('比赛 ID 不合法');
    res.json({ ok: true, data: await ranked.finishMatch(matchId, winner) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/ranked/settle', requireAuth, async (req, res, next) => {
  try {
    const matchId = Number(req.body?.matchId);
    const winner = String(req.body?.winner || '');
    const players = Array.isArray(req.body?.players) ? req.body.players : [];
    if (!Number.isInteger(matchId) || matchId <= 0) throw badRequest('比赛 ID 不合法');
    res.json({ ok: true, data: await ranked.settleFromClient(matchId, winner, players, req.user.id) });
  } catch (err) {
    fail(err, next);
  }
});

router.get('/ranked/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const rows = await ranked.leaderboard(req.query.limit);
    res.json({ ok: true, data: { players: rows } });
  } catch (err) {
    fail(err, next);
  }
});

router.get('/ranked/history', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: { matches: await ranked.history(req.user.id, req.query.limit) } });
  } catch (err) {
    fail(err, next);
  }
});

module.exports = router;
