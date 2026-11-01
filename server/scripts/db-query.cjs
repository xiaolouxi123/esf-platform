#!/usr/bin/env node
'use strict';

/**
 * 一次性执行 SQL，适合临时查数据 / 改数据。
 *
 *   npm run db:query -- "SELECT id, username FROM users"
 *   npm run db:query -- "UPDATE users SET status='banned' WHERE username='demo'"
 *   npm run db:query -- --json "SELECT * FROM servers"
 */

const { q, ping, close } = require('../src/db');

(async () => {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const sql = args.filter((a) => a !== '--json').join(' ').trim();

  if (!sql) {
    console.error('用法: npm run db:query -- [--json] "SQL 语句"');
    process.exit(1);
  }

  if (!(await ping())) {
    console.error('[db] 连不上数据库。先执行: npm run db:start');
    process.exit(1);
  }

  try {
    const result = await q(sql);

    if (Array.isArray(result)) {
      if (result.length === 0) {
        console.log('（空结果）');
      } else if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.table(result);
        console.log(`共 ${result.length} 行`);
      }
    } else {
      // INSERT / UPDATE / DELETE
      console.log(
        `影响行数 ${result.affectedRows ?? '-'}` +
          (result.insertId ? `，新增 id=${result.insertId}` : '') +
          (result.changedRows !== undefined ? `，实际修改 ${result.changedRows}` : '')
      );
    }
  } catch (err) {
    console.error('[db] SQL 执行失败:', err.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
