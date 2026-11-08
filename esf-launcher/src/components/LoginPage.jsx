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
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [forgot, setForgot] = useState(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotInfo, setForgotInfo] = useState('');
  const [two, setTwo] = useState(null);
  const noticeLong = String(notice || '').length > 46;

  const openForgot = () => {
    setForgot({ step: 1, account: username.trim(), code: '', token: '', password: '', confirm: '' });
    setForgotError('');
    setForgotInfo('');
  };

  const runForgot = async (event) => {
    event.preventDefault();
    if (forgotBusy || !forgot) return;
    const api = window.electronAPI?.auth;
    setForgotBusy(true);
    setForgotError('');
    try {
      if (forgot.step === 1) {
        const account = String(forgot.account || '').trim();
        if (!account) throw new Error('请输入账号或邮箱');
        const res = await api.forgotSend(account);
        const data = res?.data || res || {};
        setForgotInfo(data.maskedEmail ? `验证码已发送到 ${data.maskedEmail}` : '如果该账号已绑定邮箱，验证码会在 1 分钟内送达');
        setForgot({ ...forgot, step: 2 });
      } else if (forgot.step === 2) {
        if (!/^\d{6}$/.test(forgot.code)) throw new Error('请输入 6 位数字验证码');
        const res = await api.forgotVerify(forgot.account.trim(), forgot.code);
        const data = res?.data || res || {};
        if (!data.resetToken) throw new Error('验证失败，请重新获取验证码');
        setForgot({ ...forgot, step: 3, token: data.resetToken });
        setForgotInfo('验证通过，请设置新密码');
      } else {
        if (forgot.password.length < 8) throw new Error('新密码至少 8 位');
        if (forgot.password !== forgot.confirm) throw new Error('两次输入的密码不一致');
        await api.forgotReset(forgot.token, forgot.password);
        setForgot(null);
        setPassword('');
        setError('');
        setForgotInfo('密码已重置，请用新密码登录');
      }
    } catch (err) {
      setForgotError(err.message || '操作失败');
    } finally {
      setForgotBusy(false);
    }
  };

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
      const result = await onLogin({ username: name, password });
      if (result?.twoFactorRequired) {
        setTwo({ challengeToken: result.challengeToken, code: '', busy: false, error: '' });
      }
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const submitTwo = async (event) => {
    event.preventDefault();
    if (!two || two.busy) return;
    if (!/^\d{6}$/.test(two.code) && !/^[A-Za-z0-9-]{8,}$/.test(two.code)) {
      setTwo({ ...two, error: '请输入 6 位动态码或备用码' });
      return;
    }
    setTwo({ ...two, busy: true, error: '' });
    try {
      await onLogin({ challengeToken: two.challengeToken, code: two.code });
      setTwo(null);
    } catch (err) {
      setTwo({ ...two, busy: false, error: err.message || '验证失败' });
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
            <div className={`notice-strip${noticeOpen ? ' is-open' : ''}`}>
              <Icon name="bell" size={14} />
              <span>{notice}</span>
              {noticeLong ? (
                <button type="button" className="notice-more" onClick={() => setNoticeOpen((v) => !v)}>
                  {noticeOpen ? '收起' : '展开'}
                </button>
              ) : null}
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
            <span className="auth-switch-sep">·</span>
            <button type="button" className="link" onClick={openForgot}>
              忘记密码
            </button>
          </p>

          {forgotInfo ? (
            <p className="form-hint">
              <Icon name="check" size={14} /> {forgotInfo}
            </p>
          ) : null}

          {two ? (
            <div className="auth-forgot">
              <form className="auth-forgot-card" onSubmit={submitTwo}>
                <header className="auth-forgot-head">
                  <span className="eyebrow">两步验证</span>
                  <h3>输入动态码</h3>
                  <p>打开验证器 App，输入当前 6 位数字；也可以用备用码</p>
                </header>
                <label className="field">
                  <span className="field-label">动态码 / 备用码</span>
                  <div className="field-input">
                    <Icon name="shield" size={16} />
                    <input
                      type="text"
                      value={two.code}
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6 位数字，或 XXXX-XXXX"
                      onChange={(event) => setTwo({ ...two, code: event.target.value.trim() })}
                    />
                  </div>
                </label>
                {two.error ? (
                  <p className="form-error">
                    <Icon name="alert" size={14} /> {two.error}
                  </p>
                ) : null}
                <button type="submit" className="btn btn-primary btn-block" disabled={two.busy}>
                  {two.busy ? <span className="spinner" /> : null}
                  {two.busy ? '验证中…' : '完成登录'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => setTwo(null)}
                  disabled={two.busy}
                >
                  返回账号密码登录
                </button>
              </form>
            </div>
          ) : null}

          {forgot ? (
            <div className="auth-forgot">
              <form className="auth-forgot-card" onSubmit={runForgot}>
                <header className="auth-forgot-head">
                  <span className="eyebrow">找回密码</span>
                  <h3>
                    {forgot.step === 1 ? '确认账号' : forgot.step === 2 ? '输入验证码' : '设置新密码'}
                  </h3>
                  <p>第 {forgot.step} / 3 步</p>
                </header>

                {forgot.step === 1 ? (
                  <label className="field">
                    <span className="field-label">账号或已绑定邮箱</span>
                    <div className="field-input">
                      <Icon name="user" size={16} />
                      <input
                        type="text"
                        value={forgot.account}
                        autoFocus
                        placeholder="例如 yun 或 you@qq.com"
                        onChange={(e) => setForgot({ ...forgot, account: e.target.value })}
                      />
                    </div>
                  </label>
                ) : null}

                {forgot.step === 2 ? (
                  <label className="field">
                    <span className="field-label">6 位验证码</span>
                    <div className="field-input">
                      <Icon name="shield" size={16} />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={forgot.code}
                        autoFocus
                        placeholder="123456"
                        onChange={(e) =>
                          setForgot({ ...forgot, code: e.target.value.replace(/\D/g, '').slice(0, 6) })
                        }
                      />
                    </div>
                  </label>
                ) : null}

                {forgot.step === 3 ? (
                  <>
                    <label className="field">
                      <span className="field-label">新密码</span>
                      <div className="field-input">
                        <Icon name="shield" size={16} />
                        <input
                          type="password"
                          value={forgot.password}
                          autoFocus
                          placeholder="至少 8 位"
                          onChange={(e) => setForgot({ ...forgot, password: e.target.value })}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span className="field-label">再输一次</span>
                      <div className="field-input">
                        <Icon name="shield" size={16} />
                        <input
                          type="password"
                          value={forgot.confirm}
                          placeholder="确认新密码"
                          onChange={(e) => setForgot({ ...forgot, confirm: e.target.value })}
                        />
                      </div>
                    </label>
                  </>
                ) : null}

                {forgotError ? (
                  <p className="form-error">
                    <Icon name="alert" size={14} /> {forgotError}
                  </p>
                ) : null}

                <button type="submit" className="btn btn-primary btn-block" disabled={forgotBusy}>
                  {forgotBusy ? <span className="spinner" /> : null}
                  {forgotBusy
                    ? '处理中…'
                    : forgot.step === 1
                      ? '发送验证码'
                      : forgot.step === 2
                        ? '验证'
                        : '重置密码'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => setForgot(null)}
                  disabled={forgotBusy}
                >
                  返回登录
                </button>
              </form>
            </div>
          ) : null}

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
