import { useCallback, useEffect, useMemo, useState } from 'react';
import TitleBar from './TitleBar';
import Icon from './Icon';
import Avatar from './Avatar';
import ServerHall from './ServerHall';
import SettingsDrawer from './SettingsDrawer';
import AdminPanel from './AdminPanel';
import AssetLibrary from './AssetLibrary';
import PresencePanel from './PresencePanel';
import ChatPanel from './ChatPanel';
import ServerRoomList from './ServerRoomList';
import {
  formatDuration,
  formatRelative,
  isAdminRole,
  isStaff,
  loadFavoriteSet,
  roleLabel,
  saveFavoriteSet,
} from '../lib/format';

const FAV_SERVERS = 'esf:favServers';
const FAV_MAPS = 'esf:favMaps';

export default function Lobby({ user, settings, appInfo, backend, notice, toast, onSettingsChanged, onLogout, onAvatarChange }) {
  const [page, setPage] = useState('lobby');
  const [maps, setMaps] = useState([]);
  const [mapKeyword, setMapKeyword] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [servers, setServers] = useState([]);
  const [serversLoading, setServersLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [joinBusyKey, setJoinBusyKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [favServers, setFavServers] = useState(() => loadFavoriteSet(FAV_SERVERS));
  const [favMaps, setFavMaps] = useState(() => loadFavoriteSet(FAV_MAPS));
  const [updateInfo, setUpdateInfo] = useState(null);
  const [adminSummary, setAdminSummary] = useState(null);

  const hasGameDir = Boolean(settings?.hlPath && settings?.esfModDir);
  const staff = isStaff(user?.role);
  const activePage = page === 'admin' && !staff ? 'lobby' : page;

  const refreshServers = useCallback(async () => {
    setServersLoading(true);
    try {
      const data = await window.electronAPI.servers.list();
      setServers(Array.isArray(data?.servers) ? data.servers : []);
    } catch (err) {
      toast(err.message, 'error');
      setServers([]);
    } finally {
      setServersLoading(false);
    }
  }, [toast]);

  const refreshStats = useCallback(async () => {
    try {
      const data = await window.electronAPI.stats.get();
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    window.electronAPI.maps
      .scan()
      .then((list) => {
        setMaps(list);
        setSelectedMap((current) => current || list[0] || '');
      })
      .catch(() => setMaps([]));
  }, []);

  useEffect(() => {
    let alive = true;

    window.electronAPI.servers
      .list()
      .then((data) => {
        if (alive) setServers(Array.isArray(data?.servers) ? data.servers : []);
      })
      .catch((err) => {
        if (alive) toast(err.message, 'error');
      })
      .finally(() => {
        if (alive) setServersLoading(false);
      });

    window.electronAPI.stats
      .get()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch(() => {});

    window.electronAPI.update
      .check()
      .then((info) => {
        if (alive) setUpdateInfo(info);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [toast]);

  // 在线心跳：进入大厅立刻报一次，之后每 20 秒一次（主进程判断游戏是否在跑）
  useEffect(() => {
    const ping = () => {
      window.electronAPI.presence.ping().catch(() => {});
    };

    ping();
    const timer = setInterval(ping, 20000);
    return () => clearInterval(timer);
  }, []);

  // 员工才拉管理概览（玩家端不请求、也不显示）
  useEffect(() => {
    if (!staff) return undefined;

    let alive = true;
    window.electronAPI.admin
      .overview()
      .then((data) => {
        if (alive) setAdminSummary(data);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [staff]);

  const onlineServers = useMemo(() => servers.filter((server) => server.online), [servers]);
  const bestPing = useMemo(() => {
    const values = onlineServers.map((server) => server.ping).filter((value) => value > 0);
    return values.length ? Math.min(...values) : null;
  }, [onlineServers]);

  const visibleMaps = useMemo(() => {
    const keyword = mapKeyword.trim().toLowerCase();
    const list = maps.filter((map) => !keyword || map.toLowerCase().includes(keyword));
    return list.sort((a, b) => {
      const favA = favMaps.has(a) ? 0 : 1;
      const favB = favMaps.has(b) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      return a.localeCompare(b);
    });
  }, [maps, mapKeyword, favMaps]);

  const toggleFavorite = (setter, storageKey) => (key) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavoriteSet(storageKey, next);
      return next;
    });
  };

  const toggleServerFav = toggleFavorite(setFavServers, FAV_SERVERS);
  const toggleMapFav = toggleFavorite(setFavMaps, FAV_MAPS);

  const ensureGameDir = () => {
    if (hasGameDir) return true;
    setSettingsOpen(true);
    toast('请先选择游戏目录', 'error');
    return false;
  };

  const startLocal = async () => {
    if (!ensureGameDir()) return;
    if (!selectedMap) {
      toast('请先在左侧选择一张地图', 'error');
      return;
    }

    setLocalBusy(true);
    try {
      const result = await window.electronAPI.launch.local(selectedMap);
      toast(`已启动本地游戏：${result.map}`, 'ok');
      window.electronAPI.presence.ping().catch(() => {});
      refreshStats();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLocalBusy(false);
    }
  };

  const joinServer = async (server) => {
    if (!ensureGameDir()) return;

    setJoinBusyKey(server.serverKey);
    try {
      const result = await window.electronAPI.launch.join({
        serverKey: server.serverKey,
        ip: server.ip,
        port: server.port,
      });
      toast(`正在连接 ${result.address}`, 'ok');
      window.electronAPI.presence.ping().catch(() => {});
      refreshStats();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setJoinBusyKey('');
    }
  };

  const pickRandomMap = () => {
    if (maps.length === 0) return;
    const pool = maps.filter((map) => map !== selectedMap);
    const next = pool.length ? pool[Math.floor(Math.random() * pool.length)] : maps[0];
    setSelectedMap(next);
  };

  const openSettings = () => setSettingsOpen(true);

  const saveSettings = async (patch) => {
    const next = await window.electronAPI.settings.update(patch);
    onSettingsChanged?.(next);
  };

  const handlePickDir = async () => {
    const picked = await window.electronAPI.dialog.pickGameDir();
    const next = await window.electronAPI.settings.get();
    onSettingsChanged?.(next);
    const refreshed = await window.electronAPI.maps.scan();
    setMaps(refreshed);
    if (!selectedMap && refreshed.length > 0) setSelectedMap(refreshed[0]);
    return picked;
  };

  const quickActions = [
    {
      key: 'servers',
      icon: 'server',
      title: '服务器大厅',
      hint: `${onlineServers.length} 个在线房间`,
      onClick: () => setPage('servers'),
    },
    {
      key: 'refresh',
      icon: 'refresh',
      title: '刷新状态',
      hint: serversLoading ? '刷新中…' : '重新拉取房间列表',
      onClick: refreshServers,
    },
    {
      key: 'dir',
      icon: 'folder',
      title: hasGameDir ? '更换目录' : '设置目录',
      hint: hasGameDir ? '已配置 hl.exe' : '还未配置 hl.exe',
      onClick: openSettings,
    },
    {
      key: 'help',
      icon: 'help',
      title: '帮助中心',
      hint: '启动失败 / 连不上怎么办',
      onClick: () => toast('排错顺序：后端是否启动 → MySQL 3307 → AMXX 日志', 'ok'),
    },
  ];

  return (
    <div className="app-shell">
      <TitleBar
        page={activePage}
        onPage={setPage}
        user={user}
        onOpenSettings={openSettings}
      />

      <div className={`workspace${activePage !== 'lobby' ? ' workspace--wide' : ''}`}>
        <aside className="sidebar">
          <div className="side-head">
            <h2>地图库</h2>
            <span className="pill">{maps.length}</span>
          </div>

          <div className="search">
            <Icon name="search" size={15} />
            <input
              type="text"
              value={mapKeyword}
              placeholder="搜索地图…"
              onChange={(event) => setMapKeyword(event.target.value)}
            />
          </div>

          <div className="map-scroll">
            {visibleMaps.length === 0 ? (
              <p className="side-empty">
                {maps.length === 0 ? '还没有地图，先设置游戏目录' : '没有匹配的地图'}
              </p>
            ) : (
              visibleMaps.map((map) => {
                const isFav = favMaps.has(map);
                return (
                  <div
                    key={map}
                    className={`map-row${selectedMap === map ? ' is-active' : ''}`}
                    onClick={() => setSelectedMap(map)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => event.key === 'Enter' && setSelectedMap(map)}
                  >
                    <Icon name="map" size={14} />
                    <span className="map-name">{map}</span>
                    <button
                      type="button"
                      className={`icon-btn icon-btn--xs${isFav ? ' is-on' : ''}`}
                      title={isFav ? '取消收藏' : '收藏地图'}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleMapFav(map);
                      }}
                    >
                      <Icon name={isFav ? 'starFill' : 'star'} size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <button type="button" className="side-foot-btn" onClick={openSettings}>
            <Icon name="folder" size={15} />
            {hasGameDir ? '游戏目录已配置' : '选择游戏目录'}
          </button>
        </aside>

        <main className="center">
          {activePage === 'servers' ? (
            <ServerHall
              servers={servers}
              loading={serversLoading}
              onRefresh={refreshServers}
              onJoin={joinServer}
              favorites={favServers}
              onToggleFavorite={toggleServerFav}
              busyKey={joinBusyKey}
            />
          ) : activePage === 'assets' ? (
            <AssetLibrary toast={toast} settings={settings} />
          ) : activePage === 'admin' ? (
            <AdminPanel
              user={user}
              settings={settings}
              appInfo={appInfo}
              backend={backend}
              toast={toast}
              onOpenSettings={openSettings}
              onLogout={onLogout}
            />
          ) : (
            <>
              {updateInfo?.hasUpdate && (
                <div className="update-strip">
                  <Icon name="spark" size={15} />
                  <span>
                    发现新版本 <b>v{updateInfo.latest}</b>（当前 v{updateInfo.current}）
                    {updateInfo.releaseNotes ? ` · ${updateInfo.releaseNotes}` : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={async () => {
                      if (!updateInfo.downloadUrl) {
                        toast('管理员还没填下载地址，请联系服主获取新版本', 'ok');
                        return;
                      }
                      try {
                        await window.electronAPI.shell.openExternal(updateInfo.downloadUrl);
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    }}
                  >
                    去下载
                  </button>
                </div>
              )}

              <section className="hero">
                <div className="hero-content">
                  <span className="eyebrow">
                    <Icon name="map" size={13} />
                    当前地图
                  </span>
                  <h1>{selectedMap || '请先设置游戏目录'}</h1>
                  <p>
                    本地开图 · 平台身份校验 · 模组 <code>{settings?.esfModDir ? '已连接' : '未设置'}</code>
                  </p>

                  <div className="hero-actions">
                    <button type="button" className="btn btn-primary btn-lg" onClick={startLocal} disabled={localBusy}>
                      {localBusy ? <span className="spinner" /> : <Icon name="play" size={16} />}
                      {localBusy ? '启动中…' : '开始游戏'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={pickRandomMap}>
                      <Icon name="refresh" size={15} /> 换一张
                    </button>
                  </div>
                </div>

                <div className="hero-side">
                  <div className="hero-stat">
                    <span>地图</span>
                    <b>{maps.length}</b>
                  </div>
                  <div className="hero-stat">
                    <span>在线房间</span>
                    <b>{onlineServers.length}</b>
                  </div>
                  <div className="hero-stat">
                    <span>最低延迟</span>
                    <b>{bestPing === null ? '—' : `${bestPing}ms`}</b>
                  </div>
                  {staff && (
                    <div className="hero-stat hero-stat--staff">
                      <span>待审资源</span>
                      <b>{adminSummary ? adminSummary.assets.pending : '—'}</b>
                    </div>
                  )}
                </div>
              </section>

              <div className="quick-grid">
                {quickActions.map((action) => (
                  <button key={action.key} type="button" className="quick" onClick={action.onClick}>
                    <span className="quick-icon">
                      <Icon name={action.icon} size={18} />
                    </span>
                    <b>{action.title}</b>
                    <small>{action.hint}</small>
                  </button>
                ))}
              </div>

              <section className="section">
                <div className="section-head">
                  <h2>在线房间</h2>
                  <button type="button" className="link" onClick={() => setPage('servers')}>
                    全部 <Icon name="chevronRight" size={13} />
                  </button>
                </div>

                {onlineServers.length === 0 ? (
                  <div className="empty empty--inline">
                    <Icon name="server" size={20} />
                    <p>{serversLoading ? '正在获取…' : '当前没有在线房间'}</p>
                  </div>
                ) : (
                  <ServerRoomList
                    servers={onlineServers.slice(0, 5)}
                    loading={serversLoading}
                    onJoin={joinServer}
                    busyKey={joinBusyKey}
                    favorites={favServers}
                    onToggleFavorite={toggleServerFav}
                  />
                )}
              </section>

              <div className="notice">
                <Icon name="bell" size={15} />
                <span>{notice || '平台已接入真实账号与连服凭证，游戏内会自动完成身份校验。'}</span>
              </div>

              <section className="section">
                <div className="section-head">
                  <h2>快速上手</h2>
                  <span className="tag">3 步进服</span>
                </div>

                <div className="guide-grid">
                  {[
                    { no: '01', icon: 'map', title: '选一张地图', text: '左侧地图库支持搜索与收藏' },
                    { no: '02', icon: 'play', title: '点开始游戏', text: '启动器写入一次性平台凭证' },
                    { no: '03', icon: 'shield', title: '进服自动验证', text: 'AMXX 校验通过后显示平台身份' },
                  ].map((step) => (
                    <article key={step.no} className="guide-step">
                      <span className="step-no">{step.no}</span>
                      <Icon name={step.icon} size={17} />
                      <b>{step.title}</b>
                      <p>{step.text}</p>
                    </article>
                  ))}
                </div>
              </section>

              <div className="env-strip">
                <span className="env-item">
                  <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} /> 平台服务
                </span>
                <span className="env-item">
                  <span className={`dot dot--${backend?.db === 'up' ? 'on' : 'off'}`} /> 数据库
                </span>
                <span className="env-item">
                  <span className={`dot dot--${hasGameDir ? 'on' : 'off'}`} /> 游戏目录
                </span>
                <span className="env-item">
                  <span className={`dot dot--${onlineServers.length > 0 ? 'on' : 'off'}`} /> 在线房间
                </span>
                <span className="env-spacer" />
                <span className="env-item env-item--muted">
                  模组 {settings?.esfModDir ? '已挂载' : '未设置'}
                </span>
              </div>
            </>
          )}
        </main>

        {activePage === 'lobby' && (
          <aside className="rail">
            <section className="card profile">
              <div className="profile-head">
                <Avatar user={user} size="lg" />
                <div>
                  <h3>{user?.gameName || user?.username || '玩家'}</h3>
                  <p>
                    <span className="badge">{roleLabel(user?.role)}</span>
                    <code>@{user?.username}</code>
                  </p>
                </div>
              </div>

              <div className="profile-stats">
                <div>
                  <b>{stats ? stats.sessions : '—'}</b>
                  <span>进场次数</span>
                </div>
                <div>
                  <b>{stats ? formatDuration(stats.totalSeconds) : '—'}</b>
                  <span>累计时长</span>
                </div>
              </div>

              <p className="profile-last">
                <Icon name="clock" size={13} /> {formatRelative(stats?.lastPlayedAt)}
              </p>

              <div className="profile-actions">
                <button type="button" className="rail-link" onClick={openSettings}>
                  <Icon name="settings" size={14} /> 设置
                </button>
                <button
                  type="button"
                  className="rail-link"
                  onClick={async () => {
                    try {
                      await window.electronAPI.shell.openGameDir();
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  }}
                >
                  <Icon name="folder" size={14} /> 目录
                </button>
                <button type="button" className="rail-link rail-link--danger" onClick={onLogout}>
                  <Icon name="logout" size={14} /> 退出
                </button>
              </div>
            </section>

            {staff && (
              <section className="card card--role">
                <div className="presence-head">
                  <h3>
                    <Icon name="shield" size={14} /> {roleLabel(user?.role)}工作台
                  </h3>
                  <button type="button" className="link" onClick={() => setPage('admin')}>
                    进入 <Icon name="chevronRight" size={12} />
                  </button>
                </div>

                <div className="role-metrics">
                  <div>
                    <b>{adminSummary ? adminSummary.assets.pending : '—'}</b>
                    <span>待审资源</span>
                  </div>
                  <div>
                    <b>{adminSummary ? adminSummary.sessions.today : '—'}</b>
                    <span>今日进场</span>
                  </div>
                </div>

                <p className="role-hint">
                  {isAdminRole(user?.role)
                    ? '你可以改角色、查看操作审计与使用开发者工具。'
                    : '你可以审核资源、处理玩家与登记服务器；改角色与审计由管理员负责。'}
                </p>
              </section>
            )}

            {user?.role === 'creator' && (
              <section className="card card--role">
                <div className="presence-head">
                  <h3>
                    <Icon name="spark" size={14} /> 作者中心
                  </h3>
                </div>
                <p className="role-hint">上传模型 / 声音，审核通过后所有玩家可见。</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm btn-block"
                  onClick={() => setPage('assets')}
                >
                  去上传资源
                </button>
              </section>
            )}

            <PresencePanel user={user} />

            <ChatPanel user={user} toast={toast} />
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span className="status-item">
          <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
          {backend?.ok ? '平台服务在线' : '平台服务离线'}
        </span>
        {staff && (
          <span className="status-item">
            <span className={`dot dot--${backend?.db === 'up' ? 'on' : 'off'}`} /> 数据库
          </span>
        )}
        {staff && (
          <span className="status-item">
            待审 {adminSummary ? adminSummary.assets.pending : '—'}
          </span>
        )}
        <span className="status-item">
          <Icon name="server" size={12} /> {onlineServers.length}/{servers.length} 在线
        </span>
        <span className="status-item">
          <Icon name="wifi" size={12} /> {settings?.apiBaseUrl || '—'}
        </span>
        <span className="status-spacer" />
        <span className="status-item">v{appInfo?.version || '0.0.0'}</span>
      </footer>

      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          appInfo={appInfo}
          backend={backend}
          user={user}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onPickGameDir={handlePickDir}
          onLogout={onLogout}
          toast={toast}
          onAvatarChange={onAvatarChange}
        />
      )}
    </div>
  );
}
