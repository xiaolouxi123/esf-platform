# 多服务器 AMXX 插件平台交接说明

> 状态：方案 / 待现场核验  
> 日期：2026-11-18  
> 范围：3 台主机、5 个游戏服；平台侧 119.29.82.217，现代 FCX 服 114.132.84.150，EVM 2.1 服 3 台  
> 原则：**不猜测未核验的版本、端口、路径、模块和数据库状态**；未知项统一标“待核验”。

---

## 0. 先看结论

当前不是“服务器太多”，而是**同一套插件被要求同时服务两种运行环境**：

- 114 的 2 台 FCX 服：现代 AMXX 1.10，四插件（auth / lock / test_ranked / gamemode）已经稳定；
- 119.29.82.217 上的 2 台 EVM 2.1（A/B）和 119.91.99.176 上的 1 台 EVM 2.1（C）：承载主流玩家，但现有 `test.amxx` 只有 1v1，没有平台凭证、数据库、结算和正确退出；
- 平台 API、MySQL、更新源都在 119.29.82.217。

因此目标不是“减少游戏服”，而是：

1. **保留 5 个游戏入口**；
2. **收敛成 2 个插件通道**：`modern`（FCX）和 `evm-1v1`（EVM 三台）；
3. EVM 不升级 AMXX 核心、不覆盖 2006 年核心插件，只增加“平台层”；
4. 全部 EVM 共用一套认证、1v1 数据、结算、退出和分发链；
5. 用 119.91.99.176 的 EVM-C 做第一台金丝雀，再推 119.29.82.217 的 EVM-A/B。

**不要先写代码。先做第 2 节的现场核验。**  
本地整合包里的 `amxmodx_mm.dll` 是 `1.10.0.5461`，`test.sma` 也已经在用 `sqlx`，这与“2006 年 1.0 环境”的说法冲突；必须以三台 EVM 服务器上的 `amxx version`、`amxx modules`、`plugins.ini` 为准。

---

## 1. 事实基线（已确认 / 文档滞后）

### 1.1 已确认的主机与游戏服

| 主机 | 角色 | 游戏服 | 备注 |
|---|---|---|---|
| `119.29.82.217` | 平台 API、MySQL 8.0.29、Caddy、更新源 | EVM-A、EVM-B（2 台 2.1） | 与 API 同机；EVM 端口待核验 |
| `114.132.84.150` | FCX 游戏服 | FCX-1 `27016`、FCX-2 `27017` | 现代四插件；当前线上包 0.53 |
| `119.91.99.176` | EVM 游戏服 | EVM-C（1 台 2.1） | 旧平台 API 是否仍在运行待核验；优先做金丝雀 |

合计：**3 台主机、5 个游戏服**。  
不要再把 119.91 写成“老平台 + 无游戏服”，也不要把 119.217 只写成 API。

> 说明：EVM-A/B/C 是本文为方便交接使用的临时标识，**不是线上 `server_key`**；三台实际 `server_key` 必须从 `servers` 表/现场配置读取，未核验前不得写死。

依据：`docs/kb/current-state.md:17-23`，以及 2026-11-18 用户修正的拓扑。

### 1.2 版本事实

- 仓库 `main` 已到 `b5298bd`（tag `v0.6.51`），但 `docs/kb/current-state.md` 仍写启动器 0.6.2；**文档版本滞后，以 git 与线上为准**。
- 线上 AMXX 包：0.53（自动分边；两台 FCX 四插件哈希一致）。
- 源码 `BUILD=0.54`（本地 listen server 放行），未上传生产；生产 `.env` 仍显式 `AMXX_EXPECTED_*=0.53`。
- 本地测试包：`test_ranked 1.3.4-teamtest`（仅本地，不用于 EVM）。

依据：`docs/kb/current-state.md:45-60`、`:70-83`。

### 1.3 现有平台数据面

