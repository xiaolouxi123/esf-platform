import { useCallback, useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import Icon from './components/Icon';
import Toast from './components/Toast';
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import Lobby from './components/Lobby';
import { setSoundEnabled, playSfx } from './lib/sfx';
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
    if (tone === 'error') playSfx('error');
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
        setSoundEnabled(loadedSettings?.soundEnabled !== false);
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
    let me = result.user;
    try {
      // 登录响应只带基础字段；再拉一次 /me 获取改名冷却等资料元数据。
      const fresh = await window.electronAPI.auth.me();
      if (fresh?.user) me = fresh.user;
    } catch {
      /* 元数据拿不到时不影响登录 */
    }
    setUser(me);
    showToast(`欢迎回来，${me.gameName || me.username}`, 'ok');
    await checkBackend();
  };

  const handleGuest = async () => {
    try {
      const result = await window.electronAPI.launch.guest();
      showToast(result.switched ? '已重启游戏，平台已收进托盘' : '已启动游戏，平台已收进托盘', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    }
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
    setSoundEnabled(next?.soundEnabled !== false);
    checkBackend();
  };

  const handleAvatarChange = async (avatar) => {
    try {
      const result = await window.electronAPI.auth.updateProfile({ avatar });
      setUser(result.user);
      showToast(avatar ? `头像已换成 ${avatar}` : '头像已改回昵称首字', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleAvatarData = async (avatarData) => {
    try {
      const result = await window.electronAPI.auth.updateProfile({ avatarData });
      setUser(result.user);
      showToast(avatarData ? '自定义头像已更新' : '头像已恢复为文字', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleGameNameChange = async (gameName) => {
    const result = await window.electronAPI.auth.updateProfile({ gameName });
    setUser(result.user);
    showToast('游戏昵称已更新，进入服务器会自动同步', 'ok');
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
          onAvatarChange={handleAvatarChange}
          onAvatarData={handleAvatarData}
          onGameNameChange={handleGameNameChange}
        />
      ) : (
        <div className="auth-shell">
          <TitleBar minimal />
          {authPage === 'login' ? (
            <LoginPage
              onLogin={handleLogin}
              onGoRegister={() => setAuthPage('register')}
              onGuest={handleGuest}
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
