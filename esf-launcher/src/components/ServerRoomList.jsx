import { useCallback, useState } from 'react';
import Icon from './Icon';
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
}) {
  const [openKey, setOpenKey] = useState('');
  const [details, setDetails] = useState({});

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

        return (
          <div key={key} className={`room room--${tone}${open ? ' is-open' : ''}`}>
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
                <b>{server.name}</b>
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
                  className={`btn btn-sm ${server.online ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={!server.online || busy}
                  onClick={stop(() => onJoin && onJoin(server))}
                >
                  {busy ? <span className="spinner" /> : server.online ? '加入' : '离线'}
                </button>

                <Icon name="chevron" size={14} className={`room-chev${open ? ' is-open' : ''}`} />
              </span>
            </div>

            {open && (
              <div className="room-detail">
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
    </div>
  );
}
