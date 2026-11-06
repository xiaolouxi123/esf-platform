import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import RankedResultModal from './RankedResultModal';

const MODE_META = {
  '1v1': { label: '1v1', sub: '单排模式', desc: '单人匹配，纯个人实力', slots: 1 },
  '2v2': { label: '2v2', sub: '双人组队', desc: '两人一队，配合取胜', slots: 2 },
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

function SeasonProgress({ profile }) {
  const rating = profile?.rating ?? 1000;
  let index = 0;
  for (let i = 0; i < TIER_ORDER.length; i++) {
    if (rating >= TIER_ORDER[i].min) index = i;
  }
  const current = TIER_ORDER[index];
  const next = TIER_ORDER[index + 1];
  const percent = next
    ? Math.min(100, Math.max(0, ((rating - current.min) / (next.min - current.min)) * 100))
    : 100;

  return (
    <section className="rank-season">
      <div className="rank-season-head">
        <div>
          <span className="rank-eyebrow">SEASON PROGRESS</span>
          <h3>本赛季进度</h3>
        </div>
        <b style={{ color: tierColor(current.name) }}>
          {current.name} · {rating} 分
        </b>
      </div>
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
      <div className="rank-progress-bar">
        <i style={{ width: `${percent}%`, background: tierColor(current.name) }} />
      </div>
      <div className="rank-season-foot">
        <p>
          {next ? `距离 ${next.name} 还差 ${Math.max(0, next.min - rating)} 分` : '已达到最高段位'}
        </p>
        <span>胜利 +25 · 失败 -20</span>
      </div>
    </section>
  );
}

function RankFlow() {
  return (
    <div className="rank-flow">
      <div>
        <em>01</em>
        <b>快速匹配</b>
        <p>按评分寻找相近的玩家，等待越久范围越大。</p>
      </div>
      <div>
        <em>02</em>
        <b>全员准备</b>
        <p>人齐后进入座位，双方点击准备，3 秒倒计时。</p>
      </div>
      <div>
        <em>03</em>
        <b>锁服开赛</b>
        <p>比赛服自动锁定，仅参赛玩家可进入，支持观战与竞猜。</p>
      </div>
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

export default function RankedPage({ user, toast }) {
  const [mode, setMode] = useState('1v1');
  const [state, setState] = useState({ state: 'loading', profile: null });
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

  const queue = () => run('queue', () => window.electronAPI.ranked.queue(mode), '已加入排位匹配');
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

  return (
    <div className="ranked-page">
      <div className="ranked-main">
        <header className="ranked-hero">
          <div>
            <span className="rank-eyebrow">ESF RANKED · 天梯模式</span>
            <h1>排位竞技场</h1>
            <p>快速匹配实力相近的对手，全员准备后倒计时进入比赛。比赛中服务器锁定，只有参赛玩家能进入。</p>
          </div>
          <div className="rank-profile-card">
            <div className="rank-emblem" style={{ color: tierColor(profile?.tier) }}>
              <Icon name="trophy" size={26} />
            </div>
            <div>
              <b style={{ color: tierColor(profile?.tier) }}>{profile?.tier || '青铜'}</b>
              <span>{profile?.rating ?? 1000} 分</span>
            </div>
            <div className="rank-profile-stats">
              <span>
                <b>{profile?.wins ?? 0}</b>胜
              </span>
              <span>
                <b>{profile?.losses ?? 0}</b>负
              </span>
              <span>
                <b>{profile?.winRate ?? 0}%</b>胜率
              </span>
            </div>
            <div className="rank-coins">
              <Icon name="gift" size={13} /> {profile?.coins ?? 0}
            </div>
          </div>
        </header>

        {!matched && !queued && (
          <section className="rank-lobby">
            <div className="rank-mode-grid">
              {Object.entries(MODE_META).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  className={`rank-mode${mode === key ? ' is-active' : ''}`}
                  onClick={() => setMode(key)}
                >
                  <span>{meta.label}</span>
                  <b>{meta.sub}</b>
                  <small>{meta.desc}</small>
                  <em>{profile?.rating ?? 1000} 分匹配</em>
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary rank-queue-btn" onClick={queue} disabled={busy === 'queue'}>
              {busy === 'queue' ? <span className="spinner" /> : <Icon name="swords" size={17} />}
              {busy === 'queue' ? '正在匹配…' : '开始快速匹配'}
            </button>
            <p className="rank-lobby-hint">
              匹配范围会随时间扩大；1v1 需要 2 人，2v2 需要 4 人。
            </p>
          </section>
        )}

        {queued && (
          <section className="rank-queue">
            <div className="rank-queue-radar">
              <i />
              <i />
              <span className="spinner" />
            </div>
            <h2>正在寻找队友与对手</h2>
            <p>
              {MODE_META[state.queue?.mode || mode]?.label} · 已等待 {state.queue?.elapsed ?? 0} 秒 · 评分{' '}
              {profile?.rating ?? 1000}
            </p>
            <button type="button" className="btn btn-ghost" onClick={cancel} disabled={busy === 'cancel'}>
              取消匹配
            </button>
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

        {state.state !== 'loading' && (
          <>
            <SeasonProgress profile={profile} />
            <RankFlow />
          </>
        )}

        <div className="rank-history is-mobile">
          <header>
            <h3>
              <Icon name="clock" size={15} /> 我的战绩
            </h3>
            <span>{history.length ? `最近 ${history.length} 场` : '近 10 场'}</span>
          </header>
          {history.length === 0 ? (
            <p className="rank-board-empty">还没有排位记录，先匹配一场。</p>
          ) : (
            history.slice(0, 5).map((row) => (
              <button
                type="button"
                className="rank-history-row"
                key={`${row.matchId}:${row.finishedAt || ''}`}
                onClick={() => setResult({ ...row, fromHistory: true })}
                title="查看结算详情"
              >
                <span className={`rank-history-tag${row.result === 'win' ? ' is-win' : ' is-loss'}`}>
                  {row.result === 'win' ? '胜' : '负'}
                </span>
                <span className="rank-history-meta">
                  <b>
                    {row.mode} · {row.server?.name || '排位赛'}
                  </b>
                  <small>
                    {formatFinishedAt(row.finishedAt)}
                    {Number.isFinite(row.ratingDelta) ? ` · ${row.ratingDelta > 0 ? '+' : ''}${row.ratingDelta}` : ''}
                  </small>
                </span>
                <em>{Number.isFinite(row.ratingAfter) ? row.ratingAfter : '—'}</em>
              </button>
            ))
          )}
        </div>
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

        <div className="rank-history">
          <header>
            <h3>
              <Icon name="clock" size={15} /> 我的战绩
            </h3>
            <span>{history.length ? `最近 ${history.length} 场` : '近 10 场'}</span>
          </header>
          {history.length === 0 ? (
            <p className="rank-board-empty">还没有排位记录，先匹配一场。</p>
          ) : (
            history.map((row) => (
              <button
                type="button"
                className="rank-history-row"
                key={`${row.matchId}:${row.finishedAt || ''}`}
                onClick={() => setResult({ ...row, fromHistory: true })}
                title="查看结算详情"
              >
                <span className={`rank-history-tag${row.result === 'win' ? ' is-win' : ' is-loss'}`}>
                  {row.result === 'win' ? '胜' : '负'}
                </span>
                <span className="rank-history-meta">
                  <b>
                    {row.mode} · {row.server?.name || '排位赛'}
                  </b>
                  <small>
                    {formatFinishedAt(row.finishedAt)}
                    {Number.isFinite(row.ratingDelta) ? ` · ${row.ratingDelta > 0 ? '+' : ''}${row.ratingDelta}` : ''}
                  </small>
                </span>
                <em>{Number.isFinite(row.ratingAfter) ? row.ratingAfter : '—'}</em>
              </button>
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
