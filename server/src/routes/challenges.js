'use strict';

const express = require('express');
const { z } = require('zod');

const { requireAuth } = require('../middleware/auth');
const { badRequest } = require('../lib/errors');
const challenges = require('../services/challenges');

const router = express.Router();

function idOf(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('房间 ID 不合法');
  return id;
}

function fail(err, next) {
  next(err.status ? err : badRequest(err.message));
}

router.use('/challenges', requireAuth);

router.get('/challenges', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await challenges.getState(req.user.id) });
  } catch (err) {
    fail(err, next);
  }
});

const createSchema = z.object({
  title: z.string().trim().max(48).optional(),
  mode: z.enum(challenges.MODES),
  map: z.string().trim().max(64).optional(),
  serverKey: z.string().trim().max(32).optional(),
});

router.post('/challenges', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body || {});
    const room = await challenges.createRoom(
      { id: req.user.id, username: req.user.username, gameName: req.user.game_name },
      body
    );
    res.status(201).json({ ok: true, data: { room, state: await challenges.getState(req.user.id) } });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/challenges/:id/join', async (req, res, next) => {
  try {
    const room = await challenges.joinRoom(req.user.id, idOf(req.params.id));
    res.json({ ok: true, data: { room, state: await challenges.getState(req.user.id) } });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/challenges/:id/leave', async (req, res, next) => {
  try {
    await challenges.leaveRoom(req.user.id, idOf(req.params.id));
    res.json({ ok: true, data: await challenges.getState(req.user.id) });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/challenges/:id/close', async (req, res, next) => {
  try {
    await challenges.closeRoom(req.user, idOf(req.params.id));
    res.json({ ok: true, data: await challenges.getState(req.user.id) });
  } catch (err) {
    fail(err, next);
  }
});

const inviteSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

router.post('/challenges/:id/invite', async (req, res, next) => {
  try {
    const body = inviteSchema.parse(req.body || {});
    await challenges.invite(req.user, idOf(req.params.id), body.userId);
    res.json({ ok: true, data: { invited: true, room: await challenges.getRoom(idOf(req.params.id), req.user.id) } });
  } catch (err) {
    fail(err, next);
  }
});

const respondSchema = z.object({
  action: z.enum(['accept', 'decline']),
});

router.post('/challenges/invites/:id/respond', async (req, res, next) => {
  try {
    const body = respondSchema.parse(req.body || {});
    const result = await challenges.respond(req.user.id, idOf(req.params.id), body.action);
    res.json({ ok: true, data: { ...result, state: await challenges.getState(req.user.id) } });
  } catch (err) {
    fail(err, next);
  }
});

const readySchema = z.object({
  ready: z.boolean().default(true),
});

router.post('/challenges/:id/ready', async (req, res, next) => {
  try {
    const body = readySchema.parse(req.body || {});
    const room = await challenges.setReady(req.user.id, idOf(req.params.id), body.ready);
    res.json({ ok: true, data: { room } });
  } catch (err) {
    fail(err, next);
  }
});

router.post('/challenges/:id/start', async (req, res, next) => {
  try {
    const room = await challenges.startRoom(req.user, idOf(req.params.id));
    res.json({ ok: true, data: { room, state: await challenges.getState(req.user.id) } });
  } catch (err) {
    fail(err, next);
  }
});

module.exports = router;
