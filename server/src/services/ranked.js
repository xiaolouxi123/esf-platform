'use strict';

const { pool, q, one } = require('../db');
const { getWallet } = require('./economy');

const MODE_SIZE = { '1v1': 2, '2v2': 4 };
const MODES = Object.keys(MODE_SIZE);
const BET_MIN = 10;
const BET_MAX = 5000;
const RAKE = 0.05;

function tierOf(rating) {
  if (rating >= 1900) return '王者';
  if (rating >= 1700) return '钻石';
  if (rating >= 1500) return '铂金';
  if (rating >= 1300) return '黄金';
  if (rating >= 1100) return '白银';
  return '青铜';
}

async function ensureProfile(userId) {
  await q('INSERT IGNORE INTO ranked_profiles (user_id) VALUES (?)', [userId]);
}

async function getProfile(userId) {
  await ensureProfile(userId);
  const row = await one(
    'SELECT rating, wins, losses, matches FROM ranked_profiles WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const rankRow = await one(
    'SELECT COUNT(*) AS higher FROM ranked_profiles WHERE rating > ?',
    [row.rating]
  );
  const wallet = await getWallet(userId);
  const total = Number(row.wins || 0) + Number(row.losses || 0);
  return {
    rating: Number(row.rating),
    tier: tierOf(Number(row.rating)),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    matches: Number(row.matches || 0),
    winRate: total > 0 ? Math.round((Number(row.wins) / total) * 100) : 0,
    rank: Number(rankRow?.higher || 0) + 1,
    coins: wallet.coins,
  };
}

async function playerRows(matchId) {
  const rows = await q(
    `SELECT p.team, p.slot, p.ready, p.rating_before, p.rating_after, p.afk,
            u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.role
       FROM ranked_match_players p
       JOIN users u ON u.id = p.user_id
      WHERE p.match_id = ?
      ORDER BY p.team ASC, p.slot ASC`,
    [matchId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    avatar: row.avatar || '',
    avatarUrl: row.avatar_url || '',
    role: row.role,
    team: row.team,
    slot: Number(row.slot),
    ready: Boolean(row.ready),
    rating: Number(row.rating_before || 1000),
    ratingAfter: row.rating_after === null ? null : Number(row.rating_after),
    afk: Number(row.afk) === 1,
  }));
}

async function getMatch(matchId, userId) {
  const row = await one(
    `SELECT m.*, s.name AS server_name, s.ip, s.port, st.map AS live_map
       FROM ranked_matches m
       JOIN servers s ON s.server_key = m.server_key
       LEFT JOIN server_status st ON st.server_id = s.id
      WHERE m.id = ?
      LIMIT 1`,
    [matchId]
  );
  if (!row) return null;

  const players = await playerRows(matchId);
  const teams = { a: [], b: [] };
  for (const player of players) teams[player.team].push(player);
  const allReady = players.length > 0 && players.every((player) => player.ready);

  const pools = await one(
    `SELECT
       COALESCE(SUM(CASE WHEN team='a' THEN amount ELSE 0 END),0) AS pool_a,
       COALESCE(SUM(CASE WHEN team='b' THEN amount ELSE 0 END),0) AS pool_b,
       COUNT(*) AS bets
     FROM ranked_bets WHERE match_id = ?`,
    [matchId]
  );
  const myBet = userId
    ? await one('SELECT team, amount, settled, payout FROM ranked_bets WHERE match_id = ? AND user_id = ?', [
        matchId,
        userId,
      ])
    : null;
  const spectators = await one('SELECT COUNT(*) AS count FROM ranked_spectators WHERE match_id = ?', [
    matchId,
  ]);

  return {
    id: Number(row.id),
    mode: row.mode,
    status: row.status,
    winner: row.winner || null,
    map: row.live_map || row.map || null,
    server: {
      serverKey: row.server_key,
      name: row.server_name,
      ip: row.ip,
      port: Number(row.port),
      map: row.live_map || row.map || null,
    },
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    players,
    teams,
    readyCount: players.filter((player) => player.ready).length,
    playerCount: players.length,
    allReady,
    pool: { a: Number(pools?.pool_a || 0), b: Number(pools?.pool_b || 0), total: Number(pools?.pool_a || 0) + Number(pools?.pool_b || 0) },
    betCount: Number(pools?.bets || 0),
    myBet: myBet
      ? { team: myBet.team, amount: Number(myBet.amount), settled: Boolean(myBet.settled), payout: Number(myBet.payout) }
      : null,
    spectatorCount: Number(spectators?.count || 0),
    isParticipant: Boolean(userId && players.some((player) => player.id === Number(userId))),
  };
}