| 表 / 接口 | 用途 | 现状 |
|---|---|---|
| `launch_tokens` | 一次性连服 token，绑定 `server_key` | 已有；`used_at`、`authorized_until` 支持换图重连 |
| `v_platform_users` | 玩家视图（无密码哈希） | 已有 |
| `play_sessions` | 在线时长 | 已有；认证插件插入/关闭时更新 |
| `ranked_matches` | 排位比赛主表 | 已有；`status`、`winner`、`server_key`、`map` |
| `ranked_match_players` | 参赛者、队伍、rating、`afk` | 已有；无 kills/deaths |
| `ranked_profiles` | ELO 档案 | 已有 |
| `settle_ranked_match` | ELO/战绩/竞猜一次结算 | 已有存储过程 |
| `amxx_builds` | 插件心跳 | 已有（013 迁移） |

关键代码：

- `server/sql/001_schema.sql:30-44`（launch_tokens）
- `server/sql/001_schema.sql:49-70`（servers / server_status）
- `server/sql/001_schema.sql:75-84`（play_sessions）
- `server/scripts/migrate.js:348-400`（ranked 表）
- `server/scripts/migrate.js:403-445`（settle_ranked_match）
- `server/src/services/ranked.js:141-171`（lastResult）
- `esf-launcher/src/components/RankedPage.jsx:339-366`（结果消费与 10 分钟收游戏）

### 1.4 现有分发链

`scripts/publish-amxx.ps1` 目前是单通道：

- 受管四插件固定（`:15`）；
- manifest 只有 `channel='amxx'`、version、file、size、sha256、plugins[]（`:42-51`）；
- 只上传到 119.29.82.217 的 `C:\esf\updates\amxx`（`:72-102`）；
- 114 的 `ESFAmxxUpdate` 每 10 分钟拉取、替换整套四插件、`taskkill rehlds`、HLSM 拉起。

这条链**不能直接用于 EVM**：

- EVM 不能装 `ranked_lock` / `gamemode`（会和旧 1v1、老核心插件打架）；
- EVM 的 `test.amxx` 是旧 1v1 插件，不是 `test_ranked`；
- EVM 不在 114 的 HLSM 里，119.176 还是远程主机；
- 需要按服务器/通道选择目标，而不是“全网一套”。

---

## 2. P0：先做环境核验（不改任何文件）

在 EVM-A、EVM-B、EVM-C 上各执行一次，输出保存为 `env-audit-<server>.txt`：

```text
1. amxx version
2. amxx modules
3. amxmodx_mm.dll 的 FileVersion / SHA256
4. configs/modules.ini 中 mysql / sqlx 是否加载
5. configs/plugins.ini 当前启用的 1v1 插件（test.amxx / 1v1.amxx / 其他）
6. 实际加载的 test*.amxx 文件大小、SHA256、修改时间
7. 该插件的源码是否存在；源码与二进制是否同版本
8. 游戏服监听端口、启动方式（HLSM / 计划任务 / 手工）
9. 到 119.29.82.217:3306 的网络路径（本机 / 内网 / VPN / 公网）
10. 是否有可用的备份目录、是否可停单实例
```

### 2.1 判定门槛

| 结果 | 走哪条路 | 说明 |
|---|---|---|
| 核心 ≥ 1.8，`sqlx` 可用 | **快速路 A** | 复用 `esf_platform_auth`，只改 `test.sma`；5–7 天 |
| 核心确实是 1.0，无 `sqlx` | **兼容路 B** | 单独写 `esf_legacy_auth`（`dbi`）+ `test_legacy`；2–3 周 |
| 源码缺失 / 二进制与源码不一致 | **先停** | 没有源码就不能安全改 1v1；先找回源码或确认可替换 |

**不要为了统一而升级 EVM 的 `amxmodx_mm.dll`。**  
2005 年核心插件是旧 ABI/旧 natives 编译的，升级核心的风险远大于收益；本方案只增加插件文件。

### 2.2 已知的本地证据（不能替代现场）

本地 `G:\FCX1\FCX7.02融合版`：

