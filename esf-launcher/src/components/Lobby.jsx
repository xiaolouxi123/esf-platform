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
import { MAP_CATEGORIES, mapCatalog, mapMeta } from '../lib/maps';
import dragonBall from '../assets/dragon-ball.webp';
import {
  formatDuration,
  formatRelative,
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
  const [mapCategory, setMapCategory] = useState('all');
  const [selectedMap, setSelectedMap] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [servers, setServers] = useState([]);
  const [serversLoading, setServersLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [joinBusyKey, setJoinBusyKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [favServers, setFavServers] = useState(() => loadFavoriteSet(FAV_SERVERS));
  const [favMaps, setFavMaps] = useState(() => loadFavoriteSet(FAV_MAPS));
  const [updateInfo, setUpdateInfo] = useState(null);
  const [autoUpdate, setAutoUpdate] = useState(null);
  const [adminSummary, setAdminSummary] = useState(null);
  const [recentAssets, setRecentAssets] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [platformState, setPlatformState] = useState({
    notice: notice || '',
    maintenance: Boolean(backend?.maintenance),
    maintenanceText: '',
  });

  const hasGameDir = Boolean(settings?.hlPath && settings?.esfModDir);
  const staff = isStaff(user?.role);
  const activePage = page === 'admin' && !staff ? 'lobby' : page;

  const refreshServers = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setServersLoading(true);
      try {
        const data = await window.electronAPI.servers.list();
        setServers(Array.isArray(data?.servers) ? data.servers : []);
        setLastSyncAt(Date.now());
      } catch (err) {
        // 静默刷新失败时保留上一份列表，只提示手动刷新
        if (!silent) {
          toast(err.message, 'error');
          setServers([]);
        }
      } finally {
        if (!silent) setServersLoading(false);
      }
    },
    [toast]
  );

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
        if (alive) {
          setServers(Array.isArray(data?.servers) ? data.servers : []);
          setLastSyncAt(Date.now());
        }
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

  // 服务器状态自动刷新：每 15 秒静默拉一次，窗口重新聚焦也拉（后端轮询同样 15 秒）
  useEffect(() => {
    const timer = setInterval(() => refreshServers({ silent: true }), 15000);
    const onFocus = () => refreshServers({ silent: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshServers({ silent: true });
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshServers]);

  // 公告 / 维护模式：每 60 秒同步一次，管理员改完玩家端不用重启
  useEffect(() => {
    let alive = true;

    const load = () => {
      window.electronAPI.app
        .config()
        .then((config) => {
          if (!alive) return;
          setPlatformState({
            notice: config.notice || '',
            maintenance: Boolean(config.maintenance),
            maintenanceText: config.maintenanceText || '',
          });
        })
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 自动更新状态：主进程推送，弹窗里也能看到
  useEffect(() => {
    let unsubscribe = null;
    window.electronAPI.update
      ?.status?.()
      .then((state) => setAutoUpdate(state))
      .catch(() => {});
    unsubscribe = window.electronAPI.update?.onStatus?.((state) => setAutoUpdate(state)) || null;
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);
  // 在线心跳：进入大厅立刻报一次，之后每 20 秒一次（主进程判断游戏是否在跑）
  useEffect(() => {
    const ping = () => {
      window.electronAPI.presence.ping().catch(() => {});
    };

    ping();
    const timer = setInterval(ping, 20000);

    const refresh = () => {
      if (document.visibilityState === 'visible') ping();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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

  // 最近上架：公开资源，玩家也能看，用来填满首屏下方
  useEffect(() => {
    let alive = true;
    window.electronAPI.assets
      .list({})
      .then((data) => {
        if (alive) setRecentAssets(Array.isArray(data?.assets) ? data.assets : []);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const onlineServers = useMemo(() => servers.filter((server) => server.online), [servers]);
  const bestPing = useMemo(() => {
    const values = onlineServers.map((server) => server.ping).filter((value) => value > 0);
    return values.length ? Math.min(...values) : null;
  }, [onlineServers]);

  const visibleMaps = useMemo(() => {
    const keyword = mapKeyword.trim().toLowerCase();

    return mapCatalog(maps)
      .filter((item) => {
        if (mapCategory === 'fav') {
          if (!favMaps.has(item.code)) return false;
        } else if (mapCategory !== 'all' && item.category !== mapCategory) {
          return false;
        }
        if (!keyword) return true;
        return item.name.toLowerCase().includes(keyword) || item.code.toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        const favA = favMaps.has(a.code) ? 0 : 1;
        const favB = favMaps.has(b.code) ? 0 : 1;
        if (favA !== favB) return favA - favB;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }, [maps, mapKeyword, mapCategory, favMaps]);

  const selectedMeta = useMemo(() => mapMeta(selectedMap || ''), [selectedMap]);

  // 排序后选中的那张可能在视口外，切图时把它滚进可视区
  useEffect(() => {
    const scroller = document.querySelector('.map-scroll');
    const active = scroller?.querySelector('.map-row.is-active');
    if (!scroller || !active) return;
    const offset = active.offsetTop - scroller.offsetTop;
    if (offset < scroller.scrollTop || offset + active.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, offset - scroller.clientHeight / 2 + active.offsetHeight / 2);
    }
  }, [selectedMap, mapCategory, mapKeyword]);

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
    if (platformState.maintenance) {
      toast(platformState.maintenanceText || '平台维护中，请稍后再试', 'error');
      return;
    }
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
    if (platformState.maintenance) {
      toast(platformState.maintenanceText || '平台维护中，请稍后再试', 'error');
      return;
    }
    if (!ensureGameDir()) return;

    const key = server.custom ? server.address : server.serverKey;
    setJoinBusyKey(key);
    try {
      const result = server.custom
        ? await window.electronAPI.launch.joinCustom(server.address)
        : await window.electronAPI.launch.join({
            serverKey: server.serverKey,
            ip: server.ip,
            port: server.port,
          });

      toast(
        server.custom
          ? `正在直连 ${result.address}（未登记，不带平台身份）`
          : `正在连接 ${result.address}`,
        'ok'
      );
      window.electronAPI.presence.ping().catch(() => {});
      refreshStats();
      // 进游戏后列表里的在线人数/地图会变，几秒后静默补两次
      setTimeout(() => refreshServers({ silent: true }), 4000);
      setTimeout(() => refreshServers({ silent: true }), 12000);
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

  const assetUrl = (url) => {
    if (!url) return '';
    if (/^(data:|https?:)/i.test(url)) return url;
    return `${String(settings?.apiBaseUrl || '').replace(/\/$/, '')}${url}`;
  };

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

  // Enter 直接开始本地游戏（输入框、按钮、地图/房间行上按 Enter 不触发）
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (target?.closest?.('button, a, [role="button"], [role="link"]')) return;
      if (settingsOpen || activePage !== 'lobby') return;
      event.preventDefault();
      startLocal();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="app-shell">
      <TitleBar
        page={activePage}
        onPage={setPage}
        user={user}
        onOpenSettings={openSettings}
      />

      <div className={`workspace${activePage !== 'lobby' ? ' workspace--wide' : ''}`}>
        <aside className="game-rail">
          <button
            type="button"
            className="game-tile is-active"
            onClick={() => setPage('lobby')}
            title="ESF · 龙珠"
          >
            <img src={dragonBall} alt="ESF" />
          </button>
          <button
            type="button"
            className={`game-tile game-tile--tool${mapOpen ? ' is-active' : ''}`}
            onClick={() => setMapOpen((value) => !value)}
            title="地图库"
          >
            <Icon name="map" size={18} />
            <small>地图</small>
          </button>
          <span className="game-rail-spacer" />
          <button type="button" className="game-tile game-tile--tool" onClick={openSettings} title="设置">
            <Icon name="settings" size={17} />
          </button>
          <button
            type="button"
            className="game-tile game-tile--tool game-tile--danger"
            onClick={onLogout}
            title="退出登录"
          >
            <Icon name="logout" size={17} />
          </button>
        </aside>

        {mapOpen && (
          <button
            type="button"
            className="map-drawer-backdrop"
            aria-label="关闭地图库"
            onClick={() => setMapOpen(false)}
          />
        )}

        <aside className={`sidebar map-drawer${mapOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="map-drawer-close"
            aria-label="关闭地图库"
            onClick={() => setMapOpen(false)}
          >
            <Icon name="close" size={14} />
          </button>

          <div className="side-head">
            <h2>地图库</h2>
            <span className="pill">{maps.length}</span>
          </div>

          <div className="search">
            <Icon name="search" size={15} />
            <input
              type="text"
              value={mapKeyword}
              placeholder="搜索地图 / 代号"
              onChange={(event) => setMapKeyword(event.target.value)}
            />
          </div>

          <div className="map-filters">
            {MAP_CATEGORIES.map((category) => (
              <button
                key={category.key}
                type="button"
                className={`chip${mapCategory === category.key ? ' is-active' : ''}`}
                onClick={() => setMapCategory(category.key)}
              >
                {category.label}
              </button>
            ))}
          </div>

          <div className="map-scroll">
            {visibleMaps.length === 0 ? (
              <p className="side-empty">
                {maps.length === 0
                  ? '还没有地图，先设置游戏目录'
                  : mapCategory === 'favorites' && favMaps.size === 0
                    ? '还没有收藏地图，点地图右侧的星标收藏'
                    : '没有匹配的地图'}
              </p>
            ) : (
              visibleMaps.map((item) => {
                const isFav = favMaps.has(item.code);
                return (
                  <div
                    key={item.code}
                    className={`map-row map-row--${item.tone}${selectedMap === item.code ? ' is-active' : ''}`}
                    onClick={() => {
                      setSelectedMap(item.code);
                      setMapOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        setSelectedMap(item.code);
                        setMapOpen(false);
                      }
                    }}
                  >
                    <span className="map-icon">
                      <Icon name={item.icon} size={14} />
                    </span>
                    <span className="map-text">
                      <b>{item.name}</b>
                      <small>{item.code}</small>
                    </span>
                    <button
                      type="button"
                      className={`icon-btn icon-btn--xs${isFav ? ' is-on' : ''}`}
                      title={isFav ? '取消收藏' : '收藏地图'}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleMapFav(item.code);
                      }}
                    >
                      <Icon name={isFav ? 'starFill' : 'star'} size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="side-foot">
            <button type="button" className="side-foot-btn" onClick={openSettings}>
              <Icon name="folder" size={14} />
              <span className="side-foot-name">游戏目录</span>
              <code>{hasGameDir ? 'hl.exe' : '未设置'}</code>
              <em>{hasGameDir ? '更换' : '设置'}</em>
            </button>
            <span className="side-count">
              已显示 {visibleMaps.length} / {maps.length} 张
            </span>
          </div>
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
              toast={toast}
              syncedAt={lastSyncAt}
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
              {platformState.maintenance && (
                <div className="maintenance-strip">
                  <Icon name="alert" size={15} />
                  <span>
                    <b>平台维护中</b> · {platformState.maintenanceText || '请稍后再试'}
                  </span>
                </div>
              )}

              {autoUpdate?.status === 'downloaded' && (
                <div className="update-strip update-strip--ready">
                  <Icon name="download" size={15} />
                  <span>
                    新版本 <b>v{autoUpdate.version}</b> 已下载，重启启动器后生效
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => window.electronAPI.update.install()}
                  >
                    立即重启安装
                  </button>
                </div>
              )}

              {autoUpdate &&
                ['checking', 'available', 'downloading'].includes(autoUpdate.status) && (
                  <div className="update-strip update-strip--progress">
                    <Icon name="refresh" size={15} />
                    <div className="update-progress-body">
                      <div className="update-progress-text">
                        <span>
                          {autoUpdate.status === 'checking' && '正在检查更新…'}
                          {autoUpdate.status === 'available' &&
                            `发现 v${autoUpdate.version}，准备下载…`}
                          {autoUpdate.status === 'downloading' &&
                            `正在下载 v${autoUpdate.version} · ${autoUpdate.percent || 0}%`}
                        </span>
                        {autoUpdate.status === 'downloading' && autoUpdate.total > 0 && (
                          <span className="update-progress-size">
                            {(autoUpdate.transferred / 1048576).toFixed(1)} /{' '}
                            {(autoUpdate.total / 1048576).toFixed(1)} MB
                          </span>
                        )}
                      </div>
                      {autoUpdate.status === 'downloading' && (
                        <div className="update-bar">
                          <i style={{ width: `${Math.min(100, autoUpdate.percent || 0)}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {updateInfo?.hasUpdate &&
                !['available', 'downloading', 'downloaded'].includes(autoUpdate?.status) && (
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

              <section className={`hero hero--${selectedMeta.tone}`}>
                <div className="hero-content">
                  <span className="eyebrow">
                    <Icon name="map" size={13} />
                    当前地图
                    <em className="eyebrow-status">{hasGameDir ? '已就绪' : '未就绪'}</em>
                  </span>
                  <h1>{selectedMeta.name}</h1>

                  <div className="hero-tags">
                    <span className="tag">{selectedMeta.categoryLabel}</span>
                    <span className="tag tag--code">{selectedMap || '未选择'}</span>
                    <span className="tag">本地开图</span>
                    <span className="tag">平台身份校验</span>
                  </div>

                  <div className="hero-actions">
                    <button type="button" className="btn btn-primary btn-lg" onClick={startLocal} disabled={localBusy}>
                      {localBusy ? <span className="spinner" /> : <Icon name="play" size={16} />}
                      {localBusy ? '启动中…' : '开始游戏'}
                      <kbd className="btn-kbd">Enter</kbd>
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

              <section className="section">
                <div className="section-head">
                  <h2>
                    在线房间 <span className="pill">{onlineServers.length}</span>
                  </h2>

                  <div className="section-head-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      title="刷新房间列表"
                      onClick={refreshServers}
                      disabled={serversLoading}
                    >
                      <Icon name="refresh" size={14} />
                    </button>
                    <button type="button" className="link" onClick={() => setPage('servers')}>
                      全部 <Icon name="chevronRight" size={13} />
                    </button>
                  </div>
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
                    syncedAt={lastSyncAt}
                  />
                )}
              </section>


              <section className="feed">
                <div className="feed-col">
                  <div className="section-head">
                    <h2>平台公告</h2>
                    <span className="tag">公开</span>
                  </div>

                  <ul className="feed-list">
                    <li className="feed-item">
                      <span className="feed-tag feed-tag--notice">公告</span>
                      <div>
                        <b>{platformState.notice || '平台已接入真实账号与连服凭证'}</b>
                        <small>进入游戏后自动完成身份校验</small>
                      </div>
                    </li>

                    {updateInfo?.hasUpdate && (
                      <li className="feed-item">
                        <span className="feed-tag feed-tag--update">更新</span>
                        <div>
                          <b>新版本 v{updateInfo.latest} 已发布</b>
                          <small>在「设置 → 关于」里检查更新</small>
                        </div>
                      </li>
                    )}

                    <li className="feed-item">
                      <span className="feed-tag">提示</span>
                      <div>
                        <b>点房间行可展开实时玩家</b>
                        <small>玩家名 / 分数 / 在线时长，来自 A2S 查询</small>
                      </div>
                    </li>

                    <li className="feed-item">
                      <span className="feed-tag">功能</span>
                      <div>
                        <b>大厅频道与在线状态已上线</b>
                        <small>每 20 秒心跳，游戏中会自动标记地图</small>
                      </div>
                    </li>
                  </ul>

                  <p className="feed-foot">
                    <span>公告由管理员在大厅维护</span>
                    <Icon name="bell" size={12} />
                  </p>
                </div>

                <div className="feed-col">
                  <div className="section-head">
                    <h2>最近上架</h2>
                    <button type="button" className="link" onClick={() => setPage('assets')}>
                      资源库 <Icon name="chevronRight" size={13} />
                    </button>
                  </div>

                  {recentAssets.length === 0 ? (
                    <p className="admin-muted">还没有上架资源，作者上传并通过审核后会出现在这里。</p>
                  ) : (
                    <ul className="feed-list">
                      {recentAssets.slice(0, 4).map((asset) => (
                        <li key={asset.id} className="feed-item">
                          {asset.coverUrl && (
                            <img
                              className="feed-thumb"
                              src={assetUrl(asset.coverUrl)}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <span className="feed-tag feed-tag--asset">
                            {asset.kind === 'model' ? '模型' : asset.kind === 'sound' ? '声音' : '资源'}
                          </span>
                          <div>
                            <b>{asset.name}</b>
                            <small>
                              v{asset.version} · {formatRelative(asset.createdAt)}
                              {asset.authorName ? ` · ${asset.authorName}` : ''}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="feed-foot">
                    <span>共 {recentAssets.length} 个已上架资源</span>
                    <button type="button" className="link" onClick={() => setPage('assets')}>
                      查看全部 <Icon name="chevronRight" size={12} />
                    </button>
                  </p>
                </div>
              </section>




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

              {staff && (
                <div className="profile-strip">
                  <span>
                    待审 <b>{adminSummary ? adminSummary.assets.pending : '—'}</b>
                  </span>
                  <span>
                    今日 <b>{adminSummary ? adminSummary.sessions.today : '—'}</b>
                  </span>
                  <button type="button" className="link" onClick={() => setPage('admin')}>
                    管理台 <Icon name="chevronRight" size={12} />
                  </button>
                </div>
              )}

              {user?.role === 'creator' && (
                <button type="button" className="link profile-strip profile-strip--link" onClick={() => setPage('assets')}>
                  作者中心 · 上传资源 <Icon name="chevronRight" size={12} />
                </button>
              )}
            </section>

            <PresencePanel
              user={user}
              backend={backend}
              hasGameDir={hasGameDir}
              settings={settings}
              serversCount={servers.length}
              updateInfo={updateInfo}
            />

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
        {staff && (
          <span className="status-item">
            <Icon name="wifi" size={12} /> {settings?.apiBaseUrl || '—'}
          </span>
        )}
        <span className="status-spacer" />
        <button
          type="button"
          className="link status-help"
          onClick={() => toast('排错顺序：后端是否启动 → MySQL 3307 → AMXX 日志', 'ok')}
        >
          <Icon name="help" size={12} /> 帮助中心
        </button>
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