async function getLastResult(userId) {
  const row = await one(
    `SELECT m.id
       FROM ranked_match_players p
       JOIN ranked_matches m ON m.id = p.match_id
      WHERE p.user_id = ? AND m.status = 'finished'
      ORDER BY m.finished_at DESC, m.id DESC
      LIMIT 1`,
    [userId]
  );
  if (!row) return null;

  const match = await getMatch(row.id, userId);
  const me = match?.players?.find((player) => player.id === Number(userId));
  if (!match || !me || !match.winner) return null;

  return {
    matchId: match.id,
    mode: match.mode,
    winner: match.winner,
    myTeam: me.team,
    result: me.team === match.winner ? 'win' : 'loss',
    ratingBefore: me.rating,
    ratingAfter: me.ratingAfter,
    ratingDelta: me.ratingAfter === null ? null : me.ratingAfter - me.rating,
    finishedAt: match.finishedAt,
    server: match.server,
    players: match.players,
    teams: match.teams,
  };
}

/** 最近 N 场排位结果（历史战绩用；结构与 lastResult 一致） */
async function history(userId, limit = 10) {
  const size = Math.min(30, Math.max(1, Number(limit) || 10));
  const rows = await q(
    `SELECT m.id
       FROM ranked_match_players p
       JOIN ranked_matches m ON m.id = p.match_id
      WHERE p.user_id = ? AND m.status = 'finished'
      ORDER BY m.finished_at DESC, m.id DESC
      LIMIT ?`,
    [userId, size]
  );

  const out = [];
  for (const row of rows) {
    const match = await getMatch(row.id, userId);
    const me = match?.players?.find((player) => player.id === Number(userId));
    if (!match || !me || !match.winner) continue;
    out.push({
      matchId: match.id,
      mode: match.mode,
      winner: match.winner,
      myTeam: me.team,
      result: me.team === match.winner ? 'win' : 'loss',
      ratingBefore: me.rating,
      ratingAfter: me.ratingAfter,
      ratingDelta: me.ratingAfter === null ? null : me.ratingAfter - me.rating,
      afk: Boolean(me.afk),
      finishedAt: match.finishedAt,
      server: match.server,
      players: match.players,
      teams: match.teams,
    });
  }
  return out;
}

async function getState(userId) {
  const profile = await getProfile(userId);

  const active = await one(
    `SELECT m.id
       FROM ranked_match_players p
       JOIN ranked_matches m ON m.id = p.match_id
      WHERE p.user_id = ? AND m.status IN ('waiting','live')
      ORDER BY m.id DESC LIMIT 1`,
    [userId]
  );
  if (active) {
    return { state: 'matched', profile, match: await getMatch(active.id, userId) };
  }

  const watching = await one(
    `SELECT s.match_id
       FROM ranked_spectators s
       JOIN ranked_matches m ON m.id = s.match_id
      WHERE s.user_id = ? AND m.status IN ('waiting','live')
      ORDER BY s.match_id DESC LIMIT 1`,
    [userId]
  );
  if (watching) {
    return { state: 'matched', profile, match: await getMatch(watching.match_id, userId) };
  }

  const queued = await one(
    `SELECT mode, joined_at, TIMESTAMPDIFF(SECOND, joined_at, NOW()) AS elapsed
       FROM ranked_queue
      WHERE user_id = ? AND matched_match_id IS NULL
        AND joined_at > (NOW() - INTERVAL 10 MINUTE)
      LIMIT 1`,
    [userId]
  );
  if (queued) {
    return {
      state: 'queued',
      profile,
      queue: { mode: queued.mode, joinedAt: queued.joined_at, elapsed: Number(queued.elapsed || 0) },
    };
  }

  return { state: 'idle', profile, lastResult: await getLastResult(userId) };
}

function pickGroup(entries, size, tolerance = 200) {
  if (entries.length < size) return null;
  let best = null;
  let bestSpread = Infinity;
  for (let i = 0; i + size <= entries.length; i++) {
    const group = entries.slice(i, i + size);
    const spread = Number(group[group.length - 1].rating) - Number(group[0].rating);
    if (spread <= tolerance && spread < bestSpread) {
      best = group;
      bestSpread = spread;
    }
  }
  return best;
}

