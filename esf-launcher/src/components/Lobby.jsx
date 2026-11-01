import React, { useState, useEffect, useRef } from 'react';

export default function Lobby({ user, onLogout }) {
  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState('');
  const [bots, setBots] = useState([
    { name: 'SOHAN TEEN', difficulty: 'NORMAL' },
    { name: 'GOGETA', difficulty: 'BASE' }
  ]);
  const containerRef = useRef(null);

  // 🚀 服务器查询相关状态
  const [serverList, setServerList] = useState([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  // 🚀 新增：记录当前展开的服务器（用 IP 作为唯一标识）
  const [expandedServer, setExpandedServer] = useState(null);
  // 🚀 右下角临时提示（连服/启动结果），5 秒后自动消失
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // 一键连服
  const handleJoin = async (srv) => {
    setShowServerModal(false);
    try {
      const res = await window.electronAPI.joinServer(srv.ip, srv.port, user?.username);
      if (res && res.success) {
        setToast(`已启动游戏，正在连接 ${res.address || `${srv.ip}:${srv.port}`} ...`);
      } else {
        alert(res?.message || '连服失败，请查看控制台日志。');
      }
    } catch (err) {
      console.error('连服失败:', err);
      alert('连服失败：' + err.message);
    }
  };

  const handleQueryServers = async () => {
    setIsQuerying(true);
    try {
      const servers = await window.electronAPI.queryServers();
      setServerList(servers);
    } catch (err) {
      console.error('查询服务器失败:', err);
      alert('查询服务器列表失败，请检查控制台报错。');
    } finally {
      setIsQuerying(false);
    }
  };

  // 加载地图
  const loadMaps = () => {
    window.electronAPI.scanMaps().then(mapList => {
      setMaps(mapList);
      if (mapList.length > 0) {
        setSelectedMap(mapList[0]);
      } else {
        setSelectedMap('');
      }
    });
  };

  useEffect(() => {
    loadMaps();
  }, []);

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    containerRef.current.style.setProperty('--mouse-x', `${e.clientX}px`);
    containerRef.current.style.setProperty('--mouse-y', `${e.clientY}px`);
  };

  const handleLaunch = async () => {
    if (!selectedMap) return alert("请先设置游戏目录并选择地图！");
    const res = await window.electronAPI.launchGame({ map: selectedMap, bots, username: user.username });
    if (res && res.success) {
      setToast(`已启动游戏：${res.map || selectedMap}`);
    } else if (res) {
      alert(res.message);
    }
  };

  const handleSelectDir = async () => {
    const res = await window.electronAPI.selectGameDir();
    if (res.success) {
      alert('目录设置成功！\n路径: ' + res.path);
      loadMaps(); 
    } else if (res.message !== '已取消选择') {
      alert(res.message);
    }
  };

  return (
    <div className="launcher-container" ref={containerRef} onMouseMove={handleMouseMove}>
      <div className="bg-image"></div>
      <div className="mouse-glow"></div>

      {/* 顶部用户信息栏 */}
      <div className="user-bar">
        <span>欢迎，{user?.username}</span>
        
        <button onClick={() => setShowServerModal(true)} className="btn-setting">
          🌐 在线服务器
        </button>
        
        <button onClick={handleSelectDir} className="btn-setting">
          ⚙️ 设置目录
        </button>
        
        <button onClick={onLogout} className="btn-logout">退出</button>
      </div>

      <div className="top-title">
        <h1>{selectedMap || '请先设置游戏目录'}</h1>
      </div>

      <div className="sidebar">
        <h2>地图选择</h2>
        <div className="map-list">
          {maps.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', marginTop: '20px' }}>
              暂无地图<br/>(请点击右上角设置目录)
            </div>
          ) : (
            maps.map(m => (
              <div 
                key={m} 
                className={`map-item ${selectedMap === m ? 'active' : ''}`}
                onClick={() => setSelectedMap(m)}
              >
                {m}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="right-panel">
        <h2>机器人设置 (BOTS)</h2>
        <div className="bot-list">
          {bots.map((bot, index) => (
            <div key={index} className="bot-row">
              <span>{bot.name}</span>
              <span>{bot.difficulty}</span>
            </div>
          ))}
        </div>
        <button className="btn-add">+ 添加机器人</button>
        <button className="btn-launch" onClick={handleLaunch}>开始游戏</button>
      </div>

      {/* 🚀 服务器列表弹窗 (Modal) */}
      {showServerModal && (
        <div className="server-modal-overlay">
          <div className="server-modal">
            <div className="server-modal-header">
              <h2>在线服务器大厅</h2>
              <button className="btn-close" onClick={() => setShowServerModal(false)}>✖</button>
            </div>
            
            <button onClick={handleQueryServers} disabled={isQuerying} className="btn-add" style={{marginBottom: '15px'}}>
              {isQuerying ? '🔄 正在搜索服务器...' : '🔄 刷新服务器列表'}
            </button>

            <div className="server-list">
              {serverList.length === 0 ? (
                <p style={{textAlign: 'center', color: '#888'}}>暂无服务器数据，请点击上方刷新。</p>
              ) : (
                serverList.map((srv, idx) => {
                  const isExpanded = expandedServer === srv.ip;
                  return (
                    // 🚀 点击整张卡片即可展开/折叠
                    <div 
                      key={idx} 
                      className={`server-card ${!srv.online ? 'offline' : ''} ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => srv.online && setExpandedServer(isExpanded ? null : srv.ip)}
                      style={{ cursor: srv.online ? 'pointer' : 'default' }}
                    >
                      
                      <div className="card-header">
                        <div className="card-info">
                          <h3 className="server-name">{srv.name}</h3>
                          <div className="server-details">
                            <span className="tag map-tag">🗺️ {srv.map}</span>
                            <span className="tag player-tag">👤 {srv.players}/{srv.maxPlayers}</span>
                            <span className={`tag ping-tag ${srv.ping > 100 ? 'high-ping' : ''}`}>
                              📶 {srv.online ? `${srv.ping}ms` : '离线'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="card-actions">
                          {/* 展开指示箭头 */}
                          {srv.online && srv.players > 0 && (
                            <span className="expand-icon">{isExpanded ? '▲' : '▼'}</span>
                          )}

                          <button 
                            className="btn-join-big" 
                            disabled={!srv.online}
                            // 🚀 阻止事件冒泡，防止点加入时触发了卡片的折叠
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!srv.online) return;
                              handleJoin(srv);
                            }}
                          >
                            {srv.online ? '加入游戏' : '离线'}
                          </button>
                        </div>
                      </div>

                      {/* 🚀 展开后的玩家列表区域 */}
                      {isExpanded && srv.online && (
                        <div className="player-list-container">
                          {srv.playerList && srv.playerList.length > 0 ? (
                            <>
                              <div className="player-list-header">
                                <span>玩家名字</span>
                                <span>分数</span>
                              </div>
                              {srv.playerList.map((p, i) => (
                                <div key={i} className="player-row">
                                  <span>{p.name}</span>
                                  <span>{p.score}</span>
                                </div>
                              ))}
                            </>
                          ) : (
                            <div style={{fontSize: '12px', color: '#ffaa00', textAlign: 'center', padding: '10px'}}>
                              该服务器隐藏了玩家列表或获取超时
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🚀 右下角临时提示 */}
      {toast && (
        <div style={{
          position: 'fixed',
          right: '32px',
          bottom: '32px',
          maxWidth: '360px',
          padding: '12px 18px',
          borderRadius: '12px',
          background: 'rgba(20, 20, 28, 0.85)',
          border: '1px solid rgba(255, 170, 0, 0.5)',
          color: '#ffc861',
          fontSize: '14px',
          zIndex: 9999,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}