import { useEffect } from 'react';
import Icon from './Icon';
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
            </span>
            <span className="result-player-stat">
              {player.ratingAfter === null || player.ratingAfter === undefined ? (
                '—'
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

export default function RankedResultModal({ result, onClose }) {
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
  const deltaText = Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta}` : '';

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

        <h2 className={`rr-title${win ? ' is-win' : ' is-loss'}`}>{win ? '这场赢了' : '这场输了'}</h2>
        <p className="rr-sub">
          {result.mode}
          {result.server?.name ? ` · ${result.server.name}` : ''}
          {result.winner ? ` · ${result.winner.toUpperCase()} 队获胜` : ' · 对局结束'}
        </p>

        <div className={`rr-rating${win ? ' is-win' : ' is-loss'}`}>
          <span className="rr-rating-label">你的评分</span>
          <span className="rr-rating-flow">
            <b>{result.ratingBefore ?? '—'}</b>
            <Icon name="chevronRight" size={16} />
            <b>{result.ratingAfter ?? '—'}</b>
          </span>
          <span className="rr-delta">{deltaText}</span>
        </div>

        <div className="challenge-result-teams">
          <TeamColumn label="A" players={playersA} winner={result.winner === 'a'} />
          <TeamColumn label="B" players={playersB} winner={result.winner === 'b'} />
        </div>

        <p className="challenge-result-note">
          {stale ? '数据来自平台对局历史，仅供查询。' : '排位结果已回写平台，返回大厅后可继续匹配。'}
        </p>

        <div className="update-modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {stale ? '关闭' : '返回排位大厅'}
          </button>
        </div>
      </div>
    </div>
  );
}
