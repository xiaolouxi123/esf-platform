# ESF 平台 · MP 总档案

> **已作废（2026-11-11）**：本档案停留在 0.4.7/r13，数字与结论已过时。
> 当前权威信息一律看知识库：[docs/kb/index.md](kb/index.md)（线上现状见 [kb/current-state.md](kb/current-state.md)）。
> 本文件仅作历史参考，不再更新；历史版本在 git 历史中可查。

> 更新：2026-11-07 04:41（Asia/Shanghai）  
> 用途：新窗口/新接手的人只看这一份，就能知道 ESF 平台现在是什么、发布怎么发、问题在哪、下一步迁到哪。  
> 关键词：`ESF` `0.4.7` `r13` `差量更新` `blockmap` `119.29.82.217` `119.91.99.176` `114.132.84.150` `lastResult` `guest` `Kick` `ESFAPI` `ESFMySQL`

---

## 0. 30 秒速览

```text
项目：ESF 龙珠私服一体化平台
仓库：C:\Users\Administrator\Desktop\esf-launcher
客户端：Electron + React，当前 0.4.7
后端：Node/Express + MySQL 8
游戏端：AMXX 1.10，当前 r13
生产平台：119.91.99.176（API :3000，MySQL 本机）
游戏服：114.132.84.150（HLDS 27015/27016）账号:administrator（密码已轮换，位置见 docs/kb/environment/accounts-secrets.md）
新目标机：119.29.82.217（计划集中 API/MySQL/下载反代）账号:administrator（密码已轮换，位置见 docs/kb/environment/accounts-secrets.md）
官网：https://esfcn.cn/ 与 https://xiaolouxi123.github.io/esf-platform/
GitHub：https://github.com/xiaolouxi123/esf-platform
```

**当前最重要的三件事：**

1. 0.4.7 客户端已发布，但 119 生产 API 的 `/api/config` 仍返回 `latestVersion=0.4.5`，0.4.7 服务端增量还没正式应用。
2. 114 游戏服的 r13 是否已替换、是否已重启，尚未实机确认；真人 2v2 还没验收。
3. 新服务器 `119.29.82.217` 的 3389/5985 已开放，但 80/443/3000/3306 目前没有服务在听；还缺 Windows 登录凭据和域名/证书方案。

---

## 1. 服务器与角色

| 地址 | 角色 | 现状 | 关键端口 |
|---|---|---|---|
| `119.91.99.176` | 旧生产平台 | API 健康、MySQL 在跑；`/api/config` 仍是 0.4.5；0.4.7 服务端增量未应用 | TCP 3000；MySQL 端口待现场核实 |
| `114.132.84.150` | 游戏服 | HLDS + AMXX；平台身份/排位/约战插件；残留旧平台 0.2.1 环境 | UDP 27015/27016；RDP 3389 |
| `119.29.82.217` | 新目标机 | 安全组已释放；当前只有 RDP/WinRM 在听；无 API/MySQL/反代 | 3389、5985 已开；80/443/3000/3306 未监听 |
| `esfcn.cn` | 官网/域名 | 当前由 CDN 承载，A/CNAME 不指向新服务器 | 443 |
| GitHub | 代码/Release | v0.4.7 已发布；自动更新默认 feed | 443 |

> `119.29.82.217` 的探测结果强烈提示 Windows（3389 + 5985 开、22 关）。安全组“全放行”不等于服务已启动；80/443/3000/3306 需要装好服务后再验证。

---

## 2. 当前版本与交付物

### 2.1 客户端

- 当前版本：**0.4.7**
- 官方 Release：https://github.com/xiaolouxi123/esf-platform/releases/tag/v0.4.7
- 官方安装包：`ESF-Platform-Setup-0.4.7.exe`
  - 128,568,461 字节
  - SHA256 `ad751c28f7ad7606181c4b84fb323e859a2738e678f12e42faf97a7967be0b9b`
- 官方 blockmap：SHA256 `a8de585610d1711c6c3b030a69e9fd275876e5f060cfa2af25d1c5532a6b4702`
- `latest.yml` 版本 0.4.7；Release 内同时保留 0.4.2–0.4.6 的 blockmap。

> 本地 `C:\esf-release\0.4.7` 里也有一个本地构建安装包（128,651,427 字节，SHA256 `3A71518D...`），与 CI 官方包不同。交付/发布优先用 GitHub Release 的官方包。

### 2.2 AMXX r13

