---
title: 变更日志
category: log
tags: [log]
updated: 2026-11-10T08:00:00+08:00
---

# 变更日志

新在上。一行一条：日期 · 改了什么 · 依据。

- 2026-11-10 · 启动器 0.6.0 发布（`98cb7db`，tag v0.6.0）：成员状态补全约战、成员面板全站常驻可收缩（320/56，Ctrl/Cmd+M）、AFK 180s 提醒/300s 判负并固定扣 30 分（战绩公开 AFK 标记）、观战 4 人上限、锁服排队（排位优先着色）、准备 120s/空房 600s 自动解散、管理台占用看板、比赛结束 10 秒倒计时退出；插件 0.50 已由 114 自动更新（心跳 07:27）。安装包 128,767,331 B / blockmap 135,121 B，0.5.23→0.6.0 差量 41 ops / 9,103,896 B；两机 `/api/config` 均 0.6.0。新增发布自动同步 `src/data/releases.json`（`scripts/update-releases.js`，`release.ps1` bump 后调用），并回填 0.4.15/0.4.16/0.5.1/0.5.2/0.5.21/0.5.23 说明。

- 2026-11-10 · 0.6 反占服与成员面板（实施中，待验收）：成员列表补约战状态（`/members` 子查询 + `activityOf` 优先级）且成员面板全站常驻、展开 320/折叠 56、`Ctrl/Cmd+M`（`9d9e230`）；观战 4 人上限、锁服排队（排位优先）、准备 120 秒与空房 600 秒自动解散、`/queue` 与 `/challenges/:id/spectate` 接口（`a75be66`）；AFK 180s 提醒/300s 判负、排位固定 -30、`esf_match_end.flag` + 启动器 10 秒强杀、插件 0.50（`bdc7b8e` + 插件 `ad13df4`）；管理台占用看板与 AFK 战绩标记（`0887a3f`）。真机 CDP 验证折叠宽度差 264px、占用看板渲染、114 心跳 07:27 上报 0.50。Caddy 11/7 起无触发器宕机，已恢复并加 `ESFCaddyWatch` 每 5 分钟自愈。新增 `decision/anti-occupy-06` 与 `docs/design/p06-plan.html`（方案树渲染）。

- 2026-11-10 · 启动器 0.5.23：约战只开放「单挑 1」（`fcx-1v1-1`），单局 15 分钟限时，到点按击杀比分自动结算（平局记 A 队）；服务端 180 秒宽限自动关闭僵尸房间；客户端房间卡显示「限时 15 分钟 / 剩余 N 分钟」，服务器下拉只列单挑 1。插件 0.49（`TASK_CHALLENGE_TIMEOUT 4950`）经 114 自动更新，`amxx_builds` 上报 0.49。发布流程改为只推新机、老机读共享 DB 的 `platform_settings`（版本/说明/下载地址），`release.ps1` 首次实跑通过；提交 0faa15c，tag v0.5.23；差量 0.5.21→0.5.23 下载 1,697,637 B。新增 `decision/challenge-limits`。

- 2026-11-10 · 启动器 0.5.21：插件中心独立页（左侧栏，不再挤设置）；测试 profile 在 Chromium 启动前切 `userData`，不串正式账号；AMXX 心跳接口与面板；比赛结束标记强杀，只杀本次 PID 避免壳/子进程误杀；修复首次进服选队、比赛期 V 换队、`test_ranked` 心跳、HUD 非 ASCII 队名。交接单 `docs/design/HANDOFF-0.5.21.md`。

- 2026-11-10 · 启动器 0.5.2：大厅新增本地地图记忆（`settings.lastMap`，进大厅自动选上次地图，换图/随机都写入）；管理台改为栏目折叠（默认只展开玩家管理，点栏目标题切换），hero 压缩；所有者可在管理台「注销」其他账号（软删除：改名为 `deleted_<id>_…`、清邮箱/状态/会话，历史对局保留）。提交 5bea8a7，tag v0.5.2；差量 0.5.1→0.5.2 下载 7,365,460 B。发布脚本部署段改为 20×2s 健康重试。

- 2026-11-09 · 启动器 0.5.1（启动兼容包）：启动失败自动重试 2 次；15s/25s 窗口检测，无窗口可一键直接启动 `no_hl.exe`；设置 → 启动兼容 新增兼容模式（窗口化 800×600 + `-gl` + `-heapsize 262144`）；新增 `launcher.log` 与一键诊断包。提交 8d3a2fd，tag v0.5.1；差量 0.5.0→0.5.1 下载 1,685,174 B。新增 `decision/launch-compat`。