- `addons/amxmodx/dlls/amxmodx_mm.dll` FileVersion `1.10.0.5461`；
- `modules` 为 2021 年版本，`mysql` 已加载；
- `scripting/test.sma` 57,125 B，`#include <sqlx>`，使用 `SQL_ThreadQuery`；
- `plugins.ini` 同时有 2005 年老插件与 `test_ranked.amxx`；
- `1v1.amxx` 被注释，`test_ranked.amxx` 生效；`test.amxx` 不在本地 `plugins` 目录。

这说明“1.0 环境”很可能是**2006 年插件集**，不是 AMXX 核心 1.0。  
但本地包不等于三台 EVM 的线上状态，必须按 P0 核验。

---

## 3. 目标架构：两条通道，一套平台

### 3.1 通道定义

| 通道 | 目标 | 插件 | 分发 |
|---|---|---|---|
| `modern` | 114 的 FCX-1/2 | `esf_platform_auth` + `esf_ranked_lock` + `test_ranked` + `esf_gamemode` | 现有 114 更新器，保持 0.53/0.54 节奏 |
| `evm-1v1` | 119.217 的 EVM-A/B、119.176 的 EVM-C | `esf_platform_auth` + 平台版 `test.amxx` | 新 legacy 通道；单包、按 server_key 配置 |

EVM 通道**不部署** `esf_ranked_lock`、`esf_gamemode`、`test_ranked`：

- `ranked_lock` 依赖现代 `ranked_matches`/`challenge_rooms` 字段和锁服语义，会与旧 1v1 的选队/复活冲突；
- `esf_gamemode` 会覆盖 `mp_gamemode`，可能改变 2.1 旧核心的模式；
- `test_ranked` 是 FCX_BATTLE 分支，不是 EVM 的 1v1 插件。

### 3.2 数据流

```text
启动器（玩家）
  → POST /api/launch-token  (purpose=join, server_key=EVM-A/B/C)
  → 写 setinfo "_platform_token" / "_platform_user"
  → 启动 hl.exe 连接 EVM
  → esf_platform_auth 校验 token / 账号状态 / server_key
  → 写 _platform_uid、play_sessions、amxx_builds 心跳
  → test.amxx 识别两名平台玩家，开始 1v1
  → 写 ranked_matches（live）+ ranked_match_players
  → 结束：写比分 → CALL settle_ranked_match → 更新 play_sessions
  → client_cmd(id, "disconnect")
  → 启动器轮询 /api/ranked/state 的 lastResult（<10 分钟）
  → launch.stop() 只杀本次启动的 PID，弹结算窗
```

### 3.3 平台/启动器必须补的两处

1. ** servers 元数据**：增加 `plugin_channel`、`plugin_family`、`amxx_version`、`managed`（或 `capabilities` JSON）。  
   现有 `servers` 只有 `server_key/name/ip/port/enabled/sort`，无法表达“这台是 EVM、走 legacy 通道”。  
   迁移必须是新增列、默认值兼容旧行，不破坏现有 `/api/servers`。
2. **Lobby 的 ranked 结果轮询**：  
   现在 `Lobby.jsx:812-828` 只每 2.5 秒刷新 `ranked.state`，不消费 `lastResult`；`RankedPage.jsx:339-366` 才消费并 `launch.stop()`。  
   EVM 玩家从“服务器列表”直连时不在排位页，比赛结束不会自动收游戏。  
   方案：在 Lobby 的轮询里对 `lastResult.finishedAt` 在 10 分钟内的结果执行一次 `launch.stop()`，并用 localStorage 记录已消费的 `matchId:finishedAt`，避免重复弹窗/误杀。

不要让插件或启动器依赖 `esf_match_end.flag` 做 EVM 退出：  
该标记只适用于“客户端与服务器同机”的本地测试；EVM 是远程服。

---

## 4. EVM 插件改造（快速路 A）

### 4.1 只改 `test.sma` 的四个点

不重写 1v1 状态机，保留：

- `g_iBattle`、`g_iWarrior`、`BattleLimt`；
- `autoPlayerStart()`、`checkWinner()`、`resetAll()`；
- 现有 Good/Evil 队伍和击杀统计。

只加平台钩子：