路径：`C:\esf-release\0.4.7\esf-challenge-plugins-0.4.6-r13.zip`  
大小 55,562 字节  
SHA256 `8FD050FA8FD85A6E34059969BEB2944F25B263AFD7872DEBA9499948513BF7E2`

内含：

| 文件 | 大小 | 作用 |
|---|---:|---|
| `esf_platform_auth.amxx` | 6,966 | 平台身份、自动同步游戏名、guest 开关 |
| `esf_ranked_lock.amxx` | 5,392 | 排位/约战锁服，排位中拒绝 guest |
| `test_ranked.amxx` | 30,531 | 排位/约战、结算等待、约战计分、退出 |
| `esf_gamemode.amxx` | 1,238 | 模式辅助 |
| `install-amxx.bat` / `install-amxx.ps1` | — | 安装器，必须保留 UTF-8 BOM |

### 2.3 0.4.7 服务端增量

路径：`C:\esf-release\0.4.7\server-update-0.4.7.zip`  
大小 15,861 字节  
SHA256 `2DB8F2C9CBC9574E54195864F6AA2432313797E0BFDA286FB41F43186CDCA367`

包含：

```text
src\routes\auth.js
src\routes\me.js
src\services\ranked.js
scripts\migrate.js
README.txt
```

---

## 3. 目录与路径（生产）

### 3.1 平台 API 服务器（旧 119 / 未来新机同构）

```text
C:\esf\server\              后端代码
C:\esf\server\.env           生产配置（不提交、不截图、不外发）
C:\esf\logs\api.out.log      API 标准输出
C:\esf\logs\api.err.log      API 错误日志
C:\esf\uploads\              用户上传/头像等
C:\esf\updates\              更新源（latest.yml/exe/blockmap）
C:\esf\backups\              MySQL 备份
C:\esf\backup\               备份脚本与 backup.cnf
C:\esf\mysql\                MySQL 程序
C:\esf\mysql-data\           MySQL 数据目录（不要手删）
C:\esf\my.ini                MySQL 配置
C:\esf\CREDENTIALS.txt       安装时生成的 root/账号提示（用后删除）
```

### 3.2 游戏服（114）

```text
<HLDS根>\cstrike\addons\amxmodx\configs\amxx.cfg
<HLDS根>\cstrike\addons\amxmodx\plugins\*.amxx
<HLDS根>\cstrike\addons\amxmodx\logs\*.log
```

关键 cvar：

```cfg
platform_sql_host "数据库地址"
ranked_sql_host   "数据库地址"
platform_allow_guest "0/1"
platform_sync_name   "1"
battle_quit_enable   "1"
battle_quit_delay    "5.0"
```

> `platform_sql_*` 与 `ranked_sql_*` 必须是同一套库；否则会出现 auth 能连、排位/锁服连不上，或反过来。

### 3.3 客户端数据

```text
C:\Users\esf-launcher\settings.json    客户端设置（apiBaseUrl/updateFeedUrl）
C:\Users\esf-launcher\update.log       自动更新日志
```

注意不是 `%APPDATA%\ESF 平台`；这是当前实际安装用户目录。

---

## 4. 服务与重启方式

### 4.1 API

部署脚本注册的是 **Windows 计划任务** `ESFAPI`，不是 Windows 服务：

```powershell
Get-ScheduledTask -TaskName ESFAPI
Stop-ScheduledTask  -TaskName ESFAPI
Start-ScheduledTask -TaskName ESFAPI
```

也兼容旧环境：

```powershell
Get-Service ESFAPI -ErrorAction SilentlyContinue
Restart-Service ESFAPI -ErrorAction SilentlyContinue
```

**不要默认 `Restart-Service ESFAPI` 一定成功**；先看任务/服务到底哪个存在。

### 4.2 MySQL

```powershell
Get-Service ESFMySQL
Restart-Service ESFMySQL
```

### 4.3 备份

```text
计划任务：ESFDBBackup
时间：每天 04:00
目录：C:\esf\backups
保留：14 天
```

---

## 5. 数据库与账号

数据库：`esf_platform`（MySQL 8.0.29 系列）

| 账号 | 用途 | 权限 |
|---|---|---|
| `esf_app` | API | `esf_platform.*` 全部（不是只读） |
| `esf_amxx` | AMXX 游戏服 | 最小权限：玩家视图/服务器/排位/约战表 SELECT，`launch_tokens` SELECT/UPDATE，`play_sessions`/`challenge_player_stats` SELECT/INSERT/UPDATE，`settle_ranked_match`/`settle_challenge_match` EXECUTE |
| `esf_backup` | 备份 | SELECT/LOCK TABLES/SHOW VIEW/EVENT/TRIGGER + SHOW_ROUTINE |
| `root` | 维护 | 仅本机/受控；不要在公网开放 |

