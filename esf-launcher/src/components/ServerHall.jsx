import { useEffect, useState } from 'react';
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
                    这台服没在平台登记。可以把它加进「我的服务器」直接直连（不带平台身份）。
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
  toast,
  syncedAt,
  currentUserId,
  onOpenRanked,
}) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('all');
  const [mode, setMode] = useState('all');
  const [customServers, setCustomServers] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ name: '', address: '' });
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI.servers
      .customList()
      .then((data) => {
        if (alive) setCustomServers(data.servers || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const addCustom = async (event) => {
    event.preventDefault();
    if (customBusy) return;

    setCustomError('');
    setCustomBusy(true);
    try {
      const data = await window.electronAPI.servers.customAdd({
        name: customForm.name.trim(),
        address: customForm.address.trim(),
      });
      setCustomServers(data.servers || []);
      setCustomForm({ name: '', address: '' });
      setCustomOpen(false);
      toast?.(`已添加 ${customForm.address.trim()}`, 'ok');
    } catch (err) {
      setCustomError(err.message);
    } finally {
      setCustomBusy(false);
    }
  };

  const removeCustom = async (address) => {
    try {
      const data = await window.electronAPI.servers.customRemove(address);
      setCustomServers(data.servers || []);
    } catch (err) {
      setCustomError(err.message);
    }
  };

  const visible = servers.filter((server) => {
    if (filter === 'online' && !server.online) return false;
    if (filter === 'fav' && !favorites.has(server.serverKey)) return false;
    if (mode !== 'all' && (server.mode || '混战') !== mode) return false;

    const text = `${server.name} ${server.map || ''} ${server.ip}`.toLowerCase();
    return text.includes(keyword.trim().toLowerCase());
  });

  const filters = [
    { key: 'all', label: '全部' },
    { key: 'online', label: '在线' },
    { key: 'fav', label: '收藏' },
  ];

  const onlineList = servers.filter((server) => server.online);
  const onlinePlayers = onlineList.reduce((sum, server) => sum + (Number(server.players) || 0), 0);
  const avgPing = onlineList.length
    ? Math.round(onlineList.reduce((sum, server) => sum + (Number(server.ping) || 0), 0) / onlineList.length)
    : 0;

  const MODE_ORDER = ['单挑', '新手', '混战', '组队', '生存', '剧情', '其他'];
  const modeCounts = new Map();
  for (const server of servers) {
    const key = server.mode || '混战';
    modeCounts.set(key, (modeCounts.get(key) || 0) + 1);
  }
  const modeOptions = [
    { key: 'all', label: '全部模式', count: servers.length },
    ...MODE_ORDER.filter((key) => modeCounts.has(key)).map((key) => ({
      key,
      label: key,
      count: modeCounts.get(key),
    })),
    ...[...modeCounts.keys()]
      .filter((key) => !MODE_ORDER.includes(key))
      .map((key) => ({ key, label: key, count: modeCounts.get(key) })),
  ];

  return (
    <div className="hall">
      <header className="hall-head">
        <div>
          <h2>
            服务器大厅
            <span className="pill">{servers.length}</span>
          </h2>
          <p>点任意一行展开实时玩家列表；没登记的服务器可以在下面自己添加</p>
        </div>

        <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          {loading ? '刷新中…' : '刷新列表'}
        </button>
      </header>

      <div className="hall-stats">
        <div className="hall-stat">
          <span>在线服务器</span>
          <b>
            {onlineList.length}
            <em>/{servers.length}</em>
          </b>
        </div>
        <div className="hall-stat">
          <span>在线玩家</span>
          <b>{onlinePlayers}</b>
        </div>
        <div className="hall-stat">
          <span>平均延迟</span>
          <b>{avgPing > 0 ? `${avgPing}ms` : '—'}</b>
        </div>
        <div className="hall-stat">
          <span>我的服务器</span>
          <b>{customServers.length}</b>
        </div>
      </div>

      <div className="hall-modes">
        {modeOptions.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`hall-mode${mode === item.key ? ' is-active' : ''}`}
            onClick={() => setMode(item.key)}
          >
            {item.label}
            <em>{item.count}</em>
          </button>
        ))}
      </div>

      <LookupBar onJoin={onJoin} busyKey={busyKey} />

      <section className="custom-servers">
        <div className="section-head">
          <h2>
            我的服务器 <span className="pill">{customServers.length}</span>
          </h2>

          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCustomOpen((value) => !value)}>
            <Icon name={customOpen ? 'close' : 'plus'} size={14} />
            {customOpen ? '收起' : '添加服务器'}
          </button>
        </div>

        <p className="custom-hint">
          只保存在本机，不走平台登记；直连时不带平台身份，AMXX 不会做身份校验。
        </p>

        {customOpen && (
          <form className="custom-form" onSubmit={addCustom}>
            <input
              type="text"
              value={customForm.name}
              placeholder="名称（可选）"
              onChange={(event) => setCustomForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              type="text"
              value={customForm.address}
              placeholder="IP:端口，例如 1.2.3.4:27016"
              onChange={(event) => setCustomForm((prev) => ({ ...prev, address: event.target.value }))}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={customBusy || !customForm.address.trim()}>
              {customBusy ? <span className="spinner" /> : '添加'}
            </button>
          </form>
        )}

        {customError && <p className="custom-error">{customError}</p>}

        {customServers.length > 0 && (
          <div className="custom-list">
            {customServers.map((server) => (
              <div className="custom-row" key={server.address}>
                <span className="room-flag room-flag--custom">自建</span>
                <div className="custom-meta">
                  <b>{server.name}</b>
                  <small>{server.address}</small>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => removeCustom(server.address)}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busyKey === server.address}
                  onClick={() => onJoin({ custom: true, name: server.name, address: server.address })}
                >
                  {busyKey === server.address ? <span className="spinner" /> : '加入'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

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
        syncedAt={syncedAt}
        currentUserId={currentUserId}
        onOpenRanked={onOpenRanked}
      />

      <footer className="hall-tip">
        <Icon name="help" size={14} />
        <span>
          展开行查看玩家；击杀/死亡需要 AMXX 统计插件上报。要把新服加进平台列表，在 server 目录执行
          <code>npm run server:add</code>。
        </span>
      </footer>
    </div>
  );
}
