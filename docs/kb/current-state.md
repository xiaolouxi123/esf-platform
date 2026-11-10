---
title: 线上现状
category: state
tags: [state, versions, deployment]
updated: 2026-11-11T06:50:00+08:00
---

# 线上现状（2026-11-10）

只放"现在是什么"，决策理由见 [[migration]]、[[launcher-updater]]、[[ranked-challenge]]、[[amxx-plugins]]、[[lobby-presence-sound]]、[[account-security]]、[[maintenance-channel]]。
任何数字变化后**直接改这里**，不要留下旧值。

## 服务端

| 项 | 值 |
|---|---|
| 平台 API / 更新源 | https://119.29.82.217 （Caddy 反代 → 127.0.0.1:3000） |
| 新服务器 | 119.29.82.217，Windows Server 2022，主机名 10_1_0_13 |
| 老服务器（待下线） | 119.91.99.176，Windows Server 2012 R2，主机名 172_16_0_9 |
| 游戏服 | 114.132.84.150，Windows Server 2016，主机名 10_1_0_8，端口 27016 / 27017 |
| 数据库 | 新机 MySQL 8.0.29，库 `esf_platform`，端口 3306，字符集 utf8mb4 |
| 服务端代码 | `C:\esf\server`（API）、`C:\esf\updates`（更新 feed）、`C:\esf\caddy` |
| 计划任务 | `ESFMySQL`、`ESFAPI`、`ESFCaddy`（开机自启） |

## 启动器

| 项 | 值 |
|---|---|
| 最新版本 | **0.6.1**（提交 8ff59dc，tag v0.6.1，约战 2v2 修复 + 排位结算兜底 + 排位无服置灰） |
| 更新源 | https://119.29.82.217/updates/ |
| 安装包 | ESF-Platform-Setup-0.6.1.exe（128,768,372 B，blockmap 135,174 B） |
| 差量基线 | 0.6.0 → 0.6.1：36 个操作，下载 7,426,389 B；0.5.23 → 0.6.0：41 个操作，下载 9,103,896 B；0.5.21 → 0.5.23：22 个操作，下载 1,697,637 B；0.5.1 → 0.5.2：36 个操作，下载 7,365,460 B；0.5.0 → 0.5.1：22 个操作，下载 1,685,174 B；0.4.16 → 0.5.0：27 个操作，下载 3,480,839 B；0.4.15 → 0.4.16：30 个操作，下载 7,357,162 B；0.4.14 → 0.4.15：30 个操作，下载 7,625,781 B；0.4.13 → 0.4.14：18 个操作，下载 1,867,465 B |
| 新引擎支持 | 0.4.14 起识别 `ESF.exe + engine\engine.cfg`（ESF Engine 1.0），启动参数写入 `Launcher=` 行，退出还原 |
| 账号安全 | 0.4.15：邮箱绑定 / 忘记密码 / 管理台重置 + 10 次锁定；0.4.16：TOTP 两步验证（含 10 个一次性备用码）、登录设备列表与撤销、密码强度（≥10 位且 ≥3 类）、接口安全响应头 |
| 地图记忆 | 0.5.2：本地 `settings.lastMap` 记录上次选图，进大厅自动选中（换图/随机都写入）；文件里找不到时退回第一张 |
| 启动兼容 | 0.5.1：启动失败自动重试 2 次；15s/25s 窗口检测，无窗口可一键直接启动 `no_hl.exe`；兼容模式（窗口化 800×600 + `-gl` + `-heapsize 262144`）；`launcher.log` 与一键诊断包 |
| 约战限制 | 0.5.23：只开放「单挑 1」（fcx-1v1-1），单局 15 分钟，到点按击杀比分结算；服务端 180 秒宽限自动关闭僵尸房间 |
| 界面 | 0.5.0：P0–P9 全站 UI 重做（令牌、外壳、大厅、排位、约战、服务器、资源库、管理台、设置、登录、频道），交接单 `docs/design/HANDOFF-ui-redesign.md`；0.5.2：管理台栏目折叠（默认只展开玩家管理）；0.5.21：左侧栏新增「插件中心」独立页，不再放设置抽屉 |
| 插件可观测性 | 0.5.21：`GET /api/plugins/observability` 返回本地四插件版本/大小/哈希、cvar、auth/lock/test_ranked 心跳与日志入口；测试 profile 用 `--test-profile` 在 Chromium 启动前切 `userData`，登录态独立 |
| 比赛结束 | 0.5.21：AMXX 写 `esf_match_end.flag`，启动器 2.5 秒轮询后只强杀本次启动捕获的 PID（`hl.exe` 壳优先），不再按镜像名全杀 |
| 结算兜底 | 0.6.1：插件结算失败写 `esf_pending_result.json`，启动器启动/赛后自动补交 `POST /api/ranked/settle`，失败按 30s / 2min / 10min 重试；接口幂等，走 DB 过程保留 AFK −30 |
| 排位无服 | 0.6.1：`/api/servers` 返回的服务器全部 locked/offline 时，开始匹配按钮禁用并提示「暂无可用服务器」 |
| 约战模式 | 0.6.1：1v1 青蓝、2v2 紫色，文字居中；胜利条件固定 3 / 5 / 10；插件 0.51 起修正 2v2 列索引 |

