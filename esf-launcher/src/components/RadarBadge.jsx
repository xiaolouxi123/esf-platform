import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 左侧栏的迷你龙珠雷达。
 * 7 个点对应平台服务状态，点一下弹出明细。
 */
export default function RadarBadge({ backend, hasGameDir, settings, serversCount, updateInfo }) {
  const [presenceOk, setPresenceOk] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        await window.electronAPI.presence.list();
        if (alive) setPresenceOk(true);
      } catch {
        if (alive) setPresenceOk(false);
      }
    };
    check();
    const timer = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const nodes = [
    { key: 'api', label: '平台服务', ok: Boolean(backend?.ok) },
    { key: 'db', label: '数据库', ok: backend?.db === 'up' },
    { key: 'dir', label: '游戏目录', ok: Boolean(hasGameDir) },
    { key: 'mod', label: '游戏模组', ok: Boolean(settings?.esfModDir) },
    { key: 'servers', label: '房间列表', ok: serversCount > 0 },
    { key: 'presence', label: '在线状态', ok: presenceOk },
    { key: 'update', label: '版本更新', ok: !updateInfo?.hasUpdate },
  ];
  const okCount = nodes.filter((node) => node.ok).length;

  return (
    <div className="radar-badge">
      <button
        type="button"
        className={`game-tile game-tile--tool radar-trigger${open ? ' is-active' : ''}`}
        title={`龙珠雷达 ${okCount}/7`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 44 44" className="radar-svg" aria-hidden="true">
          <circle cx="22" cy="22" r="18" className="radar-ring" />
          <circle cx="22" cy="22" r="9" className="radar-ring" />
          {nodes.map((node, index) => {
            const angle = -Math.PI / 2 + (index * Math.PI * 2) / nodes.length;
            return (
              <circle
                key={node.key}
                cx={22 + Math.cos(angle) * 14}
                cy={22 + Math.sin(angle) * 14}
                r="2.6"
                className={`radar-node${node.ok ? ' is-ok' : ' is-off'}`}
              />
            );
          })}
        </svg>
        <small>{okCount}/7</small>
      </button>

      {open &&
        createPortal(
          <>
            <button
              type="button"
              className="radar-backdrop"
              aria-label="关闭龙珠雷达"
              onClick={() => setOpen(false)}
            />
            <div className="radar-popover">
              <header>
                <b>龙珠雷达</b>
                <span className={okCount === 7 ? 'is-ok' : 'is-warn'}>{okCount}/7 正常</span>
              </header>
              <ul>
                {nodes.map((node) => (
                  <li key={node.key}>
                    <span className={`radar-dot${node.ok ? ' is-ok' : ' is-off'}`} />
                    {node.label}
                    <em>{node.ok ? '正常' : '异常'}</em>
                  </li>
                ))}
              </ul>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
