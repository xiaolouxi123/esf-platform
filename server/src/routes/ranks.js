'use strict';

const express = require('express');
const { q } = require('../db');

const router = express.Router();

function publicRank(row) {
  return {
    level: Number(row.level),
    name: String(row.name || ''),
    color: String(row.color || '#94A0B8'),
    sortOrder: Number(row.sort_order || 0),
  };
}

/** 公开的格斗等级配置：客户端用来渲染徽章、颜色和排序 */
router.get('/', async (req, res, next) => {
  try {
    const rows = await q(
      'SELECT level, name, color, sort_order FROM combat_ranks ORDER BY sort_order ASC, level ASC'
    );
    res.json({ ok: true, data: { ranks: rows.map(publicRank) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.publicRank = publicRank;
