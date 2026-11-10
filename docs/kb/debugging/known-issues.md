---
title: 已解决的问题与根因
category: debugging
tags: [troubleshooting, root-cause]
updated: 2026-11-11T06:50:00+08:00
---

# 已知问题

## 1. 中文提示乱码（插件）

- 现象：`client_print` / 控制台出现"鎬ュ埌"、`[??λ]`、`???`。
- 根因：构建时把源码转 GBK 再编译 → 二进制存 GBK 字节；客户端与 HLDS 控制台按 **UTF-8** 解释。
- 修复：0.46 起 **UTF-8 直编**（不转码）；控制台日志改英文/ASCII。详见 [[amxx-plugins]]。

## 2. 朋友进排位被踢 `RANKED_LOCKED`

- 现象：`Kicked :"RANKED_LOCKED: …"`。
- 根因：游戏进程没执行 `launcher.cfg` → userinfo 没有 `_platform_token` → 以 guest 进服
  （`platform_allow_guest 1`），而 `esf_ranked_lock` 对有比赛的服踢非参赛者。
- 修复：0.48 guest 兜底（参赛名单 + 本服 10 分钟内未被使用的 token → 放行）；长期修法是启动器 `+setinfo`。

## 3. 客户端"下载一半变全量"

- 现象：进度条走一半跳回 0 并下载完整包。
- 根因：`%LOCALAPPDATA%\esf-launcher-updater\current.blockmap` 与 `installer.exe` 版本不一致，
  差量拼装 sha512 不符 → electron-updater 静默回落全量。
- 修复：`sanitizeUpdaterCache` 校验 blockmap 与 installer 尺寸；`LOCALAPPDATA` 从 `process.env` 取（Electron 无该 getPath key）。
- 详见 [[launcher-updater]]。

## 4. 管理台服务器名乱码

- 现象：`[ESF-FCX]???[2]`。
- 根因：数据库里存的就是 0x3F（`?`），来自更早的 GBK/UTF-8 混写，不可逆。
- 修复：直接改成「[ESF-FCX]新手房[2]」；新写入路径 utf8mb4 正常。

## 5. 插件心跳缺失（新手房）

- 现象：`amxx_builds` 只有 `fcx-1v1-1`，没有 `fcx-1v1-2`。
- 疑似：新手房 `amxx.cfg` 没配 `platform_server_key` / `ranked_server_key`，插件拿不到 server_key 就不写心跳。
- 状态：待查（不影响游戏，只影响可观测性）。

## 6. 114 无法 WinRM

- 现象：本机 `Test-NetConnection 114.132.84.150 -Port 5985` 失败，但服务器上 `netstat` 显示 LISTENING。
- 根因：腾讯云安全组未放行 5985。
- 处理：用 RDP + 队列代理，见 [[remote-ops]]。

## 7. 迁移期数据导入乱码

- 现象：导入 dump 报 `ERROR 1064`，中文表名/内容乱码。
- 根因：文本方式传输时编码被转坏。
- 处理：一律 gzip + base64 二进制传输，`--default-character-set=utf8mb4`。

## 8. 开局不会自动分配队伍（待处理）

- 现象：约战/排位房间已经登记了 `team`，但玩家进服后仍是未选队/同队；必须手动在控制台输入 `jointeam 1` 或 `jointeam 2` 才生效，且 ESF 对切队有 8 秒冷却。
- 现状代码（以线上 0.48 分支 `fix/amxx-ascii-logs` 为准；`test_ranked.sma` 共 3,064 行，版本 `1.2.0-r14`）：`autoPlayerStart()` 在 `amxx/test_ranked.sma:2849-2879`，只统计 `Get_Team()`，双方人数相等才走 legacy 开赛；全文件没有任何 `client_cmd` / `engclient_cmd` 下发 `jointeam`。`hookJoint()` 在 `:1905-1945`，只做拦截，不负责分配。平台房间的 `g_challengeTeam[id]` 已从 `challenge_room_players.team` 读到（`:505-563`），但只用于 HUD/结算，没有写回引擎队伍。因此队伍不相等时，`autoPlayerStart()` 不会开赛；即使 `startChallengeBattle()` 按内部队伍开赛，玩家在引擎侧仍未选队，无法正常出生。
- 相关：`register_clcmd("jointeam 1"/"jointeam 2"/"jointeam 5", "hookJoint")` 在 `:3038-3040`；`Get_Team()` 用 `get_user_team()` 首字母 G/E 判队（`:2406-2419`）。main 的旧源码行号不同（旧 `autoPlayerStart` 在 2448 附近），评估必须以线上分支为准。
- 可选修法：
  1. 插件主动分配（不逆向）：在 `OnChallengeIdentify` / `OnRankedIdentify` 拿到平台队伍后，置内部标记 `g_teamAssigning[id]=true`，用 `engclient_cmd(id, "jointeam", team == 1 ? "1" : "2")` 下发（必要时再补 `menuselect` 选职业）；`hookJoint()` 对内部标记放行，避免被自己的登录/2v2 拦截规则挡住。下发后 0.5–1 秒校验 `Get_Team()`，不匹配则等 8.2 秒重试，最多 2 次；超时以 `TEAM_ASSIGN_FAILED` 终止开局并在 HUD 提示。先实测“首次选队是否也吃 8 秒冷却”：若首次不吃，进服后 1 秒内一次即可；若吃，则按 8.2 秒节奏重试。
  2. 逆向 ESF.dll：找 8 秒冷却对应的 cvar / `m_flNextTeamChange` 字段 / `CBasePlayer::JoinTeam`，优先把冷却 cvar 设为 0；其次用 Orpheu 直接调用 JoinTeam 或清冷却。只有在方案 1 的 8 秒重试不可接受时再做。
  3. 启动器预选：进服前把队伍写进启动参数或 `launcher.cfg`，让首次 `jointeam` 不触发冷却；插件只做校验。需要实机验证命令执行时机。
