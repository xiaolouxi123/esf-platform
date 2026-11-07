---
title: 工具链与构建环境
category: environment
tags: [toolchain, node, mysql, amxxpc, github-actions]
updated: 2026-11-08T04:40:00+08:00
---

# 工具链

## 启动器 / 服务端

- Node **18.20.8**（新机 `C:\esf\node\node.exe`；本地开发机同版本）。
- 启动器：Electron + Vite + React；构建 `npm.cmd run build`，打包由 GitHub Actions 的 electron-builder 完成。
- 服务端：Node + Express，`server/`，依赖 `--omit=dev` 安装（102 包）。
- 数据库迁移脚本：`server/scripts/migrate.js`（幂等，含新增列/唯一键/数据回填）。
- 测试：`node --test tests/`（启动器 3 个文件 39 项）；ESLint 用 `npx.cmd eslint`。

## AMXX

- 编译器：`amxxpc.exe` **1.10.0.5392**，固定 `-d1`。
  本机路径：`C:\Program Files (x86)\Steam\steamapps\common\Half-Life\esf\addons\amxmodx\scripting\amxxpc.exe`。
- 构建脚本：`amxx/tools/build-r14.ps1`（UTF-8 源码 → 去 BOM 副本 → 编译 → 输出到 deploy/amxx）。
- 禁止：PowerShell 文本管道处理 `.sma`（会双重转码并加 BOM），只用 edit/read 工具。

## 基础设施

- 反向代理/HTTPS：Caddy 2.11.8，Let's Encrypt IP 证书（shortlived profile，6 天自动续期）。
- 更新包：electron-builder NSIS + electron-updater 6.8.3（差量用 blockmap，见 [[launcher-updater]]）。
- CI：`.github/workflows/release.yml`（tag 触发出包）、`ci.yml`（lint/test/build）、`repair-blockmaps.yml`、`pages.yml`、`uptime.yml`。

## 远程与脚本约定

- PowerShell 一律 **ASCII-only** 写脚本文件（PS 5.1 按 ANSI/GBK 读 UTF-8 会吞中文）；
  需要中文时用 base64 传参，在远端 `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))` 解码。
- `npm` 用 `npm.cmd`（`npm.ps1` 被执行策略拦）。
- 远程执行细节见 [[remote-ops]]。
