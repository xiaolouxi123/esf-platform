'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', '..', 'amxx', 'test_ranked.sma');
const source = fs.readFileSync(sourcePath, 'utf8');

test('challenge identification retries after a late room start', () => {
  assert.match(source, /#define TASK_CHALLENGE_RETRY\s+4600/);
  assert.match(source, /set_task\(20\.0, "taskChallengeRetry", TASK_CHALLENGE_RETRY \+ id, _, _, "b"\)/);
  assert.match(source, /public taskChallengeRetry\(taskid\)/);
  assert.match(source, /g_challengeRetry\[id\] >= CHALLENGE_RETRY_LIMIT/);
});

test('challenge retry is cleaned up when the player disconnects', () => {
  assert.match(source, /remove_task\(TASK_CHALLENGE_RETRY \+ id\)/);
});

test('challenge identification still loads the room victory rule', () => {
  assert.match(source, /COALESCE\(c\.victory_type, 'kills'\)/);
  assert.match(source, /COALESCE\(c\.victory_limit, 10\)/);
  assert.match(source, /r\.status = 'live'/);
});