- 状态：**已实施（2026-11-11，编译验证通过），待真机验收**。采用方案 1：`platformAssignTeam()`
  在 `OnRankedIdentify` / `OnChallengeIdentify` 拿到平台队伍后登记 `g_platformDesiredTeam`，
  由 `taskTeamAssign` 用 `engclient_cmd(id, "jointeam", "1"/"2")` 下发；下发期间置
  `g_teamAssigning[id]`，`hookJoint` 对该标记放行（平台模式 `PS_IS_LOGGED=false` 会误拦）；
  `taskTeamVerify` 在 0.8 秒后校验 `Get_Team()`，不匹配按 **8.2 秒冷却重试最多 2 次**，
  仍失败记 `TEAM_ASSIGN_FAILED` 并提示玩家。`startChallengeBattle()` 在
  `platformTeamAssignmentPending()` 为真时延后开赛（最多 5 次 / 约 10 秒），避免同队出生，
  超时强制开赛且留日志。断线、换房、resetall 均清理任务与标记。
  `amxx/tools/build-current.ps1` 编译 **0 error / 0 warning**，`test_ranked.amxx` 26638 B；
  静态防回归断言见 `server/test/amxx-challenge.test.js`（后端 100/100 通过）。
  **注意**：线上仍运行旧 0.52 二进制，此修复需打包发布后才生效；是否"首次选队也吃 8 秒冷却"
  仍需真机确认（KB `current-state` 待办 9）。

## 9. 本地 listen server 开房被平台校验踢出

- 现象：本机 `hl.exe` 开 listen server（New Game / LAN）后，房主反复收到
  `[平台] 未检测到平台凭证，请从 ESF 平台启动游戏`、`[排位赛] 本地房主无法被踢出，请从平台进入比赛`，
  控制台刷 `[ESF-REJECT]` / `[ESF-LOCK]` 日志；`jointeam` 还被 `hookJoint` 以
  "未登录账号，禁止加入比赛" 拦掉，实际既踢不掉也玩不了。
- 根因：本机 `G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\configs\amxx.cfg` 里
  `platform_enforce "1"`、`ranked_lock "1"`、`platform_server_key "fcx-1v1-1"`（指向生产服）。
  房主没有 `_platform_token` → `esf_platform_auth.sma` 走 `rejectPlayer` 下发 `kick`，
  但 **listen server 房主引擎踢不掉**；`esf_ranked_lock.sma` 的 loopback 兜底只跳过 kick，
  仍写拒绝状态、弹提示；`test_ranked.sma` 的 `hookJoint` 因 legacy `PS_IS_LOGGED=false` 阻止选队。
  旧做法（把 `platform_enforce` 设 `0`）只是 workaround，且锁服插件不看这个 cvar。
- 修复（2026-11-11，`BUILD 0.54`）：三个插件各加入同名 `isLocalListenGuest(id)`，
  判定条件为 **非 `is_dedicated_server()` + IP 为 `127.0.0.1` / `::1`**：
  1. `esf_platform_auth.sma`：`rejectPlayer` 在任何拒绝原因下先按 guest 放行
     （`allowLocalListenGuest`，只提示一次、不写 `g_authed`/会话/战绩、不排踢人任务）。
  2. `esf_ranked_lock.sma`：`taskCheckPlayer` 对无凭证的本地连接直接跳过锁服查询；
     `rejectPlayer` 兜底也不踢、不写拒绝状态。
  3. `test_ranked.sma`：`hookJoint` 在**无进行中的平台比赛**时放行手动 `jointeam`。
- 安全边界（关键）：`is_dedicated_server()` 是第一道判定，生产两台 HLDS 都是 dedicated，
  **这段放行在线上永远不会触发**，平台强制校验强度不变；从公网连入 listen server 的玩家
  IP 非 loopback，仍走完整校验；**带有效 token 的本地客户端仍走完整校验**，
  `amxx/local-verify.cjs` 与双开验收的 token 消费链路不受影响。
  静态防回归断言见 `server/test/amxx-auth.test.js`（后端 103/103）。
- 本机落地：`dist/amxx-0.54/` 的 4 个 `.amxx` 已覆盖到上述游戏目录 `plugins/`，
  逐文件 SHA256 校验一致，旧文件备份在 `plugins/backup-before-0.54-20261111-064942/`。
- 验证方式：重开一局本地 listen server，日志应出现
  `[Platform] local_listen_guest=1`、`[ESF-LOCK] local_listen_guest=1 ... skip lock check`，
  且**不再出现** `[ESF-REJECT] kick` / `[ESF-LOCK] kick`；房主可手动 `jointeam 1`/`2` 选队。
- 状态：**源码与本机场已修，编译 0 error / 0 warning、静态断言通过；待真机开一局确认**。
  0.54 包已本地打包但**未上传生产更新源**（生产 dedicated 不受此问题影响，
  留待下次常规发布一并上线）；生产 `.env` 仍显式 `AMXX_EXPECTED_*=0.53`，与线上 0.53 一致，
  不要因为仓库默认值升到 0.54 就误判为 drift。
