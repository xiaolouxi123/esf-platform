const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染层唯一能碰到的主进程能力。
 * 所有调用统一返回 { ok, data | code, message }，这里把它转成 Promise，
 * 失败时抛出带 code 的 Error，前端只管 try/catch。
 */
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res || res.ok !== true) {
    const error = new Error((res && res.message) || '操作失败');
    error.code = (res && res.code) || 'UNKNOWN';
    throw error;
  }
  return res.data;
}

contextBridge.exposeInMainWorld('electronAPI', {
  app: {
    info: () => call('app:info'),
    config: () => call('config:get'),
  },

  settings: {
    get: () => call('settings:get'),
    update: (patch) => call('settings:update', patch),
  },

  dialog: {
    pickGameDir: () => call('dialog:pick-game-dir'),
  },

  auth: {
    login: (username, password) => call('auth:login', { username, password }),
    register: (payload) => call('auth:register', payload),
    me: () => call('auth:me'),
    logout: () => call('auth:logout'),
    updateProfile: (patch) => call('auth:update-profile', patch),
  },

  presence: {
    ping: () => call('presence:ping'),
    list: () => call('presence:list'),
  },

  chat: {
    list: (after) => call('chat:list', { after }),
    send: (body) => call('chat:send', { body }),
  },

  update: {
    check: () => call('update:check'),
  },

  stats: {
    get: () => call('stats:get'),
  },

  servers: {
    list: () => call('servers:list'),
    lookup: (address) => call('servers:lookup', { address }),
  },

  maps: {
    scan: () => call('maps:scan'),
  },

  assets: {
    list: (params) => call('assets:list', params),
    upload: (fields) => call('assets:upload', fields),
    install: (id) => call('assets:install', { id }),
  },

  admin: {
    overview: () => call('admin:overview'),
    users: (params) => call('admin:users', params),
    updateUser: (id, patch) => call('admin:update-user', { id, ...patch }),
    kickUser: (id) => call('admin:kick-user', { id }),
    assets: (status) => call('admin:assets', { status }),
    setAssetStatus: (id, status) => call('admin:asset-status', { id, status }),
    openDevTools: () => call('devtools:open'),
  },

  launch: {
    token: (serverKey) => call('launch:token', { serverKey }),
    join: (payload) => call('launch:join', payload),
    local: (map) => call('launch:local', { map }),
  },

  shell: {
    openDataDir: () => call('shell:open-data-dir'),
    openGameDir: () => call('shell:open-game-dir'),
    openExternal: (url) => call('shell:open-external', { url }),
  },

  win: {
    minimize: () => call('window:minimize'),
    close: () => call('window:close'),
  },
});
