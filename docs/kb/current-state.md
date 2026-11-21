---
title: 线上现状
category: state
tags: [state, versions, deployment]
updated: 2026-11-22T07:10:00+08:00
---

# 线上现状（2026-11-22）

只放"现在是什么"，决策理由见 [[migration]]、[[launcher-updater]]、[[ranked-challenge]]、[[amxx-plugins]]、[[lobby-presence-sound]]、[[account-security]]、[[maintenance-channel]]。
任何数字变化后**直接改这里**，不要留下旧值。

## 版本

| 项 | 值 |
|---|---|
| 启动器线上版本 | **0.6.60**（tag `v0.6.60`，commit `87f3743`；安装包 129,193,474 B） |
| 启动器候选版本 | **0.6.61**（约战 P1–P2、房主转让/再来一局/私密房/观战候场；审核版已构建，**未打 tag、未发布**） |
| 服务端线上 bundle | 0.6.61 的 rematch/queue 版本已手工部署到 217；之后由 `release.ps1` 随版本自动部署 |
| AMXX 插件 | **0.65**（自动排队、观战保留、赛后不踢人；仅 114 `fcx-1v1-1` 为比赛服） |
| 更新源 | https://119.29.82.217/updates/ |

## 服务端

| 项 | 值 |
|---|---|
| 平台 API / 更新源 | https://119.29.82.217（Caddy 反代 → 127.0.0.1:3000） |
| 新服务器 | 119.29.82.217，Windows Server 2022，主机名 10_1_0_13 |
| 老服务器（待下线） | 119.91.99.176，Windows Server 2012 R2，主机名 172_16_0_9；只读共享库 |
| 游戏服 | 114.132.84.150，Windows Server 2016，端口 27016 / 27017 |
| 数据库 | 217 本机 MySQL 8.0.29，库 `esf_platform`，端口 3306，utf8mb4 |
| 服务端代码 | `C:\esf\server`（API）、`C:\esf\updates`（更新 feed / AMXX）、`C:\esf\caddy` |
| 运行时 | `C:\esf\node\node.exe` 18.20.8、npm 10.8.2（不在 PATH）；`package.json` engines 写 node>=20，实际 18 仅警告 |
| 计划任务 | `ESFMySQL`、`ESFAPI`、`ESFCaddy`（开机自启）；另有 5 分钟看护任务 |

## 发布链路

`scripts\release.ps1`（PS 5.1，必须 `-Approved`）：

1. bump `esf-launcher/package.json` + lock；更新 `releases.json`、官网、部署脚本、KB；
2. 重建 `deploy\esf-server-bundle.zip`，跑 `check-versions`（应 12 PASS）；
3. eslint、启动器测试、vite build；
4. 校验服务端 bundle 的 sha256/size 与 manifest，再 commit + tag + push；
5. 等 GitHub Actions 产物，下载并校验 exe sha512；
6. WinRM 部署 217：客户端资产 + 服务端 bundle（备份 → 停 API → 解压 → `npm install` → `migrate.js` → 失败回滚）+ .env + 重启；
7. 验证 latest.yml / HEAD / Range / 双端 `/api/config`。

逃生开关：`-SkipServerDeploy` 只发客户端；`-SkipDeploy` 只准备产物；`-SkipWait` 不等待 Actions。

## AMXX 插件

| 项 | 值 |
|---|---|
| 当前源码 BUILD | **0.65**（`esf_platform_auth.sma` / `esf_ranked_lock.sma`） |
| 受管插件 | esf_gamemode / esf_platform_auth / esf_ranked_lock / test_ranked |
| 分发 | `scripts\publish-amxx.ps1` → 217 `C:\esf\updates\amxx` → 114 `ESFAmxxUpdate` 计划任务 |
| 比赛服 | 仅 114 `fcx-1v1-1`；217 两台 EVM 为约战服/公开服，不参与排位 |
| 本地编译 | amxxpc 1.10.0.5392 + `-d1` + UTF-8 无 BOM（`amxx\tools\build-current.ps1`） |

## 当前待办

1. **0.6.61 真人验收**：2v2 房主转让/离开、私密房密码、观战/候场、结算「再来一局」、约战战绩；通过后才 `release.ps1 -Version 0.6.61 -Approved`。
2. 首发 0.6.61 时验证新的服务端 bundle 自动部署与迁移回滚（`C:\esf\backups\server-src-pre-*.zip`）。
3. CI server job 已修复 fresh DB 迁移（status_text / ranked_match_players.afk 顺序），需下一次 push 后确认 Actions 变绿。
4. 真人 1v1/2v2 全链路、真实 FCX 模型包安装、0.6.58→0.6.60 自动更新仍按 `docs/ACCEPTANCE-DEFERRED-2026-11-22.md` 暂缓，不算通过。
5. 老 119 清理 `esfops`、`LocalAccountTokenFilterPolicy`、一次性安装脚本；114 残留 0.2.1 对齐。
6. 217 Node 18 与 `engines>=20` 不一致；下次维护窗口评估升到 Node 20/22。