| 位置 | 新增逻辑 |
|---|---|
| `client_putinserver` | `PlatformOnConnect(id)`：读 `_platform_token`，等 `esf_platform_auth` 写 `_platform_uid`；无 token 按 `platform_allow_guest` 决定 |
| `autoPlayerStart()` 里 `g_iBattle = true` | `PlatformMatchStart()`：插入 `ranked_matches` + 2 条 `ranked_match_players` |
| `checkWinner()` | 记录 `g_platformWinner`、双方 kills/deaths |
| `resetAll()` | `PlatformMatchEnd()`：写比分、`CALL settle_ranked_match`、更新 `play_sessions`、`disconnect` |

### 4.2 认证插件要做的最小改动

`esf_platform_auth.sma` 当前已验证 token、消费 `launch_tokens`、插入 `play_sessions`、写 `amxx_builds` 心跳（`:283-301`、`:383-402`、`:423-430`）。  
新增：

```pawn
set_user_info(id, "_platform_uid", userIdString);
```

`test.amxx` 用 `_platform_uid` 识别玩家，不再按名字反查 `v_platform_users`。  
如果 EVM 核心确实是 1.0，这一段要改成 `dbi` 版本；见第 4.5 节。

### 4.3 数据库迁移（只增不删）

```sql
ALTER TABLE ranked_matches
  ADD external_key VARCHAR(96) NULL,
  ADD UNIQUE KEY uk_ranked_external (external_key);

ALTER TABLE ranked_match_players
  ADD kills SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD deaths SMALLINT UNSIGNED NOT NULL DEFAULT 0;
```

- `external_key`：`<server_key>:<map>:<started_at>:<uid_a>:<uid_b>`，防重复插入；
- `kills/deaths`：EVM 1v1 的比分要可查询，不能只依赖 `rating_after`；
- 存储过程 `settle_ranked_match` 仍按 `winner='a'|'b'` 结算，不改 ELO 规则；
- 迁移使用 `ensureColumn` 风格，重复执行安全；生产执行前先备份。

### 4.4 比赛数据写入顺序

1. 两名玩家都通过平台认证；
2. `INSERT ranked_matches (mode='1v1', server_key, map, status='live', started_at)`；
3. `SQL_GetInsertId` 取 `matchId`；
4. 读 `ranked_profiles.rating`，没有则 1000；
5. `INSERT ranked_match_players` 两条（team `a`/`b`，slot 1/2）；
6. 结束时写 `kills/deaths`，`CALL settle_ranked_match(matchId, winner)`；
7. `UPDATE play_sessions SET ended_at=NOW(), duration_sec=...`；
8. `client_cmd(id,"disconnect")`。

**幂等**：同一 `external_key` 只允许一场；结算前检查 `status`，已 `finished` 直接返回。

### 4.5 兼容路 B（仅当核心真是 1.0）

如果 P0 确认没有 `sqlx`：

- 新增 `esf_legacy_auth.sma`：`dbi` 连接、同步查询（或旧线程 API），只做 token 校验、`_platform_uid`、`play_sessions`、心跳；
- 新增 `test_legacy.sma`：保留 1v1，但把 `SQL_ThreadQuery` 改为 `dbi`；
- 不引入 `regex`、`cromchat`、`fakemeta` 新依赖；中文提示用 `client_print`；
- 工期 2–3 周，且必须先在 119.176 单服验证；
- 如果 `dbi` 的延迟/踢人/编译任一不达标，**不要硬上**：EVM 只做“只读接入/友谊赛”，不做排位结算。

---

## 5. 分发与部署

### 5.1 包结构（EVM 通道）

```text
esf-evm-1v1-<version>.zip
  test.amxx
  esf_platform_auth.amxx
  esf_evm.cfg
  install-esf-evm.ps1
  manifest.json
  SHA256SUMS.txt
```

`esf_evm.cfg` 只放服务器差异：

```cfg
platform_sql_host "127.0.0.1"   ; 119.217 本机；119.176 待核验
platform_sql_user "esf_legacy"
platform_sql_pass "<从密码库读取，不写仓库>"
platform_sql_db "esf_platform"
platform_server_key "<实际 server_key，待核验>"
platform_enforce 1
platform_allow_guest 0
```

