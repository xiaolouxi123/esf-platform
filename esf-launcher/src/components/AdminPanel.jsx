import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import AdminServers from './AdminServers';
import AdminRanks from './AdminRanks';
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatRelative,
  isAdminRole,
  isOwner,
  isStaff,
  roleLabel,
} from '../lib/format';

const ROLE_OPTIONS = [
  { value: 'user', label: '玩家' },
  { value: 'creator', label: '作者' },
  { value: 'ops', label: '运营' },
  { value: 'admin', label: '管理员' },
];

const ROLE_FILTERS = [{ value: '', label: '全部角色' }, ...ROLE_OPTIONS, { value: 'owner', label: '所有者' }];

const ACTION_LABELS = {
  'user.role': '调整角色',
  'user.ban': '封禁账号',
  'user.unban': '解封账号',
  'user.kick': '强制下线',
  'asset.upload': '上传资源',
  'asset.approve': '通过资源',
  'asset.reject': '驳回资源',
  'asset.pending': '打回待审',
  'asset.delete': '删除资源',
  'owner.transfer': '转让所有权',
  'server.add': '登记服务器',
  'server.disable': '下架服务器',
};

function actionTone(action) {
  if (action.endsWith('.ban') || action.endsWith('.reject') || action.endsWith('.delete')) return 'bad';
  if (action.endsWith('.approve') || action.endsWith('.unban')) return 'good';
  if (action === 'owner.transfer') return 'warn';
  return 'neutral';
}

/**
 * 管理台：概览 + 玩家权限 + 资源审核 + 审计日志 + 开发者工具。
 * 运营能进；改角色/审计/开发者工具只给管理员；转让所有权只给所有者。
 */
