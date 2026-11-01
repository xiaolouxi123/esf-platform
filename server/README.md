# ESF 平台后端（server/）

Express + MySQL 8，负责：账号、登录态、连服 Token 签发、服务器列表（A2S 轮询缓存）。

## 快速开始

```bash
cd server
npm install

# 1) 初始化并启动项目自带的开发用 MySQL（127.0.0.1:3307，不动本机 MySQL80）
npm run db:init      # 只需第一次
npm run db:start

# 2) 建库、建表、建账号
npm run migrate

# 3) 起服务
npm start            # http://127.0.0.1:3000
```

验证：

```bash
curl http://127.0.0.1:3000/api/health
npm run smoke        # 注册→登录→大厅→签发连服 Token 全链路
npm test             # 11 项接口测试
```

> 开发库是**项目自己的实例**，数据目录在 `../.devdb/`（已 gitignore）。
> 不想用它？把 `server/.env` 里的 `DB_*` 改成你自己的 MySQL，并删掉 `DB_ROOT_SOCKET` 一行即可，
> migrate 就会走 TCP + 密码。

## 接口

统一响应：成功 `{ ok: true, data }`，失败 `{ ok: false, code, message }`。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | — | `{ version, env, db, uptimeSec }` |
| GET | `/api/config` | — | 公告 / 维护 / 最低版本 / `db` 状态 / `inviteRequired` |
| POST | `/api/auth/register` | — | `{username, password, gameName?, inviteCode?}` |
| POST | `/api/auth/login` | — | → `{accessToken, expiresIn, user}` |
| POST | `/api/auth/logout` | JWT | `token_version + 1`，所有旧 JWT 立即失效 |
| GET | `/api/me` | JWT | 当前用户（启动器自动登录探针） |
| GET | `/api/me/stats` | JWT | 进场次数 / 累计时长 / 最近一次（来自 `play_sessions`） |
| PATCH | `/api/me` | JWT | 改昵称 / 改密码（需旧密码） |
| POST | `/api/launch-token` | JWT | `{serverKey}` → 32 位 hex Token，TTL 120s |
| GET | `/api/servers` | JWT | 服务器 + A2S 状态缓存 |

## 账号约定

- `users.username`：登录名，3~20 位字母/数字/下划线（避免大小写与中文带来的歧义）
- `users.game_name`：游戏内昵称，允许中文（utf8mb4）
- `role`：`user` / `gm` / `admin`；`status`：`active` / `banned`
- 密码 bcrypt（cost 10），登录失败写 `login_logs`

## 连服 Token 生命周期

```
启动器 POST /api/launch-token {serverKey}
  → 生成 32 位 hex，写 launch_tokens（绑定 user + server_key，120s 有效）
  → 启动器写入 cfg: setinfo "_platform_token" "<token>"
  → 玩家连入，AMXX 查库校验并消费
  → 校验通过后写 authorized_until = NOW() + 12h
```

**为什么需要 `authorized_until`**：GoldSrc 换图会让客户端重连并重发同一份 userinfo。
如果 Token 严格"一次性"，玩家在换图瞬间就会被自己的 Token 已消费踢下线。
所以设计成：首次使用受 120s TTL 限制，通过后在同一台服获得 12 小时复用窗口；
每次重连都会续期，换图不会再断。

## AMXX 侧需要的东西

游戏服务器上（本机联调就是 `G:\FCX1\FCX7.02融合版\esf\addons\amxmodx`）：

1. `modules.ini` 启用 `mysql` 模块
2. 把 `../amxx/esf_platform_auth.amxx` 放进 `plugins/`，并在 `plugins.ini` 加一行
3. `amxx.cfg` 里配置：

```
platform_sql_host "127.0.0.1:3307"      // 生产改成游戏服务器能访问到的地址
platform_sql_user "esf_amxx"
platform_sql_pass "<AMXX_DB_PASSWORD>"
platform_sql_db "esf_platform"
platform_server_key "fcx-1v1-1"         // 必须等于 servers.server_key
platform_enforce "1"                    // 1=校验不通过就踢
platform_fail_open "1"                  // 1=数据库故障时放行，不锁服
platform_debug "1"
```

## 迁移与账号权限

`npm run migrate` 是幂等的，做三件事：

1. 执行 `sql/*.sql`（建库建表 + 种子服务器）
2. 补新增列（如 `launch_tokens.authorized_until`）
3. 建两个账号
   - `esf_app`：应用账号，`esf_platform.*` 全权限
   - `esf_amxx`：游戏服务器账号，**只能**读白名单视图 `v_platform_users`（不含 password_hash）、
     消费 `launch_tokens`、写 `play_sessions`、读 `servers`

两者都用 `mysql_native_password`：AMXX 的 MySQL 模块较老，连不上 MySQL 8 默认的
`caching_sha2_password`。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| `Host '127.0.0.1' is not allowed to connect` | 开发实例只建了 `root@localhost`，迁移要靠命名管道：`.env` 里 `DB_ROOT_SOCKET=ESFDevMySQL` |
| `npm run migrate` 连不上 | 先 `npm run db:start`，`npm run db:status` 确认 3307 在听 |
| AMXX 日志 `platform_sql_host 未配置` | `amxx.cfg` 没被加载，或键名拼错；插件会在 5 秒内重试，仍失败才拒绝 |
| AMXX 日志 `数据库连接失败` | 账号密码/端口不对，或没建成 `mysql_native_password` |
| 游戏内提示"平台凭证无效" | Token 过期（>120s）、已用于别的服务器、或账号被 ban |
| 本地房主被判失败但踢不掉 | listen server 的房主无法被踢（`The local player cannot be kicked!`），这是引擎限制；远程玩家不受影响 |
