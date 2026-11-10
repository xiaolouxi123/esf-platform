---
title: 变更日志
category: log
tags: [log]
updated: 2026-11-10T08:00:00+08:00
---

# 变更日志

新在上。一行一条：日期 · 改了什么 · 依据。

- 2026-11-11 · **生产 .env 三项修补完成**（带备份 → 重启 ESFAPI → `/api/health` 验证 `ok=true / db=up`，未触发回滚；
  备份 `C:\esf\backups\env-20261111-062934.bak`）：
  `MIN_LAUNCHER_VERSION` 0.2.4→0.6.1、显式写 `AMXX_EXPECTED_*=0.53`（消除与新插件的 drift）、
  设置 `INVITE_CODE`（小范围邀请制落地）。**邀请码值只在生产 .env 与维护者手中，不写进公开仓库**。
  客户端确认**不打新 tag**：生产更新源已有 0.4.7~0.6.1 共 18 个历史版本 exe+blockmap、
  `latest.yml` 指向当前 0.6.1，重发只会产生内容相同的空版本。
  仍待确认：114 自动更新后的 `amxx_builds` 心跳 0.53、两台服插件哈希、真机双开验收。
- 2026-11-11 · **0.53 插件包已上传生产更新源**：`esf-challenge-plugins-0.53.zip` + manifest →
  新机 `C:\esf\updates\amxx\`（远端已有 0.45~0.53 全部历史包，manifest.version=0.53），
  114 的 `ESFAmxxUpdate` 会在 10 分钟内自动替换并重启游戏服；心跳与哈希待确认。
  只读探测生产更新源：`C:\esf\updates` 已有 0.4.7~0.6.1 共 18 个历史 exe + blockmap，
  `latest.yml` 指向 0.6.1，`.env` 版本项均正确 —— 客户端「历史版本 + 目前版本」已齐备，
  **无需重发安装包或打新 tag**；官网更新记录已改为展示全部 25 个历史版本 + 当前版本。
  `release.yml` 加固：tag 格式校验（避免 workflow_dispatch 把 main 当版本号）、
  `fail_on_unmatched_files: true`、把**所有历史版本**的 blockmap 带到新 Release（原先只带上一版）。
  探测同时发现 3 个待确认的生产配置项：`MIN_LAUNCHER_VERSION=0.2.4` 过时、
  生产 `.env` 未显式写 `AMXX_EXPECTED_*`（服务器 env.js 仍是旧默认值，会与新插件 drift）、
  缺 `INVITE_CODE`（小范围邀请制未落地），修这些需要重启 API，待维护者确认。
- 2026-11-11 · **部署包重建 + 0.53 发布准备**：新增 `scripts/build-server-bundle.py`，重建
  `deploy/esf-server-bundle.zip`（45→73 文件、7→16 个 SQL、含 `settle_*` 过程、53 项 env 模板），
  产出 manifest 并接入 `check-versions.cjs`（12 PASS / 0 FAIL）。`server/.env.example` 补全应用与
  脚本全部变量、全为占位值；`deploy-esf-server.ps1` 生成的 `.env` 补邀请码、上传令牌、ops key、
  HTTPS 入口、AMXX 来源 IP 与 0.53 心跳期望。
  **插件升 BUILD 0.53**（不升版本 114 的 updater 不会拉取），同步 `AMXX_EXPECTED_*` 默认值、
  静态测试断言与部署脚本。编译 0 error / 0 warning，本地产出
  `dist/amxx-release/esf-challenge-plugins-0.53.zip`（37,908 B / sha256 `b8d8a480…`）与无 BOM manifest。
  发布清单见 `docs/RELEASE-2026-11-11.md`。**线上仍是 0.52**：上传到新机、114 自动更新与
  `git push origin main` 需维护者执行；发布后把 `current-state` 的线上插件包改为 0.53。
- 2026-11-11 · **修复开局自动分边（KB 待办 9 / known-issues #8）**：`amxx/test_ranked.sma` 新增
  `platformAssignTeam()`，在排位/约战识别回调拿到平台队伍后主动 `engclient_cmd(jointeam)`；
  下发期间 `g_teamAssigning` 让 `hookJoint` 放行，0.8 秒校验 `Get_Team()`，不匹配按 8.2 秒
  冷却重试最多 2 次，失败记 `TEAM_ASSIGN_FAILED` 并提示玩家；`startChallengeBattle()` 在队伍
  未落位时延后开赛（最多 5 次），断线/换房/resetall 全量清理。
  `amxx/tools/build-current.ps1` 编译 **0 error / 0 warning**（`test_ranked.amxx` 25640→26638 B），
  新增静态防回归断言，后端 **100/100 全绿**。**未发布**：线上仍是旧 0.52 二进制，
  下次插件发布需升 BUILD 并同步 `AMXX_EXPECTED_*`；首次选队是否吃 8 秒冷却待真机确认。
  构建脚本同时修掉 `Remove-Item` 触发环境删除保护的问题，改为 amxxpc 覆盖 + 时间戳校验。
- 2026-11-11 · **版本单一来源**：新增 `scripts/sync-versions.cjs`（发版时由 `release.ps1` 调用）与
  `scripts/check-versions.cjs`（已接入 CI，11 PASS / 0 FAIL）。唯一来源为 `esf-launcher/package.json` 0.6.1；
  同步官网 3 处版本、JS 兜底值、下载链接、更新记录（取 releases.json 前 8 条）、`website/version.json`、
  sitemap/robots。清理的漂移：`website/index.html` 0.4.7→0.6.1（静态托管改读 `./version.json`，不再永久显示旧版）、
  `package.json:98` 占位 `updates.example.com`→`https://119.29.82.217/updates/`、部署脚本 0.2.4→0.6.1 且老机 IP→新机、
  `uptime.yml`/`MONITORING.md` 改走 Caddy HTTPS、KB servers.md 0.4.10→0.6.1、官网 README 重写、
  未备案域名 `esfcn.cn` 从 canonical/og/sitemap/robots 移除。`release/latest.yml`(0.5.21)、
  `server/updates/latest.yml`(0.2.4) 是未入库的历史构建产物，含真实 sha512，**不伪造哈希**，仅给 WARN。