## AMXX 插件

| 项 | 值 |
|---|---|
| 当前线上插件包 | **0.52**（UTF-8 构建，含 guest 兜底、构建心跳、约战限时、AFK 判负、结算失败落盘与 2v2 列修正） |
| 更新源已上传 | **0.53**（含开局自动分边修复，zip + manifest 已上传新机 `C:\esf\updates\amxx\`，等待 114 自动更新与心跳确认；见 `docs/RELEASE-2026-11-11.md`） |
| 当前源码 BUILD | **0.54**（追加本地 listen server 开房放行，见 [[known-issues]] 第 9 条；已编译并装入**本机游戏目录**，zip + manifest 已本地产出，**未上传生产**——生产是 dedicated server，不触发该问题） |
| 本地测试包 | `test_ranked 1.3.4-teamtest`（test15，38,392 B，SHA256 `0e81b6f6...`）；仅本地验证，未发布到游戏服 |
| 分发位置 | `C:\esf\updates\amxx\manifest.json` + `esf-challenge-plugins-0.52.zip` |
| 受管插件 | esf_gamemode / esf_platform_auth / esf_ranked_lock / test_ranked |
| 114 更新任务 | `ESFAmxxUpdate`，SYSTEM，每 10 分钟 |
| 114 更新脚本 | `C:\esf-agent\amxx-updater.ps1`，版本记录 `C:\esf-agent\amxx-version.txt` |
| 线上构建心跳 | 表 `amxx_builds`；fcx-1v1-1 于 2026-11-10 08:37 上报 0.52（platform_auth / ranked_lock） |
| 源码基线 | **main**（2026-11-11 合并自 `fix/amxx-ascii-logs`，含 0.49–0.52 全部增量；该分支保留但不再作为基线） |
| 版本一致性 | 0.52 已统一：`BUILD` = `"0.52"`，`esf_ranked_lock.sma` 的 `VERSION` = `1.3.0`；构建方式为 amxxpc 1.10.0.5392 + `-d1` + UTF-8 无 BOM 直编 |
| 功能缺口 | 开局不会自动分边：`autoPlayerStart()` 只统计引擎队伍，未下发 `jointeam`；平台队伍已在 `g_challengeTeam` / `g_rankedTeam`，但未写回引擎。见待办 9 |

## 游戏服配置

- `amxx.cfg`：`platform_sql_host` / `ranked_sql_host` = 119.29.82.217，`platform_allow_guest 1`（测试期放行非平台玩家）。
- HLSM 2.4 监控两台服，`taskkill /f /im rehlds.exe` 后会自动拉起。

## 待办

1. 0.6.1 验收：**API 层 9 项本机模拟已全部通过**（2026-11-11，`server/scripts/acceptance-sim.cjs` → `npm run test:acceptance`，记录见 `docs/ACCEPTANCE-SIM-2026-11-11.md`）：观战 4 人上限与空位复用、锁服排队排位优先、AFK −30 结算与战绩公开标记、结算补交幂等与鉴权。仍待真人/双开 hl.exe 验证：游戏侧 AFK 计时提醒、赛后 10 秒退出与 PID 强杀、观战 Token 实际进服、开局自动分边。
2. 0.5.0/0.6.0 客户端实机复测：全站新 UI、2FA、设备会话、忘记密码全链路。
2. 新手房（27017）未上报 `amxx_builds` 心跳，疑似 `amxx.cfg` 未配 `platform_server_key` / `ranked_server_key`，待查。
3. 启动器侧把 token 直接写进命令行参数（`+setinfo`），不再依赖 launcher.cfg，随下一版发布。
4. 迁移收尾：真人 1v1/2v2 验收；老 119 的 `esfops` 与 `LocalAccountTokenFilterPolicy` 回滚时点待定（回滚会断老机 WinRM 部署通道，建议 7 天后再清）。
5. 清理一次性安装脚本 `C:\esf\updates\ops\install-*.ps1`。
6. ops agent 任务输出的中文乱码（cmd 以 UTF-8 输出、agent 按 GBK 读回），改 `[IO.File]::ReadAllText(..., UTF8)`。
7. 老 114 仍有 0.2.1 版本残留，待与现网版本对齐。
8. 发布提速：`release.ps1` 仍用 PSSession 逐机拷 125 MB 安装包（约 4–5 分钟/台）；下一步改成两台机自行从 `https://119.29.82.217/updates/` 下载并校验 sha512。
9. **验收 0.53，择机发布 0.54**：0.53（自动分边）已上传更新源，待确认 114 心跳/哈希与真机双开验收。
   源码已升 **0.54**（追加本地 listen server 开房放行，见 [[known-issues]] 第 9 条），产物已本地打包并装入本机游戏目录，
   **未上传生产**（生产 dedicated 服不受该问题影响），留到下次常规发布一并上线。
   生产 `.env` 仍显式写 `AMXX_EXPECTED_*=0.53`，与线上一致；仓库默认值已升 0.54，
   **不要因此误判为 drift**；真正发布 0.54 时需同步改这三项并重启 API。
