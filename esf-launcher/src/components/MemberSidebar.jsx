import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import Icon from './Icon';
import { roleLabel, formatDuration, formatRelative } from '../lib/format';

const ROLE_RANK = { owner: 4, admin: 3, ops: 2, creator: 1, user: 0 };
const ROLE_COLOR = {
  owner: '#FF8A1F',
  admin: '#FF5F6D',
  ops: '#3FD0FF',
  creator: '#A78BFA',
  user: '#94A0B8',
};

/** Discord 式右侧成员名单：所有账号 + 头衔分组 + 权限等级 + 在线状态 */
export default function MemberSidebar({
  user,
  titles = [],
  stats,
  coins = 0,
  staff,
  toast,
  onTitlesChanged,
  onOpenSettings,
  onOpenAdmin,
}) {
  const [members, setMembers] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [menu, setMenu] = useState(null);
  const [profile, setProfile] = useState(null);
  const [zoom, setZoom] = useState(false);

  const reloadMembers = async () => {
    try {
      const data = await window.electronAPI.members.list();
      setMembers(Array.isArray(data?.members) ? data.members : []);
    } catch {
      /* 保留上一份 */
    }
  };

  const canManageRoles = user?.role === 'admin' || user?.role === 'owner';

  const openMenu = (event, member) => {
    if (!staff) return;
    const isSelf = Number(member.id) === Number(user?.id);
    if (!isSelf && member.role === 'owner') return;
    event.preventDefault();
    setMenu({
      member,
      isSelf,
      x: Math.min(event.clientX, window.innerWidth - 244),
      y: Math.min(event.clientY, window.innerHeight - 440),
    });
  };

  const closeMenu = () => setMenu(null);

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
      toast?.(`已把 ${member.gameName} 的格斗等级设为 ${level === 0 ? '未定级' : `Lv.${level}`}`, 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    }
  };

  const openProfile = async (member) => {
    setZoom(false);
    setProfile({ ...member });
    try {
      const data = await window.electronAPI.members.detail(member.id);
      if (data?.member) setProfile(data.member);
    } catch {
      // 详情接口不可用时，staff 用管理台账号数据补战绩
      try {
        const data = await window.electronAPI.admin.users({ q: member.username, limit: 5 });
        const row = (data?.users || []).find((item) => Number(item.id) === Number(member.id));
        if (row) {
          setProfile((prev) =>
            prev
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
        /* 普通玩家看不到战绩就先显示基础资料 */
      }
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const data = await window.electronAPI.members.list();
        if (alive) setMembers(Array.isArray(data?.members) ? data.members : []);
      } catch {
        /* 拉取失败保留上一份 */
      }
    };

    load();
    const timer = setInterval(load, 10000);
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('esf:presence', load);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('esf:presence', load);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const titleById = new Map(titles.map((item) => [Number(item.id), item]));
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

  const sorted = [...filtered].sort((a, b) => {
    const diff = metaOf(b).rank - metaOf(a).rank;
    if (diff !== 0) return diff;
    if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
    return String(a.gameName || '').localeCompare(String(b.gameName || ''));
  });

  const groups = [];
  for (const member of sorted) {
    const meta = metaOf(member);
    const last = groups[groups.length - 1];
    if (last && last.label === meta.label) last.members.push(member);
    else groups.push({ label: meta.label, color: meta.color, members: [member] });
  }

  const onlineCount = members.filter((member) => member.online).length;
  const selfTitle = titleById.get(Number(user?.titleId));
  const profileMeta = profile ? metaOf(profile) : null;

  return (
    <aside className="member-sidebar card">
      <header className="member-sidebar-head">
        <h3>
          <Icon name="users" size={15} /> 成员
        </h3>
        <span>
          {members.length} 位 · {onlineCount} 在线
        </span>
      </header>

      <button type="button" className="member-self" onClick={onOpenSettings} title="账号与设置">
        <Avatar user={user} size="sm" />
        <span className="member-self-meta">
          <b>{user?.gameName || user?.username}</b>
          <small style={{ color: selfTitle?.color }}>
            {selfTitle ? selfTitle.name : roleLabel(user?.role)}
            {stats ? ` · ${stats.sessions} 场` : ''} · 金币 {coins}
          </small>
        </span>
        <Icon name="settings" size={14} />
      </button>

      {staff ? (
        <button type="button" className="member-admin-link" onClick={onOpenAdmin}>
          管理台与平台设置
          <Icon name="chevronRight" size={12} />
        </button>
      ) : null}
      {staff ? <p className="member-hint">右键成员可改头衔 / 格斗等级 / 权限</p> : null}

      <div className="member-search">
        <Icon name="search" size={14} />
        <input
          type="text"
          value={keyword}
          placeholder="搜索成员"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="member-scroll">
        {members.length === 0 ? (
          <p className="admin-muted">加载中…</p>
        ) : groups.length === 0 ? (
          <p className="admin-muted">没有匹配的成员</p>
        ) : (
          groups.map((group) => (
            <div className="member-group" key={group.label}>
              <div className="member-group-head">
                <span className="member-group-dot" style={{ background: group.color }} />
                <span style={{ color: group.color }}>{group.label}</span>
                <em>{group.members.length}</em>
              </div>
              {group.members.map((member) => (
                <div
                  key={member.id}
                  data-member-id={member.id}
                  className={`member-row${member.id === user?.id ? ' is-self' : ''}${member.online ? '' : ' is-offline'}`}
                  onContextMenu={(event) => openMenu(event, member)}
                  onClick={() => openProfile(member)}
                >
                  <Avatar user={member} size="xs" />
                  <span className="member-row-meta">
                    <b style={{ color: metaOf(member).color }}>
                      {member.gameName}
                      {member.id === user?.id ? ' · 我' : ''}
                    </b>
                    <small>
                      <span className="member-level">{roleLabel(member.role)}</span>
                      {Number(member.combatLevel) > 0 && (
                        <span className="combat-level">Lv.{member.combatLevel}</span>
                      )}
                      {member.ranked && (
                        <span className={`member-ranked is-${member.ranked.status}`}>
                          {member.ranked.status === 'queued'
                            ? '匹配中'
                            : member.ranked.status === 'waiting'
                              ? '待准备'
                              : '比赛中'}
                          {' · '}
                          {member.ranked.mode}
                        </span>
                      )}
                      {member.online
                        ? member.state === 'ingame'
                          ? member.serverMap || member.serverName || '游戏中'
                          : '在大厅'
                        : '离线'}
                    </small>
                  </span>
                  <span
                    className={`member-dot${member.online ? (member.state === 'ingame' ? ' is-ingame' : '') : ' is-offline'}${member.ranked ? ' is-ranked' : ''}`}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {profile &&
        createPortal(
          <div
            className="member-profile-backdrop"
            onClick={() => {
              setProfile(null);
              setZoom(false);
            }}
          >
            <div className="member-profile" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="member-profile-close"
                aria-label="关闭成员详情"
                onClick={() => {
                  setProfile(null);
                  setZoom(false);
                }}
              >
                <Icon name="close" size={14} />
              </button>

              <div className="member-profile-top">
                <button
                  type="button"
                  className="member-profile-avatar"
                  title={profile.avatarUrl ? '查看大头像' : undefined}
                  onClick={() => profile.avatarUrl && setZoom(true)}
                >
                  <Avatar user={profile} size="lg" />
                </button>
                <div className="member-profile-identity">
                  <h3 style={{ color: profileMeta?.color }}>{profile.gameName}</h3>
                  <p>@{profile.username}</p>
                  <div className="member-profile-badges">
                    <span style={{ color: profileMeta?.color }}>{profileMeta?.label}</span>
                    <span className="member-level">{roleLabel(profile.role)}</span>
                    {Number(profile.combatLevel) > 0 && (
                      <span className="combat-level">Lv.{profile.combatLevel}</span>
                    )}
                    <span className={`member-profile-state${profile.online ? ' is-online' : ''}`}>
                      {profile.online ? (profile.state === 'ingame' ? '游戏中' : '在线') : '离线'}
                    </span>
                    {profile.ranked && (
                      <span className={`member-ranked is-${profile.ranked.status}`}>
                        {profile.ranked.status === 'queued'
                          ? '排位匹配中'
                          : profile.ranked.status === 'waiting'
                            ? '排位待准备'
                            : '排位比赛中'}
                        {' · '}
                        {profile.ranked.mode}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="member-profile-stats">
                <div>
                  <b>{profile.sessions ?? '—'}</b>
                  <span>进场次数</span>
                </div>
                <div>
                  <b>{profile.totalSeconds != null ? formatDuration(profile.totalSeconds) : '—'}</b>
                  <span>累计时长</span>
                </div>
                <div>
                  <b>{profile.online ? '在线' : '离线'}</b>
                  <span>当前状态</span>
                </div>
              </div>

              <dl className="member-profile-info">
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
                  <dt>格斗等级</dt>
                  <dd>{Number(profile.combatLevel) > 0 ? `Lv.${profile.combatLevel}` : '未定级'}</dd>
                </div>
                <div>
                  <dt>所在位置</dt>
                  <dd>
                    {profile.online
                      ? profile.state === 'ingame'
                        ? profile.serverMap || profile.serverName || '游戏中'
                        : '大厅'
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

              {profile.avatarUrl ? (
                <p className="member-profile-hint">点击头像查看大图</p>
              ) : (
                <p className="member-profile-hint">该玩家还没有上传自定义头像</p>
              )}
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
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="member-menu-head">
                <b>{menu.member.gameName}</b>
                <small>@{menu.member.username}</small>
              </div>

              <div className="member-menu-label">授予头衔</div>
              <button
                type="button"
                className={`member-menu-item${!menu.member.titleId ? ' is-current' : ''}`}
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
                  {[0, 1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`member-menu-item${Number(menu.member.combatLevel || 0) === level ? ' is-current' : ''}`}
                      onClick={() => changeCombatLevel(level)}
                    >
                      {level === 0 ? '未定级' : `Lv.${level}`}
                    </button>
                  ))}
                  <div className="member-menu-label">权限等级</div>
                  {['user', 'creator', 'ops', 'admin'].map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={`member-menu-item${menu.member.role === role ? ' is-current' : ''}`}
                      onClick={() => changeRole(role)}
                    >
                      {roleLabel(role)}
                    </button>
                  ))}
                </>
              )}
            </div>
          </>,
          document.body
        )}
    </aside>
  );
}
