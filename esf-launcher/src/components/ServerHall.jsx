import { useEffect, useRef, useState } from 'react';
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
  onSpectate,
  onOpenChallenge,
}) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('all');
  const [mode, setMode] = useState('all');
  const [customServers, setCustomServers] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ name: '', address: '' });
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState('');
  const customRef = useRef(null);

  const openCustom = () => {
    setCustomOpen(true);
    requestAnimationFrame(() => {
      customRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      customRef.current?.querySelector('input')?.focus();
    });
  };

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
    <div className="hall servers-page">
      <header className="hero servers-hero">
        <span className="hero-art" aria-hidden="true" />
        <span className="hero-mask" aria-hidden="true" />

        <div className="hero-content">
          <div className="eyebrow">
            <Icon name="servers" size={12} />
            服务器大厅
            <b className="eyebrow-status">{onlineList.length > 0 ? '在线' : '全部离线'}</b>
            <span className="eyebrow-note">平台登记 + 直连，两种都能进</span>
          </div>

          <h1 className="hero-title">服务器大厅</h1>

          <div className="hero-tags">
            <span className="tag tag--code">{servers.length} 台已登记</span>
            <span className="tag">15 秒自动刷新</span>
            <span className="tag">AMXX 身份校验</span>
          </div>
        </div>

        <div className="hero-foot">
          <div className="hud">
            <div className="hud-cell hud-cell--rooms">
              <span>在线服务器</span>
              <b>
                {onlineList.length}
                <em>/{servers.length}</em>
              </b>
            </div>
            <div className="hud-cell hud-cell--map">
              <span>在线玩家</span>
              <b>{onlinePlayers}</b>
            </div>
            <div className="hud-cell hud-cell--ping">
              <span>平均延迟</span>
              <b>
                {avgPing > 0 ? avgPing : '—'}
                {avgPing > 0 && <em>ms</em>}
              </b>
            </div>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="btn btn-ghost btn-lg servers-refresh"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
              {loading ? '刷新中…' : '刷新列表'}
            </button>
            <button type="button" className="btn btn-primary btn-lg hero-cta" onClick={openCustom}>
              <Icon name="plus" size={15} />
              添加服务器
            </button>
          </div>
        </div>
      </header>

      <div className="servers-filters">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={keyword}
            placeholder="筛选：名称 / 地图 / IP"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <div className="servers-modes">
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
        onSpectate={onSpectate}
        onOpenChallenge={onOpenChallenge}
      />

      <div className="servers-foot">
        <section className="custom-servers" ref={customRef}>
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

        <section className="lookup-panel">
          <div className="section-head">
            <h2>直连查询</h2>
            <span className="lookup-note">不依赖登记</span>
          </div>

          <LookupBar onJoin={onJoin} busyKey={busyKey} />
        </section>
      </div>

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