- 2026-11-11 · **AMXX 可复现构建补齐**：新增 `amxx/tools/build-current.ps1`（ASCII-only、UTF-8 无 BOM 直编、
  amxxpc 1.10.0.5392 `-d1`、版本从 `BUILD` 常量读取），实测产出 0.52 的 4 个 `.amxx` +
  `SHA256SUMS.txt`，编译日志 0 error / 0 warning。`build-r14.ps1` 明确标为历史脚本（转 GBK，不可用于 0.52）。
  产物哈希仍需与线上 `esf-challenge-plugins-0.52.zip` 比对才能确认二进制一致（线上包不在仓库）。
- 2026-11-11 · **仓库确认 public + 合规收口**：平台定位小范围邀请制。`SECURITY.md` 补私密漏洞报告、
  7 天响应 SLA、支持版本（仅 0.6.x）、历史泄露事项；新增 `website/privacy.html`（收集范围/留存/删除/第三方）
  并在官网 footer 挂入口；`server/src/env.js` 生产环境未配 `INVITE_CODE` 时告警（**不抛错**，避免线上起不来），
  生产 `.env` 必须配置邀请码。维持「不重写 git 历史」决定（旧口令已轮换作废）。
  新增 `docs/GAME-ACCEPTANCE-RUNBOOK.md`：4 项游戏侧验收需真人/双开 hl.exe，明确当前 token 写
  `launcher.cfg` 导致双开互相覆盖，正解是待办 3 的 `+setinfo`；开局自动分边已知 FAIL。
