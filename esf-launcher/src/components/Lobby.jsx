import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TitleBar from './TitleBar';
import Icon from './Icon';
import ServerHall from './ServerHall';
import SettingsDrawer from './SettingsDrawer';
import AdminPanel from './AdminPanel';
import AssetLibrary from './AssetLibrary';
import MemberSidebar from './MemberSidebar';
import ChatPanel from './ChatPanel';
import RadarBadge from './RadarBadge';
import RankedPage from './RankedPage';
import ChallengePage from './ChallengePage';
import PluginsPage from './PluginsPage';
import ChallengeResultModal from './ChallengeResultModal';
import ReleasesModal from './ReleasesModal';
import ServerRoomList from './ServerRoomList';
import { MAP_CATEGORIES, mapCatalog, mapMeta } from '../lib/maps';
import { DEFAULT_RANKS, normalizeRanks, rankLabel } from '../lib/ranks';
import { playSfx } from '../lib/sfx';
import dragonBall from '../assets/dragon-ball.webp';
import {
  isStaff,
  loadFavoriteSet,
  saveFavoriteSet,
} from '../lib/format';

const FAV_SERVERS = 'esf:favServers';
const FAV_MAPS = 'esf:favMaps';
const LOCAL_MODE_KEY = 'esf:localMode';

