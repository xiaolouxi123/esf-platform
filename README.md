# ESF 平台启动器

三步走：启动器（Electron）→ 后端（Express + MySQL）→ 游戏服务器（AMXX）。

```
esf-launcher/
├─ esf-launcher/   启动器：React + Vite + Electron（main.cjs / preload.js / launcher-core.cjs）
├─ server/         后端：Express + MySQL 8（账号、Token 签发、服务器列表）
├─ amxx/           AMXX 1.10 插件源码与本机验证脚本
└─ .devdb/ .run/   本地开发用的 MySQL 数据目录与进程日志（gitignore）
```

## 本地跑起来

```bash
# 1. 后端 + 数据库
cd server
npm install
npm run db:init        # 只需第一次
npm run db:start
npm run migrate
npm start              # http://127.0.0.1:3000

# 2. 启动器（另开一个终端）
cd esf-launcher
npm install
npm run dev            # vite + electron
```

## 当前进度

| 模块 | 状态 |
|---|---|
| 启动器 UI / 地图 / 本地开图 / 一键连服 | ✅ |
| 后端骨架 + 数据库 + 账号 + 连服 Token | ✅ |
| AMXX 服务端校验（查库、消费 Token、踢人） | ✅ 本机 listen server 已验证 |
| 启动器接入真实登录 / Token / 自动登录 | ✅ 主进程 IPC + safeStorage |
| 界面重做（导航、按钮、图标、状态位） | ✅ 见 `shots/` |
| 打包分发（electron-builder） | ⬜ 第四步 |

详见 `Desktop\存档\第一步.md`、`Desktop\存档\第二步.md`。

## 界面预览

```bash
cd esf-launcher
npm run build
node_modules\.bin\electron scripts/shot.cjs --state=dashboard
node_modules\.bin\electron scripts/shot.cjs --state=servers --click=".nav-item:nth-child(2)"
node_modules\.bin\electron scripts/shot.cjs --state=settings --click=".nav-item:nth-child(3)"
node_modules\.bin\electron scripts/shot.cjs --state=login
# 输出到 shots/*.png
```

> 需要先执行 `Remove-Item Env:\ELECTRON_RUN_AS_NODE`，否则 electron 会以纯 Node 方式运行。

## 常用命令

```bash
# 后端
cd server
npm run smoke                        # 全链路冒烟
npm run token demo demo12345 fcx-1v1-1   # 签发一个连服 Token
npm test

# 本机 listen server 验证 AMXX（不开 Electron）
node amxx/local-verify.cjs <token> <昵称> <地图>

# 启动器
cd esf-launcher
npm run dev
node tests/core.test.cjs
node tests/main.test.cjs
```