- 2026-11-11 · **插件源码基线统一**：`fix/amxx-ascii-logs`（13 个提交，含线上 0.49–0.52 与 `amxx/tools/`）合并进 main，冲突仅 `amxx/README.md`，已解决并清掉 r14/0.4.6 过期版本号。合并后源码 `BUILD="0.52"`（auth/lock）、lock `VERSION=1.3.0`。**重要更正**：`amxx/tools/build-r14.ps1` 是 r14 历史脚本（转 GBK 编译、产出 0.4.6-r14 包），**不能复现当前 0.52**；当前用 UTF-8 无 BOM 直编 + `scripts/publish-amxx.ps1` 打包，见 [[toolchain]] / [[release-amxx]]。合并把 3 个 r14 静态断言带成红灯（版本串、约战 SELECT 列、SQL 缓冲区抓错心跳语句），已对齐 0.52 实现；后端 **99/99 全绿**、启动器 3 文件 / 66 检查点通过、模拟验收 9/9 通过。
- 2026-11-11 · 本机模拟验收 9 项全通过：新增 `server/scripts/acceptance-sim.cjs` + `npm run test:acceptance`，覆盖观战 4 人上限、锁服排队排位优先、AFK −30 结算与战绩标记、结算补交幂等与鉴权；记录见 `docs/ACCEPTANCE-SIM-2026-11-11.md`，`current-state` 待办 1 已拆为「服务端已验收 / 游戏端待验」。验收中发现并修复 `/api/ranked/settle` 信息泄露：`settleFromClient` 原先在参赛者校验前做「已结算」短路，任何登录用户可拿走比赛详情；已把鉴权提前并用 `callerId` 取详情。后端回归 81/81 全绿。
- 2026-11-11 · administrator 口令轮换**完成**（两台）：新机用 `rotate-admin-password.ps1` 复连验证通过；114 用 RDP + `net user administrator *` 回显「命令成功完成」（前两次因两次输入不一致报「密码不匹配」，最初一次 `net administrator *` 是语法错误、无副作用）。两台使用不同口令，均不记明文。旧值仅留在 git 历史但已失效，**决定不重写历史**（force push 会波及未合并分支）。剩余收尾：本机 `cmdkey` 删除 `TERMSRV/119.29.82.217`、`TERMSRV/114.132.84.150`（Domain + LegacyGeneric 两条）后重新保存；确认 114 `AutoAdminLogon` 未使用旧口令；复核 27016/27017 与 `amxx_builds` 心跳。
- 2026-11-11 · administrator 口令轮换（一阶段完成）：新机 119.29.82.217 已用 `deploy/security/rotate-admin-password.ps1` 轮换并用新口令复连验证成功，新值写回 `%TEMP%\esf-newbox.pwd`（WinRM/发布脚本自动可用）。114 游戏服仅 RDP，待人工改密；**两台机必须设不同口令**（泄露根因是复用）。本机 `cmdkey /list` 中 `TERMSRV/119.29.82.217`、`TERMSRV/114.132.84.150`（Domain + LegacyGeneric 两条）保存凭据均需删除后重新保存；`.rdp` 文件本身不含明文口令。114 上 `ESFAmxxUpdate`、`ESFOpsAgent` 与新机 `ESFAPI`/`ESFDBBackup` 均为 SYSTEM 运行，改密不影响服务；但需确认 114 未配置使用旧口令的自动登录，否则重启后会卡在登录界面导致 HLDS 起不来。
- 2026-11-11 · 修复 `npm test`（Node 22 下 `node --test <dir>` 把目录当模块而失败）：两个 package.json 的 test 脚本改为显式文件列表，Node 18/20/22 均可跑；实测启动器 3 文件/66 检查点、后端 81 用例全绿（后端需先 `npm run db:start` + `migrate`）。修复 `test/challenges.test.js` 未跟上 0.5.23「约战只开放单挑 1」的过时用例（改用 `fcx-1v1-1`，临时服务器仅保留给收藏/管理台用例）。
- 2026-11-11 · 凭据泄露处置（一阶段）：`docs/ESF_MP_ARCHIVE.md` 移除两台服务器 administrator 明文口令并标作废（历史版本仍在 git 历史，administrator 口令待轮换）；`PROJECT_REPORT.md` 标作废；`README.md` 总档案指引改指向 KB；`.gitignore` 新增 `CREDENTIALS.txt`/`*.cnf`/`*.pwd`/`ops-key.txt`/`*.pem` 等凭据模式与 `.agents/`；新增 `deploy/security/rotate-admin-password.ps1`（WinRM 远程轮换 administrator 口令，校验后才写回密码文件）。评估报告见 `docs/ASSESSMENT-2026-11-11.md`。

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
