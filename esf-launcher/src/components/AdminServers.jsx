import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';

const EMPTY_FORM = {
  serverKey: '',
  name: '',
  ip: '',
  port: '27015',
  mode: '混战',
  sort: '0',
  enabled: true,
};

function toForm(server) {
  return {
    serverKey: server.serverKey,
    name: server.name || '',
    ip: server.ip || '',
    port: String(server.port || 27015),
    mode: server.mode || '混战',
    sort: String(server.sort ?? 0),
    enabled: Boolean(server.enabled),
  };
}

/** 管理台服务器登记：运营改完立即写库，大厅/收藏下一次刷新就能看到。 */
export default function AdminServers({ toast }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.admin.servers();
      setServers(Array.isArray(data?.servers) ? data.servers : []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // 异步拉取，状态在 await 后落地；规则对同步调用误报。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const startEdit = (server) => {
    setCreating(false);
    setEditing(server.serverKey);
    setForm(toForm(server));
  };

  const startCreate = () => {
    setEditing('');
    setCreating(true);
    setForm(EMPTY_FORM);
  };

  const cancel = () => {
    setEditing('');
    setCreating(false);
    setForm(EMPTY_FORM);
  };

  const save = async (event) => {
    event.preventDefault();
    const port = Number(form.port);
    const sort = Number(form.sort);
    if (!form.name.trim() || !form.ip.trim() || !Number.isFinite(port) || !Number.isFinite(sort)) {
      toast('请填写名称、地址和有效的端口 / 排序', 'error');
      return;
    }

    setBusy(creating ? 'create' : 'save');
    try {
      if (creating) {
        if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(form.serverKey)) {
          toast('服务器标识只能用小写字母、数字、_ 或 -，2-32 位', 'error');
          return;
        }
        await window.electronAPI.admin.createServer({
          serverKey: form.serverKey,
          name: form.name.trim(),
          ip: form.ip.trim(),
          port,
          mode: form.mode.trim() || '混战',
          sort,
          enabled: form.enabled,
        });
        toast('服务器已登记，大厅刷新后可见', 'ok');
      } else {
        await window.electronAPI.admin.updateServer(editing, {
          name: form.name.trim(),
          ip: form.ip.trim(),
          port,
          mode: form.mode.trim() || '混战',
          sort,
          enabled: form.enabled,
        });
        toast('服务器已更新', 'ok');
      }
      cancel();
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleEnabled = async (server) => {
    setBusy(server.serverKey);
    try {
      await window.electronAPI.admin.updateServer(server.serverKey, { enabled: !server.enabled });
      toast(server.enabled ? '服务器已下架' : '服务器已启用', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="admin-section admin-servers">
      <div className="admin-section-head">
        <h3>
          <Icon name="server" size={15} /> 服务器列表
          <span className="pill">{servers.length}</span>
        </h3>
        <div className="admin-filters">
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
            <Icon name="refresh" size={13} /> 刷新
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={startCreate}>
            <Icon name="plus" size={13} /> 登记服务器
          </button>
        </div>
      </div>

      <p className="admin-muted">
        这里修改的名称、地址和排序会实时写库；大厅「在线房间」「我的收藏服」和服务器页会自动刷新。
      </p>

      {(creating || editing) && (
        <form className="admin-server-form" onSubmit={save}>
          <div className="admin-server-form-head">
            <b>{creating ? '登记新服务器' : `编辑 ${editing}`}</b>
            <button type="button" className="icon-btn" onClick={cancel} title="取消">
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="admin-server-fields">
            {creating && (
              <label>
                <span>服务器标识</span>
                <input
                  value={form.serverKey}
                  placeholder="fcx-2v2-1"
                  onChange={(event) => setForm((prev) => ({ ...prev, serverKey: event.target.value }))}
                />
              </label>
            )}
            <label>
              <span>显示名称</span>
              <input
                value={form.name}
                placeholder="[ESF] 2v2 竞技房"
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label>
              <span>IP / 域名</span>
              <input
                value={form.ip}
                placeholder="127.0.0.1"
                onChange={(event) => setForm((prev) => ({ ...prev, ip: event.target.value }))}
              />
            </label>
            <label>
              <span>端口</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
              />
            </label>
            <label>
              <span>模式</span>
              <input
                value={form.mode}
                placeholder="混战 / 组队"
                onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}
              />
            </label>
            <label>
              <span>排序</span>
              <input
                type="number"
                value={form.sort}
                onChange={(event) => setForm((prev) => ({ ...prev, sort: event.target.value }))}
              />
            </label>
            <label className="admin-server-check">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span>在大厅展示</span>
            </label>
          </div>
          <div className="admin-server-form-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={cancel}>
              取消
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={Boolean(busy)}>
              {busy ? '保存中…' : creating ? '创建' : '保存修改'}
            </button>
          </div>
        </form>
      )}

      {loading && servers.length === 0 ? (
        <p className="admin-muted">正在读取服务器…</p>
      ) : servers.length === 0 ? (
        <p className="admin-muted">还没有登记服务器。</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-server-table">
            <thead>
              <tr>
                <th>服务器</th>
                <th>地址</th>
                <th>模式</th>
                <th>在线</th>
                <th>排序</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.serverKey}>
                  <td>
                    <b>{server.name}</b>
                    <small className="admin-server-key">{server.serverKey}</small>
                  </td>
                  <td>
                    <code>
                      {server.ip}:{server.port}
                    </code>
                  </td>
                  <td>{server.mode}</td>
                  <td>
                    <span className={`admin-server-online${server.online ? ' is-online' : ''}`}>
                      {server.online ? `${server.players}/${server.maxPlayers}` : '离线'}
                    </span>
                    {server.map ? <small className="admin-server-key">{server.map}</small> : null}
                  </td>
                  <td>{server.sort}</td>
                  <td>
                    <span className={`admin-server-enabled${server.enabled ? ' is-on' : ''}`}>
                      {server.enabled ? '展示中' : '已下架'}
                    </span>
                  </td>
                  <td>
                    <div className="admin-server-actions">
                      <button type="button" className="link" onClick={() => startEdit(server)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="link"
                        onClick={() => toggleEnabled(server)}
                        disabled={busy === server.serverKey}
                      >
                        {server.enabled ? '下架' : '启用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
