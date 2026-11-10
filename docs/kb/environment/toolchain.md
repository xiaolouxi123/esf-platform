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
- 测试：`npm test`（显式文件列表，Node 18/20/22 通用；启动器 3 个文件 66 检查点、后端 81 用例，后端需本地库 `npm run db:start` + `npm run migrate`）；ESLint 用 `npx.cmd eslint`。

## AMXX

- 编译器：`amxxpc.exe` **1.10.0.5392**，固定 `-d1`。
  本机路径：`C:\Program Files (x86)\Steam\steamapps\common\Half-Life\esf\addons\amxmodx\scripting\amxxpc.exe`。
- 构建：当前 0.52 用 **`amxx/tools/build-current.ps1`**（UTF-8 无 BOM 直编、amxxpc 1.10.0.5392 `-d1`、产出 `dist/amxx-<BUILD>/` + SHA256SUMS）
  + `scripts/publish-amxx.ps1` 打包（产出 `esf-challenge-plugins-0.52.zip` + manifest）。2026-11-11 实测编译 0 error / 0 warning。
  `amxx/tools/build-r14.ps1` 是 r14/0.4.6 时代的**历史脚本**（先把源码转 GBK 再编译），
  2026-11-11 随分支合并进入 main，但**不能用于构建当前版本**（转 GBK 会导致中文乱码，见 [[known-issues]] 第 1 条）。
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
