---
title: 变更日志
category: log
tags: [log]
updated: 2026-11-08T04:50:00+08:00
---

# 变更日志

新在上。一行一条：日期 · 改了什么 · 依据。

- 2026-11-08 · 启动器 0.4.13：成员行版式调整（状态跟在名字后同一行，角色/段位收进第二行，自己那栏点状态即编辑）。提交 4e9bdfc，tag v0.4.13；差量 0.4.12→0.4.13 下载 1,686,703 B。
- 2026-11-08 · 启动器 0.4.12：成员自定义状态（users.status_text）+ 自动活动行 + 7 个界面音效与设置开关；新增 decision/lobby-presence-sound。提交 43e4b83，tag v0.4.12；差量 0.4.11→0.4.12 下载 7,606,741 B。
- 2026-11-08 · 建立 `docs/kb/`：index/current-state + decision（migration、launcher-updater、ranked-challenge、amxx-plugins、kb-policy）+ environment（servers、accounts-secrets、toolchain）+ pattern（release-launcher、release-amxx、remote-ops）+ debugging（known-issues）。依据：仓库现状与线上实测（0.4.10 / 插件 0.48）。
- 2026-11-07 · 插件自动更新链路：`scripts/publish-amxx.ps1` + 114 `ESFAmxxUpdate`（每 10 分钟）+ 心跳表 `amxx_builds`；发布 0.45 验证自动生效。提交 f5b116b。
- 2026-11-07 · 插件 0.46/0.47/0.48：UTF-8 直编、guest 兜底、心跳、视图授权修正。提交 dd3a868。
- 2026-11-07 · 启动器 0.4.10：历史战绩/结算面板重排，修 `LOCALAPPDATA` 缓存校验。提交 a43d18c，tag v0.4.10。
- 2026-11-07 · 启动器 0.4.9：排位历史、按天房号、更新缓存校验、esf.exe 兼容。提交 9af6c7e，tag v0.4.9。
- 2026-11-07 · 启动器 0.4.8：默认 API 切新机、A2S 短包崩溃修复。提交 0a7def4，tag v0.4.8。
- 2026-11-07 · 平台迁移：新机 119.29.82.217 上线（MySQL 8.0.29 + Node 18.20.8 + Caddy/LE IP 证书），老机切库保留回滚。