三台 EVM 共用同一个 zip，只换 `platform_server_key`。  
**不要为每台服单独编译。**

### 5.2 安装脚本（单台 2–3 分钟）

1. 校验 zip 的 SHA256；
2. 读 `amxmodx_mm.dll` 版本 / `amxx version`，低于门槛退出；
3. 只停当前实例，不杀整机、不动 API/MySQL；
4. 备份 `test.amxx`、`plugins.ini`、`amxx.cfg` 到时间戳目录；
5. 复制两个 `.amxx`，在 `plugins.ini` 确保只有一行 `test.amxx`，注释旧 `1v1.amxx`；
6. 写入 `esf_evm.cfg`（已有则只更新 `platform_server_key` 等差异项）；
7. 启动实例，等 A2S + `amxx_builds` 心跳；失败自动回滚并保留日志。

### 5.3 灰度顺序

1. **119.176 的 EVM-C**：独立主机、单服，最容易回滚；观察 24 小时；
2. **119.217 的 EVM-A**：与 API 同机，先确认不重启 API/MySQL，只停 EVM-A；
3. **119.217 的 EVM-B**：最后。

每台先 `platform_enforce 0` 观察 1–2 场，确认认证/选队/结算日志，再切 `1`。  
不要三台同时上。

### 5.4 更新器

- 119.217 本机：一个轻量 `esf-evm-updater.ps1`，计划任务每 5 分钟检查 `C:\esf\updates\evm-1v1\manifest.json`；
- 119.176：同一脚本，通过 HTTPS 拉取 manifest + zip；失败重试 3 次，不阻塞游戏；
- 只替换 `test.amxx` / `esf_platform_auth.amxx` / cfg；**不整包覆盖** `plugins.ini` 和老插件；
- 校验 sha256 +（可选）签名；备份最近 2 版；保留 `install.log`。

外部 EVM 若不允许平台直连，只做“拉取 + 人工确认”：平台生成下载链接，管理员在 EVM 上执行安装脚本。

---

## 6. 安全

### 6.1 数据库账号

新建 `esf_legacy`，只给：

- SELECT：`launch_tokens`、`v_platform_users`、`ranked_matches`、`ranked_match_players`、`ranked_profiles`、`servers`；
- INSERT/UPDATE：`play_sessions`、`ranked_matches`、`ranked_match_players`、`amxx_builds`；
- UPDATE：`launch_tokens.used_at` / `authorized_until`；
- EXECUTE：`settle_ranked_match`。

不给 `users` 写权限，不给 `DELETE`/`DROP`，不给 `mysql` 库。

### 6.2 网络

- 不要让 EVM 直接暴露公网 3306；
- 119.217 上的 EVM-A/B 走 `127.0.0.1`（同机）；
- 119.176 优先 WireGuard/ZeroTier/内网；不行则本机 `stunnel`/`socat` 转发到 `127.0.0.1:3306`，平台只开 TLS 端口 + IP 白名单；
- 所有远程安装走 HTTPS + sha256，不走明文 SMB。

### 6.3 红线

1. 不升级 EVM 的 AMXX 核心；
2. 不覆盖 2005 年核心插件；
3. 不让 `test.amxx` 与 `test_ranked` 同时接管 1v1；
4. 不用 `quit` 做退出（客户端会拦），用 `disconnect` + 启动器按 PID 强杀；
5. 不把 `esf_match_end.flag` 用在远程 EVM；
6. 不在仓库写数据库密码；
7. 不让外部 EVM 直接调用平台管理接口。

---

## 7. 可观测性与维护

### 7.1 心跳

每个 EVM 至少上报：

- `amxx_builds(server_key, 'platform_auth', BUILD)`；
- `amxx_builds(server_key, 'test_amxx', VERSION)`（或统一 `test_amxx` 键）；
- `server_status` 由现有 A2S 轮询写入。

平台 `/api/plugins/observability` 增加 `channel`/`expected`，按 `server_key` 显示：

