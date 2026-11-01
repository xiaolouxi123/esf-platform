import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';

/** 在线玩家：每 15 秒拉一次，标注"在大厅"还是"游戏中" */
export default function PresencePanel({ user }) {
  const [online, setOnline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const data = await window.electronAPI.presence.list();
        if (alive) setOnline(data.online || []);
      } catch {
        /* 后端短暂不可用时保留上次结果 */
      } finally {
        if (alive) setLoading(false);
      }
    };

    tick();
    const timer = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const inGame = online.filter((item) => item.state === 'ingame').length;

  return (
    <section className="card card--presence">
      <div className="presence-head">
        <h3>
          <Icon name="users" size={14} /> 在线玩家
          <span className="pill">{online.length}</span>
        </h3>
        <span className="presence-sub">{inGame} 人在游戏中</span>
      </div>

      <div className="presence-list">
        {online.length === 0 ? (
          <p className="admin-muted">{loading ? '加载中…' : '暂时没人在线'}</p>
        ) : (
          online.map((item) => (
            <div key={item.id} className={`presence-row${item.id === user?.id ? ' is-self' : ''}`}>
              <Avatar user={item} size="sm" />
              <div className="presence-meta">
                <b>
                  {item.gameName}
                  {item.id === user?.id ? ' · 我' : ''}
                </b>
                <small>
                  {item.state === 'ingame'
                    ? `游戏中 · ${item.serverMap || item.serverName || '服务器'}`
                    : '在大厅'}
                </small>
              </div>
              <span className={`presence-dot${item.state === 'ingame' ? ' is-ingame' : ''}`} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
