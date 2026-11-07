---
title: 服务器清单
category: environment
tags: [servers, topology]
updated: 2026-11-08T04:40:00+08:00
---

# 服务器

## 119.29.82.217 —— 新平台机（主力）

- Windows Server 2022，4C/4G，主机名 `10_1_0_13`，公网 IP 119.29.82.217。
- 角色：MySQL + Node API + Caddy（HTTPS/更新源）。
- 关键路径与任务：

| 项 | 值 |
|---|---|
| Node | `C:\esf\node\node.exe`（18.20.8） |
| MySQL | `C:\esf\mysql`，datadir `C:\esf\mysql-data`，端口 3306，服务 `ESFMySQL` |
| API | `C:\esf\server`，服务/任务 `ESFAPI`（SYSTEM，开机启动，失败重启） |
| Caddy | `C:\esf\caddy\caddy.exe`，任务 `ESFCaddy` |
| 更新 feed | `C:\esf\updates`（启动器三件套）、`C:\esf\updates\amxx`（插件包） |
| 凭据 | `C:\esf\CREDENTIALS.txt`（不入库） |

- 端口：3389（RDP）、5985（WinRM）、3000（API，Caddy 反代）、443/80（Caddy）。
- 3306 只对 114.132.84.150 与老 119.91.99.176 放行。

## 119.91.99.176 —— 老平台机（保留回滚）

- Windows Server 2012 R2，主机名 `172_16_0_9`；仍是可用的 API 实例，`DB_HOST` 已指向新机。
- 远程：RDP 保存凭据自动登录；临时本地管理员 `esfops` + `LocalAccountTokenFilterPolicy=1` 用于 WinRM。
- **收尾时要清理**：删除 `esfops`、复位 `LocalAccountTokenFilterPolicy`、删除 RDP 保存凭据。

## 114.132.84.150 —— 游戏服

- Windows Server 2016，主机名 `10_1_0_8`；跑两台 HLDS（`FcxServer - 8245单挑`、`FcxServer - 8245新手房`），
  端口 27016 / 27017，由 **HL Server Monitor 2.4** 守护（进程死了自动拉起）。
- 插件目录：每台服 `esf\addons\amxmodx\plugins`；配置 `esf\addons\amxmodx\configs\amxx.cfg`；
  控制台日志 `<服务器根>\qconsole.log`（不是 `esf\qconsole.log`）；AMXX 日志 `esf\addons\amxmodx\logs\L<日期>.log`。
- 自动更新：`C:\esf-agent\amxx-updater.ps1` + 计划任务 `ESFAmxxUpdate`（每 10 分钟），
  版本 `C:\esf-agent\amxx-version.txt`，备份 `C:\esf-agent\backups\`。
- 远程：**只有 RDP**（WinRM 5985 在监听但云安全组不放行），见 [[remote-ops]]。

## 客户端

- Electron 启动器，最新 0.4.10，更新源 `https://119.29.82.217/updates/`。
- 安装位置默认 `%LOCALAPPDATA%\Programs\esf-launcher`；更新缓存 `%LOCALAPPDATA%\esf-launcher-updater`。
