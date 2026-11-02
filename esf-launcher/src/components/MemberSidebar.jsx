import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import Icon from './Icon';
import { roleLabel } from '../lib/format';

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
  staff,
  toast,
  onTitlesChanged,
  onOpenSettings,
  onOpenAdmin,
}) {
  const [members, setMembers] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [menu, setMenu] = useState(null);

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
    const timer = setInterval(load, 20000);
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
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
            {stats ? ` · ${stats.sessions} 场` : ''}
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
      {staff ? <p className="member-hint">右键成员可改头衔 / 权限等级</p> : null}

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
                >
                  <Avatar user={member} size="xs" />
                  <span className="member-row-meta">
                    <b style={{ color: metaOf(member).color }}>
                      {member.gameName}
                      {member.id === user?.id ? ' · 我' : ''}
                    </b>
                    <small>
                      <span className="member-level">{roleLabel(member.role)}</span>
                      {member.online
                        ? member.state === 'ingame'
                          ? member.serverMap || member.serverName || '游戏中'
                          : '在大厅'
                        : '离线'}
                    </small>
                  </span>
                  <span
                    className={`member-dot${member.online ? (member.state === 'ingame' ? ' is-ingame' : '') : ' is-offline'}`}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>

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
