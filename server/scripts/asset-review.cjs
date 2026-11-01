#!/usr/bin/env node
'use strict';

/**
 * 资源审核（没有后台界面之前，先用命令顶着）。
 *
 *   npm run asset:list                    # 待审列表
 *   npm run asset:list -- --status all    # 全部
 *   npm run asset:review -- 3 approved    # 通过 id=3
 *   npm run asset:review -- 3 rejected    # 驳回
 */

const { q, ping, close } = require('../src/db');

const argv = process.argv.slice(2);
const mode = argv[0] === '--review' ? 'review' : 'list';
const rest = mode === 'review' ? argv.slice(1) : argv;

// --status xxx 之外的都当位置参数（id、目标状态）
const options = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const token = rest[i];
  if (token.startsWith('--')) {
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      options[name] = next;
      i++;
    } else {
      options[name] = true;
    }
  } else {
    positional.push(token);
  }
}

(async () => {
  if (!(await ping())) {
    console.error('[db] 连不上数据库。先执行: npm run db:start');
    process.exit(1);
  }

  try {
    if (mode === 'review') {
      const id = Number(positional[0]);
      const status = positional[1];
      if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
        throw new Error('用法: npm run asset:review -- <id> <pending|approved|rejected>');
      }

      const result = await q('UPDATE assets SET status = ? WHERE id = ?', [status, id]);
      if (!result.affectedRows) throw new Error(`没有 id=${id} 的资源`);

      const row = await q(
        'SELECT id, name, status, target_path AS targetPath FROM assets WHERE id = ? LIMIT 1',
        [id]
      );
      console.log(`[asset] id=${row[0].id} ${row[0].name} → ${row[0].status}（落地 ${row[0].targetPath}）`);
      return;
    }

    const status = String(options.status || 'pending');
    const where = status === 'all' ? '1 = 1' : 'a.status = ?';
    const params = status === 'all' ? [] : [status];

    const rows = await q(
      `SELECT a.id, a.kind, a.name, a.version, a.target_path AS targetPath,
              a.status, a.file_size AS bytes, IFNULL(u.username, '-') AS author,
              DATE_FORMAT(a.created_at, '%m-%d %H:%i') AS createdAt
         FROM assets a LEFT JOIN users u ON u.id = a.author_id
        WHERE ${where}
        ORDER BY a.created_at DESC LIMIT 50`,
      params
    );

    if (rows.length === 0) {
      console.log(`（没有状态为 ${status} 的资源）`);
    } else {
      console.table(rows);
      console.log('审核：npm run asset:review -- <id> approved|rejected');
    }
  } catch (err) {
    console.error('[asset] 失败:', err.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
