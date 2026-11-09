---
title: 线上现状
category: state
tags: [state, versions, deployment]
updated: 2026-11-09T20:20:00+08:00
---

# 线上现状（2026-11-09）

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
| 最新版本 | **0.5.1**（提交 8d3a2fd，tag v0.5.1，启动兼容包） |
| 更新源 | https://119.29.82.217/updates/ |
| 安装包 | ESF-Platform-Setup-0.5.1.exe（128,757,432 B，blockmap 135,110 B） |
| 差量基线 | 0.5.0 → 0.5.1：22 个操作，下载 1,685,174 B；0.4.16 → 0.5.0：27 个操作，下载 3,480,839 B；0.4.15 → 0.4.16：30 个操作，下载 7,357,162 B；0.4.14 → 0.4.15：30 个操作，下载 7,625,781 B；0.4.13 → 0.4.14：18 个操作，下载 1,867,465 B |
| 新引擎支持 | 0.4.14 起识别 `ESF.exe + engine\engine.cfg`（ESF Engine 1.0），启动参数写入 `Launcher=` 行，退出还原 |
| 账号安全 | 0.4.15：邮箱绑定 / 忘记密码 / 管理台重置 + 10 次锁定；0.4.16：TOTP 两步验证（含 10 个一次性备用码）、登录设备列表与撤销、密码强度（≥10 位且 ≥3 类）、接口安全响应头 |
| 启动兼容 | 0.5.1：启动失败自动重试 2 次；15s/25s 窗口检测，无窗口可一键直接启动 `no_hl.exe`；兼容模式（窗口化 800×600 + `-gl` + `-heapsize 262144`）；`launcher.log` 与一键诊断包 |
| 界面 | 0.5.0：P0–P9 全站 UI 重做（令牌、外壳、大厅、排位、约战、服务器、资源库、管理台、设置、登录、频道），交接单 `docs/design/HANDOFF-ui-redesign.md` |

## AMXX 插件

| 项 | 值 |
|---|---|
| 当前插件包 | **0.48**（UTF-8 构建，含 guest 兜底 + 构建心跳） |
| 分发位置 | `C:\esf\updates\amxx\manifest.json` + `esf-challenge-plugins-0.48.zip` |
| 受管插件 | esf_gamemode / esf_platform_auth / esf_ranked_lock / test_ranked |
| 114 更新任务 | `ESFAmxxUpdate`，SYSTEM，每 10 分钟 |
| 114 更新脚本 | `C:\esf-agent\amxx-updater.ps1`，版本记录 `C:\esf-agent\amxx-version.txt` |
| 线上构建心跳 | 表 `amxx_builds`；fcx-1v1-1 于 2026-11-07 10:07 上报 0.48 |
| 源码分支 | `fix/amxx-ascii-logs`（提交 dd3a868）；含 r14 提交 c333c33 + 0.48 修复，main 306cd47 早于线上，不能作为现状基线 |
| 版本一致性 | 线上源码 `esf_platform_auth.sma` 的 `BUILD` 仍是 `0.47`、`esf_ranked_lock.sma` 的 `VERSION` 是 `1.3.0`，与包 `0.48` / README `1.2.0` 不一致；0.48 发布物不能由当前分支的构建脚本直接复现，待复核 |
| 功能缺口 | 开局不会自动分边：`autoPlayerStart()` 只统计引擎队伍，未下发 `jointeam`；平台队伍已在 `g_challengeTeam` / `g_rankedTeam`，但未写回引擎。见待办 9 |

## 游戏服配置

- `amxx.cfg`：`platform_sql_host` / `ranked_sql_host` = 119.29.82.217，`platform_allow_guest 1`（测试期放行非平台玩家）。
- HLSM 2.4 监控两台服，`taskkill /f /im rehlds.exe` 后会自动拉起。

## 待办

1. 0.5.0 客户端实机复测：全站新 UI（大厅/排位/约战/服务器/资源库/管理台/设置/登录/频道）、2FA、设备会话、忘记密码全链路。
2. 新手房（27017）未上报 `amxx_builds` 心跳，疑似 `amxx.cfg` 未配 `platform_server_key` / `ranked_server_key`，待查。
3. 启动器侧把 token 直接写进命令行参数（`+setinfo`），不再依赖 launcher.cfg，随下一版发布。
4. 迁移收尾：真人 1v1/2v2 验收；老 119 的 `esfops` 与 `LocalAccountTokenFilterPolicy` 回滚时点待定（回滚会断老机 WinRM 部署通道，建议 7 天后再清）。
5. 清理一次性安装脚本 `C:\esf\updates\ops\install-*.ps1`。
6. ops agent 任务输出的中文乱码（cmd 以 UTF-8 输出、agent 按 GBK 读回），改 `[IO.File]::ReadAllText(..., UTF8)`。
7. 老 114 仍有 0.2.1 版本残留，待与现网版本对齐。
8. 发布提速：`release.ps1` 仍用 PSSession 逐机拷 125 MB 安装包（约 4–5 分钟/台）；下一步改成两台机自行从 `https://119.29.82.217/updates/` 下载并校验 sha512。
9. 插件开局不会自动分边：`autoPlayerStart()` 只统计队伍，未下发 `jointeam`；ESF 切队有 8 秒冷却。方案与验证项见 [[known-issues]] 第 8 条，等插件下一轮修改时处理。
