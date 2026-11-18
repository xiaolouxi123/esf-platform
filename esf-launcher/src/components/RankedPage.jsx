import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import Icon from './Icon';
import DragonHeroBackdrop from './DragonHeroBackdrop';
import RankedResultModal from './RankedResultModal';
import RankMedal from './RankMedal';
import RankTip from './RankTip';
import { RANK_TIERS, rankOf } from '../lib/rankLadder';
import { readRankedCache, writeRankedCache } from '../lib/rankedCache';
import { playSfx } from '../lib/sfx';

const MODE_META = {
  '1v1': { label: '1v1', sub: '单排', desc: '单人匹配，纯个人实力', slots: 1 },
  '2v2': { label: '2v2', sub: '双人', desc: '两人一队，配合取胜', slots: 2 },
};

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

function TierTrack({ rank, hasRank }) {
  const index = hasRank ? rank.index : -1;
  return (
    <div className="rank-tier-line tierline-v2">
      <div
        className="tl-v2-rail"
        role="list"
        aria-label={hasRank
          ? `天梯共 ${RANK_TIERS.length} 段，当前第 ${index + 1} 段`
          : `天梯共 ${RANK_TIERS.length} 段，当前未定级`}
      >
        {RANK_TIERS.map((tier, i) => {
          const state = i < index ? ' is-passed' : i === index ? ' is-current' : '';
          return (
            <span
              key={tier.key}
              role="listitem"
              aria-current={i === index ? 'step' : undefined}
              className={`tl-v2-stop${state}${i % 2 ? ' is-low' : ''}`}
              style={{ '--tier-color': tier.color }}
              title={`${tier.name} · ${tier.floor} 分起`}
            >
              <b>{tier.short}</b>
              <i />
            </span>
          );
        })}
      </div>
      <span className="tl-v2-gap">
        {!hasRank
          ? <><em>未定级</em><b>先打一场</b></>
          : rank.next
            ? <><em>距 {rank.next.short}</em><b>{rank.toNext} 分</b></>
            : <><em>天梯顶点</em><b>最高段位</b></>}
      </span>
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

function formatSeconds(total) {
  const seconds = Math.max(0, Math.round(Number(total) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return rest + ' 秒';
  return rest ? minutes + ' 分 ' + rest + ' 秒' : minutes + ' 分';
}

function historyDuration(row) {
  const started = Date.parse(row.startedAt || '');
  const finished = Date.parse(row.finishedAt || '');
  if (Number.isNaN(started) || Number.isNaN(finished) || finished <= started) return '';
  return formatSeconds((finished - started) / 1000);
}

function historyOpponents(row, userId) {
  const players = Array.isArray(row.players) ? row.players : [];
  if (row.myTeam) return players.filter((player) => player.team && player.team !== row.myTeam);
  return players.filter((player) => player.id !== userId);
}

function HistoryPanel({ history, user, rank, onOpen, onQueue, onShowHistory }) {
  const recent = history.slice(0, 5);
  const wins = recent.filter((row) => row.result === 'win').length;
  const losses = recent.length - wins;
  const net = recent.reduce((sum, row) => sum + (Number.isFinite(row.ratingDelta) ? row.ratingDelta : 0), 0);
  const seconds = recent
    .map((row) => {
      const started = Date.parse(row.startedAt || '');
      const finished = Date.parse(row.finishedAt || '');
      return !Number.isNaN(started) && !Number.isNaN(finished) && finished > started ? (finished - started) / 1000 : 0;
    })
    .filter((value) => value > 0);
  const avgDuration = seconds.length ? formatSeconds(seconds.reduce((sum, value) => sum + value, 0) / seconds.length) : '—';
  const hasHistory = history.length > 0;

  return (
    <section className="rank-history rank-history--v2">
      <header className="rank-history-head">
        <div>
          <h3>
            <Icon name="clock" size={15} /> 我的战绩
          </h3>
        </div>
        {hasHistory ? (
          <div className="rank-history-head-actions">
            <span className="rank-history-count">最近 {recent.length} 场</span>
            <button type="button" className="rank-history-all" onClick={onShowHistory}>
              历史战绩
              <Icon name="chevronRight" size={11} />
            </button>
          </div>
        ) : (
          <span className="rank-history-count">最近 5 场</span>
        )}
      </header>

      {hasHistory ? (
        <>
          <div className="rank-history-overview">
            <div>
              <span>近 {recent.length} 场</span>
              <b>{wins} 胜 {losses} 负</b>
            </div>
            <div>
              <span>净胜分</span>
              <b className={net >= 0 ? 'is-up' : 'is-down'}>{net > 0 ? '+' + net : net}</b>
            </div>
            <div>
              <span>场均对局</span>
              <b>{avgDuration}</b>
            </div>
            <div className="rank-history-seal">
              <span>当前段位</span>
              <b style={{ color: rank?.color || 'var(--accent)' }}>{rank?.name || '未定级'}</b>
              <small>{rank?.value ?? 0} 分</small>
            </div>
          </div>

          <div className="rank-history-list">
            {recent.map((row) => {
              const opponents = historyOpponents(row, user?.id);
              const duration = historyDuration(row);
              const before = Number.isFinite(row.ratingBefore) ? row.ratingBefore : '—';
              const after = Number.isFinite(row.ratingAfter) ? row.ratingAfter : '—';
              const delta = Number.isFinite(row.ratingDelta) ? row.ratingDelta : null;
              return (
                <button
                  type="button"
                  className={'rank-history-row is-' + (row.result === 'win' ? 'win' : 'loss')}
                  key={String(row.matchId) + ':' + (row.finishedAt || '')}
                  onClick={() => onOpen(row)}
                  title="查看结算详情"
                >
                  <span className={'rank-history-tag' + (row.result === 'win' ? ' is-win' : ' is-loss')}>
                    {row.result === 'win' ? '胜' : '负'}
                  </span>
                  {row.afk ? (
                    <span className="rank-history-afk" title="离开比赛被判负，固定扣 30 分">
                      AFK
                    </span>
                  ) : null}
                  <span className="rank-history-main">
                    <span className="rank-history-line">
                      <b>{row.mode} 排位</b>
                      <em>
                        <Icon name="map" size={11} /> {row.map || row.server?.map || '随机地图'}
                      </em>
                    </span>
                    <span className="rank-history-sub">
                      {opponents.length ? (
                        <span>
                          对手 <b>{opponents.map((player) => player.gameName).join('、')}</b>
                        </span>
                      ) : (
                        <span>{row.players?.length || 0} 人对局</span>
                      )}
                      {duration ? <span className="rank-history-sep">{duration}</span> : null}
                      <span className="rank-history-sep">{formatFinishedAt(row.finishedAt) || '刚刚'}</span>
                    </span>
                  </span>
                  <span className="rank-history-rate">
                    <b className={delta !== null && delta >= 0 ? 'is-up' : 'is-down'}>
                      {delta === null ? '—' : (delta > 0 ? '+' : '') + delta}
                    </b>
                    <small>{before} → {after}</small>
                  </span>
                  <Icon name="chevronRight" size={13} className="rank-history-chevron" />
                </button>
              );
            })}
          </div>

          <footer className="rank-history-foot">
            <span>
              <Icon name="clock" size={12} /> 最近 {recent.length} 场 · 每 20 秒自动同步
            </span>
            {onQueue ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onQueue}>
                <Icon name="swords" size={13} /> 再打一场
              </button>
            ) : null}
          </footer>
        </>
      ) : (
        <>
          <div className="rank-history-empty">
            <div className="rank-history-empty-visual">
              <RankMedal tier={rank?.index || 0} stars={rank?.stars || 1} size={96} />
              <span>SEASON 1</span>
            </div>
            <div className="rank-history-empty-copy">
              <h4>第一场排位，等你开打</h4>
              <span className="rank-history-empty-meta">0 / 1 场 · 首场后显示真实段位</span>
              <p>段位分、对手、地图和用时都会写进这里。排位只动段位分，不扣金币。</p>
              <div className="rank-history-empty-actions">
                {onQueue ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onQueue}>
                    <Icon name="swords" size={14} /> 开始第一场
                  </button>
                ) : null}
                <span>1v1 随时可排 · 2v2 叫上朋友</span>
              </div>
            </div>
          </div>
          <div className="rank-history-empty-tips">
            <div>
              <b>01</b>
              <span>排队等对手</span>
            </div>
            <div>
              <b>02</b>
              <span>全员准备 3 秒进服</span>
            </div>
            <div>
              <b>03</b>
              <span>结算写回段位</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function HistoryModal({ history, user, rank, onClose, onOpen }) {
  const wins = history.filter((row) => row.result === 'win').length;
  const losses = history.length - wins;

  return createPortal(
    <div className="history-modal-backdrop" onClick={onClose}>
      <section
        className="history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="历史战绩"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="history-modal-head">
          <div>
            <span className="history-modal-kicker">RANKED · HISTORY</span>
            <h2>历史战绩</h2>
            <p>最近 {history.length} 场 · 点任意一场查看结算</p>
          </div>
          <button type="button" className="history-modal-close" onClick={onClose} aria-label="关闭历史战绩">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="history-modal-summary">
          <span>
            近 {history.length} 场 <b>{wins} 胜 {losses} 负</b>
          </span>
          <span>
            胜率 <b>{history.length ? Math.round((wins / history.length) * 100) : 0}%</b>
          </span>
          <span>
            段位 <b style={{ color: rank?.color || 'var(--accent)' }}>{rank?.name || '未定级'}</b>
          </span>
        </div>
        <div className="history-modal-list">
          {history.map((row) => {
            const opponents = historyOpponents(row, user?.id);
            const duration = historyDuration(row);
            const before = Number.isFinite(row.ratingBefore) ? row.ratingBefore : '—';
            const after = Number.isFinite(row.ratingAfter) ? row.ratingAfter : '—';
            const delta = Number.isFinite(row.ratingDelta) ? row.ratingDelta : null;
            return (
              <button
                type="button"
                className={'rank-history-row rank-history-row--modal is-' + (row.result === 'win' ? 'win' : 'loss')}
                key={String(row.matchId) + ':' + (row.finishedAt || '')}
                onClick={() => onOpen(row)}
              >
                <span className={'rank-history-tag' + (row.result === 'win' ? ' is-win' : ' is-loss')}>
                  {row.result === 'win' ? '胜' : '负'}
                </span>
                {row.afk ? <span className="rank-history-afk">AFK</span> : null}
                <span className="rank-history-main">
                  <span className="rank-history-line">
                    <b>{row.mode} 排位</b>
                    <em>
                      <Icon name="map" size={11} /> {row.map || row.server?.map || '随机地图'}
                    </em>
                  </span>
                  <span className="rank-history-sub">
                    {opponents.length ? (
                      <span>
                        对手 <b>{opponents.map((player) => player.gameName).join('、')}</b>
                      </span>
                    ) : (
                      <span>{row.players?.length || 0} 人对局</span>
                    )}
                    {duration ? <span className="rank-history-sep">{duration}</span> : null}
                    <span className="rank-history-sep">{formatFinishedAt(row.finishedAt) || '刚刚'}</span>
                  </span>
                </span>
                <span className="rank-history-rate">
                  <b className={delta !== null && delta >= 0 ? 'is-up' : 'is-down'}>
                    {delta === null ? '—' : (delta > 0 ? '+' : '') + delta}
                  </b>
                  <small>{before} → {after}</small>
                </span>
                <Icon name="chevronRight" size={13} className="rank-history-chevron" />
              </button>
            );
          })}
        </div>
      </section>
    </div>,
    document.body
  );
}

function BetPanel({ match, betTeam, betAmount, setBetTeam, setBetAmount, onBet, busy }) {
  return (
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
            <button type="button" className={betTeam === 'a' ? 'is-active' : ''} onClick={() => setBetTeam('a')}>
              A 队 <small>{match.teams?.a?.map((p) => p.gameName).join(' / ')}</small>
            </button>
            <button type="button" className={betTeam === 'b' ? 'is-active' : ''} onClick={() => setBetTeam('b')}>
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
            <button type="button" className="btn btn-primary btn-sm" onClick={onBet} disabled={busy === 'bet'}>
              确认下注
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RankSide({ leaderboard, user, rank, myPosition }) {
  const top = leaderboard.slice(0, 8);
  return (
    <div className="rank-side-stack">
      <section className="rank-board rank-board--v2">
        <header className="rank-board-head">
          <div>
            <h3>
              <Icon name="trophy" size={15} /> 天梯排行榜
            </h3>
            <p>按段位分排序 · 每 12 秒刷新</p>
          </div>
          <span>TOP 8</span>
        </header>

        {top.length === 0 ? (
          <div className="rank-board-empty rank-board-empty--v2">
            <span className="rank-board-empty-icon">
              <Icon name="trophy" size={24} />
            </span>
            <b>榜单还是空的</b>
            <small>第一场排位后，你的名字会出现在这里。</small>
          </div>
        ) : (
          <div className="rank-board-list">
            {top.map((row) => {
              const rowRank = rankOf(row.rating);
              const podium = row.position <= 3 ? ' is-p' + row.position : '';
              return (
                <div
                  className={'rank-board-row' + podium + (row.id === user?.id ? ' is-self' : '')}
                  key={row.id}
                >
                  <span className="rank-board-pos">
                    {row.position <= 3 ? <Icon name="trophy" size={12} /> : row.position}
                  </span>
                  <Avatar user={row} size="xs" />
                  <span className="rank-board-name">
                    <b>{row.gameName}</b>
                    <small style={{ color: rowRank.color }}>{rowRank.name}</small>
                  </span>
                  <span className="rank-board-rate">
                    <b>{row.rating}</b>
                    <small>{row.matches ? row.winRate + '% 胜率' : '未定级'}</small>
                  </span>
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, 8 - top.length) }).map((_, index) => (
              <div className="rank-board-row is-empty" key={'slot-' + index}>
                <span className="rank-board-pos">{top.length + index + 1}</span>
                <span className="rank-board-avatar-empty" />
                <span className="rank-board-name">
                  <b>待上榜</b>
                  <small>完成 1 场排位</small>
                </span>
                <span className="rank-board-rate">
                  <b>—</b>
                  <small>未定级</small>
                </span>
              </div>
            ))}
          </div>
        )}

        <footer className="rank-board-foot">
          <span>
            <i /> 你的位置
          </span>
          <b>
            {myPosition ? '第 ' + myPosition + ' 名' : '未上榜'} <em>· {rank?.value ?? 0} 分</em>
          </b>
        </footer>
      </section>

      <section className="rank-tips rank-tips--v2">
        <header>
          <h4>赛季规则</h4>
          <span>SEASON 1</span>
        </header>
        <ol>
          <li>
            <b>01</b>
            <span>胜利 +25 分，失败 -20 分，最低 0 分。</span>
          </li>
          <li>
            <b>02</b>
            <span>比赛开始后服务器锁定，普通玩家无法加入。</span>
          </li>
          <li>
            <b>03</b>
            <span>竞猜仅限赛前，参赛玩家不能下注自己的比赛。</span>
          </li>
        </ol>
      </section>
    </div>
  );
}

export default function RankedPage({ user, toast, servers = [] }) {
  const [mode, setMode] = useState('1v1');
  // 有缓存先用缓存渲染，避免每次点开都空等一次网络往返
  const [state, setState] = useState(() => readRankedCache('state') || { state: 'loading', profile: null });
  const matchServers = (servers || []).filter((s) => s.isMatch);
  const poolBusy = matchServers.length > 0 && matchServers.every((s) => !s.online || s.locked);
  const serverUnavailable = matchServers.length === 0;
  const [leaderboard, setLeaderboard] = useState(() => readRankedCache('leaderboard') || []);
  const [history, setHistory] = useState(() => readRankedCache('history') || []);
  const [betTeam, setBetTeam] = useState('a');
  const [betAmount, setBetAmount] = useState(50);
  const [busy, setBusy] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [result, setResult] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
      writeRankedCache('state', data);
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
      writeRankedCache('leaderboard', data.players || []);
    } catch {
      /* 排行可稍后重试 */
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await window.electronAPI.ranked.history(30);
      setHistory(data.matches || []);
      writeRankedCache('history', data.matches || []);
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
    }, 20000);
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
  // 匹配成功即进入聚焦态：页面上只留对局卡，段位/战绩/排行榜收进「段位详情」
  const focusMode = matched && Boolean(match);
  const rank = rankOf(profile?.rating);
  const hasRank = Boolean(profile);
  const currentMode = MODE_META[mode] || MODE_META['1v1'];

  return (
    <div className={"ranked-page" + (focusMode ? " is-focus" : "")}>
      {focusMode ? (
        <section className="rank-focus">
          <div className="rank-focus-bar">
            <span className="rank-focus-label">
              <Icon name="swords" size={14} />
              {MODE_META[match.mode]?.label || match.mode} 排位对局
            </span>
            <span className="rank-focus-tags">
              <span className="tag tag--rank" style={{ color: rank.color }}>
                {hasRank ? rank.name : '未定级'}
              </span>
              <span className="tag tag--code">{rank.value} 分</span>
            </span>
            <button
              type="button"
              className={`btn btn-ghost btn-sm rank-focus-more${showDetail ? ' is-open' : ''}`}
              onClick={() => setShowDetail((value) => !value)}
              aria-expanded={showDetail}
            >
              <Icon name="chevronRight" size={14} />
              {showDetail ? '收起详情' : '段位详情'}
            </button>
          </div>

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
            <BetPanel
              match={match}
              betTeam={betTeam}
              betAmount={betAmount}
              setBetTeam={setBetTeam}
              setBetAmount={setBetAmount}
              onBet={bet}
              busy={busy}
            />
          )}

          {showDetail && (
            <div className="ranked-grid rank-focus-extra">
              <div className="ranked-main">
                <HistoryPanel history={history} user={user} rank={rank} onOpen={(row) => setResult({ ...row, fromHistory: true })} />
              </div>
              <aside className="ranked-side">
                <RankSide leaderboard={leaderboard} user={user} rank={rank} myPosition={profile?.rank} />
              </aside>
            </div>
          )}
        </section>
      ) : (
        <>
      <header className="ranked-hero hero--dragon">
        <DragonHeroBackdrop />
        <div className="ranked-hero-content">
          <div className="ranked-hero-main">
          <div className="eyebrow">
            <b>天梯排位</b>
            <span className={`eyebrow-status${queued ? ' is-live' : ''}`}>
              {queued ? '匹配中' : matched ? '对局中' : '赛季进行中'}
            </span>
            <span className="eyebrow-note">全员准备后 3 秒进入比赛</span>
          </div>
          <h1 className="ranked-title">排位竞技场</h1>
          <div className="hero-tags">
            <span className="tag tag--rank" style={{ color: rank.color }}>
              {hasRank ? rank.name : '未定级'}
            </span>
            <span className="tag tag--code">{rank.value} 分</span>
            <span className="tag">1v1 / 2v2</span>
            <span className="tag">{profile?.rank ? `平台第 ${profile.rank}` : '本季未上榜'}</span>
          </div>
          <TierTrack rank={rank} hasRank={hasRank} />
          <div className="rank-progress-bar">
            <i style={{ width: `${rank.percent}%`, background: rank.color }} />
          </div>
          <p className="ranked-hint">
            {currentMode.desc} · 匹配范围随时间扩大，1v1 需 2 人、2v2 需 4 人
          </p>
          </div>

          <div className="ranked-hero-medal">
            <RankTip index={rank.index} stars={rank.stars} rating={rank.value}>
              <RankMedal tier={rank.index} stars={rank.stars} size={148} />
            </RankTip>
            <b style={{ color: rank.color }}>{hasRank ? rank.name : '未定级'}</b>
            <span className="ranked-hero-stars" aria-label={`${rank.stars} / 5 星`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Icon key={i} name="starFill" size={12} className={i < rank.stars ? 'is-on' : 'is-off'} />
              ))}
            </span>
            <small>{rank.tier.intro}</small>
            <em className="ranked-hero-tip">悬停徽章 · 查看全部段位</em>
          </div>
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
                  {busy === 'queue'
                    ? '正在匹配…'
                    : serverUnavailable
                      ? '暂无可用服务器'
                      : poolBusy
                        ? '排队等空位'
                        : '开始匹配'}
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
                <h2>{state.pool && state.pool.free === 0 ? '比赛服全忙，正在排队等空位' : '正在寻找队友与对手'}</h2>
                <p>
                  {MODE_META[state.queue?.mode || mode]?.label} · 已等待 {state.queue?.elapsed ?? 0} 秒 · 评分{' '}
                  {profile?.rating ?? 1000}
                  {state.pool ? ` · 比赛服 ${state.pool.free}/${state.pool.total} 空闲` : ''}
                </p>
                {state.pool && state.pool.free === 0 && (
                  <p className="rank-pool-hint">
                    三台比赛服都在对局或约战中。空出一台后会自动拉你进场，不用重新匹配；想换服可先取消。
                  </p>
                )}
              </div>
            </section>
          )}

          {state.state === 'error' && (
            <div className="empty empty--inline">
              <Icon name="alert" size={18} />
              <p>{state.error || '排位服务暂不可用'}</p>
            </div>
          )}

          {state.state !== 'loading' && (
            <HistoryPanel
              history={history}
              user={user}
              rank={rank}
              onOpen={(row) => {
                setHistoryOpen(false);
                setResult({ ...row, fromHistory: true });
              }}
              onQueue={queue}
              onShowHistory={() => setHistoryOpen(true)}
            />
          )}
        </div>

        <aside className="ranked-side">
          <RankSide leaderboard={leaderboard} user={user} rank={rank} myPosition={profile?.rank} />
        </aside>
      </div>

        </>
      )}

      {countdown !== null && (
        <div className="rank-countdown">
          <div className="rank-countdown-ring">{countdown}</div>
          <h2>即将进入比赛</h2>
          <p>正在连接 {match?.server?.name} · 平台会自动收进托盘</p>
        </div>
      )}

      {historyOpen ? (
        <HistoryModal
          history={history}
          user={user}
          rank={rank}
          onClose={() => setHistoryOpen(false)}
          onOpen={(row) => {
            setHistoryOpen(false);
            setResult({ ...row, fromHistory: true });
          }}
        />
      ) : null}

      <RankedResultModal
        result={result}
        recent={history}
        onRematch={() => {
          if (result) dismissedResultRef.current = `${result.matchId}:${result.finishedAt || ''}`;
          setResult(null);
          queue();
        }}
        onClose={() => {
          if (result) dismissedResultRef.current = `${result.matchId}:${result.finishedAt || ''}`;
          setResult(null);
        }}
      />
    </div>
  );
}
