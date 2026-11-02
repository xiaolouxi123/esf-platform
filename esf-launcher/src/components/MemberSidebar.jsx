import { useEffect, useState } from 'react';
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
export default function MemberSidebar({ user, titles = [], stats, staff, onOpenSettings, onOpenAdmin }) {
  const [members, setMembers] = useState([]);
  const [keyword, setKeyword] = useState('');

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
                  className={`member-row${member.id === user?.id ? ' is-self' : ''}${member.online ? '' : ' is-offline'}`}
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
    </aside>
  );
}