关键事实：

- `esf_amxx` 的 Host 可能不止一个：至少见过 `@127.0.0.1` 和 `@114.132.84.150`；迁移后要按实际游戏服公网 IP 逐个授权。
- 迁移脚本会枚举现有 `esf_amxx` Host 并补授权；但新库/新 Host 仍要现场核对。
- MySQL 端口存在 **3306/3307 二义**：部署脚本写 3307，备份/AMXX 文档写 3306。永远以目标机 `.env`、`my.ini`、`SELECT @@port`、`Get-NetTCPConnection` 现场值为准。
- 生产库表数已超过旧文档的 21 张（含约战/challenge 表）；以 `SHOW TABLES` 为准。

---

## 6. 自动更新与差量发布

### 6.1 更新链路

客户端更新源解析（`esf-launcher/main.cjs:59-75`）：

1. `ESF_UPDATE_URL` 环境变量；
2. 客户端 `settings.json` 的 `updateFeedUrl`；
3. 后端 `/api/config` 下发的 `updateFeedUrl`；
4. 都没有时用 GitHub 默认：
   `https://github.com/xiaolouxi123/esf-platform/releases/latest/download/`

后端 `/api/config` 的 feed 解析（`server/src/routes/config.js:17-35`）：

- 优先 `UPDATE_FEED_URL`；
- 否则读 `C:\esf\updates\public-url.txt`；
- 本机访问时强制 `http://<host>/updates/`。

### 6.2 每次发布差量更新的标准流程

```text
1. 服务端已部署并迁移
2. esf-launcher/package.json 升版本
3. 更新 CHANGELOG.md、docs/release-<版本>.md
4. 跑测试：launcher lint/test/build；server npm test
5. npm run dist 生成 exe/blockmap/latest.yml
6. 发布 GitHub Release/tag（CI 会构建并带旧 blockmap）
7. 把 latest.yml、exe、exe.blockmap 上传到更新源
8. 更新服务端 .env：LATEST_VERSION/DOWNLOAD_URL/RELEASE_NOTES
9. 重启 API，确认 /api/config
10. 更新官网公告/下载链接
11. 用旧版客户端实测：找到新版本、下载、安装
```

**差量更新要点：**

- `latest.yml` 的 `version`、文件大小、sha512 必须与 exe 一致。
- 差量需要旧版本 blockmap；Release 里保留 0.4.2–0.4.6 的 blockmap，0.4.6→0.4.7 有差量条件。
- GitHub 对 Range 请求曾返回 `HTTP 501`，electron-updater 会回退完整下载；日志会写
  `Cannot download differentially, fallback to full download`。这不是发布失败。
- 启动器只在启动后约 8 秒检查一次，没有定时轮询；测试自动更新必须完全退出后重开。
- 日志：`C:\Users\esf-launcher\update.log`。

### 6.3 集中下载后的目标

新服务器上建议：

```env
UPDATE_FEED_URL=https://dl.esfcn.cn/updates/
DOWNLOAD_URL=https://dl.esfcn.cn/updates/ESF-Platform-Setup-<版本>.exe
UPDATE_DIR=C:\esf\updates
```

把 `latest.yml`、最新 exe、最新 blockmap、历史 blockmap 放进 `C:\esf\updates`，由 Nginx/Caddy 直接提供 `/updates/`，API 仍负责上传/管理。`latest.yml` 必须 `Cache-Control: no-cache`。

---

## 7. 当前已知问题（0.4.7 时点）

| 优先级 | 问题 | 现状/处理 |
|---|---|---|
| P0 | 119 生产 API 仍是 0.4.5 配置 | 需应用 `server-update-0.4.7.zip`、迁移、重启；再改 `.env` 版本/公告 |
| P0 | 114 游戏服 r13 未确认部署 | 需替换 auth 6,966 / lock 5,392 / test_ranked 30,531，重启并实测 |
| P0 | 排位 guest 不结算 | 测试必须两个账号都从平台启动；r13 会拒绝排位中的 guest |
| P1 | 排位结束不退出/无结果窗 | 0.4.7 客户端 + 0.4.7 服务端 `lastResult` 才能完整生效 |
| P1 | 自动更新不触发 | 只启动查一次；完全退出重开；差量 501 会回退完整下载 |
| P1 | 新机 119.29.82.217 无服务/无凭据 | 3389/5985 开，80/443/3000/3306 未监听；需要 Windows 管理员凭据 |
| P2 | 老 114 残留平台 0.2.1 | 不要再往 114 建 challenge 表/写平台数据；以 119 为唯一平台 |
| P2 | MySQL 端口文档二义 | 3306/3307 并存，必须现场核实 |
| P2 | 真人 2v2 未验收 | 锁服/观战/结算/quit 都还没完成真人验收 |