export default function AdminPanel({
  user,
  settings,
  appInfo,
  backend,
  toast,
  titles = [],
  onTitlesChanged,
  onRanksChanged,
  onOpenSettings,
  onLogout,
}) {
  const staff = isStaff(user?.role);
  const canAssign = isAdminRole(user?.role);
  const canSeeAudit = isAdminRole(user?.role);
  const owner = isOwner(user?.role);
  const titleById = new Map(titles.map((item) => [Number(item.id), item]));

  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const serversRef = useRef(null);
  const [busyId, setBusyId] = useState(null);

  const [audit, setAudit] = useState({ logs: [], total: 0 });
  const [auditAction, setAuditAction] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);

  const [platform, setPlatform] = useState(null);
  const [platformForm, setPlatformForm] = useState({ notice: '', maintenance: false, maintenanceText: '' });
  const [platformSaving, setPlatformSaving] = useState(false);
  const [titleForm, setTitleForm] = useState({ name: '', color: '#FF8A1F', rank: 0 });
  const [titleBusy, setTitleBusy] = useState(false);

  const [transferId, setTransferId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [openSection, setOpenSection] = useState('users');

  const onStackClick = (event) => {
    const head = event.target.closest('.admin-section-head');
    if (!head) return;
    if (event.target.closest('input, select, textarea, button, a, .admin-filters')) return;
    const holder = head.closest('[data-key]');
    if (!holder) return;
    const key = holder.dataset.key;
    setOpenSection((current) => (current === key ? '' : key));
  };

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

  const loadAudit = useCallback(async () => {
    if (!canSeeAudit) return;
    setAuditLoading(true);
    try {
      const data = await window.electronAPI.admin.audit({
        action: auditAction || undefined,
        limit: 30,
      });
      setAudit(data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAuditLoading(false);
    }
  }, [canSeeAudit, auditAction, toast]);

  useEffect(() => {
    const timer = setTimeout(() => loadAudit(), 200);
    return () => clearTimeout(timer);
  }, [loadAudit]);

  useEffect(() => {
    if (!staff) return undefined;

    let alive = true;
    window.electronAPI.admin
      .platform()
      .then((data) => {
        if (!alive) return;
        setPlatform(data);
        setPlatformForm({
          notice: data.notice || '',
          maintenance: Boolean(data.maintenance),
          maintenanceText: data.maintenanceText || '',
        });
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [staff]);

  const act = async (id, action, successMessage) => {
    setBusyId(id);
    try {
      await action();
      toast(successMessage, 'ok');
      await refresh();
      if (canSeeAudit) await loadAudit();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (target, role) =>
    act(target.id, () => window.electronAPI.admin.updateUser(target.id, { role }), `已把 ${target.gameName} 设为${roleLabel(role)}`);

  const assignTitle = (target, value) =>
    act(
      target.id,
      async () => {
        const titleId = value ? Number(value) : null;
        await window.electronAPI.titles.assign(target.id, titleId);
        await onTitlesChanged?.();
      },
      value ? `已给 ${target.gameName} 授予头衔` : `已取消 ${target.gameName} 的头衔`
    );

  const createTitle = async (event) => {
    event.preventDefault();
    const name = titleForm.name.trim();
    if (!name) {
      toast('先填头衔名', 'error');
      return;
    }
    setTitleBusy(true);
    try {
      await window.electronAPI.titles.create({
        name,
        color: titleForm.color,
        rank: Number(titleForm.rank) || 0,
      });
      setTitleForm({ name: '', color: '#FF8A1F', rank: 0 });
      await onTitlesChanged?.();
      toast(`头衔「${name}」已创建`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTitleBusy(false);
    }
  };

  const changeTitleRank = async (title, rank) => {
    const next = Number(rank);
    if (!Number.isFinite(next) || next === Number(title.rank)) return;
    try {
      await window.electronAPI.titles.update({
        id: title.id,
        name: title.name,
        color: title.color,
        rank: next,
      });
      await onTitlesChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeTitle = async (title) => {
    setTitleBusy(true);
    try {
      await window.electronAPI.titles.remove(title.id);
      await onTitlesChanged?.();
      toast(`头衔「${title.name}」已删除`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTitleBusy(false);
    }
  };

  const toggleBan = (target) => {
    const next = target.status === 'active' ? 'banned' : 'active';
    const verb = next === 'banned' ? '封禁' : '解封';
    return act(target.id, () => window.electronAPI.admin.updateUser(target.id, { status: next }), `已${verb} ${target.gameName}`);
  };

  const kick = (target) =>
    act(target.id, () => window.electronAPI.admin.kickUser(target.id), `已强制 ${target.gameName} 下线`);

  // 注销账号：服务端软删除（匿名化 + 撤销会话），仅所有者可用
  const deleteUser = async (target) => {
    if (!window.confirm(`确定注销「${target.gameName}」？\n会清空邮箱、状态、密码与会话，历史对局保留，无法撤销。`)) return;
    setBusyId(target.id);
    try {
      await window.electronAPI.admin.deleteUser(target.id);
      toast(`已注销 ${target.gameName}`, 'ok');
      await refresh();
      if (canSeeAudit) await loadAudit();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  // 重置密码：服务端生成一次性临时密码，复制到剪贴板给玩家
  const resetPassword = async (target) => {
    if (!window.confirm(`确定重置 ${target.gameName} 的密码？重置后对方会被强制下线，需用临时密码登录并改密。`)) {
      return;
    }
    setBusyId(target.id);
    try {
      const data = await window.electronAPI.admin.resetPassword(target.id);
      const temp = data?.tempPassword || data?.data?.tempPassword || '';
      if (temp) {
        try {
          await navigator.clipboard.writeText(temp);
        } catch {
          /* 剪贴板被占用时忽略，密码仍显示在提示里 */
        }
      }
      toast(`临时密码：${temp}${temp ? '（已复制）' : ''}`, 'ok');
      await refresh();
      if (canSeeAudit) await loadAudit();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

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

  const savePlatform = async () => {
    setPlatformSaving(true);
    try {
      const data = await window.electronAPI.admin.updatePlatform({
        notice: platformForm.notice.trim(),
        maintenance: platformForm.maintenance,
        maintenanceText: platformForm.maintenanceText.trim(),
      });
      setPlatform(data);
      toast('运营设置已保存，玩家端 1 分钟内生效', 'ok');
      if (canSeeAudit) await loadAudit();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPlatformSaving(false);
    }
  };

  const transferOwner = async () => {    const target = users.find((item) => String(item.id) === String(transferId));
    if (!target) return toast('请选择接手账号', 'error');
    if (!window.confirm(`确认把所有权转让给「${target.gameName}」？\n你会降为管理员，双方都需要重新登录。`)) return;

    setTransferring(true);
    try {
      await window.electronAPI.admin.transferOwner(Number(target.id));
      toast(`所有权已转让给 ${target.gameName}，请重新登录`, 'ok');
      setTimeout(() => onLogout?.(), 1200);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTransferring(false);
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
      hint: overview
        ? `封禁 ${overview.users.banned} · 管理员 ${overview.users.admins} · 运营 ${overview.users.ops}`
        : '',
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

  const cardValue = (key) => cards.find((card) => card.key === key)?.value ?? '—';

  const gotoRegisterServer = () => {
    setOpenSection('servers');
    const section = serversRef.current;
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      section.querySelector('.admin-section-head .btn-primary')?.click();
    }, 260);
  };

  const transferCandidates = users.filter((item) => item.role !== 'owner' && item.id !== user?.id);

  return (
    <div className="admin">
      <header className="hero admin-hero">
        <span className="hero-art" aria-hidden="true" />
        <span className="hero-mask" aria-hidden="true" />

        <div className="hero-content">
          <div className="eyebrow">
            <Icon name="shield" size={12} />
            管理台
            <span className="eyebrow-status is-on">{roleLabel(user?.role)}</span>
            <span className="eyebrow-note">普通玩家看不到这个页面</span>
          </div>

          <h1 className="hero-title">管理台</h1>

          <div className="hero-tags">
            <span className="tag tag--code">admin console</span>
            <span className="tag">账号 · 资源 · 服务器 · 审计</span>
            <span className="tag">今日进场 {overview ? formatNumber(overview.sessions.today) : '—'}</span>
            <span className="tag tag--mode tag--admin">管理员权限</span>
          </div>
        </div>

        <div className="hero-foot">
          <div className="hud">
            <div className="hud-cell hud-cell--accounts">
              <span>账号</span>
              <b>{cardValue('users')}</b>
            </div>
            <div className="hud-cell hud-cell--pending">
              <span>待审资源</span>
              <b>{cardValue('assets')}</b>
            </div>
            <div className="hud-cell hud-cell--servers">
              <span>在线 / 启用</span>
              <b>{overview ? overview.servers.online : '—'}<em>/{overview ? overview.servers.enabled : '—'}</em></b>
            </div>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="btn btn-ghost btn-lg admin-refresh"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button type="button" className="btn btn-primary btn-lg hero-cta" onClick={gotoRegisterServer}>
              <Icon name="plus" size={15} /> 登记服务器
            </button>
          </div>
        </div>
      </header>

      <div className="admin-stack" onClick={onStackClick}>
      <div ref={serversRef} className="admin-servers-block admin-collapse" data-key="servers" data-open={openSection === 'servers'}>
        <AdminServers toast={toast} />
      </div>


      {canAssign && (
        <div className="admin-collapse" data-key="ranks" data-open={openSection === 'ranks'}>
          <AdminRanks toast={toast} onRanksChanged={onRanksChanged} />
        </div>
      )}

      <section className="admin-section" data-key="users" data-open={openSection === 'users'}>
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
              {ROLE_FILTERS.map((item) => (
                <option key={item.value || 'all'} value={item.value}>
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
                <th>头衔</th>
                <th>状态</th>
                <th>场次 / 时长</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="admin-empty">
                    {loading ? '加载中…' : '没有匹配的账号'}
                  </td>
                </tr>
              ) : (
                users.map((row) => {
                  const self = Number(row.id) === Number(user?.id);
                  const isTargetOwner = row.role === 'owner';
                  const opsLimited = user?.role === 'ops' && !['user', 'creator'].includes(row.role);
                  const locked = self || isTargetOwner || opsLimited;

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
                        {canAssign && !isTargetOwner && !self ? (
                          <select
                            value={row.role}
                            disabled={busyId === row.id}
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
                        {staff && (!isTargetOwner || self) ? (
                          <select
                            value={row.titleId || ''}
                            disabled={busyId === row.id}
                            onChange={(event) => assignTitle(row, event.target.value)}
                          >
                            <option value="">无头衔</option>
                            {titles.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        ) : row.titleId && titleById.get(Number(row.titleId)) ? (
                          <span
                            className="chat-title"
                            style={{
                              color: titleById.get(Number(row.titleId)).color,
                              borderColor: `${titleById.get(Number(row.titleId)).color}55`,
                            }}
                          >
                            {titleById.get(Number(row.titleId)).name}
                          </span>
                        ) : (
                          <span className="admin-muted">无</span>
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
                        ) : isTargetOwner ? (
                          <span className="admin-muted">所有者不可操作</span>
                        ) : opsLimited ? (
                          <span className="admin-muted">无权限</span>
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
                              disabled={busyId === row.id || locked}
                              onClick={() => kick(row)}
                            >
                              下线
                            </button>
                            {canAssign ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                disabled={busyId === row.id || locked}
                                onClick={() => resetPassword(row)}
                              >
                                重置密码
                              </button>
                            ) : null}
                            {owner ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger-ghost"
                                disabled={busyId === row.id || locked}
                                onClick={() => deleteUser(row)}
                              >
                                注销
                              </button>
                            ) : null}
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

      <section className="admin-section" data-key="titles" data-open={openSection === 'titles'}>
        <div className="admin-section-head">
          <h3>
            <Icon name="star" size={15} /> 频道头衔
            <span className="pill">{titles.length}</span>
          </h3>
          <span className="admin-muted">admin 以上可创建 / 排序，ops 以上可在玩家表授予</span>
        </div>

        <div className="title-manager">
          <div className="title-list">
            {titles.length === 0 ? (
              <span className="admin-muted">还没有头衔，先在下面创建一个</span>
            ) : (
              titles.map((item) => (
                <div className="title-item" key={item.id}>
                  <span className="title-dot" style={{ background: item.color }} />
                  <b style={{ color: item.color }}>{item.name}</b>
                  {canAssign ? (
                    <input
                      key={`${item.id}-${item.rank}`}
                      type="number"
                      className="title-rank"
                      defaultValue={item.rank}
                      title="排序权重，越大越靠前；改完点空白处生效"
                      onBlur={(event) => changeTitleRank(item, event.target.value)}
                    />
                  ) : (
                    <em>{item.rank}</em>
                  )}
                  {canAssign && (
                    <button
                      type="button"
                      className="title-remove"
                      disabled={titleBusy}
                      title="删除头衔"
                      onClick={() => removeTitle(item)}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {canAssign && (
            <form className="title-form" onSubmit={createTitle}>
              <input
                type="text"
                value={titleForm.name}
                maxLength={16}
                placeholder="新头衔名，例如 超级赛亚人"
                onChange={(event) => setTitleForm((prev) => ({ ...prev, name: event.target.value }))}
              />
              <input
                type="color"
                value={titleForm.color}
                title="头衔颜色"
                onChange={(event) => setTitleForm((prev) => ({ ...prev, color: event.target.value }))}
              />
              <input
                type="number"
                value={titleForm.rank}
                title="排序权重"
                onChange={(event) => setTitleForm((prev) => ({ ...prev, rank: event.target.value }))}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={titleBusy}>
                添加头衔
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="admin-section" data-key="platform" data-open={openSection === 'platform'}>
        <div className="admin-section-head">
          <h3>
            <Icon name="bell" size={15} /> 运营设置
            <span className="tag">ops 及以上</span>
          </h3>
          {platform && (
            <span className={`status-pill status-${platform.maintenance ? 'banned' : 'active'}`}>
              {platform.maintenance ? '维护中' : '正常'}
            </span>
          )}
        </div>

        <div className="platform-form">
          <label className="field">
            <span className="field-label">大厅公告</span>
            <div className="field-input">
              <input
                type="text"
                value={platformForm.notice}
                maxLength={300}
                placeholder="例如：今晚 20:00 停服维护 30 分钟"
                onChange={(event) => setPlatformForm((prev) => ({ ...prev, notice: event.target.value }))}
              />
            </div>
          </label>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={platformForm.maintenance}
              onChange={(event) =>
                setPlatformForm((prev) => ({ ...prev, maintenance: event.target.checked }))
              }
            />
            <span>
              <b>维护模式</b>
              <small>开启后玩家无法开始游戏或加入服务器</small>
            </span>
          </label>

          <label className="field">
            <span className="field-label">维护提示</span>
            <div className="field-input">
              <input
                type="text"
                value={platformForm.maintenanceText}
                maxLength={120}
                placeholder="平台维护中，请稍后再试"
                onChange={(event) =>
                  setPlatformForm((prev) => ({ ...prev, maintenanceText: event.target.value }))
                }
              />
            </div>
          </label>

          <div className="admin-actions">
            <button type="button" className="btn btn-primary" onClick={savePlatform} disabled={platformSaving}>
              {platformSaving ? <span className="spinner" /> : <Icon name="check" size={14} />}
              {platformSaving ? '保存中…' : '保存设置'}
            </button>
          </div>
        </div>
      </section>

      <section className="admin-section" data-key="assets" data-open={openSection === 'assets'}>
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

      {canSeeAudit && (
        <section className="admin-section" data-key="audit" data-open={openSection === 'audit'}>
          <div className="admin-section-head">
            <h3>
              <Icon name="clock" size={15} /> 操作审计
              <span className="pill">{audit.total}</span>
            </h3>

            <div className="admin-filters">
              <select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}>
                <option value="">全部动作</option>
                {Object.entries(ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-ghost" onClick={loadAudit} disabled={auditLoading}>
                {auditLoading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
              </button>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>详情</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {audit.logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="admin-empty">
                      {auditLoading ? '加载中…' : '还没有审计记录'}
                    </td>
                  </tr>
                ) : (
                  audit.logs.map((log) => (
                    <tr key={log.id}>
                      <td className="admin-muted">{formatRelative(log.createdAt)}</td>
                      <td>{log.actorName || '系统/CLI'}</td>
                      <td>
                        <span className={`audit-tag audit-tag--${actionTone(log.action)}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="admin-muted">
                        {log.targetType ? `${log.targetType}#${log.targetId ?? '-'}` : '—'}
                      </td>
                      <td className="audit-detail">
                        {log.detail ? JSON.stringify(log.detail).slice(0, 120) : '—'}
                      </td>
                      <td className="admin-muted">{log.ip || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {owner && (
        <section className="admin-section" data-key="transfer" data-open={openSection === 'transfer'}>
          <div className="admin-section-head">
            <h3>
              <Icon name="shield" size={15} /> 转让所有权
              <span className="tag tag--soon">仅所有者</span>
            </h3>
          </div>

          <p className="admin-muted">
            所有权是唯一且不可被降级的身份。转让后你会降为管理员，双方都需要重新登录。
          </p>

          <div className="owner-transfer">
            <select value={transferId} onChange={(event) => setTransferId(event.target.value)}>
              <option value="">选择接手账号…</option>
              {transferCandidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.gameName}（{roleLabel(item.role)}）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-danger-ghost"
              disabled={!transferId || transferring}
              onClick={transferOwner}
            >
              {transferring ? <span className="spinner" /> : <Icon name="alert" size={14} />} 转让
            </button>
          </div>
        </section>
      )}

      <section className="admin-section admin-section--dev" data-key="dev" data-open={openSection === 'dev'}>
        <div className="admin-section-head">
          <h3>
            <Icon name="settings" size={15} /> 开发者工具
            <span className="tag tag--soon">仅管理员</span>
          </h3>
        </div>

        {canAssign ? (
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
    </div>
  );
}
