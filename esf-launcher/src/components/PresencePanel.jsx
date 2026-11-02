import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { roleLabel } from '../lib/format';

const ROLE_RANK = { owner: 4, admin: 3, ops: 2, creator: 1, user: 0 };
const ROLE_COLOR = {
  owner: '#FF8A1F',
  admin: '#FF5F6D',
  ops: '#3FD0FF',
  creator: '#A78BFA',
  user: '#94A0B8',
};

/**
 * 在线玩家 + 龙珠雷达。
 *
 * 雷达不是装饰：7 个节点对应真实的平台服务状态
 * （API / 数据库 / 游戏目录 / 模组 / 房间列表 / 在线状态 / 版本）。
 * 点雷达展开节点明细，异常节点会变成琥珀色。
 */
export default function PresencePanel({
  user,
  backend,
  hasGameDir,
  settings,
  serversCount,
  updateInfo,
  titles = [],
}) {
  const [online, setOnline] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [presenceFailures, setPresenceFailures] = useState(0);
  const [showNodes, setShowNodes] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const data = await window.electronAPI.members.list();
        if (alive) setRoster(Array.isArray(data?.members) ? data.members : []);
      } catch {
        /* 名册失败时回退到在线列表 */
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
    if (title) {
      return { label: title.name, color: title.color, rank: Number(title.rank) };
    }
    return {
      label: roleLabel(member.role),
      color: ROLE_COLOR[member.role] || ROLE_COLOR.user,
      rank: (ROLE_RANK[member.role] ?? 0) * 10,
    };
  };
  const source = roster.length > 0 ? roster : online.map((item) => ({ ...item, online: true }));
  const members = [...source].sort((a, b) => {
    const diff = metaOf(b).rank - metaOf(a).rank;
    if (diff !== 0) return diff;
    if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
    return String(a.gameName || '').localeCompare(String(b.gameName || ''));
  });
  const groups = [];
  for (const member of members) {
    const meta = metaOf(member);
    const last = groups[groups.length - 1];
    if (last && last.label === meta.label) {
      last.members.push(member);
    } else {
      groups.push({ label: meta.label, color: meta.color, members: [member] });
    }
  }

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const data = await window.electronAPI.presence.list();
        if (alive) {
          setOnline(data.online || []);
          setPresenceFailures(0);
        }
      } catch {
        if (alive) setPresenceFailures((count) => count + 1);
      } finally {
        if (alive) setLoading(false);
      }
    };

    tick();
    const timer = setInterval(tick, 15000);

    const refresh = () => {
      if (document.visibilityState === 'visible') tick();
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

  const nodes = [
    { key: 'api', label: '平台服务', state: backend?.ok ? 'ok' : 'off' },
    { key: 'db', label: '数据库', state: backend?.db === 'up' ? 'ok' : 'off' },
    { key: 'dir', label: '游戏目录', state: hasGameDir ? 'ok' : 'off' },
    { key: 'mod', label: '游戏模组', state: settings?.esfModDir ? 'ok' : 'off' },
    { key: 'rooms', label: '房间列表', state: Number(serversCount) > 0 ? 'ok' : 'warn' },
    { key: 'presence', label: '在线状态', state: presenceFailures >= 3 ? 'off' : presenceFailures > 0 ? 'warn' : 'ok' },
    { key: 'version', label: '版本更新', state: updateInfo?.hasUpdate ? 'warn' : 'ok' },
  ];

  const okCount = nodes.filter((node) => node.state === 'ok').length;
  const warnCount = nodes.filter((node) => node.state === 'warn').length;

  return (
    <section className="card card--presence">
      <div className="presence-head">
        <button
          type="button"
          className="radar-btn"
          title="查看 7 个服务节点"
          onClick={() => setShowNodes((value) => !value)}
        >
          <span className="radar">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="18" className="radar-ring" />
              <circle cx="22" cy="22" r="11" className="radar-ring" />
              <circle cx="22" cy="22" r="4" className="radar-ring" />
              <line x1="22" y1="22" x2="22" y2="4" className="radar-sweep" />
              {nodes.map((node, index) => {
                const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
                return (
                  <circle
                    key={node.key}
                    cx={22 + Math.cos(angle) * 16}
                    cy={22 + Math.sin(angle) * 16}
                    r="2.6"
                    className={`radar-dot radar-dot--${node.state}`}
                  />
                );
              })}
            </svg>
          </span>
          <span className="radar-label">龙珠雷达</span>
          <span className={`pill${warnCount > 0 ? ' is-warn' : ''}`}>
            {okCount}/7
          </span>
        </button>

        <span className="presence-sub">
          {members.length} 位成员 · {online.length} 在线
        </span>
      </div>

      {showNodes && (
        <ul className="radar-nodes">
          {nodes.map((node) => (
            <li key={node.key}>
              <span className={`radar-node-dot radar-node-dot--${node.state}`} />
              {node.label}
              <em>{node.state === 'ok' ? '正常' : node.state === 'warn' ? '注意' : '异常'}</em>
            </li>
          ))}
        </ul>
      )}

      <div className="presence-list">
        {online.length === 0 ? (
          <p className="admin-muted">{loading ? '加载中…' : '暂时没人在线'}</p>
        ) : (
          groups.map((group) => (
            <div className="presence-group" key={group.label}>
              <div className="presence-group-head">
                <span className="presence-group-dot" style={{ background: group.color }} />
                <span style={{ color: group.color }}>{group.label}</span>
                <em>{group.members.length}</em>
              </div>
              {group.members.map((item) => (
                <div
                  key={item.id}
                  className={`presence-row${item.id === user?.id ? ' is-self' : ''}${item.online ? '' : ' is-offline'}`}
                >
                  <Avatar user={item} size="sm" />
                  <div className="presence-meta">
                    <b style={{ color: metaOf(item).color }}>
                      {item.gameName}
                      {item.id === user?.id ? ' · 我' : ''}
                    </b>
                    <small>
                      <span className="member-level">{roleLabel(item.role)}</span>
                      {item.online
                        ? item.state === 'ingame'
                          ? `游戏中 · ${item.serverMap || item.serverName || '服务器'}`
                          : '在大厅'
                        : '离线'}
                    </small>
                  </div>
                  <span
                    className={`presence-dot${item.online ? (item.state === 'ingame' ? ' is-ingame' : '') : ' is-offline'}`}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
