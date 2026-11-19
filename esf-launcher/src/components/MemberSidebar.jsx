import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import Icon from './Icon';
import { roleLabel, formatDuration, formatRelative } from '../lib/format';
import { DEFAULT_RANKS, normalizeRanks, rankFor } from '../lib/ranks';
import { playSfx } from '../lib/sfx';

const ROLE_RANK = { owner: 5, admin: 4, ops: 3, creator: 2, user: 1 };
const ROLE_COLOR = {
  owner: '#FF8A1F',
  admin: '#FF5F6D',
  ops: '#3FD0FF',
  creator: '#A78BFA',
  user: '#94A0B8',
};
const ROLE_ORDER = ['owner', 'admin', 'ops', 'creator', 'user'];
const CARD_WIDTH = 300;

const activityWeight = (member) => {
  if (!member.online) return 9;
  if (member.challenge?.status === 'live') return 2;
  if (member.ranked?.status === 'live') return 2;
  if (member.ranked?.status === 'waiting') return 3;
  if (member.ranked?.status === 'queued') return 4;
  if (member.state === 'ingame') return 2;
  return member.statusText ? 1 : 0;
};

/** Discord 式右侧成员名单：在线优先、离线折叠、详情走浮层 */
export default function MemberSidebar({
  user,
  titles = [],
  ranks = DEFAULT_RANKS,
  stats,
  coins = 0,
  staff,
  toast,
  onTitlesChanged,
  onOpenSettings,
  onOpenAdmin,
  collapsed = false,
  onToggleCollapse,
}) {
  const [members, setMembers] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [menu, setMenu] = useState(null);
  const [roleConfirm, setRoleConfirm] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileAnchor, setProfileAnchor] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const cancelStatusRef = useRef(false);
  const searchRef = useRef(null);
  const cardRef = useRef(null);
  const menuRef = useRef(null);
  const returnFocusRef = useRef(null);
  const profileReqRef = useRef(0);

  const reloadMembers = async () => {
    try {
      const data = await window.electronAPI.members.list();
      setMembers(Array.isArray(data?.members) ? data.members : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  };

  const canManageRoles = user?.role === 'admin' || user?.role === 'owner';
  const selfMember = members.find((item) => Number(item.id) === Number(user?.id));
  const selfStatus = String(selfMember?.statusText || '');

  const saveStatus = async () => {
    if (cancelStatusRef.current) {
      cancelStatusRef.current = false;
      setEditingStatus(false);
      return;
    }
    if (statusSaving) return;
    setStatusSaving(true);
    try {
      await window.electronAPI.members.setStatus(statusDraft);
      await reloadMembers();
      setEditingStatus(false);
      playSfx('click');
      toast?.('状态已更新', 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setStatusSaving(false);
    }
  };

  const beginStatusEdit = () => {
    setStatusDraft(selfStatus);
    cancelStatusRef.current = false;
    setEditingStatus(true);
  };

  const cancelStatusEdit = () => {
    cancelStatusRef.current = true;
    setEditingStatus(false);
  };

  /** 成员行状态：优先自定义状态，其次约战/排位/游戏内自动推导 */
  const activityOf = (member) => {
    if (!member.online) return '离线';
    if (member.statusText) return member.statusText;
    if (member.challenge) {
      const c = member.challenge;
      if (c.status === 'live') {
        return `约战游戏中 · ${c.mode || '1v1'}${c.map ? ` · ${c.map}` : ''}`;
      }
      return c.ready ? '约战中 · 已准备' : '约战中 · 未准备';
    }
    if (member.ranked) {
      const label =
        member.ranked.status === 'queued'
          ? '匹配中'
          : member.ranked.status === 'waiting'
            ? '待准备'
            : '比赛中';
      return `${label} · ${member.ranked.mode}`;
    }
    if (member.state === 'ingame') return member.serverMap || member.serverName || '游戏中';
    return '在大厅';
  };

  const closeProfile = () => {
    profileReqRef.current += 1;
    setProfile(null);
    setZoom(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    window.requestAnimationFrame(() => target?.focus?.());
  };

  const openProfile = async (member, event) => {
    const requestId = profileReqRef.current + 1;
    profileReqRef.current = requestId;
    setZoom(false);
    setProfile({ ...member });
    returnFocusRef.current = event?.currentTarget || document.activeElement;
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    const fallback = document.querySelector('.rail--members')?.getBoundingClientRect();
    const anchorLeft = rect?.left ?? fallback?.left ?? window.innerWidth - 340;
    const anchorTop = rect?.top ?? 90;
    const cardHeight = Math.min(440, window.innerHeight - 110);
    setProfileAnchor({
      left: Math.max(12, anchorLeft - CARD_WIDTH - 14),
      top: Math.max(58, Math.min(anchorTop - 8, window.innerHeight - cardHeight - 20)),
    });
    try {
      const data = await window.electronAPI.members.detail(member.id);
      if (data?.member && profileReqRef.current === requestId) {
        setProfile((prev) => {
          if (!prev || profileReqRef.current !== requestId) return prev;
          const merged = { ...prev, ...data.member };
          if (prev.ranked && !data.member.ranked) merged.ranked = prev.ranked;
          return merged;
        });
      }
    } catch {
      // 详情接口不可用时，staff 用管理台账号数据补战绩
      try {
        const data = await window.electronAPI.admin.users({ q: member.username, limit: 5 });
        const row = (data?.users || []).find((item) => Number(item.id) === Number(member.id));
        if (row && profileReqRef.current === requestId) {
          setProfile((prev) =>
            prev && profileReqRef.current === requestId
              ? {
                  ...prev,
                  sessions: row.sessions,
                  totalSeconds: row.totalSeconds,
                  createdAt: row.createdAt,
                  lastLoginAt: row.lastLoginAt,
                }
              : prev
          );
        }
      } catch {
        // 普通玩家看不到战绩就先显示基础资料
      }
    }
  };

  const openMenuAt = (member, x, y) => {
    if (!staff) return;
    const isSelf = Number(member.id) === Number(user?.id);
    if (!isSelf && member.role === 'owner') return;
    setRoleConfirm(null);
    setMenu({
      member,
      isSelf,
      x: Math.max(12, Math.min(x, window.innerWidth - 244)),
      y: Math.max(12, Math.min(y, window.innerHeight - 440)),
    });
  };

  const openMenu = (event, member) => {
    if (!staff) return;
    event.preventDefault();
    openMenuAt(member, event.clientX, event.clientY);
  };

  const closeMenu = () => {
    setMenu(null);
    setRoleConfirm(null);
  };

  const assignTitle = async (titleId) => {
    const member = menu?.member;
    closeMenu();
    if (!member) return;
    try {
      await window.electronAPI.titles.assign(member.id, titleId);
      await onTitlesChanged?.();
      await reloadMembers();
      toast?.('头衔已更新', 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    }
  };

  const changeRole = async (role) => {
    const member = menu?.member;
    closeMenu();
    if (!member) return;
    try {
      await window.electronAPI.admin.updateUser(member.id, { role });
      await reloadMembers();
      toast?.(`已把 ${member.gameName} 设为${roleLabel(role)}`, 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    }
  };

  const changeCombatLevel = async (level) => {
    const member = menu?.member;
    closeMenu();
    if (!member) return;
    try {
      await window.electronAPI.members.setCombatLevel(member.id, level);
      await reloadMembers();
      const rankName = rankFor(rankList, level).name;
      toast?.(`已把 ${member.gameName} 的格斗等级设为 ${Number(level) === 0 ? '未定级' : rankName}`, 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    }
  };

  const copyName = async (name) => {
    try {
      await navigator.clipboard.writeText(String(name || ''));
      toast?.('昵称已复制', 'ok');
    } catch {
      toast?.('复制失败，请手动选择昵称', 'error');
    }
  };

  useEffect(() => {
    let alive = true;
    let presenceBusy = false;

    const load = async () => {
      try {
        const data = await window.electronAPI.members.list();
        if (!alive) return;
        const list = Array.isArray(data?.members) ? data.members : [];
        setMembers(list);
        setProfile((prev) => {
          if (!prev) return prev;
          const next = list.find((member) => Number(member.id) === Number(prev.id));
          return next ? { ...prev, ...next } : prev;
        });
        setLoadError(false);
      } catch {
        if (alive) setLoadError(true);
      }
    };

    // 轻量状态：800ms 一次，只合并在线/排队/约战字段，不重拉头像与资料。
    const loadPresence = async () => {
      if (presenceBusy) return;
      presenceBusy = true;
      try {
        const data = await window.electronAPI.members.presence();
        if (!alive) return;
        const rows = Array.isArray(data?.members) ? data.members : [];
        if (rows.length === 0) {
          setMembers((prev) => prev.map((member) => ({ ...member, online: false, state: 'offline', ranked: null, challenge: null })));
          setProfile((prev) => (prev
            ? { ...prev, online: false, state: 'offline', ranked: null, challenge: null }
            : prev));
          return;
        }
        const byId = new Map(rows.map((row) => [Number(row.id), row]));
        setProfile((prev) => {
          if (!prev) return prev;
          const next = byId.get(Number(prev.id));
          if (!next) return { ...prev, online: false, state: 'offline', ranked: null, challenge: null };
          const online = Boolean(next.online);
          return {
            ...prev,
            online,
            state: online ? next.state : 'offline',
            serverKey: online ? next.serverKey : null,
            serverName: online ? next.serverName : null,
            serverMap: online ? next.serverMap : null,
            ranked: online ? next.ranked : null,
            challenge: online ? next.challenge : null,
            updatedAt: next.updatedAt,
          };
        });
        setMembers((prev) =>
          prev.map((member) => {
            const next = byId.get(Number(member.id));
            if (!next) return { ...member, online: false, state: 'offline', ranked: null, challenge: null };
            const online = Boolean(next.online);
            return {
              ...member,
              online,
              state: online ? next.state : 'offline',
              serverKey: online ? next.serverKey : null,
              serverName: online ? next.serverName : null,
              serverMap: online ? next.serverMap : null,
              ranked: online ? next.ranked : null,
              challenge: online ? next.challenge : null,
              updatedAt: next.updatedAt,
            };
          })
        );
      } catch {
        /* 轮询失败保留上一份 */
      } finally {
        presenceBusy = false;
      }
    };

    load();
    loadPresence();

    const fullTimer = setInterval(load, 15000);
    const fastTimer = setInterval(loadPresence, 800);
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        loadPresence();
        load();
      }
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('esf:presence', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      alive = false;
      clearInterval(fullTimer);
      clearInterval(fastTimer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('esf:presence', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!profile && !menu) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (menu) closeMenu();
        else closeProfile();
      }
      if (event.key === 'Tab' && profile && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [profile, menu]);

  useEffect(() => {
    if (!profile) return undefined;
    const close = () => closeProfile();
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [profile]);

  const profileId = profile?.id;
  useEffect(() => {
    if (!profileId) return;
    cardRef.current?.querySelector('.member-card-close')?.focus();
  }, [profileId]);

  useEffect(() => {
    if (!menu) return undefined;
    const frame = requestAnimationFrame(() => {
      const target = menuRef.current?.querySelector(
        '.member-menu-confirm .btn-primary, .member-menu-item'
      );
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menu, roleConfirm]);

  const titleById = new Map(titles.map((item) => [Number(item.id), item]));
  const rankList = normalizeRanks(ranks);
  const rankOf = (member) => rankFor(rankList, member?.combatLevel);
  const rankValue = (member) => rankOf(member).sortOrder * 10 + rankOf(member).level;
  const metaOf = (member) => {
    const title = titleById.get(Number(member.titleId));
    if (title) return { label: title.name, color: title.color, rank: Number(title.rank) };
    return {
      label: roleLabel(member.role),
      color: ROLE_COLOR[member.role] || ROLE_COLOR.user,
      rank: (ROLE_RANK[member.role] ?? 0) * 10,
    };
  };

  const needle = keyword.trim().toLowerCase();
  const filtered = members.filter((member) => {
    if (!needle) return true;
    return `${member.gameName} ${member.username}`.toLowerCase().includes(needle);
  });

  const byRole = (list) => {
    const buckets = new Map();
    for (const member of list) {
      const role = ROLE_ORDER.includes(member.role) ? member.role : 'user';
      if (!buckets.has(role)) buckets.set(role, []);
      buckets.get(role).push(member);
    }
    return [...buckets.entries()]
      .sort((a, b) => (ROLE_RANK[b[0]] ?? 0) - (ROLE_RANK[a[0]] ?? 0))
      .map(([role, rows]) => ({
        key: role,
        label: roleLabel(role),
        color: ROLE_COLOR[role] || ROLE_COLOR.user,
        members: rows.sort((a, b) => {
          const activityDiff = activityWeight(a) - activityWeight(b);
          if (activityDiff !== 0) return activityDiff;
          const rankDiff = rankValue(b) - rankValue(a);
          if (rankDiff !== 0) return rankDiff;
          return String(a.gameName || '').localeCompare(String(b.gameName || ''));
        }),
      }));
  };

  const onlineMembers = members.filter((member) => member.online);
  const offlineMembers = members.filter((member) => !member.online);
  const onlineGroups = byRole(onlineMembers);
  const offlineGroups = byRole(offlineMembers);
  const onlineCount = onlineMembers.length;
  const offlineCount = offlineMembers.length;
  const searching = Boolean(needle);
  const searchOffline = filtered.some((member) => !member.online);
  const onlySelfOnline = onlineCount === 1 && Number(onlineMembers[0]?.id) === Number(user?.id);
  const searchResults = [...filtered].sort((a, b) => {
    if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
    const roleDiff = (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0);
    if (roleDiff !== 0) return roleDiff;
    const activityDiff = activityWeight(a) - activityWeight(b);
    if (activityDiff !== 0) return activityDiff;
    const rankDiff = rankValue(b) - rankValue(a);
    if (rankDiff !== 0) return rankDiff;
    return String(a.gameName || '').localeCompare(String(b.gameName || ''));
  });
  const offlineExpanded = offlineOpen;
  const selfTitle = titleById.get(Number(user?.titleId));

  if (collapsed) {
    return (
      <aside className="member-sidebar card is-collapsed">
        <button
          type="button"
          className="member-collapse-btn"
          title="展开成员列表（Ctrl+M）"
          onClick={onToggleCollapse}
        >
          <Icon name="chevronLeft" size={14} />
        </button>
        <span className="member-mini-count" title={`${members.length} 位 · ${onlineCount} 在线`}>
          <span className="dot dot--on" />
          {onlineCount}
        </span>
        <div className="member-mini-list">
          {onlineMembers.slice(0, 10).map((member) => (
            <button
              key={member.id}
              type="button"
              className="member-mini-avatar"
              title={`${member.gameName || member.username} · ${activityOf(member)}`}
              onClick={(event) => openProfile(member, event)}
            >
              <Avatar user={member} size="xs" />
              <span
                className={`member-mini-dot${member.state === 'ingame' ? ' is-ingame' : ''}${member.challenge ? ' is-challenge' : member.ranked ? ' is-ranked' : ''}`}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="member-mini-settings"
          title="我的资料与设置"
          onClick={onOpenSettings}
        >
          <Avatar user={user} size="xs" />
        </button>
      </aside>
    );
  }

  const profileMeta = profile ? metaOf(profile) : null;
  const profileRank = profile ? rankOf(profile) : null;

  const renderGroup = (group, scope) => {
    const groupKey = `${scope}:${group.key}`;
    const isCollapsed = collapsedGroups.has(groupKey);
    return (
      <div className="member-group member-group--v2" key={groupKey}>
        <button
          type="button"
          className="member-group-head member-group-head--v2"
          aria-expanded={!isCollapsed}
          onClick={() => {
            setCollapsedGroups((prev) => {
              const next = new Set(prev);
              if (next.has(groupKey)) next.delete(groupKey);
              else next.add(groupKey);
              return next;
            });
          }}
        >
          <Icon name={isCollapsed ? 'chevronRight' : 'chevron'} size={12} />
          <span className="member-group-dot" style={{ background: group.color }} />
          <span>{group.label}</span>
          <em>{group.members.length}</em>
        </button>
        {!isCollapsed &&
          group.members.map((member) => renderRow(member, { scope, compact: scope === 'offline' }))}
      </div>
    );
  };

  const renderRow = (member, { scope, compact = false } = {}) => {
    const isSelf = Number(member.id) === Number(user?.id);
    const active = Number(profile?.id) === Number(member.id);
    const dotClass = !member.online
      ? ' is-offline'
      : member.challenge
        ? ' is-challenge'
        : member.ranked
          ? ' is-ranked'
          : member.state === 'ingame'
            ? ' is-ingame'
            : '';
    return (
      <div
        key={`${scope}:${member.id}`}
        role="button"
        tabIndex={0}
        aria-label={`${member.gameName}，${activityOf(member)}`}
        data-member-id={member.id}
        className={`member-row member-row--v2${isSelf ? ' is-self' : ''}${member.online ? '' : ' is-offline'}${compact ? ' is-compact' : ''}${active ? ' is-active' : ''}`}
        onContextMenu={(event) => openMenu(event, member)}
        onClick={(event) => {
          playSfx('click');
          openProfile(member, event);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            playSfx('click');
            openProfile(member, event);
          }
        }}
      >
        <span className="member-avatar-wrap">
          <Avatar user={member} size={compact ? 'xs' : 'sm'} />
          <span className={`member-presence-dot${dotClass}`} title={member.online ? '在线' : '离线'} />
        </span>
        <span className="member-row-meta">
          <span className="member-row-name">
            {member.gameName}
            {isSelf ? <em>我</em> : null}
          </span>
          {compact ? null : <span className="member-row-activity">{activityOf(member)}</span>}
        </span>
        {staff ? (
          <button
            type="button"
            className="member-row-more"
            title="管理成员"
            aria-label={`管理 ${member.gameName}`}
            aria-haspopup="menu"
            aria-expanded={Number(menu?.member?.id) === Number(member.id)}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openMenuAt(member, rect.right - 230, rect.top + 4);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Icon name="more" size={14} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="member-sidebar card member-panel">
      <header className="member-panel-head">
        <h3 className="member-panel-title">
          <Icon name="users" size={14} /> 成员
        </h3>
        <span className="member-panel-count" aria-live="polite">
          {searching ? null : <i className={`dot ${onlineCount ? 'dot--on' : 'dot--off'}`} />}
          <b>{searching ? filtered.length : onlineCount}</b>
          <em>
            {searching
              ? `个结果${searchOffline ? ' · 含离线' : ''}`
              : `在线 · ${members.length} 位`}
          </em>
        </span>
        {staff ? (
          <button
            type="button"
            className="member-header-btn"
            title="打开管理台"
            aria-label="打开管理台"
            onClick={onOpenAdmin}
          >
            <Icon name="shield" size={13} />
          </button>
        ) : null}
        <button
          type="button"
          className="member-collapse-btn"
          title="收起成员列表（Ctrl+M）"
          aria-label="收起成员列表"
          onClick={onToggleCollapse}
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </header>

      <div className="member-self member-self--v2">
        <Avatar user={user} size="sm" />
        <div className="member-self-meta">
          <div className="member-self-top">
            <b>{user?.gameName || user?.username}</b>
            {editingStatus ? (
              <input
                className="member-self-status-input"
                type="text"
                value={statusDraft}
                maxLength={48}
                autoFocus
                placeholder="在做什么？最多 48 字"
                onChange={(event) => setStatusDraft(event.target.value)}
                onBlur={() => saveStatus()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    saveStatus();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelStatusEdit();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className={`member-self-status${selfStatus ? '' : ' is-empty'}`}
                title="点击设置我的状态"
                onClick={beginStatusEdit}
              >
                {statusSaving ? '保存中…' : selfStatus || activityOf(selfMember || { online: true })}
              </button>
            )}
          </div>
          <small style={{ color: selfTitle?.color }}>
            {selfTitle ? selfTitle.name : roleLabel(user?.role)}
            {stats ? ` · ${stats.sessions} 场` : ''} · 金币 {coins}
          </small>
        </div>
        <button type="button" className="member-self-gear" title="账号与设置" onClick={onOpenSettings}>
          <Icon name="settings" size={14} />
        </button>
      </div>

      <div className={`member-search member-search--v2${keyword ? ' has-value' : ''}`}>
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          type="text"
          value={keyword}
          placeholder="搜索成员"
          aria-label="搜索成员"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setKeyword('');
              event.currentTarget.blur();
            }
          }}
        />
        {keyword ? (
          <button
            type="button"
            className="member-search-clear"
            title="清除搜索"
            aria-label="清除搜索"
            onClick={() => {
              setKeyword('');
              searchRef.current?.focus();
            }}
          >
            <Icon name="close" size={11} />
          </button>
        ) : null}
      </div>

      <div className="member-scroll member-scroll--v2" onScroll={() => profile && closeProfile()}>
        {loadError ? (
          <div className="member-empty">
            <span className="member-empty-icon"><Icon name="alert" size={20} /></span>
            <b>没能加载成员</b>
            <p>检查网络后重试，列表会保留上一次的数据。</p>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => reloadMembers()}>
              重新加载
            </button>
          </div>
        ) : members.length === 0 ? (
          <div className="member-empty member-empty--loading">
            <span className="member-empty-icon"><Icon name="users" size={20} /></span>
            <b>正在同步成员</b>
            <p>头像与在线状态会很快出现。</p>
          </div>
        ) : searching ? (
          <>
            {filtered.length === 0 ? (
              <div className="member-empty member-empty--compact">
                <span className="member-empty-icon"><Icon name="search" size={18} /></span>
                <b>换个名字试试</b>
                <p>支持游戏名和账号名。</p>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setKeyword('')}>
                  清除搜索
                </button>
              </div>
            ) : (
              searchResults.map((member) => renderRow(member, { scope: 'search' }))
            )}
          </>
        ) : (
          <>
            {onlySelfOnline ? (
              <div className="member-lonely member-lonely--solo">
                <div>
                  <b>现在只有你在</b>
                  <span>开房后把链接发到群里，等他们上线。</span>
                </div>
              </div>
            ) : (
              <section className="member-segment" aria-label={`在线成员 ${onlineCount} 位`}>
                <div className="member-segment-head">
                  <span>在线</span>
                  <em>{onlineCount}</em>
                </div>
                {onlineCount === 0 ? (
                  <div className="member-lonely">
                    <div>
                      <b>现在没人在线</b>
                      <span>离线成员在下方；开房后把链接发到群里，等他们上线。</span>
                    </div>
                  </div>
                ) : onlineGroups.length > 1 ? (
                  onlineGroups.map((group) => renderGroup(group, 'online'))
                ) : (
                  onlineGroups[0]?.members.map((member) => renderRow(member, { scope: 'online' }))
                )}
              </section>
            )}

            <section className="member-segment member-segment--offline" aria-label={`离线成员 ${offlineCount} 位`}>
              <button
                type="button"
                className="member-offline-toggle"
                aria-expanded={offlineExpanded}
                onClick={() => setOfflineOpen((prev) => !prev)}
              >
                <Icon name={offlineExpanded ? 'chevron' : 'chevronRight'} size={12} />
                <span>离线</span>
                <em>{offlineCount}</em>
              </button>
              {offlineExpanded && offlineGroups.map((group) => renderGroup(group, 'offline'))}
            </section>
          </>
        )}
      </div>

      {profile &&
        createPortal(
          <div
            className="member-card-layer"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeProfile();
            }}
          >
            <div
              className="member-card"
              role="dialog"
              aria-modal="true"
              aria-label={`${profile.gameName} 的成员资料`}
              tabIndex={-1}
              ref={cardRef}
              style={{
                left: profileAnchor?.left ?? 12,
                top: profileAnchor?.top ?? 90,
                '--member-color': profileMeta?.color || '#FF8A1F',
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <span className="member-card-glow" aria-hidden="true" />
              <button
                type="button"
                className="member-card-close"
                aria-label="关闭成员资料"
                onClick={closeProfile}
              >
                <Icon name="close" size={13} />
              </button>

              <div className="member-card-head">
                <button
                  type="button"
                  className="member-card-avatar"
                  title={profile.avatarUrl ? '查看大头像' : undefined}
                  onClick={() => profile.avatarUrl && setZoom(true)}
                >
                  <Avatar user={profile} size="lg" />
                </button>
                <div className="member-card-identity">
                  <h3 style={{ color: profileMeta?.color }}>{profile.gameName}</h3>
                  <p>@{profile.username}</p>
                  <span className={`member-card-state${profile.online ? ' is-online' : ''}`}>
                    {profile.online ? '在线' : '离线'}
                  </span>
                </div>
              </div>

              <div className="member-card-badges">
                {profileMeta?.label !== roleLabel(profile.role) ? (
                  <span className="member-chip" style={{ color: profileMeta?.color }}>
                    {profileMeta?.label}
                  </span>
                ) : null}
                <span className="member-chip">{roleLabel(profile.role)}</span>
                <span className="member-chip" style={{ color: profileRank?.color }}>
                  段位 {profileRank?.name || '未定级'}
                </span>
              </div>

              <p className="member-card-activity">
                <span
                  className={`member-presence-dot${profile.online ? '' : ' is-offline'}${profile.challenge ? ' is-challenge' : profile.ranked ? ' is-ranked' : ''}`}
                />
                {activityOf(profile)}
              </p>

              <div className="member-card-stats">
                <div>
                  <b>{profile.sessions ?? '—'}</b>
                  <span>进场次数</span>
                </div>
                <div>
                  <b>{profile.totalSeconds != null ? formatDuration(profile.totalSeconds) : '—'}</b>
                  <span>累计时长</span>
                </div>
              </div>

              <dl className="member-card-info">
                <div>
                  <dt>最近登录</dt>
                  <dd>{profile.lastLoginAt ? formatRelative(profile.lastLoginAt) : '—'}</dd>
                </div>
                <div>
                  <dt>加入时间</dt>
                  <dd>
                    {profile.createdAt
                      ? new Date(profile.createdAt).toLocaleDateString('zh-CN')
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>所在位置</dt>
                  <dd>
                    {profile.online
                      ? (profile.state === 'ingame'
                          ? profile.serverMap || profile.serverName || '游戏中'
                          : '大厅')
                      : '离线'}
                  </dd>
                </div>
                <div>
                  <dt>排位状态</dt>
                  <dd>
                    {profile.ranked
                      ? `${profile.ranked.mode} · ${
                          profile.ranked.status === 'queued'
                            ? '匹配中'
                            : profile.ranked.status === 'waiting'
                              ? '待准备'
                              : '比赛中'
                        }`
                      : '未在排位'}
                  </dd>
                </div>
              </dl>

              <div className="member-card-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => copyName(profile.gameName)}>
                  <Icon name="copy" size={12} /> 复制昵称
                </button>
                {staff && (Number(profile.id) === Number(user?.id) || profile.role !== 'owner') ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      const rect = cardRef.current?.getBoundingClientRect();
                      const member = profile;
                      closeProfile();
                      openMenuAt(member, (rect?.left ?? 320) - 238, (rect?.top ?? 120) + 30);
                    }}
                  >
                    <Icon name="shield" size={12} /> 管理成员
                  </button>
                ) : null}
              </div>
            </div>

            {zoom && profile.avatarUrl && (
              <div
                className="avatar-lightbox"
                onClick={(event) => {
                  event.stopPropagation();
                  setZoom(false);
                }}
              >
                <img src={profile.avatarUrl} alt={`${profile.gameName} 头像`} />
              </div>
            )}
          </div>,
          document.body
        )}

      {menu &&
        createPortal(
          <>
            <button
              type="button"
              className="member-menu-backdrop"
              tabIndex={-1}
              aria-label="关闭成员菜单"
              onClick={closeMenu}
              onContextMenu={(event) => {
                event.preventDefault();
                closeMenu();
              }}
            />
            <div
              className="member-menu"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              ref={menuRef}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const items = [...event.currentTarget.querySelectorAll('.member-menu-item')];
                if (!items.length) return;
                const at = items.indexOf(document.activeElement);
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowDown'
                      ? (at + 1 + items.length) % items.length
                      : (at - 1 + items.length) % items.length;
                items[next].focus();
                event.preventDefault();
              }}
            >
              <div className="member-menu-head">
                <b>{menu.member.gameName}</b>
                <small>@{menu.member.username}</small>
              </div>

              {roleConfirm ? (
                <div className="member-menu-confirm">
                  <b>把 {menu.member.gameName} 设为{roleLabel(roleConfirm)}？</b>
                  <p>
                    {roleConfirm === 'admin'
                      ? '管理员可以封禁玩家、处理资源审核与查看管理台。'
                      : roleConfirm === 'ops'
                        ? '运营可以处理房间与维护，不能改账号权限。'
                        : roleConfirm === 'creator'
                          ? '作者可以上传资源，不能处理账号。'
                          : '普通玩家只能使用大厅、约战与服务器。'}
                  </p>
                  <div>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRoleConfirm(null)}>
                      取消
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => changeRole(roleConfirm)}>
                      确认
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="member-menu-label">授予头衔</div>
                  <button
                    type="button"
                    className={`member-menu-item${!menu.member.titleId ? ' is-current' : ''}`}
                    role="menuitem"
                    onClick={() => assignTitle(null)}
                  >
                    无头衔
                  </button>
                  {titles.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`member-menu-item${Number(menu.member.titleId) === Number(item.id) ? ' is-current' : ''}`}
                      style={{ color: item.color }}
                      role="menuitem"
                      onClick={() => assignTitle(item.id)}
                    >
                      <span className="member-menu-dot" style={{ background: item.color }} />
                      {item.name}
                      <em>{item.rank}</em>
                    </button>
                  ))}

                  {canManageRoles && !menu.isSelf && (
                    <>
                      <div className="member-menu-label">格斗等级</div>
                      {[...rankList]
                        .sort((a, b) => b.sortOrder - a.sortOrder || b.level - a.level)
                        .map((rank) => (
                          <button
                            key={rank.level}
                            type="button"
                            className={`member-menu-item${Number(menu.member.combatLevel || 0) === rank.level ? ' is-current' : ''}`}
                            style={{ color: rank.level === 0 ? undefined : rank.color }}
                            role="menuitem"
                            onClick={() => changeCombatLevel(rank.level)}
                          >
                            <span
                              className="member-menu-dot"
                              style={{ background: rank.level === 0 ? '#7C879E' : rank.color }}
                            />
                            {rank.name}
                            <em>排序 {rank.sortOrder}</em>
                          </button>
                        ))}
                      <div className="member-menu-label">权限等级</div>
                      {['user', 'creator', 'ops', 'admin'].map((role) => (
                        <button
                          key={role}
                          type="button"
                          className={`member-menu-item${menu.member.role === role ? ' is-current' : ''}`}
                          role="menuitem"
                          onClick={() => setRoleConfirm(role)}
                        >
                          {roleLabel(role)}
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </>,
          document.body
        )}
    </aside>
  );
}
