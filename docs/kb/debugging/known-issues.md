---
title: 已解决的问题与根因
category: debugging
tags: [troubleshooting, root-cause]
updated: 2026-11-08T04:45:00+08:00
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
