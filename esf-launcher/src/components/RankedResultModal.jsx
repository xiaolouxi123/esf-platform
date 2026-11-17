import { useEffect } from 'react';
import Icon from './Icon';
import RankMedal from './RankMedal';
import { rankOf } from '../lib/rankLadder';
import { playResultSfx } from '../lib/sfx';

function TeamColumn({ label, players, winner }) {
  const list = players || [];
  return (
    <section className={`result-team${winner ? ' is-winner' : ''}`}>
      <header className="result-team-head">
        <span className="result-team-label">{label} 队</span>
        {winner && <span className="result-win-tag">胜利</span>}
      </header>
      <div className="result-team-body">
        {list.map((player) => (
          <div className="result-player" key={player.id}>
            <span className="result-player-name" title={player.gameName || player.username}>
              {player.gameName || player.username}
              {player.afk ? <em className="result-player-afk">离开</em> : null}
            </span>
            <span className="result-player-stat">
              {player.ratingAfter === null || player.ratingAfter === undefined ? (
                <>{player.rating ?? '—'}</>
              ) : (
                <>
                  <i>{player.rating ?? '—'}</i>
                  <Icon name="chevronRight" size={11} />
                  <b>{player.ratingAfter}</b>
                </>
              )}
            </span>
          </div>
        ))}
        {list.length === 0 && <div className="result-empty">暂无数据</div>}
      </div>
    </section>
  );
}

function formatWhen(value) {
  const ms = Date.parse(value || '');
  if (Number.isNaN(ms)) return '';
  const at = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = at.toDateString() === now.toDateString();
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return sameDay ? `今天 ${clock}` : `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock}`;
}

function formatDuration(start, end) {
  const from = Date.parse(start || '');
  const to = Date.parse(end || '');
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return '';
  const total = Math.round((to - from) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时 ${minutes % 60} 分`;
  }
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return `${seconds} 秒`;
}

export default function RankedResultModal({ result, recent = [], onClose, onRematch }) {
  const stale = Boolean(result?.fromHistory);
  const win = result?.result === 'win';

  useEffect(() => {
    if (!result || stale) return;
    playResultSfx(win);
  }, [result, stale, win]);

  if (!result) return null;

  const playersA = (result.players || []).filter((player) => player.team === 'a');
  const playersB = (result.players || []).filter((player) => player.team === 'b');
  const delta = result.ratingDelta;
  const when = formatWhen(result.finishedAt);
  const duration = formatDuration(result.startedAt, result.finishedAt);
  const deltaText = Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta}` : '';
  const hasAfter = Number.isFinite(Number(result.ratingAfter));
  const before = Number.isFinite(Number(result.ratingBefore)) ? rankOf(result.ratingBefore) : null;
  const after = hasAfter ? rankOf(result.ratingAfter) : null;
  const tierUp = Boolean(before && after && after.index > before.index);
  const tierDown = Boolean(before && after && after.index < before.index);
  const form = (recent || []).slice(0, 5);
  const formWins = form.filter((row) => row.result === 'win').length;
  const modeLabel = result.mode === '2v2' ? '2v2 排位' : '1v1 排位';

  return (
    <div className="update-modal-backdrop challenge-result-backdrop" onMouseDown={onClose}>
      <div
        className="update-modal challenge-result-modal ranked-result-modal"
        role="dialog"
        aria-modal="true"
        aria-label={stale ? '历史战绩' : '排位结算'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="update-modal-close" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={14} />
        </button>

        <div className="rr-top">
          <span className={`rr-badge${win ? ' is-win' : ' is-loss'}`}>{win ? '胜利' : '失败'}</span>
          <span className="rr-top-meta">
            {stale ? '历史战绩' : '排位结算'}
            {when ? ` · ${when}` : ''}
          </span>
        </div>

        <div className="rr-hero">
          <div className={`rr-hero-medal${after ? '' : ' is-empty'}`}>
            {after ? (
              <>
                <RankMedal tier={after.index} stars={after.stars} size={124} />
                <span className="rr-hero-tier" style={{ color: after.color }}>
                  {after.name}
                </span>
              </>
            ) : (
              <span className="rr-hero-tier">未记录段位</span>
            )}
          </div>

          <div className="rr-hero-main">
            <h2 className={`rr-title${win ? ' is-win' : ' is-loss'}`}>{win ? '这场赢了' : '这场输了'}</h2>
            <div className="rr-chips">
              <span className="rr-chip">{modeLabel}</span>
              {result.map && <span className="rr-chip">地图 {result.map}</span>}
              {result.server?.name && <span className="rr-chip">{result.server.name}</span>}
              {duration && <span className="rr-chip">用时 {duration}</span>}
              {tierUp && (
                <span className="rr-chip is-up">
                  升段 {before.name} → {after.name}
                </span>
              )}
              {tierDown && (
                <span className="rr-chip is-down">
                  掉段 {before.name} → {after.name}
                </span>
              )}
              {result.afk && <span className="rr-chip is-down">离开比赛，按判负结算</span>}
            </div>

            <div className={`rr-rating${win ? ' is-win' : ' is-loss'}`}>
              <span className="rr-rating-label">你的评分</span>
              <span className="rr-rating-flow">
                <b>{result.ratingBefore ?? '—'}</b>
                <Icon name="chevronRight" size={16} />
                <b>{result.ratingAfter ?? '—'}</b>
              </span>
              <span className="rr-delta">{deltaText}</span>
            </div>

            {after && (
              <div className="rr-progress">
                <div className="rr-progress-meta">
                  <span>{after.isMax ? '已经是最高段位' : `距 ${after.next.name} 还差 ${after.toNext} 分`}</span>
                  <span>
                    {after.stars}/{after.starsMax} 星 · {after.value} 分
                  </span>
                </div>
                <div className="rr-progress-track">
                  <i style={{ width: `${after.percent}%`, background: after.color }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="challenge-result-teams">
          <TeamColumn label="A" players={playersA} winner={result.winner === 'a'} />
          <TeamColumn label="B" players={playersB} winner={result.winner === 'b'} />
        </div>

        {form.length > 0 && (
          <div className="rr-form">
            <span className="rr-form-label">近 {form.length} 场</span>
            {form.map((row) => (
              <span
                key={`${row.matchId}:${row.finishedAt || ''}`}
                className={`rr-form-pill${row.result === 'win' ? ' is-win' : ' is-loss'}`}
                title={`${row.mode} · ${row.result === 'win' ? '胜' : '负'} · ${row.ratingDelta > 0 ? '+' : ''}${row.ratingDelta ?? '—'}`}
              >
                {row.result === 'win' ? '胜' : '负'}
              </span>
            ))}
            <span className="rr-form-note">
              {formWins} 胜 {form.length - formWins} 负
            </span>
          </div>
        )}

        <p className="challenge-result-note">
          {stale ? '数据来自平台对局历史，仅供查询。' : '排位结果已回写平台，返回大厅后可继续匹配。'}
        </p>

        <div className="update-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {stale ? '关闭' : '返回排位大厅'}
          </button>
          {!stale && onRematch && (
            <button type="button" className="btn btn-primary" onClick={onRematch}>
              <Icon name="swords" size={14} /> 再来一场
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