- `ok`：心跳版本 = 期望；
- `drift`：版本不一致；
- `stale`：超过 15 分钟无心跳；
- `missing`：从未上报；
- `offline`：A2S 不在线。

### 7.2 日志

- 游戏侧：`addons/amxmodx/logs/LYYYYMMDD.log`；
- 安装侧：`C:\esf-agent\evm-install.log`；
- 平台侧：`/api/plugins/observability` + 服务端日志；
- 每场比赛记录 `external_key`、`match_id`、`server_key`、两名 `user_id`、winner、结算结果。

### 7.3 日常维护

| 频率 | 动作 |
|---|---|
| 每日 | 看 3 台 EVM 心跳、A2S、安装日志；检查 `ranked_matches` 是否有卡在 `live` 的比赛 |
| 每周 | 抽查 1 场结算：`ranked_matches` / `ranked_match_players` / `ranked_profiles` / `lastResult` 一致；清理 30 天前日志 |
| 每月 | 做一次回滚演练（备份目录 + 安装脚本）；检查 `esf_legacy` 授权；核对 manifest 与线上哈希 |
| 每季度 | 评估是否需要兼容路 B；检查 AMXX 安全公告；复核 VPN/TLS 证书 |

### 7.4 告警阈值

- 心跳 > 15 分钟：warning；
- 心跳 > 60 分钟或 A2S 离线：critical；
- `settle_ranked_match` 失败 > 3 次/小时：critical；
- 同一 `external_key` 重复插入：critical（说明幂等失效）；
- 安装失败/回滚：warning，保留现场。

---

## 8. 验收清单

### 8.1 单台 EVM

- [ ] `amxx version` / `amxx modules` 与 P0 记录一致；
- [ ] `plugins.ini` 只启用一个 1v1 插件；
- [ ] 平台 token 进服，日志出现 `[Platform] verified`；
- [ ] `play_sessions` 有 started_at，退出后有 ended_at/duration；
- [ ] 两名平台玩家开始 1v1，`ranked_matches` 有 live 行；
- [ ] 结束后 `status=finished`、`winner` 正确、两人 `rating_after` 变化；
- [ ] `lastResult` 在 5 秒内可被启动器读到；
- [ ] 启动器 10 分钟内 `launch.stop()` 只杀本次 PID；
- [ ] 重复结算不重复加分；
- [ ] 回滚后旧 `test.amxx` 能正常开局。

### 8.2 三台 EVM

- [ ] EVM-A/B/C 的 `server_key` 与 `servers` 表一致；
- [ ] 三台心跳都在 15 分钟内；
- [ ] 三台都能认证、开局、结算、退出；
- [ ] 119.217 的 API/MySQL 未被 EVM 安装/重启影响；
- [ ] 119.176 的远程网络路径稳定，无公网 3306；
- [ ] 114 的两台 FCX 未受 EVM 变更影响，仍上报 0.53/0.54。

---

## 9. 待核验清单（必须现场确认，不得猜）

| # | 项目 | 为什么重要 | 怎么确认 |
|---|---|---|---|
| 1 | EVM-A/B/C 的 AMXX 核心版本 | 决定快速路 A 还是兼容路 B | `amxx version` + DLL FileVersion |
| 2 | `sqlx`/`mysql` 模块是否加载 | auth/test 的 DB 能力 | `amxx modules` + `modules.ini` |
| 3 | EVM 当前 1v1 插件是 `test.amxx` 还是 `1v1.amxx` | 决定改哪个源码 | `plugins.ini` + 文件哈希 |
| 4 | `test.sma` 源码与线上二进制是否同版本 | 没有源码不能安全改 | 比对 SHA/编译时间/作者 |
| 5 | EVM-A/B/C 的监听端口 | 启动器 `server_key`/A2S 必须匹配 | `netstat` / HLSM 配置 |
| 6 | EVM 的启动方式（HLSM/计划任务/手工） | 安装脚本只能停单实例 | 服务/任务列表 |
| 7 | 119.176 到 119.217 的网络路径 | 决定直连/VPN/stunnel | `Test-NetConnection 3306` |
| 8 | 119.176 旧平台 API 是否仍在运行 | 避免误停/双 API | 端口 3000/443、计划任务 |
| 9 | 119.217 上 EVM-A/B 与 API 的资源/端口隔离 | 安装时不能影响 API | 进程/端口/服务 |
| 10 | 生产库是否已执行 013 及最新迁移 | 影响 `amxx_builds`/ranked 字段 | `SHOW TABLES` / `SHOW COLUMNS` |
| 11 | EVM 玩家是否都从启动器进服 | 决定“正确退出”是否依赖启动器 | 实际入口/日志 |
| 12 | 2.1 的胜负条件/队伍映射 | `winner` 与 `team a/b` 必须对应 | 实际一局 + 插件源码 |