**排位验收成功标志（AMXX 日志）：**

```text
[Ranked] match ... settled
[排位] 结算写入成功
[Ranked] disconnect game after match end
```

平台 `/api/ranked/state` 空闲时应带 `lastResult`；客户端应弹 `RANKED RESULT · 排位结算`，并自动收掉 `hl.exe`。

---

## 8. 迁移到 119.29.82.217 的目标架构

### 8.1 推荐拓扑

```text
                    Internet
                       |
              +--------+---------+
              | 119.29.82.217    |
              | Windows          |
              |                  |
  api.esfcn.cn -> Nginx/Caddy -> 127.0.0.1:3000 (Node API)
  dl.esfcn.cn  -> Nginx/Caddy -> C:\esf\updates (latest.yml/exe/blockmap)
              |                  |
              |            MySQL 8 (3306/3307, 仅本机+114白名单)
              |                  |
              |            C:\esf\uploads / backups
              +--------+---------+
                       |
                114.132.84.150
                HLDS/AMXX -> 新库地址
```

- **游戏服 114 建议保留**（HLDS 对带宽/延迟敏感），只把它的 SQL 指向新库；不要为了“数据集中”把游戏服也塞进 119.29.82.217，除非确认新机带宽/配置足够。
- 如果一定要把游戏服也搬过去，再单独评估 UDP 27015/27016、CPU、带宽、玩家延迟；不要和 API/DB 迁移混在一次变更里。

### 8.2 域名/证书（需确认）

- 现有 `esfcn.cn` 是 CDN 承载，不要直接改根域。
- 建议新增：
  - `api.esfcn.cn` → `119.29.82.217`
  - `dl.esfcn.cn` → `119.29.82.217`
- TLS：Caddy 自动签发最省事；Nginx 则用 win-acme/certbot。
- 若没有域名/DNS 权限，可临时用 `http://119.29.82.217:3000` 和 `http://119.29.82.217/updates/`，但不推荐长期明文暴露 API。

### 8.3 迁移阶段（建议一次窗口内完成）

**阶段 0：冻结与备份**

- 公告维护/停写；
- 旧 119 上 `mysqldump --single-transaction --routines` 导出 `esf_platform`；
- 复制 `C:\esf\uploads`、`C:\esf\updates`、最新 `C:\esf\backups`；
- 记录旧 `.env` 的所有键（不抄密码到聊天/仓库）；
- 新机先装 Node 20/22 + MySQL 8，建空库。

**阶段 1：新库恢复**

- 新建 `esf_platform`、`esf_app`、`esf_amxx`、`esf_backup`；
- 导入 dump（含存储过程）；
- 核对表数、`users/servers/ranked_matches/challenge_rooms` 行数；
- 给 `esf_amxx@114.132.84.150` 授权；
- 用 `SELECT @@port` 确认端口，写回 `.env`/`my.ini`。

**阶段 2：新 API**

- 部署 `C:\esf\server`（当前 0.4.7 + server-update）；
- 复制/生成 `.env`，改 `DB_HOST=127.0.0.1`、`API_PORT=3000`、`UPDATE_DIR=C:\esf\updates`；
- `npm run migrate`；
- 注册 `ESFAPI` 计划任务或服务；
- 本机 `http://127.0.0.1:3000/api/health` 通过。

**阶段 3：反代与下载**

- 安装 Nginx/Caddy；
- `api.esfcn.cn` 反代到 `127.0.0.1:3000`（保留 `X-Forwarded-*`）；
- `dl.esfcn.cn` 静态提供 `C:\esf\updates`；
- 证书生效；
- `curl https://api.esfcn.cn/api/health`、`https://dl.esfcn.cn/updates/latest.yml` 通过。

**阶段 4：切换游戏服**

- 114 的 `amxx.cfg`：
  `platform_sql_host "新库地址"`、`ranked_sql_host "新库地址"`；
