import { useState } from 'react';
import Icon from './Icon';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export default function RegisterPage({ onRegister, onGoLogin, inviteRequired }) {
  const [form, setForm] = useState({
    username: '',
    gameName: '',
    password: '',
    confirm: '',
    inviteCode: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const username = form.username.trim();
    const gameName = form.gameName.trim();

    if (!USERNAME_RE.test(username)) return setError('账号需 3~20 位字母 / 数字 / 下划线');
    if (form.password.length < 8) return setError('密码至少 8 位');
    if (form.password !== form.confirm) return setError('两次输入的密码不一致');
    if (gameName && gameName.length > 16) return setError('游戏昵称最多 16 个字');

    setBusy(true);
    setError('');
    try {
      await onRegister({
        username,
        password: form.password,
        gameName: gameName || undefined,
        inviteCode: form.inviteCode.trim() || undefined,
      });
    } catch (err) {
      setError(err.message || '注册失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-visual">
        <div className="auth-visual-inner">
          <span className="eyebrow">
            <Icon name="spark" size={14} /> JOIN THE PLATFORM
          </span>
          <h1>
            三十秒
            <br />
            开一局
          </h1>
          <p>注册后即可查看在线房间、一键连服，游戏内自动带上平台身份。</p>

          <ul className="auth-points">
            <li>
              <Icon name="users" size={15} /> 昵称支持中文，游戏内显示
            </li>
            <li>
              <Icon name="shield" size={15} /> 密码 bcrypt 加密存储
            </li>
            <li>
              <Icon name="server" size={15} /> 房间列表实时刷新
            </li>
          </ul>
        </div>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <header className="auth-card-head">
            <h2>创建账号</h2>
            <p>账号用于登录，昵称用于游戏内显示</p>
          </header>

          <div className="field-row">
            <label className="field">
              <span className="field-label">账号</span>
              <div className="field-input">
                <Icon name="user" size={16} />
                <input
                  type="text"
                  value={form.username}
                  autoFocus
                  autoComplete="username"
                  placeholder="wo_shi_5"
                  onChange={update('username')}
                />
              </div>
            </label>

            <label className="field">
              <span className="field-label">游戏昵称</span>
              <div className="field-input">
                <input
                  type="text"
                  value={form.gameName}
                  placeholder="留空则用账号"
                  onChange={update('gameName')}
                />
              </div>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field-label">密码</span>
              <div className="field-input">
                <input
                  type="password"
                  value={form.password}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  onChange={update('password')}
                />
              </div>
            </label>

            <label className="field">
              <span className="field-label">确认密码</span>
              <div className="field-input">
                <input
                  type="password"
                  value={form.confirm}
                  autoComplete="new-password"
                  placeholder="再输一次"
                  onChange={update('confirm')}
                />
              </div>
            </label>
          </div>

          {inviteRequired ? (
            <label className="field">
              <span className="field-label">邀请码</span>
              <div className="field-input">
                <Icon name="gift" size={16} />
                <input
                  type="text"
                  value={form.inviteCode}
                  placeholder="本平台当前需要邀请码"
                  onChange={update('inviteCode')}
                />
              </div>
            </label>
          ) : null}

          {error ? (
            <p className="form-error">
              <Icon name="alert" size={14} /> {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="plus" size={15} />}
            {busy ? '创建中…' : '创建账号'}
          </button>

          <p className="auth-switch">
            已经有账号了？
            <button type="button" className="link" onClick={onGoLogin}>
              返回登录
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
