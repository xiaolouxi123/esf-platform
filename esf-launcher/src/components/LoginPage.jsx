import { useState } from 'react';
import Icon from './Icon';
import ServerSetting from './ServerSetting';

export default function LoginPage({ onLogin, onGoRegister, backend, notice, onServerChange }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const name = username.trim();
    if (!name || !password) {
      setError('请输入账号和密码');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onLogin({ username: name, password });
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-visual">
        <div className="auth-visual-inner">
          <span className="eyebrow">
            <Icon name="spark" size={14} /> DRAGON BALL · ESF
          </span>
          <h1>
            把对局
            <br />
            变成一段旅程
          </h1>
          <p>账号、服务器、连服凭证全部打通。从平台启动，游戏里自动认领身份。</p>

          <ul className="auth-points">
            <li>
              <Icon name="shield" size={15} /> 一次性连服凭证，进服自动校验
            </li>
            <li>
              <Icon name="signal" size={15} /> 实时服务器状态与延迟
            </li>
            <li>
              <Icon name="clock" size={15} /> 在线时长与对局记录
            </li>
          </ul>
        </div>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <header className="auth-card-head">
            <h2>登录平台</h2>
            <p>使用你的 ESF 账号进入大厅</p>
          </header>

          {notice ? (
            <div className="notice-strip">
              <Icon name="bell" size={14} />
              <span>{notice}</span>
            </div>
          ) : null}

          <label className="field">
            <span className="field-label">账号</span>
            <div className="field-input">
              <Icon name="user" size={16} />
              <input
                type="text"
                value={username}
                autoFocus
                autoComplete="username"
                placeholder="3~20 位字母 / 数字 / 下划线"
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </label>

          <label className="field">
            <span className="field-label">密码</span>
            <div className="field-input">
              <Icon name="shield" size={16} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                placeholder="至少 8 位"
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="field-action"
                onClick={() => setShowPassword((value) => !value)}
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
              </button>
            </div>
          </label>

          {error ? (
            <p className="form-error">
              <Icon name="alert" size={14} /> {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="play" size={15} />}
            {busy ? '登录中…' : '进入大厅'}
          </button>

          <p className="auth-switch">
            还没有账号？
            <button type="button" className="link" onClick={onGoRegister}>
              立即注册
            </button>
          </p>

          <ServerSetting onChanged={onServerChange} />

          <footer className="auth-foot">
            <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
            {backend?.ok ? `平台服务在线 · v${backend.version || '0.0.0'}` : backend?.message || '平台服务未连接'}
          </footer>
        </form>
      </div>
    </div>
  );
}
