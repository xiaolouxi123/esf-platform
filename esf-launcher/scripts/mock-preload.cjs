const { contextBridge } = require('electron');

/**
 * 截图用的假 electronAPI。
 * 只在 scripts/shot.cjs 里使用（sandbox:false 才能读环境变量）。
 */

const state = process.env.MOCK_STATE || 'dashboard';
const scenario = process.env.MOCK_SCENARIO || state;
const role = process.env.MOCK_ROLE || 'owner';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const user = { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', avatarUrl: '', titleId: 1, role, combatLevel: 2, coins: 128 };

const titles = [
  { id: 1, name: '所有者', color: '#FF8A1F', rank: 100, memberCount: 1 },
  { id: 2, name: '管理员', color: '#FF5F6D', rank: 80, memberCount: 1 },
  { id: 3, name: '运营', color: '#3FD0FF', rank: 60, memberCount: 1 },
  { id: 4, name: '作者', color: '#A78BFA', rank: 40, memberCount: 1 },
  { id: 5, name: '玩家', color: '#94A0B8', rank: 10, memberCount: 1 },
];
const customServers = [{ name: '朋友的服', address: '1.2.3.4:27016', addedAt: new Date().toISOString() }];

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
    mode: '单挑',
    name: '[ESF-FCX]单挑房[1]',
    ip: '114.132.84.150',
    port: 27016,
    online: true,
    players: 4,
    maxPlayers: 12,
    ping: 18,
    map: 'ape_foreshadow',
    ranked: {
      id: 88,
      mode: '2v2',
      status: 'live',
      map: 'ape_foreshadow',
      playerCount: 4,
      readyCount: 4,
      teams: {
        a: [
          { id: 2, gameName: '测试玩家', avatar: '🐉', ready: true },
          { id: 10, gameName: '悟空', avatar: '🐒', ready: true },
        ],
        b: [
          { id: 6, gameName: 'yun', avatar: '🥋', ready: true },
          { id: 9, gameName: '克林', avatar: '', ready: true },
        ],
      },
    },
    locked: true,
  },
  {
    serverKey: 'fcx-1v1-2',
    mode: '新手',
    name: '[ESF-FCX]新手房',
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
    mode: '组队',
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
      notice:
        '0.4.13 已发布：成员状态移到名字后面同一行显示，角色与段位收进第二行；点自己那一栏的状态可以直接编辑，改完立刻在全体成员那里生效。启动器重启后会自动检查更新，不用再手动下载安装包。本次还修好了大厅房间行的实时玩家展开、排位结算弹窗重复弹出的问题，以及最小窗口下的表格错位。如果更新后遇到启动失败，请先看设置页的引擎诊断，再到大厅频道里反馈。',
      maintenance: process.env.MOCK_MAINTENANCE === '1',
      maintenanceText: '今晚 20:00-21:00 停服维护',
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
  favorites: {
    list: async () => ({ serverKeys: ['fcx-1v1-1'] }),
    set: async (keys) => ({ serverKeys: Array.isArray(keys) ? keys : [] }),
  },

  presence: {
    ping: async () => ({ state: 'lobby', serverKey: null, wallet: { coins: 128, totalEarned: 328 } }),
    list: async () => ({
      online: [
        {
          id: 2,
          username: 'demo',
          gameName: '测试玩家',
          avatar: '🐉',
          titleId: 1,
          role,
          state: 'lobby',
        },
        {
          id: 6,
          username: 'yun',
          gameName: 'yun',
          avatar: '🥋',
          titleId: 2,
          role: 'admin',
          state: 'ingame',
          serverKey: 'fcx-1v1-1',
          serverName: '[ESF-FCX]单挑房[1]',
          serverMap: 'ape_foreshadow',
        },
      ],
    }),
  },

  titles: {
    list: async () => ({ titles }),
    create: async () => ({ title: titles[0] }),
    update: async () => ({ title: titles[0] }),
    remove: async () => ({ deleted: true }),
    assign: async () => ({ ok: true }),
  },

  members: {
    list: async () => ({
      members: [
        { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', titleId: 1, role: 'owner', combatLevel: 2, online: true, state: 'lobby' },
        { id: 6, username: 'yun', gameName: 'yun', avatar: '🥋', titleId: 2, role: 'admin', combatLevel: 4, online: true, state: 'ingame', serverName: '[ESF-FCX]单挑房[1]', serverMap: 'ape_foreshadow' },
        { id: 9, username: 'krillin', gameName: '克林', avatar: '', titleId: 5, role: 'user', combatLevel: 0, online: false, state: 'offline' },
        { id: 10, username: 'goku', gameName: '悟空', avatar: '🐒', titleId: 4, role: 'creator', combatLevel: 3, online: false, state: 'offline' },
      ],
    }),
    detail: async (id) => {
      const list = [
        { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', titleId: 1, role: 'owner', combatLevel: 2, online: true, state: 'lobby' },
        { id: 6, username: 'yun', gameName: 'yun', avatar: '🥋', titleId: 2, role: 'admin', combatLevel: 4, online: true, state: 'ingame', serverName: '[ESF-FCX]单挑房[1]', serverMap: 'ape_foreshadow' },
        { id: 9, username: 'krillin', gameName: '克林', avatar: '', titleId: 5, role: 'user', combatLevel: 0, online: false, state: 'offline' },
        { id: 10, username: 'goku', gameName: '悟空', avatar: '🐒', titleId: 4, role: 'creator', combatLevel: 3, online: false, state: 'offline' },
      ];
      const member = list.find((item) => Number(item.id) === Number(id)) || list[0];
      return {
        member: {
          ...member,
          sessions: 12,
          totalSeconds: 19800,
          createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
          lastLoginAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      };
    },
    setCombatLevel: async (id, combatLevel) => ({ id, combatLevel }),
  },

  challenges: {
    state: async () => {
      const hostYun = { id: 6, username: 'yun', gameName: 'yun', avatar: '🥋', combatLevel: 4 };
      const hostGoku = { id: 10, username: 'goku', gameName: '悟空', avatar: '🐒', combatLevel: 3 };
      const hostKrillin = { id: 9, username: 'krillin', gameName: '克林', avatar: '', combatLevel: 0 };
      const rooms = [
        {
          id: 301,
          displayNo: 12,
          mode: '2v2',
          title: '周末 2v2 友谊赛',
          host: hostYun,
          playerCount: 3,
          maxPlayers: 4,
          readyCount: 2,
          createdAt: new Date(Date.now() - 4 * 60000).toISOString(),
          map: 'esf_cell_games2',
          server: { name: '[ESF-FCX]单挑房[1]', serverKey: 'fcx-1v1-1' },
          full: false,
        },
        {
          id: 302,
          displayNo: 13,
          mode: '1v1',
          title: '单挑练枪 · 先到先进',
          host: hostGoku,
          playerCount: 1,
          maxPlayers: 2,
          readyCount: 1,
          createdAt: new Date(Date.now() - 42 * 60000).toISOString(),
          map: 'ape_foreshadow',
          server: { name: '[ESF-FCX]单挑房[2]', serverKey: 'fcx-1v1-2' },
          full: false,
        },
        {
          id: 303,
          displayNo: 14,
          mode: '2v2',
          title: '新手局 · 随便玩',
          host: hostKrillin,
          playerCount: 4,
          maxPlayers: 4,
          readyCount: 4,
          createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
          map: 'esf_city',
          server: { name: '[ESF-FCX]组队服', serverKey: 'fcx-team' },
          full: true,
        },
      ];

      const me = { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', combatLevel: 2 };
      const waitingRoom = {
        id: 401,
        displayNo: 21,
        mode: '2v2',
        title: '测试玩家的小房间',
        host: me,
        isHost: true,
        status: 'waiting',
        playerCount: 2,
        maxPlayers: 4,
        readyCount: 1,
        allReady: false,
        full: false,
        map: 'esf_cell_games2',
        victoryLimit: 10,
        victoryLabel: '击杀 10 次',
        server: { name: '[ESF-FCX]单挑房[1]', serverKey: 'fcx-1v1-1', ip: '114.132.84.150', port: 27016 },
        createdAt: new Date(Date.now() - 2 * 60000).toISOString(),
        members: [me, hostYun],
        teams: {
          a: [{ ...me, ready: true }],
          b: [{ ...hostYun, ready: false }],
        },
        pendingInvites: [{ id: 91, user: hostGoku }],
        result: null,
      };

      const liveRoom = {
        ...waitingRoom,
        status: 'live',
        map: 'ape_foreshadow',
        server: { name: '[ESF-FCX]单挑房[1]', serverKey: 'fcx-1v1-1', ip: '114.132.84.150', port: 27016, map: 'ape_foreshadow' },
        teams: {
          a: [{ ...me, ready: true }],
          b: [{ ...hostYun, ready: true }, { ...hostGoku, ready: true }],
        },
        playerCount: 3,
        readyCount: 3,
        allReady: true,
        full: false,
      };

      const myRoom =
        scenario === 'challenge-room'
          ? waitingRoom
          : scenario === 'challenge-live'
            ? liveRoom
            : null;

      return {
        myRoom,
        rooms,
        invites:
          scenario === 'challenge-invite'
            ? [
                {
                  id: 71,
                  from: hostGoku,
                  room: { title: '周末 2v2 友谊赛', mode: '2v2', playerCount: 3, maxPlayers: 4 },
                },
              ]
            : [],
        lastResult: null,
      };
    },
    create: async () => ({ ok: true }),
    join: async () => ({ ok: true }),
    leave: async () => ({ ok: true }),
    close: async () => ({ ok: true }),
    ready: async () => ({ ok: true }),
    start: async () => ({ ok: true }),
    respond: async () => ({ ok: true }),
    invite: async () => ({ ok: true }),
  },

  economy: {
    summary: async () => ({
      wallet: { coins: 128, totalEarned: 328, lastEarnedAt: new Date().toISOString() },
      transactions: [
        { amount: 2, reason: 'game_time', createdAt: new Date(Date.now() - 120000).toISOString() },
        { amount: 1, reason: 'online_time', createdAt: new Date(Date.now() - 360000).toISOString() },
      ],
    }),
  },

  ranked: {
    state: async () => {
      const players = [
        { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', role: 'owner', team: 'a', slot: 1, ready: true, rating: 1380 },
        { id: 10, username: 'goku', gameName: '悟空', avatar: '🐒', role: 'creator', team: 'a', slot: 2, ready: false, rating: 1210 },
        { id: 6, username: 'yun', gameName: 'yun', avatar: '🥋', role: 'admin', team: 'b', slot: 1, ready: true, rating: 1190 },
        { id: 9, username: 'krillin', gameName: '克林', avatar: '', role: 'user', team: 'b', slot: 2, ready: false, rating: 1150 },
      ];
      const match = {
        id: 88,
        mode: '2v2',
        status: 'waiting',
        map: 'ape_foreshadow',
        server: {
          serverKey: 'fcx-1v1-1',
          name: '[ESF-FCX]单挑房[1]',
          ip: '114.132.84.150',
          port: 27016,
          map: 'ape_foreshadow',
        },
        players,
        teams: { a: players.filter((p) => p.team === 'a'), b: players.filter((p) => p.team === 'b') },
        readyCount: 2,
        playerCount: 4,
        allReady: false,
        pool: { a: 320, b: 180, total: 500 },
        betCount: 3,
        myBet: null,
        spectatorCount: 3,
        isParticipant: true,
      };
      const profile = {
        rating: 1380,
        tier: '黄金',
        wins: 12,
        losses: 7,
        matches: 19,
        winRate: 63,
        rank: 18,
        coins: 128,
      };
      if (scenario === 'ranked') return { state: 'matched', profile, match };
      if (scenario === 'ranked-queue') {
        return { state: 'queued', profile, queue: { mode: '2v2', elapsed: 23, joinedAt: new Date().toISOString() } };
      }
      return { state: 'idle', profile };
    },
    queue: async () => ({ state: 'queued', profile: { rating: 1380, tier: '黄金', coins: 128 }, queue: { mode: '2v2', elapsed: 0 } }),
    cancel: async () => ({ state: 'idle', profile: { rating: 1380, tier: '黄金', coins: 128 } }),
    ready: async () => ({ state: 'matched', profile: { rating: 1380, tier: '黄金', coins: 128 } }),
    bet: async () => ({ state: 'matched' }),
    spectate: async () => ({ id: 88 }),
    finish: async () => ({ id: 88 }),
    leaderboard: async () => ({
      players: [
        { position: 1, id: 10, gameName: '悟空', avatar: '🐒', tier: '钻石', rating: 1640, winRate: 72 },
        { position: 2, id: 6, gameName: 'yun', avatar: '🥋', tier: '铂金', rating: 1480, winRate: 66 },
        { position: 3, id: 2, gameName: '测试玩家', avatar: '🐉', tier: '黄金', rating: 1380, winRate: 63 },
        { position: 4, id: 9, gameName: '克林', avatar: '', tier: '白银', rating: 980, winRate: 48 },
      ],
    }),
    history: async () => {
      const ago = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
      return {
        matches: [
          {
            matchId: 101,
            mode: '2v2',
            map: 'ape_foreshadow',
            result: 'win',
            finishedAt: ago(96),
            ratingBefore: 1355,
            ratingAfter: 1380,
            ratingDelta: 25,
            winner: 'a',
            server: { name: '[ESF-FCX]单挑房[1]' },
          },
          {
            matchId: 100,
            mode: '1v1',
            map: 'esf_city',
            result: 'loss',
            finishedAt: ago(160),
            ratingBefore: 1375,
            ratingAfter: 1355,
            ratingDelta: -20,
            winner: 'b',
            server: { name: '[ESF-FCX]新手房' },
          },
          {
            matchId: 99,
            mode: '2v2',
            map: 'ape_foreshadow',
            result: 'win',
            finishedAt: ago(1540),
            ratingBefore: 1350,
            ratingAfter: 1375,
            ratingDelta: 25,
            winner: 'a',
            server: { name: '[ESF-FCX]单挑房[1]' },
          },
          {
            matchId: 98,
            mode: '1v1',
            map: 'esf_city',
            result: 'loss',
            finishedAt: ago(1600),
            ratingBefore: 1370,
            ratingAfter: 1350,
            ratingDelta: -20,
            winner: 'b',
            server: { name: '[ESF-FCX]新手房' },
          },
          {
            matchId: 97,
            mode: '2v2',
            map: 'ape_foreshadow',
            result: 'win',
            finishedAt: ago(3020),
            ratingBefore: 1345,
            ratingAfter: 1370,
            ratingDelta: 25,
            winner: 'a',
            server: { name: '[ESF-FCX]单挑房[1]' },
          },
        ],
      };
    },
  },

  chat: {
    list: async () => ({
      messages: [
        {
          id: 1,
          body: '新版本的大厅频道上线了，进来试试',
          createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
          user: { id: 6, username: 'yun', gameName: 'yun', avatar: '🥋', titleId: 2, role: 'admin' },
        },
        {
          id: 2,
          body: '单挑房有人吗？',
          createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          user: { id: 9, username: 'krillin', gameName: '克林', avatar: '', titleId: 5, role: 'user' },
        },
        {
          id: 3,
          body: '我在 ape_foreshadow，直接进来',
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
          user: { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', titleId: 1, role },
        },
      ],
    }),
    send: async (body) => ({
      message: {
        id: 99,
        body,
        createdAt: new Date().toISOString(),
        user: { id: 2, username: 'demo', gameName: '测试玩家', avatar: '🐉', titleId: 1, role },
      },
    }),
  },

  update: {
    // 默认无更新，避免更新弹窗挡住每一张截图；要拍弹窗用 --state=update
    check: async () =>
      scenario === 'update'
        ? {
            current: '0.1.0',
            latest: '0.2.0',
            hasUpdate: true,
            releaseNotes: '新增大厅频道与在线状态',
            downloadUrl: 'https://example.com/esf-platform/releases',
          }
        : { current: '0.4.13', latest: '', hasUpdate: false, releaseNotes: '', downloadUrl: '' },
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
    customList: async () => ({ servers: customServers.slice() }),
    customAdd: async ({ name, address }) => {
      const value = String(address || '').trim();
      if (!/^[0-9A-Za-z.-]{3,64}:\\d{2,5}$/.test(value)) throw new Error('地址格式应为 IP:端口，例如 1.2.3.4:27016');
      if (customServers.some((item) => item.address === value)) throw new Error('这个地址已经在列表里了');
      customServers.push({ name: String(name || '').trim() || value, address: value, addedAt: new Date().toISOString() });
      return { server: customServers[customServers.length - 1], servers: customServers.slice() };
    },
    customRemove: async (address) => {
      const index = customServers.findIndex((item) => item.address === address);
      if (index >= 0) customServers.splice(index, 1);
      return { servers: customServers.slice() };
    },
    detail: async (params = {}) => ({
      serverKey: params.serverKey || 'fcx-1v1-1',
      address: '114.132.84.150:27016',
      registered: true,
      online: true,
      name: '[ESF-FCX]单挑房[1]',
      map: 'ape_foreshadow',
      players: 4,
      maxPlayers: 12,
      ping: 18,
      playerList: [
        { name: '悟空', score: 12, durationSec: 1520 },
        { name: '贝吉塔', score: 9, durationSec: 940 },
        { name: '短笛', score: 5, durationSec: 610 },
        { name: '克林', score: 3, durationSec: 240 },
      ],
      note: 'A2S 只提供玩家名、分数与在线时长；击杀 / 死亡需要 AMXX 统计插件上报',
    }),
  },
  maps: {
    scan: async () => maps,
  },
  launch: {
    token: async (serverKey) => ({ serverKey, expiresAt: null, maskedToken: 'a1b2c3…' }),
    join: async ({ ip, port }) => ({ address: `${ip}:${port}`, maskedToken: 'a1b2c3…', switched: false }),
    local: async (map, mode) => ({ map, mode, maskedToken: 'a1b2c3…', switched: false }),
    joinCustom: async (address) => ({ address, platform: false, switched: false }),
    guest: async () => ({ guest: true, switched: false }),
  },
  plugins: {
    status: async () => ({
      found: true,
      path: 'G:\\FCX1\\FCX7.02融合版\\esf\\addons\\amxx\\configs\\amxx.cfg',
      enforce: true,
      dir: 'G:\\FCX1\\FCX7.02融合版\\esf\\addons\\amxx',
    }),
    setEnforce: async (enforce) => ({ enforce }),
    openDir: async () => ({ dir: '' }),
  },
  assets: {
    list: async ({ kind } = {}) => ({
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
        {
          id: 4,
          kind: 'sprite',
          name: '龟派气功特效',
          version: '1.0.0',
          targetPath: 'sprites/kamehameha.spr',
          coverUrl:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23131722'/%3E%3Ccircle cx='160' cy='90' r='48' fill='none' stroke='%23ffb05c' stroke-width='4'/%3E%3Ccircle cx='160' cy='90' r='18' fill='%23ffb05c' fill-opacity='.35'/%3E%3C/svg%3E",
          description: '替换默认光束贴图',
          fileSize: 131_072,
          downloads: 3,
          authorName: 'demo',
        },
      ].filter((item) => !kind || item.kind === kind),
      total: 4,
    }),
    upload: async () => ({ id: 99, name: '新资源', version: '1.0.0', status: 'pending' }),
    install: async () => ({ targetPath: 'sound/test/beep.wav', bytes: 2048, backedUp: false }),
  },

  admin: {
    overview: async () => ({
      users: { total: 5, active: 5, banned: 0, owners: 1, admins: 1, ops: 1, creators: 1 },
      assets: { pending: 1, approved: 3 },
      servers: { total: 1, enabled: 1, online: 1 },
      sessions: { total: 5, today: 2 },
      tokens: { today: 3 },
    }),
    users: async () => ({
      users: [
        {
          id: 2,
          username: 'demo',
          gameName: '测试玩家',
          avatar: '🐉',
          titleId: 1,
          role,
          status: 'active',
          sessions: 4,
          totalSeconds: 19800,
          lastLoginAt: new Date().toISOString(),
        },
        {
          id: 6,
          username: 'yun',
          gameName: 'yun',
          avatar: '',
          role: 'admin',
          status: 'active',
          sessions: 1,
          totalSeconds: 13,
          lastLoginAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
        {
          id: 7,
          username: 'xiao_k',
          gameName: '小K',
          avatar: '⚡',
          role: 'ops',
          status: 'active',
          sessions: 12,
          totalSeconds: 7200,
          lastLoginAt: new Date(Date.now() - 7200 * 1000).toISOString(),
        },
        {
          id: 8,
          username: 'goku_author',
          gameName: '模型作者',
          avatar: '🥋',
          role: 'creator',
          status: 'active',
          sessions: 3,
          totalSeconds: 900,
          lastLoginAt: new Date(Date.now() - 86400 * 1000).toISOString(),
        },
        {
          id: 9,
          username: 'newbie',
          gameName: '新人',
          avatar: '',
          role: 'user',
          status: 'banned',
          sessions: 0,
          totalSeconds: 0,
          lastLoginAt: null,
        },
      ],
      total: 5,
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
          authorName: '模型作者',
        },
      ],
    }),
    setAssetStatus: async (id, status) => ({ id, status }),
    servers: async () => ({
      servers: [
        {
          id: 1,
          key: 'fcx-1v1-1',
          name: '[ESF-FCX]单挑房[1]',
          ip: '114.132.84.150',
          port: 27016,
          mode: '混战',
          enabled: true,
          sort: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 2,
          key: 'fcx-team',
          name: '[ESF-FCX]组队服',
          ip: '114.132.84.152',
          port: 27018,
          mode: '组队',
          enabled: false,
          sort: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
    audit: async () => ({
      total: 4,
      logs: [
        {
          id: 4,
          actorName: '测试玩家',
          action: 'user.role',
          targetType: 'user',
          targetId: 7,
          detail: { username: 'xiao_k', from: { role: 'user' }, to: { role: 'ops' } },
          ip: '127.0.0.1',
          createdAt: new Date(Date.now() - 120 * 1000).toISOString(),
        },
        {
          id: 3,
          actorName: '测试玩家',
          action: 'asset.approve',
          targetType: 'asset',
          targetId: 1,
          detail: { status: 'approved', name: '测试音效' },
          ip: '127.0.0.1',
          createdAt: new Date(Date.now() - 900 * 1000).toISOString(),
        },
        {
          id: 2,
          actorName: 'cli',
          action: 'server.add',
          targetType: 'server',
          targetId: 1,
          detail: { serverKey: 'fcx-1v1-1', address: '114.132.84.150:27016' },
          ip: 'cli',
          createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
        {
          id: 1,
          actorName: '测试玩家',
          action: 'user.ban',
          targetType: 'user',
          targetId: 9,
          detail: { username: 'newbie', from: { status: 'active' }, to: { status: 'banned' } },
          ip: '127.0.0.1',
          createdAt: new Date(Date.now() - 86400 * 1000).toISOString(),
        },
      ],
    }),
    transferOwner: async () => ({ owner: 'yun' }),
    platform: async () => ({
      notice: '10 月 31 日更新：连服 Token 已改为服务端签发。',
      maintenance: process.env.MOCK_MAINTENANCE === '1',
      maintenanceText: '今晚 20:00-21:00 停服维护',
    }),
    updatePlatform: async (patch) => ({
      notice: patch.notice || '',
      maintenance: Boolean(patch.maintenance),
      maintenanceText: patch.maintenanceText || '',
    }),
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
