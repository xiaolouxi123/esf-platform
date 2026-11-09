---
title: 启动兼容包（0.5.1）
category: decision
tags: [launcher, compatibility, launch, diagnostics]
updated: 2026-11-09T20:20:00+08:00
---

# 启动兼容包（0.5.1）

## 要解决的问题

老电脑上反馈「双击没反应，连点很多下偶尔能起」。排查后不是单一原因，而是几类问题都没有出口：

- 启动进程失败（被杀软/SmartScreen 拦、缺运行库、路径不对）时，界面只报一句 spawn 错误，用户看不到下一步；
- 进程起来了但没窗口（老显卡/驱动/全屏切换失败），用户以为没启动，继续双击；
- 玩家自制的 `.bat` 用 `start hl.exe` 相对路径，快捷方式「起始位置」一变就静默失败；
- 出问题后没有任何日志可回收，只能靠远程猜。

## 做了什么

1. **启动重试**：`spawnGameWithRetry` 最多 3 次（间隔 1.5s / 3s），仍失败才抛错，错误里带可操作提示（杀软 / SmartScreen / 解除锁定）。
2. **窗口检测**：spawn 后 15s、25s 各查一次游戏进程是否已有窗口（PowerShell 读 `MainWindowHandle`）。
3. **无窗口兜底**：25s 仍无窗口时弹窗，提供「直接启动 no_hl.exe」——绕过启动壳，直接拉起真实游戏进程（`-game <mod>` + 兼容参数），以及「打开启动日志」「关闭」。
4. **兼容模式**：设置 → 启动兼容 开关，开启后所有启动追加 `-window -w 800 -h 600 -gl -heapsize 262144`，并持久化到 `settings.compatMode`（默认关）。
5. **启动日志**：每次启动写 `<userData>/launcher.log`（exe、参数、cwd、pid、spawn 错误；2MB 自动清空）。
6. **一键诊断包**：设置 → 启动兼容 → 导出诊断包，生成 `桌面\ESF诊断-<时间>.txt`，含版本、系统、设置（隐藏敏感项）、游戏进程、最近 300 行启动日志。

## 边界

- 这些是「让失败可见、可回退、可诊断」，不是万能修复：驱动崩溃、系统缺 DLL、杀软硬拦仍需用户侧处理。
- 仍不要求 Steam：玩家普遍用 `no_hl` 整合包，兼容路径直接拉 `no_hl.exe`。
- 平台启动本身一直用绝对路径 + 正确 cwd（`-game esf +exec launcher.cfg +connect …`），不依赖快捷方式起始位置；`.bat` 的坑只影响玩家自制启动器。
- 老电脑排查顺序（写进用户指引）：先开兼容模式 → 仍不行导出诊断包 → 看 `launcher.log` 里是 spawn 失败、进程无窗口，还是被踢。

## 验证

- `node --check` + eslint 通过；39 项本地测试通过；build 产物 `index-CQpQ1BlO.css 172.09 kB` / `index-Dikr_2Pb.js 437.46 kB`。
- 发布 0.5.1：exe 128,757,432 B、blockmap 135,110 B、sha512 `uatDRF4z…`；两机部署 health ok、config 0.5.1、notice 更新；公网 latest.yml / HEAD / Range 206 通过。
- 差量 0.5.0 → 0.5.1：22 个操作，下载 1,685,174 B（1.61 MB），拼装 sha512 与 latest.yml 一致。
- 待实机验证：老电脑开兼容模式能否起窗口；无窗口弹窗的「直接启动 no_hl.exe」是否可用；诊断包内容是否足够定位。

## 相关

- 玩家自制 bat 修正：`cd /d "%~dp0"` + `start "" "%~dp0hl.exe" -game esf`（不要依赖起始位置）。
- 发布流程瓶颈（本次暴露）：`release.ps1` 从 GitHub 下载 128MB 资产在本地网络会卡住，已改用镜像分块下载；下一步改为「服务器直接下载 / 只推一台、另一台从内网拉」。