- 2026-11-09 · 插件 0.48 审计修正：线上 `fix/amxx-ascii-logs`（dd3a868）包含 r14 提交 c333c33 + 0.48 修复，r14 的 R1/R5/R7/R8/R10 修复已在线上；main 306cd47 早于线上，不能作为现状基线。剩余功能缺口是自动分边。另发现源码 `BUILD 0.47` / `lock VERSION 1.3.0` 与包 `0.48` / README `1.2.0` 不一致，0.48 发布物不能由当前分支构建脚本直接复现；已记入 `current-state` 的版本一致性行与 `known-issues` 第 8 条。
- 2026-11-09 · 插件待办：记录“开局不会自动分配队伍”——`autoPlayerStart()` 只统计 `Get_Team()`，全文件无 `jointeam` 下发；ESF 切队有 8 秒冷却。候选方案（engclient_cmd + 8.2s 重试 + 校验 / 逆向 ESF.dll 找冷却 cvar / 启动器预选）写入 `debugging/known-issues` 第 8 条，并挂到 `current-state` 待办 9。
- 2026-11-09 · 启动器 0.5.0（UI Beta 冻结）：P0–P9 全站界面重做（令牌/外壳/大厅/排位/约战/服务器/资源库/管理台/设置/登录/频道），提交 0238202，tag v0.5.0；差量 0.4.16→0.5.0 下载 3,480,839 B。修复 `release.ps1` 的 bump 未传版本参数导致 `package.json` 丢 `version` 键的旧 bug。交接单 `docs/design/HANDOFF-ui-redesign.md` 已补齐各阶段提交号。
- 2026-11-09 · 启动器 0.4.16：TOTP 两步验证（10 个一次性备用码）、登录设备列表与撤销、密码强度（≥10 位且 ≥3 类）、接口安全响应头。提交 7f4ea11，tag v0.4.16；差量 0.4.15→0.4.16 下载 7,357,162 B。新增 `decision/account-security` 的 0.4.16 段。

- 2026-11-09 · 启动器 0.4.15：忘记密码三步、设置内绑定 QQ 邮箱与改密、管理台重置临时密码（强制改密）、登录 10 次锁定；两台 API 配好 QQ SMTP 并全链路实测。提交 e4aa157，tag v0.4.15；差量 0.4.14→0.4.15 下载 7,625,781 B。新增 `decision/account-security`、`decision/maintenance-channel`。

- 2026-11-09 · 密钥轮换：esf_app / esf_backup / esf_amxx 全部更换，验证 health、备份、amxx_builds 心跳恢复；同日记 ops agent 卡死事故与修复（轮询 HasExited + 杀进程树）。提交 b978bba。

- 2026-11-09 · 维护通道：`ops_jobs`/`ops_agents` + 114 pull agent（计划任务 ESFOpsAgent），服务器可远程排队执行命令并取回输出。提交见 `deploy/ops-agent`。

- 2026-11-08 · 启动器 0.4.14：支持 ESF Engine 1.0（无 hl.exe，参数写入 `engine.cfg` 的 `Launcher=` 行、退出还原、`engine.cfg.esf-base` 备份）；EACCES 诊断。提交 ea14d16，tag v0.4.14；差量 0.4.13→0.4.14 下载 1,867,465 B。新增 `decision/engine-mode`。

- 2026-11-08 · 启动器 0.4.13：成员行版式调整（状态跟在名字后同一行，角色/段位收进第二行，自己那栏点状态即编辑）。提交 4e9bdfc，tag v0.4.13；差量 0.4.12→0.4.13 下载 1,686,703 B。
- 2026-11-08 · 启动器 0.4.12：成员自定义状态（users.status_text）+ 自动活动行 + 7 个界面音效与设置开关；新增 decision/lobby-presence-sound。提交 43e4b83，tag v0.4.12；差量 0.4.11→0.4.12 下载 7,606,741 B。
- 2026-11-08 · 建立 `docs/kb/`：index/current-state + decision（migration、launcher-updater、ranked-challenge、amxx-plugins、kb-policy）+ environment（servers、accounts-secrets、toolchain）+ pattern（release-launcher、release-amxx、remote-ops）+ debugging（known-issues）。依据：仓库现状与线上实测（0.4.10 / 插件 0.48）。
- 2026-11-07 · 插件自动更新链路：`scripts/publish-amxx.ps1` + 114 `ESFAmxxUpdate`（每 10 分钟）+ 心跳表 `amxx_builds`；发布 0.45 验证自动生效。提交 f5b116b。
- 2026-11-07 · 插件 0.46/0.47/0.48：UTF-8 直编、guest 兜底、心跳、视图授权修正。提交 dd3a868。
- 2026-11-07 · 启动器 0.4.10：历史战绩/结算面板重排，修 `LOCALAPPDATA` 缓存校验。提交 a43d18c，tag v0.4.10。
- 2026-11-07 · 启动器 0.4.9：排位历史、按天房号、更新缓存校验、esf.exe 兼容。提交 9af6c7e，tag v0.4.9。
- 2026-11-07 · 启动器 0.4.8：默认 API 切新机、A2S 短包崩溃修复。提交 0a7def4，tag v0.4.8。
- 2026-11-07 · 平台迁移：新机 119.29.82.217 上线（MySQL 8.0.29 + Node 18.20.8 + Caddy/LE IP 证书），老机切库保留回滚。

- **2026-11-10 · 启动器 0.6.1**：约战页修复与排位结算兜底——1v1/2v2 分色居中、胜利条件固定 3/5/10；插件 0.51 修正 2v2 列索引（不再被当 1v1）；插件 0.52 结算失败写 `esf_pending_result.json`，启动器启动/赛后自动补交 `POST /api/ranked/settle`（幂等、AFK −30），失败按 30s/2min/10min 重试；排位无可用服务器时按钮置灰。提交 8ff59dc，tag v0.6.1；差量 0.6.0→0.6.1 下载 7,426,389 B；两机 config 0.6.1、exe 128,768,372 B。
