# 文件说明

GitHub 仓库根目录的文件列表显示的是每个文件**最后一次提交信息**，不是文件描述。  
下面按目录列出每个文件的用途，后续新增文件请同步更新本表。

## 根目录

| 文件 | 说明 |
|---|---|
| `README.md` | 项目总览、架构、本地开发、测试、安全说明 |
| `CONTRIBUTING.md` | 分支、提交、PR、代码风格、密钥规范 |
| `SECURITY.md` | 漏洞报告方式与生产部署安全建议 |
| `LICENSE` | MIT 许可证 |
| `CHANGELOG.md` | 版本更新记录 |
| `FILES.md` | 本文件，逐文件说明 |
| `.gitignore` | 忽略依赖、构建产物、数据库、密钥、安装包 |

## `.github`

| 文件 | 说明 |
|---|---|
| `workflows/ci.yml` | GitHub Actions：启动器 lint/test/build + 后端 MySQL 测试 |

## `amxx`

| 文件 | 说明 |
|---|---|
| `esf_platform_auth.sma` | 平台身份校验：读取 `_platform_token`、消费 token、记录在线时长、可选昵称一致性 |
| `esf_ranked_lock.sma` | 排位比赛锁服：只允许本场参赛玩家进入 |
| `esf_gamemode.sma` | 启动后兜底应用 `esf_force_gamemode`（0 混战 / 2 组队） |
| `test_ranked.sma` | 1v1/2v2 比赛逻辑、队伍 HUD、平台战绩回写、结束 5 秒 quit |
| `test_ranked-history.md` | 原 `test.sma` 的历史更新记录（从文件头移出） |
| `README.md` | AMXX 插件编译、配置、行为说明 |
| `local-verify.cjs` | 本机 listen server 的 token 验证辅助脚本 |

## `esf-launcher`

| 文件 | 说明 |
|---|---|
| `main.cjs` | Electron 主进程：窗口、托盘、游戏启动/结束、更新、IPC |
| `preload.js` | 暴露给渲染层的安全 IPC API |
| `api.cjs` | 后端 HTTP 客户端与统一错误处理 |
| `store.cjs` | 本地设置与登录态（safeStorage） |
| `launcher-core.cjs` | 纯 Node 逻辑：launcher.cfg、启动参数、game.cfg 模式写入、目录识别 |
| `src/App.jsx` | 应用入口、登录态、页面切换 |
| `src/components/Lobby.jsx` | 大厅主界面、开图、服务器、成员/频道/排位入口 |
| `src/components/RankedPage.jsx` | 排位天梯：匹配、座位、竞猜、排行榜 |
| `src/components/ServerHall.jsx` | 服务器大厅与房间详情 |
| `src/components/ServerRoomList.jsx` | 房间列表、排位座位、锁定状态 |
| `src/components/MemberSidebar.jsx` | 成员名单、头衔、右键管理、资料卡 |
| `src/components/ChatPanel.jsx` | 大厅频道聊天 |
| `src/components/AdminPanel.jsx` | 管理台：玩家、头衔、资源审核、审计 |
| `src/components/SettingsDrawer.jsx` | 设置抽屉：目录、API、头像、插件、更新 |
| `src/components/LoginPage.jsx` | 登录页 |
| `src/components/RegisterPage.jsx` | 注册页 |
| `src/App.css` | 全局样式与页面样式 |
| `scripts/shot.cjs` | 无头截图/回归截图脚本 |
| `scripts/mock-preload.cjs` | 截图用 mock API |
| `tests/` | 启动器核心与 IPC 测试 |

## `server`

| 文件 | 说明 |
|---|---|
| `src/app.js` | Express 应用、路由挂载、Range 更新下载 |
| `src/server.js` | 启动入口 |
| `src/env.js` | 环境变量解析与校验 |
| `src/db.js` | MySQL 连接池 |
| `src/middleware/auth.js` | JWT 鉴权、token_version 失效 |
| `src/routes/auth.js` | 注册、登录、登出 |
| `src/routes/me.js` | 当前用户、资料、战绩、头像 |
| `src/routes/servers.js` | 服务器列表、A2S 查询、排位占用 |
| `src/routes/launch.js` | 连服 token 签发 |
| `src/routes/members.js` | 成员名册、详情、格斗等级 |
| `src/routes/presence.js` | 在线心跳、金币结算 |
| `src/routes/titles.js` | 头衔 CRUD / 授予 |
| `src/routes/economy.js` | 金币钱包/流水 |
| `src/routes/ranked.js` | 排位匹配、准备、竞猜、观战、结算 |
| `src/routes/assets.js` | 模型/声音/特效上传、审核、安装 |
| `src/routes/admin.js` | 管理台、审计、平台设置 |
| `src/routes/chat.js` | 大厅频道 |
| `src/routes/health.js` | 健康检查 |
| `src/services/tokenService.js` | token 签发、服务器校验、排位锁 |
| `src/services/economy.js` | 金币钱包、在线时长结算 |
| `src/services/ranked.js` | 排位匹配算法、比赛、竞猜、排行榜 |
| `src/services/platform.js` | 公告/维护设置 |
| `scripts/migrate.js` | 建表、补列、权限、结算存储过程 |
| `scripts/dev-db.cjs` | 本地 MySQL 开发实例 |
| `scripts/smoke.cjs` | 全链路冒烟 |
| `scripts/smoke-updates.cjs` | 更新源冒烟 |
| `test/` | 后端 API / 排位 / 更新测试 |
| `sql/` | 初始 SQL schema 与种子数据 |

## `deploy`

| 文件 | 说明 |
|---|---|
| `deploy-esf-server.ps1` | Windows 服务器一键部署（Node/MySQL/服务/防火墙） |
| `amxx/`（gitignore） | 含数据库密码的 AMXX 安装包，不进入公开仓库 |

> `deploy/amxx` 被 `.gitignore` 排除；插件源码在 `amxx/`，安装包请私下分发。
