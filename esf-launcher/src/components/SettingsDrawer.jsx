import { useState } from 'react';
import Icon from './Icon';

/**
 * 右侧滑出的设置抽屉：平台地址、本地服务器标识、游戏目录、账号。
 * 关闭时由父组件卸载，所以 draft 直接以 settings 初始化即可，不需要 effect 同步。
 */
export default function SettingsDrawer({
  settings,
  appInfo,
  backend,
  onClose,
  onSave,
  onPickGameDir,
  onLogout,
  toast,
}) {
  const [draft, setDraft] = useState(settings || {});
  const [busy, setBusy] = useState(false);

  const update = (key) => (event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }));

  const pickDir = async () => {
    setBusy(true);
    try {
      const picked = await onPickGameDir();
      setDraft((prev) => ({ ...prev, hlPath: picked.hlPath, esfModDir: picked.modDir }));
    } catch (err) {
      if (err.code !== 'CANCELED') toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        apiBaseUrl: draft.apiBaseUrl?.trim() || 'http://127.0.0.1:3000',
        localServerKey: draft.localServerKey?.trim() || 'fcx-1v1-1',
      });
      toast('设置已保存', 'ok');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-root">
      <button type="button" className="drawer-backdrop" aria-label="关闭设置" onClick={onClose} />

      <aside className="drawer" role="dialog" aria-modal="true" aria-label="平台设置">
        <header className="drawer-head">
          <h2>
            <Icon name="settings" size={17} /> 平台设置
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <h3>游戏目录</h3>
            <p className="drawer-hint">启动器需要知道 hl.exe 和 esf 模组文件夹的位置。</p>

            <div className="path-box">
              <span className="path-label">hl.exe</span>
              <code>{draft.hlPath || '未设置'}</code>
            </div>
            <div className="path-box">
              <span className="path-label">模组</span>
              <code>{draft.esfModDir || '未设置'}</code>
            </div>

            <button type="button" className="btn btn-ghost btn-block" onClick={pickDir} disabled={busy}>
              <Icon name="folder" size={15} /> 选择游戏目录
            </button>
          </section>

          <section className="drawer-section">
            <h3>平台连接</h3>
            <p className="drawer-hint">后端地址。队友换机器时改这里指向同一台服务器。</p>

            <label className="field">
              <span className="field-label">API 地址</span>
              <div className="field-input">
                <Icon name="wifi" size={16} />
                <input
                  type="text"
                  value={draft.apiBaseUrl || ''}
                  placeholder="http://127.0.0.1:3000"
                  onChange={update('apiBaseUrl')}
                />
              </div>
            </label>

            <label className="field">
              <span className="field-label">本地开图用的服务器标识</span>
              <div className="field-input">
                <Icon name="server" size={16} />
                <input
                  type="text"
                  value={draft.localServerKey || ''}
                  placeholder="fcx-1v1-1"
                  onChange={update('localServerKey')}
                />
              </div>
            </label>

            <p className="inline-status">
              <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
              {backend?.ok
                ? `已连接 · v${backend.version || '0.0.0'}${backend.db === 'up' ? ' · 数据库正常' : ''}`
                : backend?.message || '未连接'}
            </p>
          </section>

          <section className="drawer-section">
            <h3>账号</h3>
            <div className="drawer-actions">
              <button type="button" className="btn btn-ghost btn-block" onClick={onLogout}>
                <Icon name="logout" size={15} /> 退出登录
              </button>
            </div>
          </section>

          <section className="drawer-section drawer-section--muted">
            <h3>关于</h3>
            <dl className="kv">
              <div>
                <dt>启动器</dt>
                <dd>v{appInfo?.version || '—'}</dd>
              </div>
              <div>
                <dt>Electron</dt>
                <dd>{appInfo?.electron || '—'}</dd>
              </div>
              <div>
                <dt>数据目录</dt>
                <dd className="kv-path">{appInfo?.userDataDir || '—'}</dd>
              </div>
            </dl>

            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 10 }}
              onClick={async () => {
                try {
                  await window.electronAPI.shell.openDataDir();
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
            >
              <Icon name="external" size={14} /> 打开数据目录
            </button>
          </section>
        </div>

        <footer className="drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={15} />} 保存
          </button>
        </footer>
      </aside>
    </div>
  );
}