/** 队列触发匹配：锁住队列和服务器，避免并发创建两场比赛 */
async function tryMatch(mode) {
  const size = MODE_SIZE[mode];
  if (!size) return null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [entries] = await conn.query(
      `SELECT id, user_id, rating, TIMESTAMPDIFF(SECOND, joined_at, NOW()) AS waited
         FROM ranked_queue
        WHERE mode = ? AND matched_match_id IS NULL
          AND joined_at > (NOW() - INTERVAL 10 MINUTE)
        ORDER BY rating ASC
        FOR UPDATE`,
      [mode]
    );
    const oldest = entries.reduce((max, entry) => Math.max(max, Number(entry.waited || 0)), 0);
    const tolerance = 200 + Math.min(800, Math.floor(oldest / 15) * 50);
    const group = pickGroup(entries, size, tolerance);
    if (!group) {
      await conn.rollback();
      return null;
    }

    const [serverRows] = await conn.query(
      `SELECT s.server_key, s.ip, s.port, st.map
         FROM servers s
         JOIN server_status st ON st.server_id = s.id
        WHERE s.enabled = 1 AND st.online = 1
          AND NOT EXISTS (
            SELECT 1 FROM ranked_matches rm
             WHERE rm.server_key = s.server_key
               AND rm.status IN ('waiting','live')
          )
        ORDER BY s.sort ASC, s.id ASC
        LIMIT 1
        FOR UPDATE`
    );
    if (!serverRows[0]) {
      await conn.rollback();
      return null;
    }
    const chosen = serverRows[0];

    const [matchResult] = await conn.query(
      `INSERT INTO ranked_matches (mode, server_key, map, status)
       VALUES (?, ?, ?, 'waiting')`,
      [mode, chosen.server_key, chosen.map || null]
    );
    const matchId = matchResult.insertId;

    const sorted = [...group].sort((a, b) => Number(a.rating) - Number(b.rating));
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const pair = Math.floor(i / 2);
      const team = pair % 2 === 0 ? (i % 2 === 0 ? 'a' : 'b') : i % 2 === 0 ? 'b' : 'a';
      const slot = pair + 1;
      await conn.query(
        `INSERT INTO ranked_match_players
           (match_id, user_id, team, slot, ready, rating_before)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [matchId, row.user_id, team, slot, row.rating]
      );
    }

    const ids = group.map((entry) => entry.id);
    await conn.query(
      `UPDATE ranked_queue SET matched_match_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
      [matchId, ...ids]
    );
    await conn.commit();
    return matchId;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function joinQueue(userId, mode) {
  if (!MODES.includes(mode)) throw new Error('排位模式不合法');
  await ensureProfile(userId);
  const active = await one(
    `SELECT m.id
       FROM ranked_match_players p
       JOIN ranked_matches m ON m.id = p.match_id
      WHERE p.user_id = ? AND m.status IN ('waiting','live')
      LIMIT 1`,
    [userId]
  );
  if (active) throw new Error('你已经在排位比赛中');
  const profile = await one('SELECT rating FROM ranked_profiles WHERE user_id = ?', [userId]);
  await q('DELETE FROM ranked_queue WHERE user_id = ?', [userId]);
  await q('INSERT INTO ranked_queue (user_id, mode, rating) VALUES (?, ?, ?)', [
    userId,
    mode,
    Number(profile?.rating || 1000),
  ]);
  await tryMatch(mode);
  return getState(userId);
}

async function leaveQueue(userId) {
  await q('DELETE FROM ranked_queue WHERE user_id = ? AND matched_match_id IS NULL', [userId]);
  return getState(userId);
}

async function setReady(userId) {
  const active = await one(
    `SELECT p.match_id, m.status
       FROM ranked_match_players p
       JOIN ranked_matches m ON m.id = p.match_id
      WHERE p.user_id = ? AND m.status IN ('waiting','live')
      ORDER BY m.id DESC LIMIT 1`,
    [userId]
  );
  if (!active) throw new Error('你不在排位比赛中');
  await q('UPDATE ranked_match_players SET ready = 1 WHERE match_id = ? AND user_id = ?', [
    active.match_id,
    userId,
  ]);

  const counts = await one(
    `SELECT COUNT(*) AS total, SUM(ready = 1) AS ready
       FROM ranked_match_players WHERE match_id = ?`,
    [active.match_id]
  );
  if (Number(counts?.total) > 0 && Number(counts.total) === Number(counts.ready)) {
    await q(
      `UPDATE ranked_matches SET status = 'live', started_at = COALESCE(started_at, NOW())
        WHERE id = ? AND status = 'waiting'`,
      [active.match_id]
    );
  }
  return getState(userId);
}

async function placeBet(userId, matchId, team, amount) {
  if (!['a', 'b'].includes(team)) throw new Error('请选择竞猜阵营');
  const value = Number(amount);
  if (!Number.isInteger(value) || value < BET_MIN || value > BET_MAX) {
    throw new Error(`竞猜金额需在 ${BET_MIN}-${BET_MAX} 金币之间`);
  }

  const match = await one('SELECT id, status FROM ranked_matches WHERE id = ?', [matchId]);
  if (!match) throw new Error('比赛不存在');
  if (match.status !== 'waiting') throw new Error('比赛已开始，停止下注');

  const participant = await one(
    'SELECT 1 AS ok FROM ranked_match_players WHERE match_id = ? AND user_id = ?',
    [matchId, userId]
  );
  if (participant) throw new Error('参赛玩家不能竞猜自己的比赛');

  const existing = await one('SELECT id FROM ranked_bets WHERE match_id = ? AND user_id = ?', [
    matchId,
    userId,
  ]);
  if (existing) throw new Error('本场已经下过注');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [deduct] = await conn.query(
      'UPDATE wallets SET coins = coins - ? WHERE user_id = ? AND coins >= ?',
      [value, userId, value]
    );
    if (deduct.affectedRows === 0) {
      await conn.rollback();
      throw new Error('金币不足');
    }
    await conn.query(
      'INSERT INTO ranked_bets (match_id, user_id, team, amount) VALUES (?, ?, ?, ?)',
      [matchId, userId, team, value]
    );
    await conn.query(
      'INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
      [userId, -value, 'ranked_bet']
    );
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }

  return getState(userId);
}

