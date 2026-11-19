import Icon from './Icon';

/**
 * 大厅专用房间卡：替代密集表格，两列卡片。
 * 比赛服 / 公开服用边框与标签强区分；锁定房只给「查看」入口。
 */
export default function LobbyRooms({
  servers = [],
  busyKey = '',
  favorites,
  onToggleFavorite,
  onJoin,
  onSpectate,
  currentUserId = null,
  onOpenRanked,
  onOpenChallenge,
}) {
  if (servers.length === 0) return null;

  return (
    <div className="lobby-rooms">
      {servers.map((server) => {
        const ranked = server.ranked || null;
        const challenge = server.challenge || null;
        const arena = server.arena || null;
        const kind = server.isMatch ? 'match' : server.isChallenge ? 'challenge' : 'public';
        const kindLabel = kind === 'match' ? '比赛服' : kind === 'challenge' ? '约战服' : '公开服';
        const key = server.serverKey;
        const favorite = favorites ? favorites.has(key) : false;
        const busy = busyKey === key;
        const rankedPlayers = ranked
          ? ranked.players || [...(ranked.teams?.a || []), ...(ranked.teams?.b || [])]
          : [];
        const rankedParticipant = rankedPlayers.some((player) => Number(player.id) === Number(currentUserId));
        const challengeParticipant = Boolean(challenge?.participant);
        const arenaLive = arena?.phase === 'live';
        const arenaLocked = Boolean(arenaLive && !arena.participant && arena.joinMode !== 'spectate');
        const locked = Boolean(
          (ranked && !rankedParticipant) ||
            (challenge && !challengeParticipant) ||
            arenaLocked
        );

        let action = '加入';
        let onAction = () => onJoin && onJoin(server);
        if (!server.online) {
          action = '离线';
          onAction = null;
        } else if (ranked && !rankedParticipant) {
          action = '查看排位';
          onAction = () => onOpenRanked && onOpenRanked();
        } else if (challenge && !challengeParticipant) {
          action = '查看约战';
          onAction = () => onOpenChallenge && onOpenChallenge();
        } else if (ranked) {
          action = '进入比赛';
        } else if (challenge) {
          action = '进入约战';
        } else if (arena && arena.participant) {
          action = '进入比赛';
        } else if (arenaLive && arena.joinMode === 'spectate') {
          action = `观战 ${arena.spectatorCount}/${arena.spectatorLimit}`;
          onAction = () => onSpectate && onSpectate(server);
        } else if (arenaLive && arena.joinMode === 'queue') {
          action = '满员等待';
          onAction = null;
        } else if (arenaLocked) {
          action = '已锁服';
          onAction = null;
        } else if (arena?.phase === 'waiting' && arena.participant) {
          action = '等待开赛';
          onAction = null;
        }

        return (
          <article
            key={key}
            className={`lobby-room is-${kind}${server.online ? '' : ' is-offline'}`}
          >
            <header>
              <span className="lobby-room-kind">{kindLabel}</span>
              <b title={server.name}>{server.name}</b>
              {onToggleFavorite && (
                <button
                  type="button"
                  className={`icon-btn icon-btn--xs${favorite ? ' is-on' : ''}`}
                  title={favorite ? '取消收藏' : '收藏房间'}
                  aria-label={favorite ? '取消收藏房间' : '收藏房间'}
                  aria-pressed={favorite}
                  onClick={() => onToggleFavorite(key)}
                >
                  <Icon name={favorite ? 'starFill' : 'star'} size={13} />
                </button>
              )}
            </header>

            <p className="lobby-room-meta">
              {server.map || '未知地图'}
              <i>·</i>
              {server.mode || '混战'}
              {ranked && <em className="is-ranked">排位 {ranked.mode} 进行中</em>}
              {challenge && (
                <em className="is-challenge">
                  约战 {challenge.mode} · BO{Number(challenge.bestOf) === 1 ? 1 : 3}
                </em>
              )}
              {arena && arena.phase !== 'idle' && (
                <em className="is-arena">
                  擂台 {arena.phase === 'live' ? '进行中' : '等待开赛'} · 观战 {arena.spectatorCount}/
                  {arena.spectatorLimit} · 排队 {arena.queueLength}/{arena.queueLimit}
                </em>
              )}
            </p>

            <footer>
              <span className={`lobby-room-ping${!server.online || server.ping > 90 ? ' is-warn' : ''}`}>
                {server.online ? `${server.ping}ms` : '离线'}
              </span>
              <span className="lobby-room-count">
                {server.players}
                <em>/{server.maxPlayers}</em>
              </span>
              <span className="lobby-room-spacer" />
              <button
                type="button"
                className={`btn btn-sm lobby-join lobby-join--${kind}${locked ? ' is-locked' : ''}`}
                disabled={!server.online || busy || !onAction}
                title={
                  !server.online
                    ? '服务器当前离线'
                    : busy
                      ? '正在进入…'
                      : !onAction
                        ? '当前不可加入，稍后再试'
                        : action
                }
                onClick={onAction || undefined}
              >
                {busy ? <span className="spinner" /> : action}
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}