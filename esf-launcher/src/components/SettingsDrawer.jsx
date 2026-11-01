import { useState } from 'react';
import Icon from './Icon';
import { isStaff } from '../lib/format';

/**
 * 右侧滑出的设置抽屉：平台地址、本地服务器标识、游戏目录、账号。
 * 关闭时由父组件卸载，所以 draft 直接以 settings 初始化即可，不需要 effect 同步。
 * 平台地址、数据目录这类开发向内容只对 staff（运营/管理员/所有者）展示。
 */
const AVATAR_CHOICES = ['🐉', '🔥', '⚡', '🛡️', '🐒', '🥋', '💫', '👑'];

export default function SettingsDrawer({
  settings,
  appInfo,
  backend,
  user,
  onClose,
  onSave,
  onPickGameDir,
  onLogout,
  onAvatarChange,
  toast,
}) {
  const [draft, setDraft] = useState(settings || {});
  const [busy, setBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const staff = isStaff(user?.role);

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
            <p className="drawer-hint">
              {staff ? '后端地址。队友换机器时改这里指向同一台服务器。' : '平台服务状态。地址由管理员维护。'}
            </p>

            {staff && (
              <>
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
              </>
            )}

            <p className="inline-status">
              <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
              {backend?.ok
                ? `已连接 · v${backend.version || '0.0.0'}${backend.db === 'up' ? ' · 数据库正常' : ''}`
                : backend?.message || '未连接'}
            </p>
          </section>

          <section className="drawer-section">
            <h3>账号</h3>
            <p className="drawer-hint">头像会显示在标题栏、在线列表和大厅频道里。</p>

            <div className="avatar-picker">
              {AVATAR_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={`avatar-option${user?.avatar === choice ? ' is-active' : ''}`}
                  onClick={() => onAvatarChange?.(choice)}
                  title={`使用 ${choice} 作为头像`}
                >
                  {choice}
                </button>
              ))}
              <button
                type="button"
                className={`avatar-option avatar-option--reset${user?.avatar ? '' : ' is-active'}`}
                onClick={() => onAvatarChange?.('')}
                title="用昵称首字"
              >
                首字
              </button>
            </div>

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
                <dt>最新版本</dt>
                <dd>{updateInfo ? `v${updateInfo.latest}` : '点下面检查'}</dd>
              </div>
              {staff && (
                <>
                  <div>
                    <dt>Electron</dt>
                    <dd>{appInfo?.electron || '—'}</dd>
                  </div>
                  <div>
                    <dt>数据目录</dt>
                    <dd className="kv-path">{appInfo?.userDataDir || '—'}</dd>
                  </div>
                </>
              )}
            </dl>

            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 10 }}
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  const info = await window.electronAPI.update.check();
                  setUpdateInfo(info);
                  toast(
                    info.hasUpdate
                      ? `发现新版本 v${info.latest}（当前 v${info.current}）`
                      : `已经是最新版本 v${info.current}`,
                    'ok'
                  );
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
              {checking ? '检查中…' : '检查更新'}
            </button>

            {updateInfo?.hasUpdate && updateInfo.downloadUrl ? (
              <button
                type="button"
                className="btn btn-primary btn-block"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  try {
                    await window.electronAPI.shell.openExternal(updateInfo.downloadUrl);
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }}
              >
                <Icon name="external" size={14} /> 下载 v{updateInfo.latest}
              </button>
            ) : null}

            {staff && (
              <button
                type="button"
                className="btn btn-ghost btn-block"
                style={{ marginTop: 8 }}
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
            )}
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
