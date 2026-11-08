---
title: 变更日志
category: log
tags: [log]
updated: 2026-11-09T06:45:00+08:00
---

# 变更日志

新在上。一行一条：日期 · 改了什么 · 依据。

- 2026-11-09 · 启动器 0.5.0（UI Beta 冻结）：P0–P9 全站界面重做（令牌/外壳/大厅/排位/约战/服务器/资源库/管理台/设置/登录/频道），提交 0238202，tag v0.5.0；差量 0.4.16→0.5.0 下载 3,480,839 B。修复 `release.ps1` 的 bump 未传版本参数导致 `package.json` 丢 `version` 键的旧 bug。交接单 `docs/design/HANDOFF-ui-redesign.md` 已补齐各阶段提交号。
- 2026-11-09 · 启动器 0.4.16：TOTP 两步验证（10 个一次性备用码）、登录设备列表与撤销、密码强度（≥10 位且 ≥3 类）、接口安全响应头。提交 7f4ea11，tag v0.4.16；差量 0.4.15→0.4.16 下载 7,357,162 B。新增 `decision/account-security` 的 0.4.16 段。

- 2026-11-09 · 启动器 0.4.15：忘记密码三步、设置内绑定 QQ 邮箱与改密、管理台重置临时密码（强制改密）、登录 10 次锁定；两台 API 配好 QQ SMTP 并全链路实测。提交 e4aa157，tag v0.4.15；差量 0.4.14→0.4.15 下载 7,625,781 B。新增 `decision/account-security`、`decision/maintenance-channel`。

- 2026-11-09 · 密钥轮换：esf_app / esf_backup / esf_amxx 全部更换，验证 health、备份、amxx_builds 心跳恢复；同日记 ops agent 卡死事故与修复（轮询 HasExited + 杀进程树）。提交 b978bba。

- 2026-11-09 · 维护通道：`ops_jobs`/`ops_agents` + 114 pull agent（计划任务 ESFOpsAgent），服务器可远程排队执行命令并取回输出。提交见 `deploy/ops-agent`。

- 2026-11-08 · 启动器 0.4.14：支持 ESF Engine 1.0（无 hl.exe，参数写入 `engine.cfg` 的 `Launcher=` 行、退出还原、`engine.cfg.esf-base` 备份）；EACCES 诊断。提交 ea14d16，tag v0.4.14；差量 0.4.13→0.4.14 下载 1,867,465 B。新增 `decision/engine-mode`。

- 2026-11-08 · 启动器 0.4.13：成员行版式调整（状态跟在名字后同一行，角色/段位收进第二行，自己那栏点状态即编辑）。提交 4e9bdfc，tag v0.4.13；差量 0.4.12→0.4.13 下载 1,686,703 B。
- 2026-11-08 · 启动器 0.4.12：成员自定义状态（users.status_text）+ 自动活动行 + 7 个界面音效与设置开关；新增 decision/lobby-presence-sound。提交 43e4b83，tag v0.4.12；差量 0.4.11→0.4.12 下载 7,606,741 B。
- 2026-11-08 · 建立 `docs/kb/`：index/current-state + decision（migration、launcher-updater、ranked-challenge、amxx-plugins、kb-policy）+ environment（servers、accounts-secrets、toolchain）+ pattern（release-launcher、release-amxx、remote-ops）+ debugging（known-issues）。依据：仓库现状与线上实测（0.4.10 / 插件 0.48）。
- 2026-11-07 · 插件自动更新链路：`scripts/publish-amxx.ps1` + 114 `ESFAmxxUpdate`（每 10 分钟）+ 心跳表 `amxx_builds`；发布 0.45 验证自动生效。提交 f5b116b。
- 2026-11-07 · 插件 0.46/0.47/0.48：UTF-8 直编、guest 兜底、心跳、视图授权修正。提交 dd3a868。
- 2026-11-07 · 启动器 0.4.10：历史战绩/结算面板重排，修 `LOCALAPPDATA` 缓存校验。提交 a43d18c，tag v0.4.10。
- 2026-11-07 · 启动器 0.4.9：排位历史、按天房号、更新缓存校验、esf.exe 兼容。提交 9af6c7e，tag v0.4.9。
- 2026-11-07 · 启动器 0.4.8：默认 API 切新机、A2S 短包崩溃修复。提交 0a7def4，tag v0.4.8。
- 2026-11-07 · 平台迁移：新机 119.29.82.217 上线（MySQL 8.0.29 + Node 18.20.8 + Caddy/LE IP 证书），老机切库保留回滚。
