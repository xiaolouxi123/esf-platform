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

  members: {
    list: () => call('members:list'),
    detail: (id) => call('members:detail', { id }),
    setCombatLevel: (id, combatLevel) => call('members:set-combat-level', { id, combatLevel }),
  },

  economy: {
    summary: () => call('economy:summary'),
  },

  ranked: {
    state: () => call('ranked:state'),
    queue: (mode) => call('ranked:queue', { mode }),
    cancel: (matchId) => call('ranked:cancel', { matchId }),
    ready: () => call('ranked:ready'),
    bet: (matchId, team, amount) => call('ranked:bet', { matchId, team, amount }),
    spectate: (matchId) => call('ranked:spectate', { matchId }),
    finish: (matchId, winner) => call('ranked:finish', { matchId, winner }),
    leaderboard: (limit) => call('ranked:leaderboard', { limit }),
  },

  chat: {
    list: (after) => call('chat:list', { after }),
    send: (body) => call('chat:send', { body }),
  },

  titles: {
    list: () => call('titles:list'),
    create: (payload) => call('titles:create', payload),
    update: (payload) => call('titles:update', payload),
    remove: (id) => call('titles:remove', { id }),
    assign: (userId, titleId) => call('titles:assign', { userId, titleId }),
  },

  update: {
    check: () => call('update:check'),
    autoCheck: () => call('update:auto-check'),
    install: () => call('update:auto-install'),
    pause: () => call('update:pause'),
    resume: () => call('update:resume'),
    dismiss: () => call('update:dismiss'),
    status: () => call('update:status'),
    onStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },

  stats: {
    get: () => call('stats:get'),
  },

  servers: {
    list: () => call('servers:list'),
    lookup: (address) => call('servers:lookup', { address }),
    detail: (params) => call('servers:detail', params),
    customList: () => call('servers:custom-list'),
    customAdd: (fields) => call('servers:custom-add', fields),
    customRemove: (address) => call('servers:custom-remove', { address }),
  },

  ranks: {
    list: () => call('ranks:list'),
  },

  favorites: {
    list: () => call('favorites:list'),
    set: (serverKeys) => call('favorites:set', { serverKeys }),
    add: (serverKey) => call('favorites:add', { serverKey }),
    remove: (serverKey) => call('favorites:remove', { serverKey }),
  },

  challenges: {
    state: () => call('challenges:state'),
    create: (payload) => call('challenges:create', payload),
    join: (id) => call('challenges:join', { id }),
    leave: (id) => call('challenges:leave', { id }),
    close: (id) => call('challenges:close', { id }),
    invite: (id, userId) => call('challenges:invite', { id, userId }),
    respond: (id, action) => call('challenges:respond', { id, action }),
    ready: (id, ready = true) => call('challenges:ready', { id, ready }),
    start: (id) => call('challenges:start', { id }),
  },

  maps: {
    scan: () => call('maps:scan'),
  },

  assets: {
    list: (params) => call('assets:list', params),
    upload: (fields) => call('assets:upload', fields),
    pickCover: () => call('assets:pick-cover'),
    install: (id) => call('assets:install', { id }),
  },

  admin: {
    overview: () => call('admin:overview'),
    users: (params) => call('admin:users', params),
    updateUser: (id, patch) => call('admin:update-user', { id, ...patch }),
    kickUser: (id) => call('admin:kick-user', { id }),
    assets: (status) => call('admin:assets', { status }),
    setAssetStatus: (id, status) => call('admin:asset-status', { id, status }),
    audit: (params) => call('admin:audit', params),
    transferOwner: (userId) => call('admin:transfer-owner', { userId }),
    platform: () => call('admin:platform'),
    updatePlatform: (patch) => call('admin:update-platform', patch),
    servers: () => call('admin:servers'),
    createServer: (payload) => call('admin:create-server', payload),
    updateServer: (serverKey, patch) => call('admin:update-server', { serverKey, ...patch }),
    ranks: () => call('admin:ranks'),
    saveRanks: (ranks) => call('admin:save-ranks', { ranks }),
    openDevTools: () => call('devtools:open'),
  },

  launch: {
    token: (serverKey) => call('launch:token', { serverKey }),
    join: (payload) => call('launch:join', payload),
    joinCustom: (address) => call('launch:join-custom', { address }),
    local: (map, mode) => call('launch:local', { map, mode }),
    guest: () => call('launch:guest'),
  },

  plugins: {
    status: () => call('plugins:status'),
    setEnforce: (enforce) => call('plugins:set-enforce', { enforce }),
    openDir: () => call('plugins:open-dir'),
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
