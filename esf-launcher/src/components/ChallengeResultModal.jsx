import Icon from './Icon';
import Avatar from './Avatar';
import { DEFAULT_RANKS, rankFor } from '../lib/ranks';

const victoryLabel = (result) => {
  if (result?.victoryType === 'series') return Number(result?.bestOf) === 1 ? '一局定胜负' : '三局两胜';
  return result?.victoryType === 'deaths' ? '死亡次数' : '击杀数';
};

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? '今天 ' + hh + ':' + mm : date.getMonth() + 1 + ' 月 ' + date.getDate() + ' 日 ' + hh + ':' + mm;
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return seconds + ' 秒';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? minutes + ' 分' : minutes + ' 分 ' + rest + ' 秒';
}

function PlayerRow({ player }) {
  const rank = rankFor(DEFAULT_RANKS, player.combatLevel);
  const hasStats = Number(player.kills) > 0 || Number(player.deaths) > 0;
  return (
    <div className="result-player">
      <Avatar user={player} size="xs" />
      <span className="result-player-name">{player.gameName || player.username}</span>
      <span
        className={
          'combat-level rank-badge crm-rank' + (Number(player.combatLevel) === 0 ? ' rank-badge--unranked' : '')
        }
        style={{ color: rank.color, borderColor: rank.color + '55', background: rank.color + '14' }}
      >
        {rank.name}
      </span>
      <span className="result-player-stat">{hasStats ? player.kills + ' / ' + player.deaths : '已参战'}</span>
    </div>
  );
}

function TeamColumn({ label, players, winner }) {
  return (
    <div className={'result-team' + (winner ? ' is-winner' : '')}>
      <div className="result-team-head">
        <b>{label} 队</b>
        {winner ? <span className="result-win-tag">胜利</span> : <span className="crm-team-state">败</span>}
      </div>
      {(players || []).map((player) => (
        <PlayerRow key={player.id} player={player} />
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
  const duration = formatDuration(result.startedAt, result.endedAt);
  const bestOf = Number(result.bestOf) === 1 ? 1 : 3;
  const seriesTarget = bestOf === 1 ? 1 : 2;
  const chips = [
    result.mode ? result.mode + ' 约战' : null,
    result.map ? '地图 ' + result.map : null,
    result.serverName,
    duration ? '用时 ' + duration : null,
    result.displayNo ? '房间 #' + result.displayNo : null,
  ].filter(Boolean);

  return (
    <div className="update-modal-backdrop challenge-result-backdrop" onMouseDown={onClose}>
      <div
        className={
          'update-modal challenge-result-modal' + (winnerA ? ' is-win-a' : winnerB ? ' is-win-b' : '')
        }
        role="dialog"
        aria-modal="true"
        aria-label="约战战绩"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="update-modal-close" onClick={onClose} aria-label="关闭战绩">
          <Icon name="close" size={14} />
        </button>
        <div className="update-modal-kicker">MATCH RESULT · 约战战绩</div>
        <div className="crm-head">
          <h2>{result.winner ? (winnerA ? 'A 队获胜' : 'B 队获胜') : '约战已结束'}</h2>
          <span className="crm-when">{formatWhen(result.endedAt)}</span>
        </div>
        <p className="update-modal-sub">{result.title || '约战房间'}</p>

        <div className="crm-score">
          <span className={'crm-score-side' + (winnerA ? ' is-winner' : '')}>
            <em>A 队</em>
            <b>{result.scoreA || 0}</b>
          </span>
          <span className="crm-score-colon">:</span>
          <span className={'crm-score-side' + (winnerB ? ' is-winner' : '')}>
            <em>B 队</em>
            <b>{result.scoreB || 0}</b>
          </span>
        </div>
        <div className="crm-rule">
          {result.victoryType === 'series'
            ? `赛制：${bestOf === 1 ? '一局定胜负' : '三局两胜'} · 先到 ${seriesTarget} 胜`
            : `胜利条件：${victoryLabel(result)}达到 ${result.victoryLimit || 10} 次`}
        </div>

        {Array.isArray(result.rounds) && result.rounds.length > 0 && (
          <div className="crm-rounds">
            {result.rounds.map((round) => (
              <span key={round.roundNo} className={'crm-round is-' + round.winner}>
                <em>第 {round.roundNo} 局</em>
                <b>
                  {round.scoreA}:{round.scoreB}
                </b>
              </span>
            ))}
          </div>
        )}

        {chips.length > 0 && (
          <div className="crm-chips">
            {chips.map((chip) => (
              <span key={chip} className="crm-chip">
                {chip}
              </span>
            ))}
          </div>
        )}

        <div className="challenge-result-teams">
          <TeamColumn label="A" players={playersA} winner={winnerA} />
          <TeamColumn label="B" players={playersB} winner={winnerB} />
        </div>
        <p className="challenge-result-note">
          {result.victoryType === 'series'
            ? `${bestOf === 1 ? '本局' : '三局两胜'}战绩已回写平台；本场约战不计排位分，也不会影响天梯徽章。`
            : '战绩已回写平台，本场约战不计排位分，也不会影响天梯徽章。'}
        </p>

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
