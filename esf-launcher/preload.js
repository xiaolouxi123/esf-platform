const { contextBridge, ipcRenderer } = require('electron');

// 把后端的能力暴露给前端，前端通过 window.electronAPI 调用
contextBridge.exposeInMainWorld('electronAPI', {
  // 扫描地图
  scanMaps: () => ipcRenderer.invoke('scan-maps'),

  // 启动游戏
  launchGame: (config) => ipcRenderer.invoke('launch-game', config),

  // 🚀 新增：选择游戏目录
  selectGameDir: () => ipcRenderer.invoke('select-game-dir'),

  //服务器接口
  queryServers: () => ipcRenderer.invoke('query-servers'),
  // 🚀 连服需要带上当前用户名，服务端 AMXX 才能正确显示身份
  joinServer: (ip, port, username) => ipcRenderer.invoke('join-server', { ip, port, username }),
});
