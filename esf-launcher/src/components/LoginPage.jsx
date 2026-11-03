import { useState } from 'react';
import Icon from './Icon';
import loginBg from '../assets/login-bg.jpg';
import dragonBall from '../assets/dragon-ball.webp';

export default function LoginPage({ onLogin, onGoRegister, onGuest, backend, notice }) {
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
    <div className="auth auth--cinematic">
      <div className="auth-bg" style={{ backgroundImage: `url(${loginBg})` }} aria-hidden="true" />
      <div className="auth-veil" aria-hidden="true" />

      <div className="auth-visual">
        <div className="auth-visual-inner">
          <span className="eyebrow auth-eyebrow">
            <span className="eyebrow-line" />
            DRAGON BALL · ESF
          </span>
          <h1>
            把对局
            <br />
            变成一段<em>旅程</em>
          </h1>
          <p>
            账号、服务器、连服凭证全部打通。
            <br />
            从平台启动，游戏里自动认领身份。
          </p>

          <ul className="auth-points">
            <li>
              <Icon name="shield" size={15} />
              <span>一次性连服凭证，进服自动校验</span>
            </li>
            <li>
              <Icon name="signal" size={15} />
              <span>实时服务器状态与延迟</span>
            </li>
            <li>
              <Icon name="clock" size={15} />
              <span>在线时长与对局记录</span>
            </li>
          </ul>

          <div className="auth-caption">
            <span>POWERED BY ESF PLATFORM</span>
            <span className="auth-caption-dot" />
            <span>v{backend?.version || '0.0.0'}</span>
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <form className="auth-card auth-card--cinematic" onSubmit={submit}>
          <div className="auth-emblem">
            <img src={dragonBall} alt="" />
          </div>

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

          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={onGuest}
            disabled={busy}
          >
            <Icon name="play" size={15} /> 不登录，直接进游戏
          </button>

          <p className="auth-switch">
            还没有账号？
            <button type="button" className="link" onClick={onGoRegister}>
              立即注册
            </button>
          </p>

          <footer className="auth-foot">
            <span className={`dot dot--${backend?.ok ? 'on' : 'off'}`} />
            {backend?.ok
              ? `平台服务在线 · v${backend.version || '0.0.0'}`
              : backend?.message || '平台服务未连接'}
          </footer>
        </form>
      </div>
    </div>
  );
}
