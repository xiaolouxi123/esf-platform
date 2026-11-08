---
title: 线上现状
category: state
tags: [state, versions, deployment]
updated: 2026-11-08T07:30:00+08:00
---

# 线上现状（2026-11-08）

只放"现在是什么"，决策理由见 [[migration]]、[[launcher-updater]]、[[ranked-challenge]]、[[amxx-plugins]]、[[lobby-presence-sound]]。
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
| 最新版本 | **0.4.15**（提交 e4aa157，tag v0.4.15） |
| 更新源 | https://119.29.82.217/updates/ |
| 安装包 | ESF-Platform-Setup-0.4.15.exe（128,750,345 B，blockmap 135,372 B） |
| 差量基线 | 0.4.14 → 0.4.15：30 个操作，下载 7,625,781 B；0.4.13 → 0.4.14：18 个操作，下载 1,867,465 B；0.4.12 → 0.4.13：26 个操作，下载 1,686,703 B；0.4.11 → 0.4.12：30 个操作，下载 7,606,741 B |
| 新引擎支持 | 0.4.14 起识别 `ESF.exe + engine\engine.cfg`（ESF Engine 1.0），启动参数写入 `Launcher=` 行，退出还原 |

## AMXX 插件

| 项 | 值 |
|---|---|
| 当前插件包 | **0.48**（UTF-8 构建，含 guest 兜底 + 构建心跳） |
| 分发位置 | `C:\esf\updates\amxx\manifest.json` + `esf-challenge-plugins-0.48.zip` |
| 受管插件 | esf_gamemode / esf_platform_auth / esf_ranked_lock / test_ranked |
| 114 更新任务 | `ESFAmxxUpdate`，SYSTEM，每 10 分钟 |
| 114 更新脚本 | `C:\esf-agent\amxx-updater.ps1`，版本记录 `C:\esf-agent\amxx-version.txt` |
| 线上构建心跳 | 表 `amxx_builds`；fcx-1v1-1 于 2026-11-07 10:07 上报 0.48 |
| 源码分支 | `fix/amxx-ascii-logs`（提交 dd3a868） |

## 游戏服配置

- `amxx.cfg`：`platform_sql_host` / `ranked_sql_host` = 119.29.82.217，`platform_allow_guest 1`（测试期放行非平台玩家）。
- HLSM 2.4 监控两台服，`taskkill /f /im rehlds.exe` 后会自动拉起。

## 待办

1. 朋友复测：用启动器重进排位，确认不再被 `RANKED_LOCKED` 踢（guest 兜底生效）。
2. 新手房（27017）未上报 `amxx_builds` 心跳，疑似 `amxx.cfg` 未配 `platform_server_key` / `ranked_server_key`，待查。
3. 启动器侧把 token 直接写进命令行参数（`+setinfo`），不再依赖 launcher.cfg，随下一版发布。
4. 迁移收尾：真人 1v1/2v2 验收；7 天后清理老 119 的本机凭据与临时管理员，轮换密钥。
