const { contextBridge } = require('electron');

/**
 * 截图用的假 electronAPI。
 * 只在 scripts/shot.cjs 里使用（sandbox:false 才能读环境变量）。
 */

const state = process.env.MOCK_STATE || 'dashboard';
const role = process.env.MOCK_ROLE || 'admin';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const user = { id: 2, username: 'demo', gameName: '测试玩家', role };

const settings = {
  hlPath: 'G:\\FCX1\\FCX7.02融合版\\hl.exe',
  esfModDir: 'G:\\FCX1\\FCX7.02融合版\\esf',
  apiBaseUrl: 'http://127.0.0.1:3000',
  localServerKey: 'fcx-1v1-1',
};

const maps = [
  'ape_foreshadow',
  'ape_ocean',
  'esf_cell_day',
  'esf_cell_games',
  'esf_cell_games_v4',
  'esf_city',
  'esf_city_black',
  'esf_giant_forest',
  'esf_hildegarn',
  'esf_cell_night',
  'esf_cell_games_night',
  'esf_cell_games_new',
];

const servers = [
  {
    serverKey: 'fcx-1v1-1',
    name: '[ESF-FCX]单挑房[1]',
    ip: '114.132.84.150',
    port: 27016,
    online: true,
    players: 4,
    maxPlayers: 12,
    ping: 18,
    map: 'ape_foreshadow',
  },
  {
    serverKey: 'fcx-1v1-2',
    name: '[ESF-FCX]单挑房[2]',
    ip: '114.132.84.151',
    port: 27017,
    online: true,
    players: 0,
    maxPlayers: 12,
    ping: 46,
    map: 'esf_city',
  },
  {
    serverKey: 'fcx-team',
    name: '[ESF-FCX]组队服',
    ip: '114.132.84.152',
    port: 27018,
    online: false,
    players: 0,
    maxPlayers: 20,
    ping: -1,
    map: null,
  },
];

async function fakeLogin() {
  await delay(200);
  return { user, expiresIn: 604800 };
}

