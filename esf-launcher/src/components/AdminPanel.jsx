import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatRelative,
  isStaff,
  roleLabel,
} from '../lib/format';

const ROLE_OPTIONS = [
  { value: 'user', label: '玩家' },
  { value: 'gm', label: '运营' },
  { value: 'admin', label: '管理员' },
];

/**
 * 管理台：平台概览 + 玩家权限 + 资源审核 + 开发者工具。
 * 只有 admin / gm 能进来（导航与后端双重校验）；开发者工具只给 admin。
 */
export default function AdminPanel({ user, settings, appInfo, backend, toast, onOpenSettings }) {
  const staff = isStaff(user?.role);
  const isAdmin = user?.role === 'admin';

  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    if (!staff) return;
    setLoading(true);
    try {
      const [summary, list, pending] = await Promise.all([
        window.electronAPI.admin.overview(),
        window.electronAPI.admin.users({
          q: keyword.trim() || undefined,
          role: roleFilter || undefined,
          limit: 30,
        }),
        window.electronAPI.admin.assets('pending'),
      ]);
      setOverview(summary);
      setUsers(list.users || []);
      setTotal(list.total || 0);
      setPendingAssets(pending.assets || []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [staff, keyword, roleFilter, toast]);

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 200);
    return () => clearTimeout(timer);
  }, [refresh]);

  const act = async (id, action, successMessage) => {
    setBusyId(id);
    try {
      await action();
      toast(successMessage, 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (target, role) =>
    act(target.id, () => window.electronAPI.admin.updateUser(target.id, { role }), `已把 ${target.gameName} 设为${roleLabel(role)}`);

  const toggleBan = (target) => {
    const next = target.status === 'active' ? 'banned' : 'active';
    const verb = next === 'banned' ? '封禁' : '解封';
    return act(target.id, () => window.electronAPI.admin.updateUser(target.id, { status: next }), `已${verb} ${target.gameName}`);
  };

  const kick = (target) =>
    act(target.id, () => window.electronAPI.admin.kickUser(target.id), `已强制 ${target.gameName} 下线`);

  const review = (asset, status) =>
    act(asset.id, () => window.electronAPI.admin.setAssetStatus(asset.id, status), status === 'approved' ? '已通过' : '已驳回');

  const copyDiagnostics = async () => {
    const text = [
      `launcher v${appInfo?.version || '?'}`,
      `electron ${appInfo?.electron || '?'}`,
      `api ${settings?.apiBaseUrl || '?'}`,
      `db ${backend?.db || '?'}`,
      `mod ${settings?.esfModDir || '未设置'}`,
      `userData ${appInfo?.userDataDir || '?'}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      toast('诊断信息已复制到剪贴板', 'ok');
    } catch {
      toast('复制失败，请检查剪贴板权限', 'error');
    }
  };

  if (!staff) {
    return (
      <div className="empty">
        <Icon name="shield" size={26} />
        <p>没有管理权限</p>
      </div>
    );
  }

  const cards = [
    {
      key: 'users',
      label: '账号',
      value: overview ? formatNumber(overview.users.total) : '—',
      hint: overview ? `封禁 ${overview.users.banned} · 管理员 ${overview.users.admins}` : '',
      icon: 'users',
    },
    {
      key: 'assets',
      label: '待审资源',
      value: overview ? formatNumber(overview.assets.pending) : '—',
      hint: overview ? `已上架 ${overview.assets.approved}` : '',
      icon: 'spark',
    },
    {
      key: 'servers',
      label: '服务器',
      value: overview ? `${overview.servers.online}/${overview.servers.enabled}` : '—',
      hint: '在线 / 已启用',
      icon: 'server',
    },
    {
      key: 'sessions',
      label: '今日进场',
      value: overview ? formatNumber(overview.sessions.today) : '—',
      hint: overview ? `累计 ${overview.sessions.total}` : '',
      icon: 'clock',
    },
  ];

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h2>
            管理台
            <span className={`role-badge role-${user?.role}`}>{roleLabel(user?.role)}</span>
          </h2>
          <p>账号权限、资源审核与开发者工具。普通玩家看不到这个页面。</p>
        </div>

        <button type="button" className="btn btn-ghost" onClick={refresh} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      <div className="admin-cards">
        {cards.map((card) => (
          <div key={card.key} className="admin-card">
            <span className="admin-card-icon">
              <Icon name={card.icon} size={16} />
            </span>
            <div>
              <b>{card.value}</b>
              <span>{card.label}</span>
              {card.hint ? <small>{card.hint}</small> : null}
            </div>
          </div>
        ))}
      </div>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>
            <Icon name="users" size={15} /> 玩家管理
            <span className="pill">{total}</span>
          </h3>

          <div className="admin-filters">
            <div className="search">
              <Icon name="search" size={14} />
              <input
                type="text"
                value={keyword}
                placeholder="搜索账号 / 昵称"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>

            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">全部角色</option>
              {ROLE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>玩家</th>
                <th>角色</th>
                <th>状态</th>
                <th>场次 / 时长</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-empty">
                    {loading ? '加载中…' : '没有匹配的账号'}
                  </td>
                </tr>
              ) : (
                users.map((row) => {
                  const self = Number(row.id) === Number(user?.id);
                  return (
                    <tr key={row.id} className={self ? 'is-self' : ''}>
                      <td>
                        <div className="admin-user">
                          <Avatar user={row} size="sm" />
                          <div>
                            <b>{row.gameName}</b>
                            <small>@{row.username}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {isAdmin ? (
                          <select
                            value={row.role}
                            disabled={self || busyId === row.id}
                            onChange={(event) => changeRole(row, event.target.value)}
                          >
                            {ROLE_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`role-badge role-${row.role}`}>{roleLabel(row.role)}</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill status-${row.status}`}>
                          {row.status === 'active' ? '正常' : '已封禁'}
                        </span>
                      </td>
                      <td className="admin-muted">
                        {row.sessions} 场 · {formatDuration(row.totalSeconds)}
                      </td>
                      <td className="admin-muted">{formatRelative(row.lastLoginAt)}</td>
                      <td>
                        {self ? (
                          <span className="admin-muted">当前账号</span>
                        ) : (
                          <div className="admin-actions">
                            <button
                              type="button"
                              className={`btn btn-sm ${row.status === 'active' ? 'btn-danger-ghost' : 'btn-ghost'}`}
                              disabled={busyId === row.id}
                              onClick={() => toggleBan(row)}
                            >
                              {row.status === 'active' ? '封禁' : '解封'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              disabled={busyId === row.id}
                              onClick={() => kick(row)}
                            >
                              下线
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>
            <Icon name="spark" size={15} /> 资源审核
            <span className="pill">{pendingAssets.length}</span>
          </h3>
        </div>

        {pendingAssets.length === 0 ? (
          <p className="admin-muted">没有待审资源。作者上传后会出现在这里。</p>
        ) : (
          <div className="review-list">
            {pendingAssets.map((asset) => (
              <article key={asset.id} className="review-item">
                <div>
                  <b>{asset.name}</b>
                  <span className="tag">{asset.kind}</span>
                  <span className="tag">v{asset.version}</span>
                  <small>
                    {asset.authorName || '未知作者'} · {formatBytes(asset.fileSize)} · {asset.targetPath}
                  </small>
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busyId === asset.id}
                    onClick={() => review(asset, 'approved')}
                  >
                    <Icon name="check" size={13} /> 通过
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-ghost"
                    disabled={busyId === asset.id}
                    onClick={() => review(asset, 'rejected')}
                  >
                    <Icon name="close" size={13} /> 驳回
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section admin-section--dev">
        <div className="admin-section-head">
          <h3>
            <Icon name="settings" size={15} /> 开发者工具
            <span className="tag tag--soon">仅管理员</span>
          </h3>
        </div>

        {isAdmin ? (
          <>
            <div className="dev-grid">
              <button type="button" className="dev-btn" onClick={() => window.electronAPI.admin.openDevTools()}>
                <Icon name="external" size={15} />
                <b>开发者工具</b>
                <small>打开 DevTools（独立窗口）</small>
              </button>

              <button type="button" className="dev-btn" onClick={onOpenSettings}>
                <Icon name="settings" size={15} />
                <b>连接设置</b>
                <small>API 地址 / 本地服务器标识</small>
              </button>

              <button
                type="button"
                className="dev-btn"
                onClick={async () => {
                  try {
                    await window.electronAPI.shell.openGameDir();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }}
              >
                <Icon name="folder" size={15} />
                <b>游戏目录</b>
                <small>看 esf_launcher.log 与 AMXX 日志</small>
              </button>

              <button type="button" className="dev-btn" onClick={copyDiagnostics}>
                <Icon name="copy" size={15} />
                <b>复制诊断信息</b>
                <small>版本 / API / 路径，便于反馈问题</small>
              </button>
            </div>

            <dl className="dev-kv">
              <div>
                <dt>启动器</dt>
                <dd>v{appInfo?.version || '—'}</dd>
              </div>
              <div>
                <dt>Electron</dt>
                <dd>{appInfo?.electron || '—'}</dd>
              </div>
              <div>
                <dt>API</dt>
                <dd>{settings?.apiBaseUrl || '—'}</dd>
              </div>
              <div>
                <dt>数据目录</dt>
                <dd className="kv-path">{appInfo?.userDataDir || '—'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="admin-muted">开发者工具仅对管理员开放。</p>
        )}
      </section>
    </div>
  );
}
