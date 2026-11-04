import Icon from './Icon';

const victoryLabel = (result) =>
  result?.victoryType === 'deaths' ? '死亡次数' : '击杀数';

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
          <span className="result-player-stat">{player.kills || 0} / {player.deaths || 0}</span>
        </div>
      ))}
      {(!players || players.length === 0) && <div className="result-empty">暂无数据</div>}
    </div>
  );
}

export default function ChallengeResultModal({ result, onClose, onOpenChallenges }) {
  if (!result) return null;
  const winnerA = result.winner === 'a';
  const winnerB = result.winner === 'b';
  const playersA = (result.players || []).filter((player) => player.team === 'a');
  const playersB = (result.players || []).filter((player) => player.team === 'b');

  return (
    <div className="update-modal-backdrop challenge-result-backdrop" onMouseDown={onClose}>
      <div
        className="update-modal challenge-result-modal"
        role="dialog"
        aria-modal="true"
        aria-label="约战战绩"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="update-modal-close" onClick={onClose} aria-label="关闭战绩">
          <Icon name="close" size={14} />
        </button>
        <div className="update-modal-kicker">MATCH RESULT · 约战战绩</div>
        <h2>{result.winner ? `${winnerA ? 'A' : 'B'} 队获胜` : '约战已结束'}</h2>
        <p className="update-modal-sub">{result.title || '约战房间'}</p>

        <div className="challenge-result-score">
          <span className={winnerA ? 'is-winner' : ''}>{result.scoreA || 0}</span>
          <b>:</b>
          <span className={winnerB ? 'is-winner' : ''}>{result.scoreB || 0}</span>
        </div>
        <div className="challenge-result-rule">
          胜利条件：{victoryLabel(result)}达到 {result.victoryLimit || 10} 次
          {result.serverName ? ` · ${result.serverName}` : ''}
        </div>

        <div className="challenge-result-teams">
          <TeamColumn label="A" players={playersA} winner={winnerA} />
          <TeamColumn label="B" players={playersB} winner={winnerB} />
        </div>
        <p className="challenge-result-note">数据已回写平台，本场约战不计排位分。</p>

        <div className="update-modal-actions">
          <button type="button" className="btn btn-primary" onClick={onOpenChallenges}>
            查看约战大厅
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