const api = {
  app: {
    info: async () => ({
      version: '0.1.0',
      electron: '45.1.0',
      apiBaseUrl: settings.apiBaseUrl,
      userDataDir: 'C:\\Users\\Administrator\\AppData\\Roaming\\ESF 平台',
      packaged: false,
    }),
    config: async () => ({
      notice: '10 月 31 日更新：连服 Token 已改为服务端签发，进服 2 秒内完成校验。',
      maintenance: false,
      minLauncherVersion: '0.1.0',
      version: '0.1.0',
      db: 'up',
      inviteRequired: false,
    }),
  },
  settings: {
    get: async () => settings,
    update: async (patch) => Object.assign(settings, patch),
  },
  dialog: {
    pickGameDir: async () => ({ hlPath: settings.hlPath, modDir: settings.esfModDir }),
  },
  auth: {
    login: fakeLogin,
    register: async () => ({ user }),
    me: async () => {
      if (state === 'login') {
        const error = new Error('未登录');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      return { user };
    },
    logout: async () => ({ loggedOut: true }),
    updateProfile: async (patch) => ({ user: { ...user, ...patch } }),
  },

  presence: {
    ping: async () => ({ state: 'lobby', serverKey: null }),
    list: async () => ({
      online: [
        {
          id: 2,
          username: 'demo',
          gameName: '测试玩家',
          avatar: '🐉',
          role,
          state: 'lobby',
        },
        {
          id: 6,
          username: 'yun',
          gameName: 'yun',
          avatar: '🥋',
          role: 'admin',
          state: 'ingame',
          serverKey: 'fcx-1v1-1',
          serverName: '[ESF-FCX]单挑房[1]',
          serverMap: 'ape_foreshadow',
        },
      ],
    }),
  },

  chat: {
    list: async () => ({
      messages: [
        {
          id: 1,
          body: '新版本的大厅频道上线了，进来试试',
          createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
          user: { id: 6, username: 'yun', gameName: 'yun', avatar: '🥋', role: 'admin' },
        },
        {
          id: 2,
          body: '单挑房有人吗？',
          createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          user: { id: 9, username: 'krillin', gameName: '克林', avatar: '', role: 'user' },
        },
        {
          id: 3,
          body: '我在 ape_foreshadow，直接进来',
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
          user: { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', role },
        },
      ],
    }),
    send: async (body) => ({
      message: {
        id: 99,
        body,
        createdAt: new Date().toISOString(),
        user: { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', role },
      },
    }),
  },

  update: {
    check: async () => ({
      current: '0.1.0',
      latest: '0.2.0',
      hasUpdate: true,
      releaseNotes: '新增大厅频道与在线状态',
      downloadUrl: 'https://example.com/esf-platform/releases',
    }),
  },
  stats: {
    get: async () => ({
      sessions: 12,
      totalSeconds: 19800,
      lastPlayedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }),
  },
  servers: {
    list: async () => ({ servers }),
    lookup: async (address) => ({
      address,
      ip: '114.132.84.150',
      port: 27016,
      registered: true,
      serverKey: 'fcx-1v1-1',
      registryName: '[ESF-FCX]单挑房[1]',
      online: true,
      name: '[ESF-FCX]单挑房[1]',
      map: 'ape_foreshadow',
      players: 4,
      maxPlayers: 12,
      ping: 18,
    }),
  },
  maps: {
    scan: async () => maps,
  },
  launch: {
    token: async (serverKey) => ({ serverKey, expiresAt: null, maskedToken: 'a1b2c3…' }),
    join: async ({ ip, port }) => ({ address: `${ip}:${port}`, maskedToken: 'a1b2c3…' }),
    local: async (map) => ({ map, maskedToken: 'a1b2c3…' }),
  },
  assets: {
    list: async () => ({
      assets: [
        {
          id: 1,
          kind: 'sound',
          name: '测试音效',
          version: '1.0.0',
          targetPath: 'sound/test/beep.wav',
          description: '接口自测用的短音效',
          fileSize: 2048,
          downloads: 12,
          authorName: 'demo',
        },
        {
          id: 2,
          kind: 'model',
          name: '悟空新模型',
          version: '1.2.0',
          targetPath: 'models/player/goku/goku.mdl',
          description: '替换默认模型，含骨骼修正',
          fileSize: 5_242_880,
          downloads: 87,
          authorName: 'yun',
        },
        {
          id: 3,
          kind: 'model',
          name: '比克披风',
          version: '0.9.0',
          targetPath: 'models/player/piccolo/piccolo.mdl',
          description: '披风物理暂未调完',
          fileSize: 3_145_728,
          downloads: 5,
          authorName: 'demo',
        },
      ],
      total: 3,
    }),
    upload: async () => ({ id: 99, name: '新资源', version: '1.0.0', status: 'pending' }),
    install: async () => ({ targetPath: 'sound/test/beep.wav', bytes: 2048, backedUp: false }),
  },

  admin: {
    overview: async () => ({
      users: { total: 2, active: 2, banned: 0, admins: 1, gms: 0 },
      assets: { pending: 1, approved: 3 },
      servers: { total: 1, enabled: 1, online: 1 },
      sessions: { total: 5, today: 2 },
      tokens: { today: 3 },
    }),
    users: async () => ({
      users: [
        {
          id: 6,
          username: 'yun',
          gameName: 'yun',
          role: 'admin',
          status: 'active',
          sessions: 1,
          totalSeconds: 13,
          lastLoginAt: new Date().toISOString(),
        },
        {
          id: 2,
          username: 'demo',
          gameName: '测试玩家',
          role: 'user',
          status: 'active',
          sessions: 4,
          totalSeconds: 122,
          lastLoginAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      ],
      total: 2,
    }),
    updateUser: async (id, patch) => ({ user: { id, ...patch } }),
    kickUser: async () => ({ kicked: true }),
    assets: async () => ({
      assets: [
        {
          id: 4,
          kind: 'model',
          name: '待审模型',
          version: '1.0.0',
          targetPath: 'models/player/gohan/gohan.mdl',
          fileSize: 4_194_304,
          authorName: 'demo',
        },
      ],
    }),
    setAssetStatus: async (id, status) => ({ id, status }),
    openDevTools: async () => true,
  },

  shell: {
    openDataDir: async () => true,
    openGameDir: async () => true,
  },
  win: {
    minimize: async () => true,
    close: async () => true,
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