- 若新库不是 3306，确认 AMXX SQLx 是否支持 `host:port`；不支持则统一用 3306；
- 重启 114，确认 auth/lock 都连新库；
- 用两个平台账号测 1v1，再测 2v2。

**阶段 5：切换客户端/更新源**

- 0.4.8 把 `esf-launcher/store.cjs:18` 默认 API 改成新地址（或域名）；
- 服务端 `.env` 的 `UPDATE_FEED_URL` 改为 `https://dl.esfcn.cn/updates/`；
- 把 latest.yml/exe/blockmap 全量复制到新 `C:\esf\updates`；
- 保留 GitHub Release 作为回退源；
- 老客户端可通过“登录页 → 修改服务器”手动切；新客户端默认新地址。

**阶段 6：验证与回收**

- 新 API `/api/config`、`/api/health`、`/api/ranked/state`；
- 新库账号/权限；
- 下载 Range 请求；
- 114 日志；
- 保留旧 119 只读/停机 7 天，确认无回滚需求后再销毁；
- 删除新机 `CREDENTIALS.txt`，轮换所有迁移中暴露的密码/Token。

### 8.4 回滚

- 切换前记录旧 DNS TTL；出问题把 DNS 指回旧 119；
- 旧 119 不要立刻关机/改库；
- 客户端可手动改回旧 API；
- 更新源保留 GitHub 默认作为 fallback；
- 数据库以迁移前 dump 为准，禁止双写。

---

## 9. 迁移前必须拿到的信息

1. `119.29.82.217` 的 Windows 管理员账号 + 密码（或可用 WinRM）。
2. 旧 119 的 RDP/WinRM 权限（导出库/上传文件/停旧 API）。
3. 114 的 RDP 权限（改 `amxx.cfg`、重启游戏服）。
4. `esfcn.cn` DNS 控制权/子域名添加权限。
5. 迁移窗口（建议低峰，预留 2–4 小时）。
6. 是否保留 114 游戏服（建议保留；只迁数据/API）。

**没有这些权限时，只能准备好脚本和档案，不能声称“已迁移”。**

---

## 10. 常用验证命令

```powershell
# 新 API
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod https://api.esfcn.cn/api/health

# 下载源
Invoke-WebRequest https://dl.esfcn.cn/updates/latest.yml -UseBasicParsing
(Invoke-WebRequest https://dl.esfcn.cn/updates/latest.yml -Headers @{Range='bytes=0-99'} -UseBasicParsing).StatusCode

# 服务/任务
Get-ScheduledTask -TaskName ESFAPI
Get-Service ESFMySQL
Get-ScheduledTask -TaskName ESFDBBackup

# 端口
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3000,3306,3307
```

---

## 11. 安全红线

- 不把 `.env`、`CREDENTIALS.txt`、root 密码、JWT secret、更新上传 token 提交到 Git/截图/聊天。
- 不把 MySQL 3306/3307 对 `0.0.0.0/0` 开放；只允许本机与 114 固定 IP。
- 不把 RDP 3389 长期暴露给全网；限制来源 IP，或改用临时白名单。
- 迁移后轮换：JWT_SECRET、DB 密码、AMXX 密码、UPDATE_UPLOAD_TOKEN、root 密码。
- 旧 119/114 的废弃账号、旧 0.2.1 平台数据不要带到新架构。

---

## 12. 关键词索引（便于新窗口检索）

```text
发布差量更新：blockmap + latest.yml + 旧版本 blockmap + GitHub Release
客户端更新：main.cjs resolveFeedUrl / UPDATE_FEED_URL / update.log
生产平台：119.91.99.176 / C:\esf\server / ESFAPI / ESFMySQL
游戏服：114.132.84.150 / amxx.cfg / platform_sql_host / ranked_sql_host
新目标：119.29.82.217 / 反代 / api.esfcn.cn / dl.esfcn.cn
排位：lastResult / RankedResultModal / TASK_RANKED_END / disconnect
约战：challenge_results / settle_challenge_match / DeathMsg / r13
常见错误：Kicked / guest allowed / quit 无效 / 501 fallback / Unknown column t.user_id
```

---

## 13. 一句话交接

> 代码已经到 0.4.7/r13；剩下的不是继续堆功能，而是把 0.4.7 服务端和 r13 真正部署到 119/114，再用两个平台账号完成排位/约战验收；之后把 API/MySQL/更新源集中迁到 119.29.82.217，114 只保留游戏服并指向新库。
