import Icon from './Icon';

function TeamColumn({ label, players, winner }) {
  return (
    <div className={`result-team${winner ? ' is-winner' : ''}`}>
      <div className="result-team-head">
        <b>{label} 队</b>
        {winner && <span className="result-win-tag">胜利</span>}
      </div>
      {(players || []).map((player) => (
        <div className="result-player" key={player.id}>
          <span className="result-player-name">{player.gameName || player.username}</span>
          <span className="result-player-stat">
            {player.ratingAfter === null ? '—' : `${player.rating} → ${player.ratingAfter}`}
          </span>
        </div>
      ))}
      {(!players || players.length === 0) && <div className="result-empty">暂无数据</div>}
    </div>
  );
}

export default function RankedResultModal({ result, onClose }) {
  if (!result) return null;
  const win = result.result === 'win';
  const playersA = (result.players || []).filter((player) => player.team === 'a');
  const playersB = (result.players || []).filter((player) => player.team === 'b');
  const delta = result.ratingDelta;

  return (
    <div className="update-modal-backdrop challenge-result-backdrop" onMouseDown={onClose}>
      <div
        className="update-modal challenge-result-modal ranked-result-modal"
        role="dialog"
        aria-modal="true"
        aria-label="排位结算"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="update-modal-close" onClick={onClose} aria-label="关闭排位结算">
          <Icon name="close" size={14} />
        </button>
        <div className="update-modal-kicker">RANKED RESULT · 排位结算</div>
        <h2>{win ? '这场赢了' : '这场输了'}</h2>
        <p className="update-modal-sub">
          {result.mode} · {result.server?.name || '排位服务器'} ·{' '}
          {result.winner ? `${result.winner.toUpperCase()} 队获胜` : '对局结束'}
        </p>

        <div className={`ranked-result-delta${win ? ' is-win' : ' is-loss'}`}>
          <span>你的评分</span>
          <b>
            {result.ratingBefore ?? '—'} <Icon name="chevronRight" size={14} /> {result.ratingAfter ?? '—'}
          </b>
          <em>{delta === null || delta === undefined ? '' : `${delta > 0 ? '+' : ''}${delta}`}</em>
        </div>

        <div className="challenge-result-teams">
          <TeamColumn label="A" players={playersA} winner={result.winner === 'a'} />
          <TeamColumn label="B" players={playersB} winner={result.winner === 'b'} />
        </div>
        <p className="challenge-result-note">排位结果已回写平台，返回大厅后可继续匹配。</p>

        <div className="update-modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            返回排位大厅
          </button>
        </div>
      </div>
    </div>
  );
}