---

## 10. 实施顺序与工期

| 阶段 | 内容 | 工期 |
|---|---|---|
| P0 | 三台 EVM 环境核验，产出 `env-audit-*.txt` | 0.5 天 |
| P1 | 选快速路 A：改 `test.sma` 四处 + auth 写 `_platform_uid`，本地编译 | 2 天 |
| P2 | 119.176 单服灰度：1 场真实 1v1 + 结算/退出 | 1 天 |
| P3 | 119.217 EVM-A，再 EVM-B | 1 天/台 |
| P4 | 平台 legacy 通道 + Lobby ranked 轮询 + 面板 | 2–3 天（可与 P1 并行） |
| P5 | 119.176 旧 API 下线（若确认存在）、文档/监控收尾 | 1 天 |

如果 P0 判定为兼容路 B：P1 改为 `dbi` 版，工期 +2 周；先只做 119.176，不一次性推三台。

---

## 11. 回滚

- 插件：安装脚本备份目录 `backups\<timestamp>\`，回滚 = 停实例 → 复制回 `test.amxx`/`plugins.ini`/`amxx.cfg` → 启动 → 看 A2S + 心跳；
- 平台：`servers.plugin_channel`/manifest 保留上一版；legacy 通道可一键指向旧 manifest；
- 数据库：本次只加列/索引，不删表；回滚不需要回退数据，旧插件忽略新列；
- 启动器：Lobby ranked 轮询是新增逻辑，出问题可回退到上一安装包；不影响 114 现代服。

---

## 12. 交接给下一任维护者

### 12.1 先读

1. 本文件；
2. `docs/kb/current-state.md`（注意版本可能滞后）；
3. `docs/AMXX_PLUGIN_DESIGN.md`；
4. `server/sql/001_schema.sql`、`server/scripts/migrate.js`；
5. `amxx/esf_platform_auth.sma`、`amxx/test_ranked.sma`；
6. `scripts/publish-amxx.ps1`、`docs/kb/pattern/release-amxx.md`。

### 12.2 不要做

- 不要把现代四插件整套推到 EVM；
- 不要升级 EVM 的 AMXX 核心；
- 不要用 `test_ranked` 替换 EVM 的 `test.amxx`；
- 不要在公网开放 3306；
- 不要在没有备份/回滚的情况下改 `plugins.ini`；
- 不要把“本地 2.1 包”的版本当成三台线上服的版本。

### 12.3 关键联系人/凭据位置

- 平台 API/MySQL：119.29.82.217，`C:\esf\server`；
- EVM-A/B：119.29.82.217 上两台游戏实例（具体路径/服务待核验）；
- EVM-C：119.91.99.176（旧平台主机，API 是否停待核验）；
- 密码/密钥只从既有密码库读取，不写入本文件或仓库；
- 发布记录：`docs/kb/log.md`、`docs/design/HANDOFF-0.5.21.md`（历史参考）。

---

## 13. 当前建议

**先做 P0，不要先改代码。**  
P0 的结果会决定这是“5–7 天的平台层适配”，还是“2–3 周的 1.0 兼容重写”。  
无论哪条路，都先用 119.176 的 EVM-C 做单服金丝雀，再推 119.217 的 EVM-A/B；114 的现代 FCX 服保持现状，不参与这次变更。
