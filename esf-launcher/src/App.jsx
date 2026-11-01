import { useCallback, useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import Icon from './components/Icon';
import Toast from './components/Toast';
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import Lobby from './components/Lobby';
import './App.css';

function Splash({ message }) {
  return (
    <div className="splash">
      <div className="splash-mark">
        <Icon name="shield" size={30} />
      </div>
      <h1>ESF PLATFORM</h1>
      <p>{message}</p>
      <span className="splash-bar">
        <span />
      </span>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootMessage, setBootMessage] = useState('正在连接平台服务…');
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [backend, setBackend] = useState({ ok: false, message: '检测中…' });
  const [notice, setNotice] = useState('');
  const [inviteRequired, setInviteRequired] = useState(false);
  const [authPage, setAuthPage] = useState('login');
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, tone = 'ok') => {
    setToast({ message, tone, at: Date.now() });
  }, []);

  const checkBackend = useCallback(async () => {
    try {
      const config = await window.electronAPI.app.config();
      setBackend({
        ok: true,
        version: config.version,
        db: config.db,
        maintenance: config.maintenance,
      });
      setNotice(config.notice || '');
      setInviteRequired(Boolean(config.inviteRequired));
      return true;
    } catch (err) {
      setBackend({ ok: false, message: err.message });
      return false;
    }
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!window.electronAPI) {
        setBackend({ ok: false, message: '未在 Electron 环境运行' });
        setBooting(false);
        return;
      }

      try {
        const [loadedSettings, info] = await Promise.all([
          window.electronAPI.settings.get(),
          window.electronAPI.app.info(),
        ]);
        if (!alive) return;
        setSettings(loadedSettings);
        setAppInfo(info);
      } catch (err) {
        if (!alive) return;
        setBackend({ ok: false, message: err.message });
      }

      await checkBackend();
      if (!alive) return;

      setBootMessage('正在恢复登录状态…');
      try {
        const { user: me } = await window.electronAPI.auth.me();
        if (alive) setUser(me);
      } catch {
        /* 没登录就留在登录页 */
      } finally {
        if (alive) setBooting(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [checkBackend]);

  const handleLogin = async ({ username, password }) => {
    const result = await window.electronAPI.auth.login(username, password);
    setUser(result.user);
    showToast(`欢迎回来，${result.user.gameName || result.user.username}`, 'ok');
    await checkBackend();
  };

  const handleRegister = async (payload) => {
    await window.electronAPI.auth.register(payload);
    setAuthPage('login');
    showToast('账号创建成功，请登录', 'ok');
  };

  const handleLogout = async () => {
    try {
      await window.electronAPI.auth.logout();
    } catch {
      /* 本地照样清 */
    }
    setUser(null);
    setAuthPage('login');
    showToast('已退出登录', 'ok');
  };

  const handleSettingsChanged = (next) => {
    setSettings(next);
    checkBackend();
  };

  if (booting) return <Splash message={bootMessage} />;

  return (
    <div className="app-root">
      {user ? (
        <Lobby
          user={user}
          settings={settings}
          appInfo={appInfo}
          backend={backend}
          notice={notice}
          toast={showToast}
          onSettingsChanged={handleSettingsChanged}
          onLogout={handleLogout}
        />
      ) : (
        <div className="auth-shell">
          <TitleBar minimal />
          {authPage === 'login' ? (
            <LoginPage
              onLogin={handleLogin}
              onGoRegister={() => setAuthPage('register')}
              backend={backend}
              notice={notice}
            />
          ) : (
            <RegisterPage
              onRegister={handleRegister}
              onGoLogin={() => setAuthPage('login')}
              inviteRequired={inviteRequired}
            />
          )}
        </div>
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