async function cancelMatch(userId) {
  const active = await one(
    `SELECT p.match_id
       FROM ranked_match_players p
       JOIN ranked_matches m ON m.id = p.match_id
      WHERE p.user_id = ? AND m.status = 'waiting'
      ORDER BY m.id DESC LIMIT 1`,
    [userId]
  );
  if (!active) throw new Error('没有可取消的排位对局');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE ranked_matches SET status='cancelled', finished_at=NOW() WHERE id=?", [
      active.match_id,
    ]);
    const [bets] = await conn.query(
      'SELECT id, user_id, amount FROM ranked_bets WHERE match_id = ? AND settled = 0',
      [active.match_id]
    );
    for (const bet of bets) {
      await conn.query('UPDATE wallets SET coins = coins + ? WHERE user_id = ?', [
        Number(bet.amount),
        bet.user_id,
      ]);
      await conn.query('UPDATE ranked_bets SET settled = 1, payout = ? WHERE id = ?', [
        Number(bet.amount),
        bet.id,
      ]);
      await conn.query(
        'INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
        [bet.user_id, Number(bet.amount), 'ranked_refund']
      );
    }
    const [players] = await conn.query(
      'SELECT user_id FROM ranked_match_players WHERE match_id = ?',
      [active.match_id]
    );
    if (players.length > 0) {
      await conn.query(
        `DELETE FROM ranked_queue WHERE user_id IN (${players.map(() => '?').join(',')})`,
        players.map((player) => player.user_id)
      );
    }
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }

  return getState(userId);
}

async function spectate(userId, matchId) {  const match = await one("SELECT id FROM ranked_matches WHERE id = ? AND status IN ('waiting','live')", [
    matchId,
  ]);
  if (!match) throw new Error('比赛不存在或已结束');
  await q('INSERT IGNORE INTO ranked_spectators (match_id, user_id) VALUES (?, ?)', [matchId, userId]);
  return getMatch(matchId, userId);
}

