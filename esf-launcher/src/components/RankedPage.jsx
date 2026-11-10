import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import RankedResultModal from './RankedResultModal';
import { playSfx } from '../lib/sfx';

const MODE_META = {
  '1v1': { label: '1v1', sub: '单排', desc: '单人匹配，纯个人实力', slots: 1 },
  '2v2': { label: '2v2', sub: '双人', desc: '两人一队，配合取胜', slots: 2 },
};

const TIER_COLOR = {
  青铜: '#c98f5a',
  白银: '#c7d0dd',
  黄金: '#ffd166',
  铂金: '#63e6d4',
  钻石: '#7ea8ff',
  王者: '#ff8a1f',
};

function tierColor(tier) {
  return TIER_COLOR[tier] || '#c7d0dd';
}

function formatFinishedAt(value) {
  const ms = Date.parse(value || '');
  if (Number.isNaN(ms)) return '';
  const at = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return sameDay ? `今天 ${time}` : `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
}

const TIER_ORDER = [
  { name: '青铜', min: 0 },
  { name: '白银', min: 1100 },
  { name: '黄金', min: 1300 },
  { name: '铂金', min: 1500 },
  { name: '钻石', min: 1700 },
  { name: '王者', min: 1900 },
];

function tierInfo(rating) {
  const value = Number.isFinite(rating) ? rating : 1000;
  let index = 0;
  TIER_ORDER.forEach((tier, i) => {
    if (value >= tier.min) index = i;
  });
  const current = TIER_ORDER[index];
  const next = TIER_ORDER[index + 1];
  const percent = next
    ? Math.min(100, Math.max(0, ((value - current.min) / (next.min - current.min)) * 100))
    : 100;
  return { value, index, current, next, percent };
}

function TierTrack({ index }) {
  return (
    <div className="rank-tier-track">
      {TIER_ORDER.map((tier, i) => (
        <span
          key={tier.name}
          className={i <= index ? 'is-reached' : ''}
          style={i <= index ? { '--tier-color': tierColor(tier.name) } : undefined}
        >
          {tier.name}
        </span>
      ))}
    </div>
  );
}

function SeatCard({ player, side }) {
  if (!player) {
    return (
      <div className="rank-seat rank-seat--empty">
        <div className="rank-seat-avatar">
          <Icon name="plus" size={16} />
        </div>
        <div className="rank-seat-meta">
          <b>等待加入</b>
          <small>匹配中…</small>
        </div>
      </div>
    );
  }
  return (
    <div className={`rank-seat rank-seat--${side}${player.ready ? ' is-ready' : ''}`}>
      <Avatar user={player} size="sm" />
      <div className="rank-seat-meta">
        <b>{player.gameName}</b>
        <small>
          {player.rating} 分 {player.ready ? '· 已准备' : '· 未准备'}
        </small>
      </div>
      <span className={`rank-ready-dot${player.ready ? ' is-on' : ''}`} />
    </div>
  );
}

function MatchBoard({ match, user, busy, onReady, onLaunch, onFinish, onSpectate, onCancel }) {
  const slots = MODE_META[match.mode]?.slots || 1;
  const isStaff = ['admin', 'owner'].includes(user?.role);
  const isParticipant = Boolean(match.isParticipant);
  const teamA = [...(match.teams?.a || [])];
  const teamB = [...(match.teams?.b || [])];

  return (
    <div className="rank-match">
      <div className="rank-match-head">
        <div>
          <span className="rank-eyebrow">排位对局 · {match.mode}</span>
          <h2>{match.status === 'live' ? '比赛进行中' : '对局已找到'}</h2>
          <p>
            {match.server.name} · {match.map || '随机地图'} · 全员准备后 3 秒进入游戏
          </p>
        </div>
        <span className={`rank-live${match.status === 'live' ? ' is-live' : ''}`}>
          <i /> {match.status === 'live' ? 'LIVE' : 'WAITING'}
        </span>
      </div>

      <div className="rank-server-strip">
        <span>
          <Icon name="server" size={13} /> {match.server.name}
        </span>
        <code>
          {match.server.ip}:{match.server.port}
        </code>
        <span>
          <Icon name="users" size={13} /> {match.playerCount} 人
        </span>
        <span>
          <Icon name="eye" size={13} /> {match.spectatorCount} 观战
        </span>
      </div>

      <div className="rank-vs">
        <div className="rank-team">
          <div className="rank-team-head">
            <b>A 队</b>
            <span>{match.teams?.a?.reduce((n, p) => n + p.rating, 0) || 0} 分</span>
          </div>
          {Array.from({ length: slots }, (_, index) => (
            <SeatCard key={`a-${index}`} player={teamA[index]} side="a" />
          ))}
        </div>

        <div className="rank-vs-mark">
          <span>VS</span>
          <small>
            {match.readyCount}/{match.playerCount} 已准备
          </small>
        </div>

        <div className="rank-team">
          <div className="rank-team-head">
            <b>B 队</b>
            <span>{match.teams?.b?.reduce((n, p) => n + p.rating, 0) || 0} 分</span>
          </div>
          {Array.from({ length: slots }, (_, index) => (
            <SeatCard key={`b-${index}`} player={teamB[index]} side="b" />
          ))}
        </div>
      </div>

      <div className="rank-match-actions">
        {isParticipant ? (
          <>
            <button type="button" className="btn btn-primary btn-lg" onClick={onReady} disabled={busy || match.allReady}>
              <Icon name="check" size={16} />
              {match.allReady ? '等待倒计时…' : '我已准备'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onLaunch} disabled={busy || match.status !== 'live'}>
              <Icon name="play" size={15} /> {match.status === 'live' ? '进入比赛' : '等待开赛'}
            </button>
            {match.status === 'waiting' && (
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
                取消对局
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={onSpectate} disabled={busy}>
            <Icon name="eye" size={16} /> 观战本场
          </button>
        )}

        {isStaff && (
          <div className="rank-staff">
            <span>管理员结算</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFinish('a')} disabled={busy}>
              A 队获胜
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFinish('b')} disabled={busy}>
              B 队获胜
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({ history, onOpen }) {
  return (
    <section className="rank-history">
      <header>
        <h3>
          <Icon name="clock" size={15} /> 我的战绩
        </h3>
        <span>{history.length ? `近 ${history.length} 场` : '近 10 场'}</span>
      </header>
      {history.length === 0 ? (
        <p className="rank-board-empty">还没有排位记录，先匹配一场。</p>
      ) : (
        <div className="rank-history-list">
          {history.map((row) => (
            <button
              type="button"
              className="rank-history-row"
              key={`${row.matchId}:${row.finishedAt || ''}`}
              onClick={() => onOpen(row)}
              title="查看结算详情"
            >
              <span className={`rank-history-tag${row.result === 'win' ? ' is-win' : ' is-loss'}`}>
                {row.result === 'win' ? '胜' : '负'}
              </span>
              {row.afk ? <span className="rank-history-afk" title="离开比赛被判负，固定扣 30 分">AFK</span> : null}
              <span className="rank-history-main">
                <b>{row.mode} 排位</b>
                <small>
                  {row.server?.name || row.map || '排位对局'}
                  {row.finishedAt ? ` · ${formatFinishedAt(row.finishedAt)}` : ''}
                </small>
              </span>
              <span className="rank-history-rate">
                <b className={Number.isFinite(row.ratingDelta) && row.ratingDelta >= 0 ? 'is-up' : 'is-down'}>
                  {Number.isFinite(row.ratingDelta) ? `${row.ratingDelta > 0 ? '+' : ''}${row.ratingDelta}` : '—'}
                </b>
                <small>{Number.isFinite(row.ratingAfter) ? row.ratingAfter : '—'}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function RankedPage({ user, toast, servers = [] }) {
  const [mode, setMode] = useState('1v1');
  const [state, setState] = useState({ state: 'loading', profile: null });
  const availableServers = (servers || []).filter((s) => s.online && !s.locked);
  const serverUnavailable = availableServers.length === 0;
  const [leaderboard, setLeaderboard] = useState([]);
  const [history, setHistory] = useState([]);
  const [betTeam, setBetTeam] = useState('a');
  const [betAmount, setBetAmount] = useState(50);
  const [busy, setBusy] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [result, setResult] = useState(null);
  const launchRef = useRef(null);
  const matchRef = useRef(null);
  const seenResultRef = useRef(
    typeof localStorage === 'undefined' ? '' : localStorage.getItem('esf:seenRankedResult') || ''
  );
  const dismissedResultRef = useRef('');
  matchRef.current = state.match;

  const consumeResult = useCallback(async (lastResult) => {
    if (!lastResult?.matchId) return;
    const key = `${lastResult.matchId}:${lastResult.finishedAt || ''}`;
    if (dismissedResultRef.current === key) return;
    // 已看过的结果不再弹窗（之前每次进排位页都会重新弹）
    if (seenResultRef.current === key) return;

    seenResultRef.current = key;
    try {
      localStorage.setItem('esf:seenRankedResult', key);
    } catch {
      /* 存储不可用时忽略 */
    }

    const finishedAt = Date.parse(lastResult.finishedAt || '');
    if (Number.isNaN(finishedAt)) return;
    const age = Date.now() - finishedAt;
    // 最近 10 分钟内的结果顺手把游戏收掉，避免赛后还停在服务器里
    if (age < 10 * 60 * 1000) {
      try {
        await window.electronAPI?.launch?.stop?.();
      } catch {
        /* 游戏可能已经退出 */
      }
    }
    // 只有新鲜结果才自动弹结算；更早的战绩从「我的战绩」里点开
    if (age < 60 * 60 * 1000) setResult(lastResult);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const data = await window.electronAPI.ranked.state();
      setState(data);
      if (data?.match?.mode) setMode(data.match.mode);
      await consumeResult(data?.lastResult);
    } catch (err) {
      setState((prev) => ({ ...prev, state: prev.state === 'loading' ? 'error' : prev.state, error: err.message }));
    }
  }, [consumeResult]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await window.electronAPI.ranked.leaderboard(20);
      setLeaderboard(data.players || []);
    } catch {
      /* 排行可稍后重试 */
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await window.electronAPI.ranked.history(10);
      setHistory(data.matches || []);
    } catch {
      /* 战绩可稍后重试 */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadState();
    loadLeaderboard();
    loadHistory();
    const stateTimer = setInterval(() => {
      if (alive) loadState();
    }, 2500);
    const boardTimer = setInterval(() => {
      if (alive) loadLeaderboard();
    }, 12000);
    const historyTimer = setInterval(() => {
      if (alive) loadHistory();
    }, 30000);
    return () => {
      alive = false;
      clearInterval(stateTimer);
      clearInterval(boardTimer);
      clearInterval(historyTimer);
    };
  }, [loadState, loadLeaderboard, loadHistory]);

  // 结算面板出现/关闭后刷新一次战绩
  useEffect(() => {
    if (result) loadHistory();
  }, [result, loadHistory]);

  const launchMatch = useCallback(
    async (match) => {
      try {
        await window.electronAPI.launch.join({
          serverKey: match.server.serverKey,
          ip: match.server.ip,
          port: match.server.port,
        });
        toast?.('已进入排位比赛，平台已收进托盘', 'ok');
      } catch (err) {
        toast?.(err.message, 'error');
      }
    },
    [toast]
  );

  useEffect(() => {
    const match = matchRef.current;
    if (state.state !== 'matched' || !match || match.status !== 'live' || !match.allReady) return undefined;
    if (launchRef.current === match.id) return undefined;
    launchRef.current = match.id;
    let left = 3;
    setCountdown(3);
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        setCountdown(null);
        launchMatch(match);
      } else {
        setCountdown(left);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [state.state, state.match?.id, state.match?.status, state.match?.allReady, launchMatch]);

  const run = async (key, fn, okMessage) => {
    if (busy) return;
    setBusy(key);
    try {
      const data = await fn();
      if (data) setState(data);
      if (okMessage) toast?.(okMessage, 'ok');
      await loadLeaderboard();
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const pickMode = (key) => {
    if (key === mode) return;
    playSfx('tab');
    setMode(key);
  };

  const queue = () => {
    playSfx('click');
    return run('queue', () => window.electronAPI.ranked.queue(mode), '已加入排位匹配');
  };
  const cancel = () => run('cancel', () => window.electronAPI.ranked.cancel(), '已取消匹配');
  const leaveMatch = () =>
    run('cancel', () => window.electronAPI.ranked.cancel(state.match.id), '已取消对局，竞猜金币已退回');
  const ready = () => run('ready', () => window.electronAPI.ranked.ready(), '已准备，等待其他玩家');
  const spectate = () =>
    run(
      'spectate',
      async () => {
        const match = await window.electronAPI.ranked.spectate(state.match.id);
        return { ...state, match };
      },
      '已加入观战'
    );
  const finish = (winner) =>
    run(
      'finish',
      async () => {
        await window.electronAPI.ranked.finish(state.match.id, winner);
        return window.electronAPI.ranked.state();
      },
      `已结算 ${winner.toUpperCase()} 队获胜`
    );
  const bet = () =>
    run(
      'bet',
      async () => {
        const data = await window.electronAPI.ranked.bet(state.match.id, betTeam, Number(betAmount));
        return data;
      },
      '下注成功'
    );

  const profile = state.profile;
  const match = state.match;
  const queued = state.state === 'queued';
  const matched = state.state === 'matched';
  const rank = tierInfo(profile?.rating);
  const currentMode = MODE_META[mode] || MODE_META['1v1'];

  return (
    <div className="ranked-page">
      <header className="ranked-hero">
        <span className="hero-art" aria-hidden="true" />
        <span className="hero-mask" aria-hidden="true" />
        <div className="ranked-hero-content">
          <div className="eyebrow">
            <b>天梯排位</b>
            <span className={`eyebrow-status${queued ? ' is-live' : ''}`}>
              {queued ? '匹配中' : matched ? '对局中' : '赛季进行中'}
            </span>
            <span className="eyebrow-note">全员准备后 3 秒进入比赛</span>
          </div>
          <h1 className="ranked-title">排位竞技场</h1>
          <div className="hero-tags">
            <span className="tag tag--rank" style={{ color: tierColor(rank.current.name) }}>
              {rank.current.name}
            </span>
            <span className="tag tag--code">{rank.value} 分</span>
            <span className="tag">1v1 / 2v2</span>
            <span className="tag">{profile?.rank ? `平台第 ${profile.rank}` : '本季未上榜'}</span>
          </div>
          <div className="rank-tier-line">
            <TierTrack index={rank.index} />
            <span>
              {rank.next ? `距 ${rank.next.name} 还差 ${Math.max(0, rank.next.min - rank.value)} 分` : '已达最高段位'}
            </span>
          </div>
          <div className="rank-progress-bar">
            <i style={{ width: `${rank.percent}%`, background: tierColor(rank.current.name) }} />
          </div>
          <p className="ranked-hint">
            {currentMode.desc} · 匹配范围随时间扩大，1v1 需 2 人、2v2 需 4 人
          </p>
        </div>

        <div className="ranked-hero-foot">
          <div className="hud">
            <div className="hud-cell hud-cell--rank">
              <span>积分</span>
              <b>{rank.value}</b>
            </div>
            <div className="hud-cell hud-cell--record">
              <span>胜 · 负</span>
              <b>
                {profile?.wins ?? 0}
                <em>:</em>
                {profile?.losses ?? 0}
              </b>
            </div>
            <div className="hud-cell hud-cell--rate">
              <span>胜率</span>
              <b>
                {profile?.winRate ?? 0}
                <em>%</em>
              </b>
            </div>
          </div>

          <div className="hero-actions">
            {!matched && !queued && (
              <>
                <div className="rank-mode-switch">
                  {Object.entries(MODE_META).map(([key, meta]) => (
                    <button
                      key={key}
                      type="button"
                      className={`rank-mode-btn${mode === key ? ' is-active' : ''}`}
                      onClick={() => pickMode(key)}
                      aria-pressed={mode === key}
                    >
                      <i />
                      <b>{meta.label}</b>
                      <small>{meta.sub}</small>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`btn btn-primary hero-cta rank-cta${serverUnavailable ? ' is-disabled' : ''}`}
                  onClick={queue}
                  disabled={busy === 'queue' || serverUnavailable}
                  title={serverUnavailable ? '暂时无服务器可提供排位' : '开始匹配'}
                >
                  {busy === 'queue' ? <span className="spinner" /> : <Icon name="swords" size={16} />}
                  {busy === 'queue' ? '正在匹配…' : serverUnavailable ? '暂无可用服务器' : '开始匹配'}
                </button>
                {serverUnavailable && (
                  <p className="rank-server-hint">暂时无服务器可提供排位，请稍后再试。</p>
                )}
              </>
            )}

            {queued && (
              <>
                <span className="rank-queue-chip">
                  <i />
                  {MODE_META[state.queue?.mode || mode]?.label} · 已等待 {state.queue?.elapsed ?? 0} 秒
                </span>
                <button type="button" className="btn btn-ghost btn-lg" onClick={cancel} disabled={busy === 'cancel'}>
                  取消匹配
                </button>
              </>
            )}

            {matched && (
              <span className={`rank-live-chip${match?.status === 'live' ? ' is-live' : ''}`}>
                <i />
                {match?.status === 'live' ? '比赛进行中' : '等待全员准备'}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="ranked-grid">
        <div className="ranked-main">
          {queued && (
            <section className="rank-queue">
              <div className="rank-queue-radar">
                <i />
                <i />
                <span className="spinner" />
              </div>
              <div>
                <h2>正在寻找队友与对手</h2>
                <p>
                  {MODE_META[state.queue?.mode || mode]?.label} · 已等待 {state.queue?.elapsed ?? 0} 秒 · 评分{' '}
                  {profile?.rating ?? 1000}
                </p>
              </div>
            </section>
          )}

          {matched && match && (
            <>
              <MatchBoard
                match={match}
                user={user}
                busy={Boolean(busy)}
                onReady={ready}
                onLaunch={() => {
                  launchRef.current = match.id;
                  launchMatch(match);
                }}
                onFinish={finish}
                onSpectate={spectate}
                onCancel={leaveMatch}
              />

              {!match.isParticipant && (
                <section className="rank-bet">
                  <header>
                    <div>
                      <span className="rank-eyebrow">竞猜</span>
                      <h3>押注你看好的队伍</h3>
                      <p>奖池按比例分配，平台抽成 5%。比赛开始后停止下注。</p>
                    </div>
                    <div className="rank-pools">
                      <span>
                        A 池 <b>{match.pool?.a ?? 0}</b>
                      </span>
                      <span>
                        B 池 <b>{match.pool?.b ?? 0}</b>
                      </span>
                    </div>
                  </header>

                  {match.myBet ? (
                    <div className="rank-my-bet">
                      <Icon name="check" size={15} />
                      已押 {match.myBet.team.toUpperCase()} 队 {match.myBet.amount} 金币
                    </div>
                  ) : (
                    <div className="rank-bet-form">
                      <div className="rank-bet-sides">
                        <button
                          type="button"
                          className={betTeam === 'a' ? 'is-active' : ''}
                          onClick={() => setBetTeam('a')}
                        >
                          A 队 <small>{match.teams?.a?.map((p) => p.gameName).join(' / ')}</small>
                        </button>
                        <button
                          type="button"
                          className={betTeam === 'b' ? 'is-active' : ''}
                          onClick={() => setBetTeam('b')}
                        >
                          B 队 <small>{match.teams?.b?.map((p) => p.gameName).join(' / ')}</small>
                        </button>
                      </div>
                      <div className="rank-bet-amount">
                        <input
                          type="number"
                          min="10"
                          max="5000"
                          step="10"
                          value={betAmount}
                          onChange={(event) => setBetAmount(event.target.value)}
                        />
                        <span>金币</span>
                        <button type="button" className="btn btn-primary btn-sm" onClick={bet} disabled={busy === 'bet'}>
                          确认下注
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {state.state === 'error' && (
            <div className="empty empty--inline">
              <Icon name="alert" size={18} />
              <p>{state.error || '排位服务暂不可用'}</p>
            </div>
          )}

          {state.state !== 'loading' && <HistoryPanel history={history} onOpen={(row) => setResult({ ...row, fromHistory: true })} />}
        </div>

        <aside className="ranked-side">
          <div className="rank-board">
            <header>
              <h3>
                <Icon name="trophy" size={15} /> 天梯排行榜
              </h3>
              <span>全模式</span>
            </header>
            {leaderboard.length === 0 ? (
              <p className="rank-board-empty">还没有人上榜，先打一场。</p>
            ) : (
              leaderboard.slice(0, 12).map((row) => (
                <div className={`rank-board-row${row.id === user?.id ? ' is-self' : ''}`} key={row.id}>
                  <span className="rank-board-pos">{row.position}</span>
                  <Avatar user={row} size="xs" />
                  <span className="rank-board-name">
                    <b>{row.gameName}</b>
                    <small style={{ color: tierColor(row.tier) }}>
                      {row.tier} · {row.rating}
                    </small>
                  </span>
                  <em>{row.winRate}%</em>
                </div>
              ))
            )}
          </div>

          <div className="rank-tips">
            <h4>规则</h4>
            <p>胜利 +25 分，失败 -20 分；最低 0 分。</p>
            <p>比赛开始后服务器锁定，普通玩家无法加入。</p>
            <p>竞猜仅限赛前，参赛玩家不能下注自己的比赛。</p>
          </div>
        </aside>
      </div>

      {countdown !== null && (
        <div className="rank-countdown">
          <div className="rank-countdown-ring">{countdown}</div>
          <h2>即将进入比赛</h2>
          <p>正在连接 {match?.server?.name} · 平台会自动收进托盘</p>
        </div>
      )}

      <RankedResultModal
        result={result}
        onClose={() => {
          if (result) dismissedResultRef.current = `${result.matchId}:${result.finishedAt || ''}`;
          setResult(null);
        }}
      />
    </div>
  );
}
