# ESF Platform

ESF（Dragon Ball）私服的一体化平台：Electron 启动器 + Express 后端 + AMXX 服务端插件 + 天梯排位/金币生态。

欢迎提交 Issue / PR，一起把这个平台做得更完整。

## 组成

```text
esf-platform/
├─ esf-launcher/   Electron 启动器（React 19 + Vite + Electron 45）
├─ server/         Express + MySQL 8 后端（账号 / Token / 服务器 / 排位 / 金币）
├─ amxx/           AMXX 1.10 插件源码（身份校验 / 排位锁服 / 2v2 比赛）
└─ deploy/         服务器部署脚本（不含密钥）
```

## 功能

### 启动器

- 大厅、地图库、服务器大厅、资源库、管理台、频道、排位
- 一键连服 / 本地开图 / 游戏中切服
- 开游戏自动收进托盘，退出游戏自动恢复
- 自动更新（electron-updater，支持差量）
- Discord 式成员名单、头衔、自定义头像、右键管理
- 金币、格斗等级、排位段位、竞猜、排行榜
- 频道未读、龙珠雷达、服务器离线提示

### 后端

- JWT 登录 / 注册 / 角色权限（user < creator < ops < admin < owner）
- launch token 签发与消费、服务器状态轮询
- 排位队列 / 1v1 / 2v2 / 快速匹配 / 准备 / 锁服
- 金币钱包、竞猜、比赛结算存储过程
- 资源上传审核、公告、维护模式、审计日志
- 自动更新 feed（latest.yml + Range / multipart）

### AMXX

- `esf_platform_auth`：平台身份校验、Token 消费、观战 / 参赛身份、在线时长
- `esf_ranked_lock`：比赛 / 约战期间锁服，只放行参赛者与持观战 Token 的观众
- `test_ranked`：1v1/2v2 自动检测、队伍 HUD、排位结算、约战击杀/死亡胜利条件、战绩回写平台、结束 5 秒自动 quit

## 本地开发

前置：Node.js 20+、MySQL 8（或使用项目自带的开发库脚本）、Windows（启动器与 AMXX 部分）。

```bash
# 1. 后端
cd server
cp .env.example .env
npm ci
npm run db:init      # 第一次
npm run db:start
npm run migrate
npm start            # http://127.0.0.1:3000

# 2. 启动器
cd ../esf-launcher
npm ci
npm run dev
```

首次进入启动器后，在「设置 → 游戏目录」选择包含 `hl.exe` 的半条命根目录。

### 环境变量

复制 `server/.env.example` 为 `server/.env`，至少修改：

- `JWT_SECRET`
- `DB_PASSWORD` / `DB_ROOT_PASSWORD`（如使用本机 root）
- `AMXX_DB_PASSWORD`
- `UPDATE_UPLOAD_TOKEN`

不要把 `.env`、数据库密码、服务器密码提交到仓库。

## 测试

```bash
# 启动器
cd esf-launcher
npm run lint
npm test
npm run build

# 后端（需要本地 MySQL）
cd ../server
npm run migrate
npm test
```

AMXX 插件编译示例：

```bat
amxxpc.exe ..\..\amxx\esf_platform_auth.sma -i"include" -o"..\plugins\esf_platform_auth.amxx"
amxxpc.exe ..\..\amxx\esf_ranked_lock.sma -i"include" -o"..\plugins\esf_ranked_lock.amxx"
amxxpc.exe ..\..\amxx\test_ranked.sma -i"include" -o"..\plugins\test_ranked.amxx"
```

## 目录说明

逐文件说明见 [FILES.md](FILES.md)。

- `esf-launcher/src`：React 界面
- `esf-launcher/main.cjs`：Electron 主进程 / 窗口 / 进程 / 更新
- `esf-launcher/api.cjs`：后端 HTTP 客户端
- `server/src/routes`：API
- `server/src/services`：业务（Token、排位、金币）
- `server/scripts/migrate.js`：建表 / 迁移 / 结算存储过程
- `amxx/*.sma`：AMXX 源码

## 运维

- 生产 MySQL 每日 04:00 自动备份，保留 14 天，带 SHA-256 和恢复演练脚本
- 说明、安装、恢复流程见 [deploy/backup/README.md](deploy/backup/README.md)
- 备份文件包含玩家个人信息，只存放在受限目录/私有存储，不提交仓库
- 公网 API、官网、更新源和备份心跳由 [uptime.yml](.github/workflows/uptime.yml) 每 15 分钟探测一次，详见 [docs/MONITORING.md](docs/MONITORING.md)
- 服务器本机登录 MySQL 的步骤、账号边界与排障见 [docs/SERVER_MYSQL_LOGIN.md](docs/SERVER_MYSQL_LOGIN.md)
- 跨会话总档案（架构、发布差量更新、已知问题、迁移到新机）见 [docs/ESF_MP_ARCHIVE.md](docs/ESF_MP_ARCHIVE.md)

## 安全

- 服务器 Token 是 32 位 hex，一次性消费，绑定 `server_key`
- 管理接口按角色校验，owner 不可被降级
- 更新包上传需要独立 token
- 仓库不包含生产 `.env`、数据库密码、AMXX 安装包

发现安全问题请不要公开 Issue，见 [SECURITY.md](SECURITY.md)。

## 参与开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请跑完 lint / test / build，并确保没有提交任何密钥。

## License

[MIT](LICENSE)
