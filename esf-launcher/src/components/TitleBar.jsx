import Icon from './Icon';
import Avatar from './Avatar';
import { isStaff, roleLabel } from '../lib/format';
import dragonBall from '../assets/dragon-ball.webp';

/**
 * 自定义标题栏。
 * 无边框窗口（frame:false）必须自己做拖拽区和最小化/关闭按钮，
 * 否则窗口既拖不动也关不掉。
 */
export default function TitleBar({
  page = 'lobby',
  onPage,
  user,
  onOpenSettings,
  minimal = false,
}) {
  const staff = isStaff(user?.role);

  const navItems = [
    { key: 'lobby', label: '大厅', icon: 'home' },
    { key: 'ranked', label: '排位', icon: 'trophy' },
    { key: 'challenges', label: '约战', icon: 'swords' },
    { key: 'servers', label: '服务器', icon: 'server' },
    { key: 'assets', label: '资源库', icon: 'spark' },
    ...(staff ? [{ key: 'admin', label: '管理台', icon: 'shield' }] : []),
    { key: 'settings', label: '设置', icon: 'settings' },
  ];

  const handleNav = (key) => {
    if (key === 'settings') {
      onOpenSettings?.();
      return;
    }
    onPage?.(key);
  };

  return (
    <header className={`titlebar${minimal ? ' titlebar--minimal' : ''}`}>
      <div className="brand">
        <span className="brand-mark">
          <img src={dragonBall} alt="" />
        </span>
        <span className="brand-text">
          <b>ESF PLATFORM</b>
          <small>DRAGON BALL · ONLINE</small>
        </span>
      </div>

      {!minimal && (
        <nav className="nav" aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-item${page === item.key ? ' is-active' : ''}`}
              onClick={() => handleNav(item.key)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="titlebar-right">
        {user && !minimal && (
          <button type="button" className="user-chip" onClick={onOpenSettings} title="账号与平台设置">
            <Avatar user={user} />
            <span className="user-meta">
              <b>{user.gameName || user.username}</b>
              <small>
                <span className={`role-badge role-${user.role}`}>{roleLabel(user.role)}</span>
              </small>
            </span>
          </button>
        )}

        <div className="win-btns">
          <button
            type="button"
            className="win-btn"
            title="最小化"
            onClick={() => window.electronAPI?.win?.minimize?.()}
          >
            <Icon name="minimize" size={14} />
          </button>
          <button
            type="button"
            className="win-btn win-btn--danger"
            title="关闭"
            onClick={() => window.electronAPI?.win?.close?.()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
