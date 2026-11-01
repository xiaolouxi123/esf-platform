import { useState } from 'react';
import Icon from './Icon';
import ServerRoomList from './ServerRoomList';
import { pingTone } from '../lib/format';

/** 直连查询：输入 IP:端口 现场查一次，不依赖后台是否登记 */
function LookupBar({ onJoin, busyKey }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    const value = address.trim();
    if (!value || busy) return;

    setBusy(true);
    setResult(null);
    try {
      const server = await window.electronAPI.servers.lookup(value);
      setResult(server);
    } catch (err) {
      setResult({ error: err.message, address: value });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lookup">
      <div className="lookup-bar">
        <div className="search">
          <Icon name="wifi" size={15} />
          <input
            type="text"
            value={address}
            placeholder="直连查询：输入 IP:端口，例如 114.132.84.150:27016"
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && run()}
          />
        </div>

        <button type="button" className="btn btn-ghost" onClick={run} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="search" size={15} />}
          {busy ? '查询中…' : '查询'}
        </button>
      </div>

      {result && (
        <div className={`probe${result.error ? ' is-error' : ''}`}>
          {result.error ? (
            <>
              <Icon name="alert" size={15} />
              <span>
                {result.address} 查询失败：{result.error}
              </span>
            </>
          ) : (
            <>
              <div className="probe-main">
                <span className={`dot dot--${result.online ? 'on' : 'off'}`} />
                <b>{result.name || result.registryName || result.address}</b>
                <code>{result.address}</code>
                {result.online ? (
                  <>
                    <span className="tag">
                      <Icon name="map" size={13} /> {result.map || '—'}
                    </span>
                    <span className="tag">
                      <Icon name="users" size={13} /> {result.players}/{result.maxPlayers}
                    </span>
                    <span className={`tag tag--${pingTone(result.ping)}`}>{result.ping}ms</span>
                  </>
                ) : (
                  <span className="tag tag--bad">离线</span>
                )}
              </div>

              <div className="probe-foot">
                {result.registered ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!result.online || busyKey === result.serverKey}
                    onClick={() =>
                      onJoin({
                        serverKey: result.serverKey,
                        ip: result.ip,
                        port: result.port,
                        name: result.name || result.address,
                      })
                    }
                  >
                    <Icon name="play" size={13} /> 带平台身份加入
                  </button>
                ) : (
                  <span className="probe-hint">
                    这台服没在平台登记，无法带平台身份加入。管理员可执行
                    <code>npm run server:add -- --key … --ip … --port …</code> 登记。
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ServerHall({
  servers,
  loading,
  onRefresh,
  onJoin,
  favorites,
  onToggleFavorite,
  busyKey,
}) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('all');

  const visible = servers.filter((server) => {
    if (filter === 'online' && !server.online) return false;
    if (filter === 'fav' && !favorites.has(server.serverKey)) return false;

    const text = `${server.name} ${server.map || ''} ${server.ip}`.toLowerCase();
    return text.includes(keyword.trim().toLowerCase());
  });

  const filters = [
    { key: 'all', label: '全部' },
    { key: 'online', label: '在线' },
    { key: 'fav', label: '收藏' },
  ];

  return (
    <div className="hall">
      <header className="hall-head">
        <div>
          <h2>
            服务器大厅
            <span className="pill">{servers.length}</span>
          </h2>
          <p>点任意一行展开实时玩家列表；列表来自平台登记，状态由后端每 15 秒刷新</p>
        </div>

        <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          {loading ? '刷新中…' : '刷新列表'}
        </button>
      </header>

      <LookupBar onJoin={onJoin} busyKey={busyKey} />

      <div className="hall-toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            type="text"
            value={keyword}
            placeholder="筛选：名称 / 地图 / IP"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <div className="segmented">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={filter === item.key ? 'is-active' : ''}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <ServerRoomList
        servers={visible}
        loading={loading}
        onJoin={onJoin}
        busyKey={busyKey}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
      />

      <footer className="hall-tip">
        <Icon name="help" size={14} />
        <span>
          点行展开玩家；击杀/死亡需要 AMXX 统计插件上报。要把新服加进列表，在 server 目录执行
          <code>npm run server:add</code>。
        </span>
      </footer>
    </div>
  );
}
