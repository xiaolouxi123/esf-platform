'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', '..', 'amxx', 'esf_ranked_lock.sma');
const source = fs.readFileSync(sourcePath, 'utf8');

test('ranked lock SQL fits its AMXX query buffer', () => {
  const bufferMatch = source.match(/new query\[(\d+)\];/);
  assert.ok(bufferMatch, '未找到 query 缓冲区声明');

  const bufferSize = Number(bufferMatch[1]);
  // 0.52 起文件里有多个 formatex(query, ..., serverKey)（含 amxx_builds 心跳），
  // 必须挑出真正查 launch_tokens 的那一段，否则会拿心跳 SQL 误判缓冲区。
  const blocks = [...source.matchAll(
    /formatex\(query, charsmax\(query\),\s*"([\s\S]*?)"\s*,\s*serverKey/g,
  )];
  const sqlMatch = blocks.find((m) => /FROM launch_tokens/i.test(m[1]));
  assert.ok(sqlMatch, '未找到锁服查询 SQL');

  // token 与 server_key 都是 32 字符上限；%s 按最坏情况展开。
  const sql = sqlMatch[1]
    .replace(/\\\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/%s/g, 'x'.repeat(32));

  assert.match(sql, /FROM launch_tokens t\b/, 'SQL 必须保留 launch_tokens 别名');
  assert.ok(
    sql.length + 1 <= bufferSize,
    `SQL 长度 ${sql.length} 超过缓冲区 ${bufferSize}，会被 formatex 截断`,
  );
});
