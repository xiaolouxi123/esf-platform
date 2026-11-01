const { contextBridge } = require('electron');

/**
 * 截图用的假 electronAPI。
 * 只在 scripts/shot.cjs 里使用（sandbox:false 才能读环境变量）。
 */

const state = process.env.MOCK_STATE || 'dashboard';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const user = { id: 2, username: 'demo', gameName: '测试玩家', role: 'user' };

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
