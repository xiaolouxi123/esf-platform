import { useEffect, useState } from 'react';
import Icon from './Icon';

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatAge(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

const STATE_LABEL = {
  ok: '正常',
  drift: '版本不一致',
  stale: '心跳过期',
  missing: '无心跳',
  unavailable: '无心跳表',
  'local-only': '仅本地',
  offline: '离线',
};

/**
 * 服务器插件独立页：本地 .amxx、amxx.cfg 运行配置、平台心跳和日志入口。
 * 只读观测，不修改服务器；enforce 开关仍写本地 amxx.cfg。
 */
export default function PluginsPage({ settings, toast }) {
  const [plugin, setPlugin] = useState(null);
  const [observe, setObserve] = useState(null);
  const [observing, setObserving] = useState(false);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [logPreview, setLogPreview] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [status, observation] = await Promise.all([
          window.electronAPI.plugins.status(),
          window.electronAPI.plugins
            .observe(settings?.localServerKey)
            .catch((err) => ({ serverError: err.message })),
        ]);
        if (!alive) return;
        setPlugin(status);
        setObserve(observation);
      } catch {
        /* 面板离线也要能打开 */
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [settings?.esfModDir, settings?.localServerKey]);

  const refresh = async () => {
    setObserving(true);
    try {
      const [status, observation] = await Promise.all([
        window.electronAPI.plugins.status(),
        window.electronAPI.plugins
          .observe(settings?.localServerKey)
          .catch((err) => ({ serverError: err.message })),
      ]);
      setPlugin(status);
      setObserve(observation);
      setLogPreview(null);
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setObserving(false);
    }
  };

  const toggleEnforce = async () => {
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

  const openLogs = async () => {
    try {
      await window.electronAPI.plugins.openLogs();
    } catch (err) {
      toast?.(err.message, 'error');
    }
  };

  const openPluginDir = async () => {
    try {
      await window.electronAPI.plugins.openDir();
    } catch (err) {
      toast?.(err.message, 'error');
    }
  };

  const loadLog = async () => {
    setObserving(true);
    try {
      const data = await window.electronAPI.plugins.tailLog();
      setLogPreview(data);
      if (!data.found) toast?.('还没有 AMXX 日志，先进一次本地服', 'info');
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setObserving(false);
    }
  };

  const serverList = observe?.server?.servers || [];
  const localServerKey = plugin?.cvars?.platform_server_key || settings?.localServerKey || '';
  const activeServer =
    serverList.find((item) => item.serverKey === localServerKey) || serverList[0] || null;
  const serverSummary = observe?.server?.summary || null;
  const plugins = plugin?.plugins || [];
  const installed = plugins.filter((item) => item.present).length;
  const matched = plugins.filter((item) => item.present && item.versionMatch).length;

  return (
    <div className="plugins-page">
      <header className="plugins-hero">
        <div className="plugins-hero-copy">
          <span className="eyebrow">
            <i /> SERVER PLUGINS
          </span>
          <h1>插件中心</h1>
          <p>
            本地 AMXX 文件、运行配置与平台心跳集中在这里。面板只读观测，不会修改服务器；
            线上身份校验开关仍由各服 <code>amxx.cfg</code> 控制。
          </p>
        </div>
        <div className="plugins-hero-stats">
          <div className="plugins-stat">
            <span>本地插件</span>
            <b>
              {installed}/{plugins.length || 4}
            </b>
            <small>{matched} 个版本匹配</small>
          </div>
          <div className="plugins-stat">
            <span>当前服务器</span>
            <b>{activeServer?.online ? '在线' : '离线'}</b>
            <small>{activeServer?.name || '未选择'}</small>
          </div>
          <div className="plugins-stat">
            <span>心跳</span>
            <b>{serverSummary ? `${serverSummary.ok}/${serverSummary.servers}` : '—'}</b>
            <small>{serverSummary ? `${serverSummary.attention} 台需关注` : '未连接'}</small>
          </div>
        </div>
      </header>

      <div className="plugins-grid">
        <section className="plugins-panel plugins-panel--main">
          <div className="plugins-panel-head">
            <div>
              <h2>本地插件</h2>
              <small>{plugin?.pluginsDir || plugin?.dir || '正在读取游戏目录…'}</small>
            </div>
            <div className="plugins-panel-actions">
              <button type="button" className="btn btn-ghost btn-xs" onClick={refresh} disabled={observing}>
                <Icon name="refresh" size={13} /> {observing ? '刷新中' : '刷新'}
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={openPluginDir}>
                <Icon name="folder" size={13} /> 目录
              </button>
            </div>
          </div>

          {plugin?.found ? (
            <>
              <div className="plugins-enforce">
                <div>
                  <b>平台身份校验</b>
                  <small>{plugin.enforce ? '开启 · 必须有平台凭证' : '关闭 · 游客可直接进入'}</small>
                </div>
                <button
                  type="button"
                  className={`plugin-toggle${plugin.enforce ? ' is-on' : ''}`}
                  onClick={toggleEnforce}
                  disabled={pluginBusy}
                  aria-label="切换平台身份校验"
                >
                  <i />
                </button>
              </div>
              <code className="plugins-cfg-path">{plugin.path}</code>

              <div className="plugins-list">
                {plugins.map((item) => {
                  const ok = item.present && item.versionMatch;
                  return (
                    <div className={`plugins-row${item.present ? '' : ' is-missing'}`} key={item.id}>
                      <span
                        className={`plugin-dot ${ok ? 'is-ok' : item.present ? 'is-warn' : 'is-missing'}`}
                      />
                      <span className="plugins-row-main">
                        <b>{item.label}</b>
                        <small>{item.file}</small>
                      </span>
                      <span className="plugins-row-version">
                        <b>{item.version || (item.present ? '版本未识别' : '未安装')}</b>
                        <small>{item.present ? formatBytes(item.size) : '—'}</small>
                      </span>
                      <span className={`plugins-row-state${ok ? ' is-ok' : ''}`}>
                        {ok ? '匹配' : item.present ? '版本' : '缺失'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="plugins-cvars">
                <span className="plugins-cvars-title">运行配置</span>
                {[
                  ['platform_enforce', plugin.cvars?.platform_enforce],
                  ['ranked_auto_team', plugin.cvars?.ranked_auto_team],
                  ['ranked_lock', plugin.cvars?.ranked_lock],
                  ['platform_allow_guest', plugin.cvars?.platform_allow_guest],
                ].map(([key, value]) => (
                  <span
                    className={`plugin-chip${value === null || value === undefined ? ' is-muted' : ''}`}
                    key={key}
                  >
                    {key}={value === null || value === undefined ? '默认' : value}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="plugins-empty">
              <Icon name="alert" size={18} />
              <div>
                <b>没有找到插件配置</b>
                <p>当前模组里没有找到 addons/amxmodx/configs/amxx.cfg，请在设置里确认游戏目录。</p>
              </div>
            </div>
          )}
        </section>

        <aside className="plugins-side">
          <section className="plugins-panel">
            <div className="plugins-panel-head">
              <div>
                <h2>平台心跳</h2>
                <small>{observe?.server?.checkedAt ? formatTime(observe.server.checkedAt) : '未连接'}</small>
              </div>
              <span className={`plugin-state is-${activeServer?.state || 'offline'}`}>
                {STATE_LABEL[activeServer?.state] || '未知'}
              </span>
            </div>

            {observe?.serverError ? (
              <p className="plugin-error">{observe.serverError}</p>
            ) : observe?.server?.heartbeatAvailable === false ? (
              <p className="plugin-error">数据库还没有 amxx_builds 表，先跑 server/scripts/migrate.js。</p>
            ) : activeServer ? (
              <>
                <div className="plugins-server">
                  <b>{activeServer.name}</b>
                  <small>
                    {activeServer.online ? '在线' : '离线'} · {activeServer.map || '未知地图'} ·{' '}
                    {activeServer.players}/{activeServer.maxPlayers}
                  </small>
                </div>
                <div className="plugins-heartbeats">
                  {activeServer.plugins.map((item) => (
                    <div className="plugins-heartbeat" key={item.id}>
                      <span
                        className={`plugin-dot ${
                          item.state === 'ok'
                            ? 'is-ok'
                            : item.state === 'local-only'
                              ? 'is-muted'
                              : 'is-warn'
                        }`}
                      />
                      <span>{item.label}</span>
                      <b>{item.build || item.expected || '—'}</b>
                      <small>
                        {item.heartbeat
                          ? `${STATE_LABEL[item.state] || item.state} · ${formatAge(item.ageSec)}`
                          : '仅本地文件'}
                      </small>
                    </div>
                  ))}
                </div>
                {serverSummary ? (
                  <p className="plugins-summary">
                    全部服务器：{serverSummary.online}/{serverSummary.servers} 在线 ·{' '}
                    {serverSummary.attention} 台需关注 · {serverSummary.offline} 台离线
                  </p>
                ) : null}
              </>
            ) : (
              <p className="plugins-summary">服务端没有返回这台服务器的状态。</p>
            )}
          </section>

          <section className="plugins-panel">
            <div className="plugins-panel-head">
              <div>
                <h2>诊断</h2>
                <small>AMXX 日志最后 10 行</small>
              </div>
            </div>
            <div className="plugins-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={openLogs}>
                <Icon name="folder" size={13} /> 日志目录
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadLog} disabled={observing}>
                <Icon name="clock" size={13} /> 最近日志
              </button>
            </div>
            {logPreview?.found ? (
              <pre className="plugin-log plugins-log">{logPreview.lines.slice(-10).join('\n')}</pre>
            ) : (
              <p className="plugins-summary">点“最近日志”查看插件加载、身份校验和心跳写入记录。</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