async function finishMatch(matchId, winner) {
  if (!['a', 'b'].includes(winner)) throw new Error('获胜方不合法');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[match]] = await conn.query(
      "SELECT id, status FROM ranked_matches WHERE id = ? AND status IN ('waiting','live') FOR UPDATE",
      [matchId]
    );
    if (!match) {
      await conn.rollback();
      throw new Error('比赛不存在或已结束');
    }

    await conn.query("UPDATE ranked_matches SET status='finished', winner=?, finished_at=NOW() WHERE id=?", [
      winner,
      matchId,
    ]);

    const [players] = await conn.query(
      'SELECT user_id, team, rating_before FROM ranked_match_players WHERE match_id = ?',
      [matchId]
    );
    for (const player of players) {
      const won = player.team === winner;
      const delta = won ? 25 : -20;
      const after = Math.max(0, Number(player.rating_before) + delta);
      await conn.query(
        'UPDATE ranked_match_players SET rating_after = ? WHERE match_id = ? AND user_id = ?',
        [after, matchId, player.user_id]
      );
      await conn.query(
        `UPDATE ranked_profiles
            SET rating = ?, wins = wins + ?, losses = losses + ?, matches = matches + 1
          WHERE user_id = ?`,
        [after, won ? 1 : 0, won ? 0 : 1, player.user_id]
      );
    }

    const [bets] = await conn.query('SELECT id, user_id, team, amount FROM ranked_bets WHERE match_id = ?', [
      matchId,
    ]);
    const totalPool = bets.reduce((sum, bet) => sum + Number(bet.amount), 0);
    const winningPool = bets
      .filter((bet) => bet.team === winner)
      .reduce((sum, bet) => sum + Number(bet.amount), 0);

    for (const bet of bets) {
      let payout = 0;
      if (winningPool > 0 && bet.team === winner) {
        payout = Math.floor((Number(bet.amount) * totalPool * (1 - RAKE)) / winningPool);
      } else if (winningPool === 0) {
        payout = Number(bet.amount); // 没人押中，原路退回
      }
      await conn.query('UPDATE ranked_bets SET settled = 1, payout = ? WHERE id = ?', [payout, bet.id]);
      if (payout > 0) {
        await conn.query('UPDATE wallets SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?', [
          payout,
          payout,
          bet.user_id,
        ]);
        await conn.query(
          'INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
          [bet.user_id, payout, 'ranked_win']
        );
      }
    }

    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }

  return getMatch(matchId, null);
}

async function leaderboard(limit = 20) {
  const rows = await q(
    `SELECT p.rating, p.wins, p.losses, p.matches,
            u.id, u.username, u.game_name, u.avatar, u.avatar_url, u.role
       FROM ranked_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE u.status = 'active'
      ORDER BY p.rating DESC, p.wins DESC
      LIMIT ?`,
    [Math.max(1, Math.min(50, Number(limit) || 20))]
  );
  return rows.map((row, index) => ({
    position: index + 1,
    id: Number(row.id),
    username: row.username,
    gameName: row.game_name,
    avatar: row.avatar || '',
    avatarUrl: row.avatar_url || '',
    role: row.role,
    rating: Number(row.rating),
    tier: tierOf(Number(row.rating)),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    matches: Number(row.matches || 0),
    winRate:
      Number(row.wins) + Number(row.losses) > 0
        ? Math.round((Number(row.wins) / (Number(row.wins) + Number(row.losses))) * 100)
        : 0,
  }));
}

/** 服务器列表用：server_key -> 当前比赛摘要 */
async function activeMatchesByServer() {
  const rows = await q(
    `SELECT m.id, m.mode, m.status, m.server_key, m.created_at,
            s.name AS server_name, s.ip, s.port, st.map AS live_map
       FROM ranked_matches m
       JOIN servers s ON s.server_key = m.server_key
       LEFT JOIN server_status st ON st.server_id = s.id
      WHERE m.status IN ('waiting','live')
      ORDER BY m.id DESC`
  );
  const map = new Map();
  for (const row of rows) {
    if (map.has(row.server_key)) continue;
    const players = await playerRows(row.id);
    map.set(row.server_key, {
      id: Number(row.id),
      mode: row.mode,
      status: row.status,
      map: row.live_map || null,
      players,
      teams: {
        a: players.filter((player) => player.team === 'a'),
        b: players.filter((player) => player.team === 'b'),
      },
      readyCount: players.filter((player) => player.ready).length,
      playerCount: players.length,
      createdAt: row.created_at,
    });
  }
  return map;
}

async function canEnterServer(userId, serverKey) {
  const active = await one(
    `SELECT id FROM ranked_matches
      WHERE server_key = ? AND status IN ('waiting','live') LIMIT 1`,
    [serverKey]
  );
  if (!active) return { allowed: true };
  const player = await one(
    'SELECT 1 AS ok FROM ranked_match_players WHERE match_id = ? AND user_id = ?',
    [active.id, userId]
  );
  return { allowed: Boolean(player), matchId: Number(active.id) };
}

module.exports = {
  MODES,
  BET_MIN,
  BET_MAX,
  tierOf,
  getProfile,
  getState,
  history,
  joinQueue,
  leaveQueue,
  cancelMatch,
  setReady,
  placeBet,
  spectate,
  finishMatch,
  leaderboard,
  activeMatchesByServer,
  canEnterServer,
  getMatch,
};
