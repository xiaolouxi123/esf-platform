import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import { formatClock, pingTone } from '../lib/format';

/** 三格信号条：延迟越低亮得越多 */
function PingBars({ ping, online }) {
  const level = !online ? 0 : ping <= 60 ? 3 : ping <= 140 ? 2 : 1;
  return (
    <span className={`ping-bars ping-bars--${level}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function severityOf(server) {
  if (!server.online) return 'offline';
  if (server.maxPlayers > 0 && server.players >= server.maxPlayers) return 'full';
  return pingTone(server.ping);
}

/**
 * 房间列表：表格行 + 点击展开实时详情（玩家 / 分数 / 在线时长）。
 *
 * 颜色区分：延迟分档 + 满房（红）+ 离线（灰）；
 * 展开后现场查 A2S，避免把每台服的玩家列表都提前拉一遍。
 */
export default function ServerRoomList({
  servers = [],
  loading = false,
  onJoin,
  busyKey = '',
  favorites,
  onToggleFavorite,
  emptyText = '没有符合条件的房间',
  syncedAt = null,
  currentUserId = null,
  onOpenRanked,
  onSpectate,
  onOpenChallenge,
  onQueue,
}) {
  const [openKey, setOpenKey] = useState('');
  const [details, setDetails] = useState({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsAgo = syncedAt ? Math.max(0, Math.round((now - syncedAt) / 1000)) : null;

  const loadDetail = useCallback(async (key, force = false) => {
    if (!force) {
      setDetails((prev) => {
        if (prev[key] && prev[key].data) return prev;
        return { ...prev, [key]: { loading: true } };
      });
    } else {
      setDetails((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: '' } }));
    }

    try {
      const data = await window.electronAPI.servers.detail({ serverKey: key });
      setDetails((prev) => ({ ...prev, [key]: { data, loading: false } }));
    } catch (err) {
      setDetails((prev) => ({ ...prev, [key]: { loading: false, error: err.message } }));
    }
  }, []);

  const toggle = (server) => {
    const key = server.serverKey;
    if (openKey === key) {
      setOpenKey('');
      return;
    }
    setOpenKey(key);
    if (!details[key] || (!details[key].data && !details[key].loading)) loadDetail(key);
  };

  const stop = (fn) => (event) => {
    event.stopPropagation();
    fn();
  };

  if (loading && servers.length === 0) {
    return (
      <div className="empty empty--inline">
        <span className="spinner" />
        <p>正在获取房间列表…</p>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="empty empty--inline">
        <Icon name="server" size={20} />
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="rooms">
      <div className="rooms-head">
        <span />
        <span>房间</span>
        <span>延迟</span>
        <span>人数</span>
        <span />
      </div>

      {servers.map((server) => {
        const key = server.serverKey;
        const open = openKey === key;
        const tone = severityOf(server);
        const detail = details[key] || {};
        const favorite = favorites ? favorites.has(key) : false;
        const busy = busyKey === key;
        const ranked = server.ranked || null;
        const challenge = server.challenge || null;
        const rankedPlayers = ranked
          ? ranked.players || [...(ranked.teams?.a || []), ...(ranked.teams?.b || [])]
          : [];
        const rankedParticipant = rankedPlayers.some(
          (player) => Number(player.id) === Number(currentUserId)
        );
        const challengeParticipant = Boolean(challenge?.participant);
        const lockedForMe = Boolean(
          (ranked && !rankedParticipant) || (challenge && !challengeParticipant)
        );
        const roomTone = tone === 'offline' ? 'offline' : challenge ? 'muted' : tone;

        return (
          <div
            key={key}
            className={`room room--${roomTone}${open ? ' is-open' : ''}${ranked ? ' room--ranked' : ''}${challenge ? ' room--challenge' : ''}${challenge && !challengeParticipant ? ' room--challenge-locked' : ''}`}
          >
            <div
              className="room-row"
              role="button"
              tabIndex={0}
              onClick={() => toggle(server)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggle(server);
                }
              }}
            >
              <span className={`room-flag room-flag--${tone}`}>
                {String(key).split('-')[0].toUpperCase()}
              </span>

              <span className="room-title">
                <b>
                  {server.name}
                  {ranked && <span className="room-ranked-tag">排位 {ranked.mode} · 比赛中</span>}
                  {challenge && (
                    <span className="room-challenge-tag">
                      约战 {challenge.mode} · {challenge.victoryType === 'deaths' ? `死亡 ${challenge.victoryLimit}` : `击杀 ${challenge.victoryLimit}`}
                    </span>
                  )}
                </b>
                <small>
                  {server.map || '未知地图'} · {server.ip}:{server.port}
                </small>
              </span>

              <span className={`room-ping room-ping--${tone}`}>
                <PingBars ping={server.ping} online={server.online} />
                {server.online ? `${server.ping}ms` : '离线'}
              </span>

              <span className="room-count">
                {server.players}
                <em>/{server.maxPlayers}</em>
              </span>

              <span className="room-ops">
                {onToggleFavorite && (
                  <button
                    type="button"
                    className={`icon-btn icon-btn--xs${favorite ? ' is-on' : ''}`}
                    title={favorite ? '取消收藏' : '收藏房间'}
                    onClick={stop(() => onToggleFavorite(key))}
                  >
                    <Icon name={favorite ? 'starFill' : 'star'} size={13} />
                  </button>
                )}

                <button
                  type="button"
                  className={`btn btn-sm ${lockedForMe ? 'btn-ghost' : server.online ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={!server.online || busy || lockedForMe}
                  onClick={stop(() => {
                    if (ranked && !rankedParticipant) {
                      onOpenRanked?.();
                      return;
                    }
                    if (challenge && !challengeParticipant) {
                      onOpenChallenge?.();
                      return;
                    }
                    onJoin && onJoin(server);
                  })}
                >
                  {busy ? (
                    <span className="spinner" />
                  ) : ranked ? (
                    rankedParticipant ? '进入比赛' : '比赛中'
                  ) : challenge ? (
                    challengeParticipant ? '进入约战' : '约战中'
                  ) : server.online ? (
                    '加入'
                  ) : (
                    '离线'
                  )}
                </button>

                {challenge && !challengeParticipant && server.online && onSpectate && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost room-spectate-btn"
                    disabled={busy || !challenge.spectatorAllowed}
                    title={
                      challenge.spectatorAllowed
                        ? '以 Half-Life 原生观战模式进入，不占参赛席位'
                        : '观战位已满（最多 4 人）'
                    }
                    onClick={stop(() => onSpectate(server))}
                  >
                    <Icon name="eye" size={13} /> 观战{' '}
                    {Number(challenge.spectatorCount || 0)}/{Number(challenge.spectatorLimit || 4)}
                  </button>
                )}

                {lockedForMe && server.online && onQueue && (
                  <button
                    type="button"
                    className={`btn btn-sm btn-ghost room-queue-btn${ranked ? ' is-ranked' : ' is-challenge'}`}
                    disabled={busy}
                    title={ranked ? '排位赛锁服：排位匹配玩家优先' : '约战锁服：可排队等下一场'}
                    onClick={stop(() => onQueue(server))}
                  >
                    <Icon name="clock" size={13} /> 排队
                  </button>
                )}

                <Icon name="chevron" size={14} className={`room-chev${open ? ' is-open' : ''}`} />
              </span>
            </div>

            {open && (
              <div className="room-detail">
                {ranked && (
                  <div className="room-ranked">
                    <div className="room-ranked-head">
                      <span>
                        <Icon name="trophy" size={14} /> 排位赛 {ranked.mode}
                      </span>
                      <em className={`room-ranked-status${ranked.status === 'live' ? ' is-live' : ''}`}>
                        {ranked.status === 'live' ? '比赛进行中' : '等待玩家准备'}
                      </em>
                    </div>

                    <div className="room-seats">
                      {['a', 'b'].map((team) => (
                        <div className="room-seat-team" key={team}>
                          <b>{team.toUpperCase()} 队</b>
                          {(ranked.teams?.[team] || []).map((player) => (
                            <div className="room-seat" key={player.id}>
                              <span className="room-seat-avatar">
                                <Avatar user={player} size="xs" />
                              </span>
                              <span>{player.gameName}</span>
                              <em className={player.ready ? 'is-ready' : ''}>
                                {player.ready ? '已准备' : '未准备'}
                              </em>
                            </div>
                          ))}
                          {Array.from(
                            { length: Math.max(0, (ranked.mode === '1v1' ? 1 : 2) - (ranked.teams?.[team]?.length || 0)) },
                            (_, index) => (
                              <div className="room-seat is-empty" key={`empty-${team}-${index}`}>
                                <span>等待加入</span>
                              </div>
                            )
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="room-ranked-actions">
                      <span>服务器已锁定，只有本场参赛玩家可以进入</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => onOpenRanked?.())}>
                        进入排位页 / 观战
                      </button>
                    </div>
                  </div>
                )}

                <div className="room-detail-head">
                  <span>玩家</span>
                  <span>分数</span>
                  <span>在线时长</span>
                  <button
                    type="button"
                    className="link"
                    disabled={detail.loading}
                    onClick={stop(() => loadDetail(key, true))}
                  >
                    {detail.loading ? '查询中…' : '刷新'}
                  </button>
                </div>

                {!detail.data && !detail.error ? (
                  <p className="room-detail-empty">正在查询服务器…</p>
                ) : detail.error ? (
                  <p className="room-detail-error">{detail.error}</p>
                ) : !detail.data.online ? (
                  <p className="room-detail-empty">服务器当前离线，无法获取玩家</p>
                ) : detail.data.playerList && detail.data.playerList.length > 0 ? (
                  detail.data.playerList.map((player, index) => (
                    <div className="player-line" key={`${player.name}-${index}`}>
                      <span className="player-name">{player.name || '未命名'}</span>
                      <span>{player.score}</span>
                      <span>{formatClock(player.durationSec)}</span>
                      <span />
                    </div>
                  ))
                ) : (
                  <p className="room-detail-empty">服务器里还没有玩家</p>
                )}

                <p className="room-detail-note">
                  {detail.data?.note || '击杀 / 死亡数据需要 AMXX 统计插件上报，接入后会自动多两列。'}
                </p>
              </div>
            )}
          </div>
        );
      })}

      {syncedAt && (
        <p className="rooms-sync">
          <Icon name="refresh" size={12} /> 每 15 秒自动刷新 · 上次同步 {secondsAgo} 秒前
        </p>
      )}
    </div>
  );
}
