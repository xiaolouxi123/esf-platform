---
title: 已解决的问题与根因
category: debugging
tags: [troubleshooting, root-cause]
updated: 2026-11-09T07:55:00+08:00
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
