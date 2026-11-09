import { useEffect, useState } from 'react';
import Icon from './Icon';
import { isStaff } from '../lib/format';

/**
 * 右侧滑出的设置抽屉：平台地址、本地服务器标识、游戏目录、账号。
 * 关闭时由父组件卸载，所以 draft 直接以 settings 初始化即可，不需要 effect 同步。
 * 平台地址、数据目录这类开发向内容只对 staff（运营/管理员/所有者）展示。
 */
const AVATAR_CHOICES = ['🐉', '🔥', '⚡', '🛡️', '🐒', '🥋', '💫', '👑'];

function nextNameChangeLabel(value) {
  if (!value) return '明天';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '明天';
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function deviceLabel(ua) {
  const text = String(ua || '');
  const os = /Windows/i.test(text)
    ? 'Windows'
    : /Mac OS/i.test(text)
      ? 'macOS'
      : /Linux/i.test(text)
        ? 'Linux'
        : '未知系统';
  const app = /Electron/i.test(text) ? 'ESF 平台' : /Mozilla/i.test(text) ? '浏览器' : '客户端';
  return `${os} · ${app}`;
}

function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('图片无法识别'));
      image.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL('image/webp', 0.86));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

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
  onAvatarData,
  onGameNameChange,
  toast,
}) {
  const [draft, setDraft] = useState(settings || {});
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.gameName || '');
  const [savingName, setSavingName] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [autoStatus, setAutoStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [plugin, setPlugin] = useState(null);
  const [pluginBusy, setPluginBusy] = useState(false);
  const staff = isStaff(user?.role);

  // ---- 账号安全：改密 + 绑定邮箱 ----
  const [pwd, setPwd] = useState({ old: '', next: '', confirm: '' });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [mail, setMail] = useState({ email: user?.email || '', code: '' });
  const [mailBusy, setMailBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [boundEmail, setBoundEmail] = useState(user?.email || '');

  // ---- 0.4.16 两步验证 / 设备会话 ----
  const [totp, setTotp] = useState({
    enabled: Boolean(user?.totpEnabled),
    setup: null,
    code: '',
    password: '',
    busy: false,
    backupCodes: [],
  });
  const [sessions, setSessions] = useState([]);
  const [sessBusy, setSessBusy] = useState(false);

  const loadSessions = async () => {
    try {
      const res = await window.electronAPI.auth.sessions();
      setSessions((res?.data || res)?.sessions || []);
    } catch {
      /* 会话列表拉不到不影响设置页其它功能 */
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.electronAPI.auth.sessions();
        if (alive) setSessions((res?.data || res)?.sessions || []);
      } catch {
        /* 会话列表拉不到不影响设置页其它功能 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startTotp = async () => {
    if (totp.busy) return;
    setTotp((prev) => ({ ...prev, busy: true }));
    try {
      const res = await window.electronAPI.auth.totpSetup();
      const data = res?.data || res || {};
      setTotp((prev) => ({
        ...prev,
        busy: false,
        setup: { secret: data.secret, otpauthUrl: data.otpauthUrl },
        code: '',
      }));
    } catch (err) {
      setTotp((prev) => ({ ...prev, busy: false }));
      toast?.(err.message || '生成密钥失败', 'error');
    }
  };

  const confirmTotp = async () => {
    if (totp.busy || !/^\d{6}$/.test(totp.code)) return toast?.('请输入 6 位动态码', 'error');
    setTotp((prev) => ({ ...prev, busy: true }));
    try {
      const res = await window.electronAPI.auth.totpEnable(totp.code);
      const data = res?.data || res || {};
      setTotp((prev) => ({
        ...prev,
        busy: false,
        enabled: true,
        setup: null,
        code: '',
        backupCodes: data.backupCodes || [],
      }));
      toast?.('两步验证已开启', 'success');
      loadSessions();
    } catch (err) {
      setTotp((prev) => ({ ...prev, busy: false }));
      toast?.(err.message || '开启失败', 'error');
    }
  };

  const disableTotp = async () => {
    if (totp.busy || !totp.password) return toast?.('请输入密码以关闭两步验证', 'error');
    setTotp((prev) => ({ ...prev, busy: true }));
    try {
      await window.electronAPI.auth.totpDisable(totp.password);
      setTotp((prev) => ({
        ...prev,
        busy: false,
        enabled: false,
        password: '',
        backupCodes: [],
      }));
      toast?.('两步验证已关闭', 'success');
    } catch (err) {
      setTotp((prev) => ({ ...prev, busy: false }));
      toast?.(err.message || '关闭失败', 'error');
    }
  };

  const revokeSession = async (id) => {
    if (sessBusy) return;
    setSessBusy(true);
    try {
      await window.electronAPI.auth.revokeSession(id);
      await loadSessions();
      toast?.('该设备已退出登录', 'success');
    } catch (err) {
      toast?.(err.message || '操作失败', 'error');
    } finally {
      setSessBusy(false);
    }
  };

  const revokeOthers = async () => {
    if (sessBusy) return;
    setSessBusy(true);
    try {
      await window.electronAPI.auth.revokeOtherSessions();
      await loadSessions();
      toast?.('其它设备已全部退出', 'success');
    } catch (err) {
      toast?.(err.message || '操作失败', 'error');
    } finally {
      setSessBusy(false);
    }
  };

  const changePassword = async () => {
    if (pwdBusy) return;
    if (pwd.next.length < 8) return toast?.('新密码至少 8 位', 'error');
    if (pwd.next !== pwd.confirm) return toast?.('两次输入的新密码不一致', 'error');
    setPwdBusy(true);
    try {
      await window.electronAPI.auth.updateProfile({ oldPassword: pwd.old, newPassword: pwd.next });
      setPwd({ old: '', next: '', confirm: '' });
      toast?.('密码已修改，请重新登录', 'success');
      onLogout?.();
    } catch (err) {
      toast?.(err.message || '修改失败', 'error');
    } finally {
      setPwdBusy(false);
    }
  };

  const sendEmailCode = async () => {
    if (mailBusy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.email.trim())) {
      return toast?.('请输入正确的邮箱地址', 'error');
    }
    setMailBusy(true);
    try {
      await window.electronAPI.auth.bindEmailCode(mail.email.trim());
      setCodeSent(true);
      toast?.('验证码已发送，请查收邮件（含垃圾箱）', 'success');
    } catch (err) {
      toast?.(err.message || '发送失败', 'error');
    } finally {
      setMailBusy(false);
    }
  };

  const bindEmail = async () => {
    if (mailBusy) return;
    if (!/^\d{6}$/.test(mail.code)) return toast?.('请输入 6 位验证码', 'error');
    setMailBusy(true);
    try {
      await window.electronAPI.auth.bindEmail(mail.email.trim(), mail.code);
      setBoundEmail(mail.email.trim());
      setMail({ email: mail.email.trim(), code: '' });
      setCodeSent(false);
      toast?.('邮箱绑定成功', 'success');
    } catch (err) {
      toast?.(err.message || '绑定失败', 'error');
    } finally {
      setMailBusy(false);
    }
  };

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const dataUrl = await fileToAvatar(file);
      await onAvatarData?.(dataUrl);
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveGameName = async () => {
    const next = nameDraft.trim();
    if (!next || next === user?.gameName) return;

    setSavingName(true);
    try {
      await onGameNameChange?.(next);
      setNameDraft(next);
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setSavingName(false);
    }
  };

  useEffect(() => {
    let unsubscribe = null;
    window.electronAPI.update
      ?.status?.()
      .then((state) => setAutoStatus(state))
      .catch(() => {});

    unsubscribe = window.electronAPI.update?.onStatus?.((state) => setAutoStatus(state)) || null;
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    window.electronAPI.plugins
      .status()
      .then((data) => {
        if (alive) setPlugin(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [draft.esfModDir]);

  const togglePlugin = async () => {
    if (!plugin?.found) return;
    setPluginBusy(true);
    try {
      const next = await window.electronAPI.plugins.setEnforce(!plugin.enforce);
      setPlugin((prev) => ({ ...prev, enforce: next.enforce }));
      toast?.(next.enforce ? '已开启平台身份校验' : '已关闭平台身份校验，未登录也能进本地服', 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setPluginBusy(false);
    }
  };

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
            <h3>服务器插件</h3>
            <p className="drawer-hint">
              本地开图用的 AMXX 身份校验。关闭后，不登录平台也能直接进本地服务器。
            </p>

            {plugin?.found ? (
              <>
                <div className="plugin-row">
                  <span>
                    <b>平台身份校验</b>
                    <small>{plugin.enforce ? '开启 · 必须有平台凭证' : '关闭 · 游客可直接进入'}</small>
                  </span>
                  <button
                    type="button"
                    className={`plugin-toggle${plugin.enforce ? ' is-on' : ''}`}
                    onClick={togglePlugin}
                    disabled={pluginBusy}
                  >
                    <i />
                  </button>
                </div>
                <code className="plugin-path">{plugin.path}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-block"
                  onClick={() => window.electronAPI.plugins.openDir().catch((err) => toast?.(err.message, 'error'))}
                >
                  <Icon name="folder" size={14} /> 打开插件目录
                </button>
              </>
            ) : (
              <p className="drawer-hint">当前模组里没有找到 addons/amxx/configs/amxx.cfg。</p>
            )}
            <p className="drawer-hint">
              线上服务器需要在各自的 amxx.cfg 里设置 platform_enforce "0"，这里只改本地开图。
            </p>
          </section>

          <section className="drawer-section">
            <h3>平台连接</h3>
            <p className="drawer-hint">后端地址由平台统一维护，玩家不需要填写。</p>

            <div className="path-box">
              <span className="path-label">API</span>
              <code>{draft.apiBaseUrl || '未设置'}</code>
            </div>

            {staff && (
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
            )}

            <p className="inline-status">
              <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
              {backend?.ok
                ? `已连接 · v${backend.version || '0.0.0'}${backend.db === 'up' ? ' · 数据库正常' : ''}`
                : backend?.message || '未连接'}
            </p>
          </section>

          <section className="drawer-section">
            <h3>音效</h3>
            <p className="drawer-hint">界面点击、切页、匹配与结算的提示音；关闭后完全静音。</p>
            <label className="field field--row">
              <span className="field-label">界面音效</span>
              <button
                type="button"
                className={`switch${draft.soundEnabled !== false ? ' is-on' : ''}`}
                role="switch"
                aria-checked={draft.soundEnabled !== false}
                onClick={() => {
                  const next = { ...draft, soundEnabled: draft.soundEnabled === false };
                  setDraft(next);
                  onSave?.(next);
                }}
              >
                <i />
              </button>
            </label>
          </section>

          <section className="drawer-section">
            <h3>启动兼容</h3>
            <p className="drawer-hint">老电脑上游戏“起来了但没窗口”时打开：窗口化 800×600 + OpenGL + 固定堆大小。</p>
            <label className="field field--row">
              <span className="field-label">兼容模式（窗口化）</span>
              <button
                type="button"
                className={`switch${draft.compatMode ? ' is-on' : ''}`}
                role="switch"
                aria-checked={Boolean(draft.compatMode)}
                onClick={() => {
                  const next = { ...draft, compatMode: !draft.compatMode };
                  setDraft(next);
                  onSave?.(next);
                }}
              >
                <i />
              </button>
            </label>
            <button
              type="button"
              className="btn btn--ghost drawer-actions"
              onClick={async () => {
                try {
                  const result = await window.electronAPI.app.exportDiagnosis();
                  if (result?.canceled) return;
                  toast(`诊断包已导出：${result?.path || ''}`, 'ok');
                } catch (err) {
                  toast(err.message || '导出失败', 'error');
                }
              }}
            >
              <Icon name="download" size={15} /> 导出诊断包
            </button>
            <p className="drawer-hint">包含启动参数、游戏进程与最近启动日志，老电脑出问题发这个就行。</p>
          </section>

          <section className="drawer-section">
            <h3>账号安全</h3>
            <p className="drawer-hint">绑定邮箱后，忘记密码可以自助重置，不用再找管理员。</p>

            <div className="path-box">
              <span className="path-label">已绑定邮箱</span>
              <code>{boundEmail || '未绑定'}</code>
            </div>

            <label className="field">
              <span className="field-label">QQ 邮箱</span>
              <div className="field-input">
                <Icon name="shield" size={16} />
                <input
                  type="email"
                  value={mail.email}
                  placeholder="you@qq.com"
                  onChange={(e) => setMail({ ...mail, email: e.target.value })}
                />
              </div>
            </label>

            {codeSent ? (
              <label className="field">
                <span className="field-label">6 位验证码</span>
                <div className="field-input">
                  <Icon name="shield" size={16} />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={mail.code}
                    placeholder="123456"
                    onChange={(e) =>
                      setMail({ ...mail, code: e.target.value.replace(/\D/g, '').slice(0, 6) })
                    }
                  />
                </div>
              </label>
            ) : null}

            <div className="drawer-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={sendEmailCode}
                disabled={mailBusy}
              >
                {codeSent ? '重新发送验证码' : '发送验证码'}
              </button>
              {codeSent ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={bindEmail}
                  disabled={mailBusy}
                >
                  绑定邮箱
                </button>
              ) : null}
            </div>

            <h4 className="drawer-subhead">修改密码</h4>
            <label className="field">
              <span className="field-label">当前密码</span>
              <div className="field-input">
                <Icon name="shield" size={16} />
                <input
                  type="password"
                  value={pwd.old}
                  autoComplete="current-password"
                  onChange={(e) => setPwd({ ...pwd, old: e.target.value })}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">新密码</span>
              <div className="field-input">
                <Icon name="shield" size={16} />
                <input
                  type="password"
                  value={pwd.next}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">确认新密码</span>
              <div className="field-input">
                <Icon name="shield" size={16} />
                <input
                  type="password"
                  value={pwd.confirm}
                  autoComplete="new-password"
                  onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                />
              </div>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-block"
              onClick={changePassword}
              disabled={pwdBusy || !pwd.old || !pwd.next}
            >
              {pwdBusy ? '修改中…' : '修改密码（改完需重新登录）'}
            </button>

            <h4 className="drawer-subhead">两步验证（2FA）</h4>
            {totp.enabled ? (
              <>
                <p className="drawer-hint">
                  已开启。登录时除了密码，还需要输入验证器 App 里的 6 位动态码。
                </p>
                {totp.backupCodes.length ? (
                  <div className="path-box">
                    <span className="path-label">备用码（只显示一次，请抄下来）</span>
                    <code>{totp.backupCodes.join('  ')}</code>
                  </div>
                ) : null}
                <label className="field">
                  <span className="field-label">当前密码（用于关闭）</span>
                  <div className="field-input">
                    <Icon name="shield" size={16} />
                    <input
                      type="password"
                      value={totp.password}
                      autoComplete="current-password"
                      onChange={(e) => setTotp({ ...totp, password: e.target.value })}
                    />
                  </div>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-block"
                  onClick={disableTotp}
                  disabled={totp.busy || !totp.password}
                >
                  {totp.busy ? '处理中…' : '关闭两步验证'}
                </button>
              </>
            ) : totp.setup ? (
              <>
                <p className="drawer-hint">
                  用验证器 App（Google Authenticator / Microsoft Authenticator）添加下面这串密钥，或手动输入：
                </p>
                <div className="path-box">
                  <span className="path-label">密钥（Base32）</span>
                  <code>{totp.setup.secret}</code>
                </div>
                <div className="path-box">
                  <span className="path-label">otpauth 链接</span>
                  <code>{totp.setup.otpauthUrl}</code>
                </div>
                <label className="field">
                  <span className="field-label">输入 App 显示的 6 位码</span>
                  <div className="field-input">
                    <Icon name="shield" size={16} />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={totp.code}
                      placeholder="123456"
                      onChange={(e) =>
                        setTotp({ ...totp, code: e.target.value.replace(/\D/g, '').slice(0, 6) })
                      }
                    />
                  </div>
                </label>
                <div className="drawer-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={confirmTotp}
                    disabled={totp.busy || totp.code.length !== 6}
                  >
                    {totp.busy ? '确认中…' : '确认开启'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setTotp({ ...totp, setup: null, code: '' })}
                    disabled={totp.busy}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="drawer-hint">开启后，即使密码泄露，别人没有你的手机也无法登录。</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-block"
                  onClick={startTotp}
                  disabled={totp.busy}
                >
                  {totp.busy ? '生成中…' : '开启两步验证'}
                </button>
              </>
            )}

            <h4 className="drawer-subhead">登录设备</h4>
            <div className="session-list">
              {sessions.length === 0 ? (
                <p className="drawer-hint">暂无会话记录。</p>
              ) : (
                sessions.map((item) => (
                  <div key={item.id} className={`session-row${item.current ? ' is-current' : ''}`}>
                    <div className="session-main">
                      <b>{item.current ? '本机（当前）' : deviceLabel(item.userAgent)}</b>
                      <span>
                        {item.ip || '-'} · {item.lastSeenAt ? String(item.lastSeenAt).slice(0, 10) : '-'}
                      </span>
                    </div>
                    {item.current ? (
                      <span className="session-tag">当前</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => revokeSession(item.id)}
                        disabled={sessBusy}
                      >
                        退出
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-block"
              onClick={revokeOthers}
              disabled={sessBusy || sessions.filter((s) => !s.current).length === 0}
            >
              {sessBusy ? '处理中…' : '退出其它所有设备'}
            </button>
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

            <div className="avatar-upload-row">
              <label className={`btn btn-ghost btn-sm${uploadingAvatar ? ' is-busy' : ''}`}>
                {uploadingAvatar ? <span className="spinner" /> : <Icon name="spark" size={14} />}
                {uploadingAvatar ? '处理中…' : '上传自定义头像'}
                <input type="file" accept="image/*" hidden onChange={uploadAvatar} />
              </label>
              {user?.avatarUrl ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onAvatarData?.('')}
                >
                  恢复文字头像
                </button>
              ) : null}
            </div>
            <p className="drawer-hint">支持 jpg / png / webp，自动裁成方形，建议用清晰的头像图。</p>

            <div className="profile-name-block">
              <label className="profile-name-field">
                <span className="field-label">账号</span>
                <div className="profile-name-readonly">
                  <Icon name="user" size={14} />
                  <b>{user?.username || '—'}</b>
                  <em>不可修改</em>
                </div>
              </label>

              <label className="profile-name-field">
                <span className="field-label">游戏昵称</span>
                <div className="profile-name-row">
                  <input
                    className="profile-name-input"
                    type="text"
                    maxLength={16}
                    value={nameDraft}
                    disabled={!user?.canChangeGameName || savingName}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        saveGameName();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!user?.canChangeGameName || savingName || !nameDraft.trim() || nameDraft.trim() === user?.gameName}
                    onClick={saveGameName}
                  >
                    {savingName ? <span className="spinner" /> : '保存'}
                  </button>
                </div>
                <small className={`profile-name-hint${user?.canChangeGameName ? '' : ' is-locked'}`}>
                  {user?.canChangeGameName
                    ? '每天可修改 1 次，进入服务器会自动同步'
                    : `今天已修改，${nextNameChangeLabel(user?.nextGameNameChangeAt)} 后可再改`}
                </small>
              </label>
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
              disabled={checking || autoStatus?.status === 'downloading'}
              onClick={async () => {
                setChecking(true);
                try {
                  if (autoStatus?.status === 'downloaded') {
                    await window.electronAPI.update.install();
                    return;
                  }

                  const auto = await window.electronAPI.update.autoCheck();
                  if (auto && (auto.status === 'dev' || auto.status === 'unconfigured')) {
                    const info = await window.electronAPI.update.check();
                    setUpdateInfo(info);
                    toast(
                      auto.status === 'dev'
                        ? '开发模式下只做版本对比，不下载安装包'
                        : '还没配置自动更新源，先用手动检查',
                      'ok'
                    );
                    return;
                  }

                  if (auto?.status === 'current') {
                    toast('已经是最新版本', 'ok');
                    return;
                  }

                  if (auto?.status === 'checking' || auto?.status === 'available') {
                    toast('已开始检查更新，下载进度会显示在下方', 'ok');
                    return;
                  }

                  if (auto?.status === 'downloaded') {
                    toast(`v${auto.version || ''} 已下载，点按钮重启安装`, 'ok');
                    return;
                  }

                  if (auto?.status === 'error') {
                    toast(auto.message || '检查更新失败', 'error');
                  }
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? (
                <span className="spinner" />
              ) : autoStatus?.status === 'downloaded' ? (
                <Icon name="download" size={14} />
              ) : (
                <Icon name="refresh" size={14} />
              )}
              {checking
                ? '检查中…'
                : autoStatus?.status === 'downloaded'
                  ? `重启安装 v${autoStatus.version || ''}`
                  : '检查更新'}
            </button>

            {autoStatus && ['checking', 'available', 'downloading', 'downloaded', 'error'].includes(autoStatus.status) && (
              <p className="update-status">
                {autoStatus.status === 'checking' && '正在检查更新…'}
                {autoStatus.status === 'available' && `发现 v${autoStatus.version}，正在下载…`}
                {autoStatus.status === 'downloading' && `下载中 ${autoStatus.percent || 0}%`}
                {autoStatus.status === 'downloaded' && `v${autoStatus.version} 已下载，重启后生效`}
                {autoStatus.status === 'error' && `更新失败：${autoStatus.message}`}
              </p>
            )}

            {autoStatus?.status === 'downloading' && (
              <div className="update-progress">
                <span style={{ width: `${autoStatus.percent || 0}%` }} />
              </div>
            )}

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