// 上次选的模式记在本地，下次进平台直接沿用
function readLocalMode() {
  try {
    return localStorage.getItem(LOCAL_MODE_KEY) === 'deathmatch' ? 'deathmatch' : 'team';
  } catch {
    return 'team';
  }
}
export default function Lobby({
  user,
  settings,
  appInfo,
  backend,
  notice,
  toast,
  onSettingsChanged,
  onLogout,
  onAvatarChange,
  onAvatarData,
  onGameNameChange,
}) {
  const [page, setPage] = useState('lobby');
  const [maps, setMaps] = useState([]);
  const [mapKeyword, setMapKeyword] = useState('');
  const [mapCategory, setMapCategory] = useState('all');
  const [selectedMap, setSelectedMap] = useState('');
  const initialMapRef = useRef(settings?.lastMap || '');
  const [localMode, setLocalMode] = useState(readLocalMode);
  const [coins, setCoins] = useState(Number(user?.coins || 0));
  const [mapOpen, setMapOpen] = useState(false);
  const [servers, setServers] = useState([]);
  const [titles, setTitles] = useState([]);
  const [chatUnread, setChatUnread] = useState(0);
  const lastReadRef = useRef(Number(localStorage.getItem('esf:chat:lastRead') || 0));
  const [serversLoading, setServersLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [joinBusyKey, setJoinBusyKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [releasesOpen, setReleasesOpen] = useState(false);
  const [favServers, setFavServers] = useState(() => loadFavoriteSet(FAV_SERVERS));
  const [favMaps, setFavMaps] = useState(() => loadFavoriteSet(FAV_MAPS));
  const [combatRanks, setCombatRanks] = useState(DEFAULT_RANKS);
  const [challengeResult, setChallengeResult] = useState(null);
  const autoJoinRef = useRef(null);
  const joinServerRef = useRef(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [releaseNotice, setReleaseNotice] = useState(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
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

  const loadTitles = useCallback(async () => {
    try {
      const data = await window.electronAPI.titles.list();
      setTitles(Array.isArray(data?.titles) ? data.titles : []);
    } catch {
      setTitles([]);
    }
  }, []);

  const loadRanks = useCallback(async () => {
    try {
      const data = await window.electronAPI.ranks?.list();
      if (Array.isArray(data?.ranks)) setCombatRanks(normalizeRanks(data.ranks));
    } catch {
      /* 配置接口不可用时保留默认等级 */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步读取后台等级配置后落地
    loadRanks();
  }, [loadRanks]);

  useEffect(() => {
    let alive = true;
    const checkResult = async () => {
      try {
        const data = await window.electronAPI.challenges?.state();
        if (!alive) return;
        const room = data?.myRoom;
        if (room?.status === 'live' && room.server) {
          const roomId = String(room.id);
          if (autoJoinRef.current !== roomId) {
            autoJoinRef.current = roomId;
            joinServerRef.current?.(room.server);
          }
        } else if (!room) {
          autoJoinRef.current = null;
        }
        const result = data?.lastResult;
        if (!result?.roomId) return;
        const seen = localStorage.getItem('esf:seenChallengeResult');
        if (String(result.roomId) !== seen) {
          // 只对刚结束的比赛强制收游戏，避免启动器翻出 2 小时内的旧结果误杀新进程。
          const endedAt = result.endedAt ? new Date(result.endedAt).getTime() : 0;
          const fresh = endedAt > 0 && Date.now() - endedAt < 10 * 60 * 1000;
          if (fresh) {
            try {
              await window.electronAPI.launch.stop();
            } catch {
              /* 游戏已退出或进程关闭失败时仍展示结果 */
            }
          }
          if (alive) setChallengeResult(result);
        }
      } catch {
        /* 平台或网络不可用时静默 */
      }
    };
    checkResult();
    const timer = window.setInterval(checkResult, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const dismissChallengeResult = () => {
    if (challengeResult?.roomId) {
      localStorage.setItem('esf:seenChallengeResult', String(challengeResult.roomId));
    }
    setChallengeResult(null);
  };

  useEffect(() => {
    let alive = true;
    window.electronAPI.titles
      .list()
      .then((data) => {
        if (alive) setTitles(Array.isArray(data?.titles) ? data.titles : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let initialized = lastReadRef.current > 0;

    const tick = async () => {
      try {
        const data = await window.electronAPI.chat.list(0);
        if (!alive) return;
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const maxId = messages.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);

        if (!initialized) {
          lastReadRef.current = maxId;
          localStorage.setItem('esf:chat:lastRead', String(maxId));
          initialized = true;
          setChatUnread(0);
          return;
        }

        if (activePage === 'channel') {
          lastReadRef.current = Math.max(lastReadRef.current, maxId);
          localStorage.setItem('esf:chat:lastRead', String(lastReadRef.current));
          setChatUnread(0);
          return;
        }

        setChatUnread(messages.filter((item) => Number(item.id) > lastReadRef.current).length);
      } catch {
        /* 未读统计失败不影响主流程 */
      }
    };

    tick();
    const timer = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activePage]);

  useEffect(() => {
    window.electronAPI.maps
      .scan()
      .then((list) => {
        setMaps(list);
        // 本地地图记忆：优先上次选择，其次第一张
        setSelectedMap((current) => {
          if (current) return current;
          const saved = initialMapRef.current;
          return (saved && list.includes(saved) ? saved : list[0]) || '';
        });
      })
      .catch(() => setMaps([]));
  }, []);

  const selectMap = useCallback(
    (code) => {
      setSelectedMap(code);
      if (!code || settings?.lastMap === code) return;
      window.electronAPI.settings
        .update({ lastMap: code })
        .then((next) => onSettingsChanged?.(next))
        .catch(() => {});
    },
    [settings?.lastMap, onSettingsChanged]
  );

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

  // 版本更新公告：每个版本只在首次进入大厅时弹一次，管理员公告仍在公告栏独立展示
  useEffect(() => {
    const version = String(updateInfo?.latest || '').trim();
    if (!version) return;
    if (localStorage.getItem('esf:seenReleaseVersion') === version) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首次登录时根据更新配置弹出公告
    setReleaseNotice({
      version,
      current: updateInfo?.current || appInfo?.version || '',
      notes:
        String(updateInfo?.releaseNotes || '').trim() ||
        '本次更新包含新功能、体验优化与稳定性修复。',
      downloadUrl: updateInfo?.downloadUrl || '',
      hasUpdate: Boolean(updateInfo?.hasUpdate),
    });
  }, [updateInfo, appInfo?.version]);

  const dismissReleaseNotice = () => {
    if (releaseNotice?.version) {
      localStorage.setItem('esf:seenReleaseVersion', releaseNotice.version);
    }
    setReleaseNotice(null);
  };

  const downloadRelease = async () => {
    if (!releaseNotice?.downloadUrl) {
      toast('管理员还没有填写下载地址，请稍后再试或联系服主', 'ok');
      return;
    }
    try {
      await window.electronAPI.shell.openExternal(releaseNotice.downloadUrl);
      dismissReleaseNotice();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // 收藏服务器以服务端为准：换设备也能同步；请求失败时继续用本地缓存
  useEffect(() => {
    let alive = true;
    const request = window.electronAPI.favorites?.list();
    request
      ?.then((data) => {
        if (!alive || !Array.isArray(data?.serverKeys)) return;
        const next = new Set(data.serverKeys);
        setFavServers(next);
        saveFavoriteSet(FAV_SERVERS, next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
  useEffect(() => {
    let alive = true;
    window.electronAPI.economy
      .summary()
      .then((data) => {
        if (alive && data?.wallet) setCoins(Number(data.wallet.coins || 0));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 在线心跳：进入大厅立刻报一次，之后每 12 秒一次（主进程判断游戏是否在跑）
  useEffect(() => {
    const ping = async () => {
      try {
        const data = await window.electronAPI.presence.ping();
        if (data?.wallet) setCoins(Number(data.wallet.coins || 0));
        window.dispatchEvent(new Event('esf:presence'));
      } catch {
        /* 心跳失败下一轮再试 */
      }
    };

    ping();
    const boot = setTimeout(ping, 500);
    const timer = setInterval(ping, 12000);

    const refresh = () => {
      if (document.visibilityState === 'visible') ping();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearTimeout(boot);
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
  const offlineServers = useMemo(() => servers.filter((server) => !server.online), [servers]);
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

  const platformNotice = String(platformState.notice || '').trim();
  // 公告首句（一般带版本号）单独提亮，剩下的正文压成正文色，读起来不糊成一片
  const noticeParts = useMemo(() => {
    const text = platformNotice || '平台已接入真实账号与连服凭证，进入游戏后自动完成身份校验。';
    const hit = text.match(/^(.{1,26}?)[：:]/);
    if (!hit) return { lead: '', body: text };
    return { lead: hit[1], body: text.slice(hit[0].length) };
  }, [platformNotice]);
  // 公告折叠按"实际有没有被两行裁掉"判断，而不是数字符：
  // 1180 宽下卡片更窄，同样长度的公告会多出一行，数字符会漏掉这种情况。
  const [noticeExpandable, setNoticeExpandable] = useState(false);
  const noticeTextRef = useRef(null);

  useEffect(() => {
    const element = noticeTextRef.current;
    if (!element || noticeOpen) return undefined;
    // -webkit-line-clamp 下 scrollHeight 也只剩两行，量不出来；
    // 先记下裁切后的高度，再临时取消裁切读完整高度，最后还原。
    const measure = () => {
      const clampedHeight = element.clientHeight;
      element.classList.add('is-measuring');
      const fullHeight = element.scrollHeight;
      element.classList.remove('is-measuring');
      setNoticeExpandable(fullHeight - clampedHeight > 2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [platformNotice, noticeOpen]);

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

  const toggleServerFav = (key) => {
    const next = new Set(favServers);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFavServers(next);
    saveFavoriteSet(FAV_SERVERS, next);
    window.electronAPI.favorites
      ?.set([...next])
      ?.catch((err) => {
        toast(`收藏同步失败：${err.message}`, 'error');
      });
  };
  const toggleMapFav = toggleFavorite(setFavMaps, FAV_MAPS);

  const favoriteServers = useMemo(
    () => servers.filter((server) => favServers.has(server.serverKey)),
    [servers, favServers]
  );

  // 收藏服优先展示"在线的那一台"，都离线时退回第一个，保证快捷卡永远有内容
  const favoriteTop = useMemo(() => {
    if (favoriteServers.length === 0) return null;
    return favoriteServers.find((server) => server.online) || favoriteServers[0];
  }, [favoriteServers]);

  const ensureGameDir = () => {
    if (hasGameDir) return true;
    setSettingsOpen(true);
    toast('请先选择游戏目录', 'error');
    return false;
  };

  const startLocal = async () => {
    playSfx('click');
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
      const result = await window.electronAPI.launch.local(selectedMap, localMode);
      toast(
        result.switched
          ? `已重启游戏并切换到本地${result.mode === 'deathmatch' ? '混战' : '组队'}模式`
          : `已启动本地游戏：${result.map} · ${result.mode === 'deathmatch' ? '混战' : '组队'}`,
        'ok'
      );
      window.electronAPI.presence.ping().catch(() => {});
      refreshStats();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLocalBusy(false);
    }
  };

  const joinServer = async (server) => {
    playSfx('click');
    if (platformState.maintenance) {
      toast(platformState.maintenanceText || '平台维护中，请稍后再试', 'error');
      return;
    }
    if (!ensureGameDir()) return;
    if (server.mode === '新手' && Number(user?.combatLevel || 0) > 0) {
      toast('你已有格斗等级，不能进入新手房', 'error');
      return;
    }

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
        result.switched
          ? `已重启游戏并切换到 ${result.address}`
          : server.custom
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
  useEffect(() => {
    joinServerRef.current = joinServer;
  });

  const spectateServer = async (server) => {
    if (platformState.maintenance) {
      toast(platformState.maintenanceText || '平台维护中，请稍后再试', 'error');
      return;
    }
    if (!ensureGameDir() || !server?.serverKey) return;
    setJoinBusyKey(server.serverKey);
    try {
      if (server.challenge?.id) {
        await window.electronAPI.challenges.spectate(server.challenge.id);
      }
      const result = await window.electronAPI.launch.spectate({
        serverKey: server.serverKey,
        ip: server.ip,
        port: server.port,
      });
      toast(`正在以观战模式进入 ${result.address}`, 'ok');
      window.electronAPI.presence.ping().catch(() => {});
      setTimeout(() => refreshServers({ silent: true }), 5000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setJoinBusyKey('');
    }
  };

  const queueServer = async (server) => {
    if (!server?.serverKey) return;
    setJoinBusyKey(server.serverKey);
    try {
      const data = await window.electronAPI.challenges.queueJoin(server.serverKey);
      const me = (data.entries || []).find((entry) => entry.mine);
      toast(
        me
          ? `已排队，第 ${me.position} 位${me.priority === 'ranked' ? '（排位优先）' : ''}`
          : '已加入排队',
        'ok'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setJoinBusyKey('');
    }
  };

  const pickRandomMap = () => {
    if (maps.length === 0) return;
    playSfx('click');
    const pool = maps.filter((map) => map !== selectedMap);
    const next = pool.length ? pool[Math.floor(Math.random() * pool.length)] : maps[0];
    selectMap(next);
  };

  const switchLocalMode = (mode) => {
    if (mode === localMode) return;
    playSfx('tab');
    setLocalMode(mode);
    try {
      localStorage.setItem(LOCAL_MODE_KEY, mode);
    } catch {
      /* 读写失败就用默认值，不影响开局 */
    }
  };

  const openSettings = () => setSettingsOpen(true);

  const memberCollapsed = settings?.memberPanelCollapsed === true;
  const toggleMemberPanel = async () => {
    const next = await window.electronAPI.settings.update({
      memberPanelCollapsed: !memberCollapsed,
    });
    onSettingsChanged?.(next);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'm') return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      event.preventDefault();
      window.electronAPI.settings
        .update({ memberPanelCollapsed: !(settings?.memberPanelCollapsed === true) })
        .then((next) => onSettingsChanged?.(next));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings?.memberPanelCollapsed, onSettingsChanged]);

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
        coins={coins}
        online={onlineServers.length}
        onOpenSettings={openSettings}
      />

      <div className={`workspace${['servers', 'assets', 'admin', 'ranked', 'challenges', 'plugins'].includes(activePage) ? ' workspace--wide' : ''}${memberCollapsed ? ' workspace--members-collapsed' : ''}`}>
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
          <button
            type="button"
            className={`game-tile game-tile--tool${activePage === 'channel' ? ' is-active' : ''}`}
            onClick={() => setPage(activePage === 'channel' ? 'lobby' : 'channel')}
            title={activePage === 'channel' ? '返回大厅' : '频道'}
          >
            <Icon name="bell" size={18} />
            <small>{activePage === 'channel' ? '返回' : '频道'}</small>
            {chatUnread > 0 && (
              <span className="game-badge">{chatUnread > 99 ? '99+' : chatUnread}</span>
            )}
          </button>
          <button
            type="button"
            className={`game-tile game-tile--tool${activePage === 'plugins' ? ' is-active' : ''}`}
            onClick={() => setPage(activePage === 'plugins' ? 'lobby' : 'plugins')}
            title={activePage === 'plugins' ? '返回大厅' : '插件中心'}
          >
            <Icon name="plug" size={18} />
            <small>{activePage === 'plugins' ? '返回' : '插件'}</small>
          </button>
          <span className="game-rail-spacer" />
          <RadarBadge
            backend={backend}
            hasGameDir={hasGameDir}
            settings={settings}
            serversOnline={onlineServers.length}
            updateInfo={updateInfo}
          />
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
                      selectMap(item.code);
                      setMapOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        selectMap(item.code);
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
          {activePage === 'ranked' ? (
            <RankedPage user={user} toast={toast} servers={servers} />
          ) : activePage === 'challenges' ? (
            <ChallengePage
              user={user}
              toast={toast}
              servers={servers}
              maps={maps}
              ranks={combatRanks}
              onJoinServer={joinServer}
            />
          ) : activePage === 'plugins' ? (
            <PluginsPage settings={settings} toast={toast} />
          ) : activePage === 'channel' ? (
            <div className="channel-page">
              <div className="channel-page-bar">
                <button type="button" className="channel-back" onClick={() => setPage('lobby')}>
                  ← 返回大厅
                </button>
                <div className="channel-title">
                  <b># 大厅频道</b>
                  <small>全服玩家实时聊天 · 组队、约战、反馈都在这里</small>
                </div>
                <span className="channel-online">全服公开</span>
              </div>
              <ChatPanel user={user} toast={toast} titles={titles} showIntro />
            </div>
          ) : activePage === 'servers' ? (
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
              currentUserId={user?.id}
              onOpenRanked={() => setPage('ranked')}
              onSpectate={spectateServer}
              onQueue={queueServer}
              onOpenChallenge={() => setPage('challenges')}
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
              titles={titles}
              onTitlesChanged={loadTitles}
              onRanksChanged={loadRanks}
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
                    {autoUpdate.status === 'downloading' && (
                      <div className="update-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => window.electronAPI.update.pause().catch(() => {})}
                        >
                          暂停
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => window.electronAPI.update.dismiss().catch(() => {})}
                        >
                          关闭
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {autoUpdate?.status === 'paused' && (
                <div className="update-strip update-strip--progress">
                  <Icon name="pause" size={15} />
                  <span>
                    更新 <b>v{autoUpdate.version}</b> 已暂停
                    {autoUpdate.transferred > 0 && autoUpdate.total > 0
                      ? ` · ${(autoUpdate.transferred / 1048576).toFixed(1)} / ${(autoUpdate.total / 1048576).toFixed(1)} MB`
                      : ''}
                  </span>
                  <div className="update-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => window.electronAPI.update.resume().catch(() => {})}
                    >
                      继续更新
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => window.electronAPI.update.dismiss().catch(() => {})}
                    >
                      关闭
                    </button>
                  </div>
                </div>
              )}

              {updateInfo?.hasUpdate &&
                !['available', 'downloading', 'downloaded', 'paused', 'dismissed'].includes(autoUpdate?.status) && (
                <div className="update-strip update-strip--release">
                  <Icon name="spark" size={15} />
                  <span>
                    新版本 <b>v{updateInfo.latest}</b> 已发布
                    <em className="update-strip-note"> · 更新说明与下载</em>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setReleaseNotice((prev) => prev || {
                        version: updateInfo.latest,
                        current: updateInfo.current,
                        notes: updateInfo.releaseNotes || '本次更新包含新功能、体验优化与稳定性修复。',
                        downloadUrl: updateInfo.downloadUrl || '',
                        hasUpdate: Boolean(updateInfo.hasUpdate),
                      });
                    }}
                  >
                    查看更新
                  </button>
                </div>
              )}

              {releaseNotice && (
                <div className="update-modal-backdrop" onClick={dismissReleaseNotice}>
                  <section
                    className="update-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="release-modal-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="update-modal-head">
                      <div>
                        <span className="update-modal-kicker">
                          <Icon name="spark" size={12} /> VERSION UPDATE
                        </span>
                        <h2 id="release-modal-title">平台已更新至 v{releaseNotice.version}</h2>
                        <p>本次版本带来新的平台能力，进入大厅即可使用。</p>
                      </div>
                      <button
                        type="button"
                        className="update-modal-close"
                        onClick={dismissReleaseNotice}
                        aria-label="关闭更新说明"
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                    <div className="update-modal-body">
                      <div className="update-modal-notes">{releaseNotice.notes}</div>
                      <div className="update-modal-meta">
                        <span>当前版本 <b>v{releaseNotice.current || appInfo?.version || '—'}</b></span>
                        <span>最新版本 <b>v{releaseNotice.version}</b></span>
                      </div>
                      <div className="update-modal-actions">
                        {releaseNotice.hasUpdate ? (
                          <>
                            <button type="button" className="btn btn-primary" onClick={downloadRelease}>
                              <Icon name="download" size={15} /> 去下载
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={dismissReleaseNotice}>
                              稍后
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-primary" onClick={dismissReleaseNotice}>
                            进入大厅
                          </button>
                        )}
                      </div>
                      <div className="update-modal-foot">版本更新提示每个版本仅展示一次</div>
                    </div>
                  </section>
                </div>
              )}

              <section className="quick-cards">
                <div className="quick-card quick-card--fav">
                  <div className="quick-card-head">
                    <span className="quick-card-title">
                      <Icon name="starFill" size={13} /> 我的收藏服
                    </span>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        playSfx('tab');
                        setPage('servers');
                      }}
                    >
                      管理 <Icon name="chevronRight" size={12} />
                    </button>
                  </div>

                  {!favoriteTop ? (
                    <button
                      type="button"
                      className="quick-card-body quick-card-body--empty"
                      onClick={() => {
                        playSfx('tab');
                        setPage('servers');
                      }}
                    >
                      <span className="quick-card-info">
                        <b>还没有收藏服务器</b>
                        <small>去服务器页点星标，收藏会出现在这里</small>
                      </span>
                      <Icon name="chevronRight" size={14} className="quick-card-chev" />
                    </button>
                  ) : (
                    <div className="quick-card-body">
                      <span className="quick-card-info">
                        <b>
                          <i className={`quick-card-dot${favoriteTop.online ? ' is-online' : ''}`} />
                          {favoriteTop.name}
                        </b>
                        <small>
                          {favoriteTop.online
                            ? `${favoriteTop.players}/${favoriteTop.maxPlayers} 人 · ${favoriteTop.ping || 0}ms · ${favoriteTop.map || '未知地图'}`
                            : `当前离线${favoriteServers.length > 1 ? ` · 共 ${favoriteServers.length} 个收藏` : ''}`}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary quick-card-go"
                        disabled={!favoriteTop.online || joinBusyKey === favoriteTop.serverKey}
                        onClick={() => joinServer(favoriteTop)}
                        title={favoriteTop.online ? `进入 ${favoriteTop.name}` : '服务器当前离线'}
                      >
                        {joinBusyKey === favoriteTop.serverKey ? <span className="spinner" /> : '进入'}
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="quick-card quick-card--ranked"
                  onClick={() => {
                    playSfx('tab');
                    setPage('ranked');
                  }}
                >
                  <span className="quick-card-head">
                    <span className="quick-card-title">
                      <Icon name="trophy" size={13} /> 天梯排位
                    </span>
                    <Icon name="chevronRight" size={14} className="quick-card-chev" />
                  </span>
                  <span className="quick-card-body">
                    <span className="quick-card-info">
                      <b>
                        {rankLabel(combatRanks, user?.combatLevel)} · {stats?.sessions ?? 0} 场
                      </b>
                      <small>1v1 / 2v2 · 快速匹配</small>
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="quick-card quick-card--challenge"
                  onClick={() => {
                    playSfx('tab');
                    setPage('challenges');
                  }}
                >
                  <span className="quick-card-head">
                    <span className="quick-card-title">
                      <Icon name="swords" size={13} /> 约战大厅
                    </span>
                    <Icon name="chevronRight" size={14} className="quick-card-chev" />
                  </span>
                  <span className="quick-card-body">
                    <span className="quick-card-info">
                      <b>开房邀请</b>
                      <small>自定义规则 · 不计分不锁服</small>
                    </span>
                  </span>
                </button>
              </section>

              <section className={`hero hero--${selectedMeta.tone} hero--mode-${localMode}`}>
                <span className="hero-art" aria-hidden="true" />
                <span className="hero-mask" aria-hidden="true" />

                <div className="hero-content">
                  <span className="eyebrow">
                    <Icon name="map" size={13} />
                    <b>当前地图</b>
                    <em className={`eyebrow-status${hasGameDir ? '' : ' is-off'}`}>
                      {hasGameDir ? '已就绪' : '未就绪'}
                    </em>
                    <span className="eyebrow-note">平台身份校验</span>
                  </span>

                  <h1 className="hero-title">{selectedMeta.name}</h1>

                  <div className="hero-tags">
                    <span className="tag tag--code">{selectedMap || '未选择'}</span>
                    <span className="tag">{selectedMeta.categoryLabel}</span>
                    <span className={`tag tag--mode ${localMode === 'team' ? 'tag--team' : 'tag--dm'}`}>
                      <i />
                      {localMode === 'deathmatch' ? '混战模式' : '组队模式'}
                    </span>
                    <span className="tag">本地开图</span>
                  </div>
                </div>

                <div className="hero-foot">
                  <div className="hud">
                    <div className="hud-cell hud-cell--map">
                      <span>地图</span>
                      <b>{maps.length}</b>
                    </div>
                    <div className="hud-cell hud-cell--rooms">
                      <span>在线房间</span>
                      <b>{onlineServers.length}</b>
                    </div>
                    <div className="hud-cell hud-cell--ping">
                      <span>最低延迟</span>
                      <b>
                        {bestPing === null ? '—' : bestPing}
                        {bestPing === null ? '' : <em>ms</em>}
                      </b>
                    </div>
                  </div>

                  <div className="hero-actions">
                    <div className="mode-switch" role="group" aria-label="本地游戏模式">
                      <button
                        type="button"
                        className={localMode === 'team' ? 'is-active' : ''}
                        aria-pressed={localMode === 'team'}
                        onClick={() => switchLocalMode('team')}
                      >
                        <i />
                        组队
                      </button>
                      <button
                        type="button"
                        className={localMode === 'deathmatch' ? 'is-active' : ''}
                        aria-pressed={localMode === 'deathmatch'}
                        onClick={() => switchLocalMode('deathmatch')}
                      >
                        <i />
                        混战
                      </button>
                    </div>
                    <button type="button" className="btn btn-ghost btn-lg" onClick={pickRandomMap}>
                      <Icon name="refresh" size={15} /> 换一张
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-lg hero-cta"
                      onClick={startLocal}
                      disabled={localBusy}
                    >
                      {localBusy ? <span className="spinner" /> : <Icon name="play" size={16} />}
                      {localBusy ? '启动中…' : '开始游戏'}
                      <kbd className="btn-kbd">Enter</kbd>
                    </button>
                  </div>
                </div>
              </section>

              <section className="section">
                {offlineServers.length > 0 && (
                  <div className="server-alert">
                    <Icon name="alert" size={15} />
                    <span>
                      {offlineServers.length} 个服务器当前离线：
                      {offlineServers.map((server) => server.name).join('、')}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => refreshServers()}
                      disabled={serversLoading}
                    >
                      重新检测
                    </button>
                  </div>
                )}

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
                    currentUserId={user?.id}
                    onOpenChallenge={() => setPage('challenges')}
                    onSpectate={spectateServer}
              onQueue={queueServer}
                  />
                )}
              </section>


              <section className="feed feed--compact">
                <div className="feed-col">
                  <div className="section-head">
                    <h2>平台公告</h2>
                    <span className="tag">{platformState.notice ? '管理员发布' : '公开'}</span>
                    <button
                      type="button"
                      className="feed-history"
                      onClick={() => {
                        playSfx('tab');
                        setReleasesOpen(true);
                      }}
                    >
                      版本记录 <Icon name="chevronRight" size={11} />
                    </button>
                    {noticeExpandable && (
                      <button
                        type="button"
                        className="feed-more"
                        onClick={() => setNoticeOpen((value) => !value)}
                      >
                        {noticeOpen ? '收起' : '展开全文'}
                      </button>
                    )}
                  </div>

                  <div className={`feed-notice${noticeOpen ? ' is-open' : ''}`}>
                    <span className="feed-tag feed-tag--notice">
                      {platformNotice ? '公告' : '提示'}
                    </span>
                    <p className="feed-text" ref={noticeTextRef}>
                      {noticeParts.lead && <b className="feed-text-lead">{noticeParts.lead}：</b>}
                      {noticeParts.body}
                    </p>
                  </div>

                  <p className="feed-hint">
                    <em>提示</em> 点房间行可展开实时玩家（A2S）
                    <i>·</i>
                    <em>功能</em> 频道与在线状态每 20 秒心跳
                  </p>

                  <div className="feed-assets">
                    <div className="feed-assets-head">
                      <span className="feed-assets-title">最近上架</span>
                      <button type="button" className="link" onClick={() => setPage('assets')}>
                        资源库 <Icon name="chevronRight" size={12} />
                      </button>
                    </div>

                    {recentAssets.length === 0 ? (
                      <p className="feed-assets-empty">还没有上架资源，作者上传并通过审核后会出现在这里。</p>
                    ) : (
                      <div className="asset-chips">
                        {recentAssets.slice(0, 4).map((asset) => (
                          <button
                            type="button"
                            key={asset.id}
                            className="asset-chip"
                            onClick={() => setPage('assets')}
                            title={`v${asset.version} · ${asset.name}`}
                          >
                            <span className="asset-chip-kind">
                              {asset.kind === 'model' ? '模型' : asset.kind === 'sound' ? '声音' : '资源'}
                            </span>
                            <b>{asset.name}</b>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>




            </>
          )}
        </main>

        <aside className="rail rail--members">
          <MemberSidebar
            user={user}
            titles={titles}
            ranks={combatRanks}
            stats={stats}
            coins={coins}
            staff={staff}
            toast={toast}
            onTitlesChanged={loadTitles}
            onOpenSettings={openSettings}
            onOpenAdmin={() => setPage('admin')}
            collapsed={memberCollapsed}
            onToggleCollapse={toggleMemberPanel}
          />
        </aside>
      </div>

      <footer className="statusbar">
        <span className="status-item">
          <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
          {backend?.ok ? '平台服务在线' : '平台服务离线'}
        </span>
        {staff && (
          <span className="status-item status-item--db">
            <span className={`dot dot--${backend?.db === 'up' ? 'on' : 'off'}`} /> 数据库
          </span>
        )}
        {staff && (
          <span className="status-item status-item--pending">
            待审 {adminSummary ? adminSummary.assets.pending : '—'}
          </span>
        )}
        <span className="status-item">
          <Icon name="server" size={12} /> {onlineServers.length}/{servers.length} 在线
        </span>
        {staff && (
          <span className="status-item status-item--api">
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
        <button
          type="button"
          className="status-version"
          title="查看版本记录"
          onClick={() => {
            playSfx('tab');
            setReleasesOpen(true);
          }}
        >
          v{appInfo?.version || '0.0.0'}
        </button>
      </footer>

      {releasesOpen && (
        <ReleasesModal
          currentVersion={appInfo?.version || ''}
          onClose={() => setReleasesOpen(false)}
        />
      )}

      <ChallengeResultModal
        result={challengeResult}
        onClose={dismissChallengeResult}
        onOpenChallenges={() => {
          dismissChallengeResult();
          setPage('challenges');
        }}
      />

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
          onAvatarData={onAvatarData}
          onGameNameChange={onGameNameChange}
        />
      )}
    </div>
  );
}
