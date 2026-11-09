---
title: ESF 平台知识库索引
category: index
tags: [index, rules]
updated: 2026-11-08T07:06:00+08:00
---

# ESF 平台知识库

本目录是 ESF 平台（启动器 / 服务端 / AMXX 插件 / 线上环境）的**唯一权威背景库**。
它记录：做过的决定与理由、改过的关键数字、踩过的坑、当前线上事实。

## 使用规则（给人和 agent）

1. **回答任何项目背景、历史决定、线上现状前，先读本文件，再进对应页面。**
   不确定就查，不要凭记忆回答；记忆与 KB 冲突时以 KB 为准，并顺手更新 KB。
2. **新决定落地时同步写回**：优先改已有页面，别造近似重复页；改完更新 `log.md`。
3. **作废的内容直接删掉**（不是标注"已废弃"堆着）；被新决定取代的数值必须改掉。
   历史过程留在 git 历史里，不在页面里维护过期数字。
4. 页面用 YAML frontmatter（title/category/tags/updated），页面间用 `[[slug]]` 引用。

## 目录

| 页面 | 内容 |
|---|---|
| [[current-state]] | 线上现状：版本、主机、域名、插件构建、待办（最先看这页） |
| [[migration]] | 老服务器 → 新服务器迁移的决定与结果 |
| [[launcher-updater]] | 启动器更新链路：electron-updater、blockmap、差量、发布三件套 |
| [[account-security]] | 登录锁定、忘记密码、QQ 邮箱绑定、管理台重置 |
| [[maintenance-channel]] | 114 免 RDP 维护通道：ops_jobs 命令队列与 pull agent |
| [[ranked-challenge]] | 排位/约战业务规则：战绩历史、结算弹窗、按天房号、guest 与排位锁 |
| [[challenge-limits]] | 约战限制（0.5.23）：只开单挑 1、单局 15 分钟、到点按比分结算 |
| [[anti-occupy-06]] | 0.6 反占服与成员面板：AFK 判负、观战 4 人、锁服排队、可收缩面板、占用看板 |
| [[amxx-plugins]] | AMXX 插件：UTF-8 构建、日志语言、构建心跳、自动更新管线 |
| [[lobby-presence-sound]] | 成员状态行与界面音效：status_text 字段、自动活动、7 音效与开关 |
| [[engine-mode]] | 新引擎（ESF Engine 1.0）：无 hl.exe，参数写 `engine.cfg` 的 `Launcher=` 行 |
| [[launch-compat]] | 启动兼容包（0.5.1）：重试、无窗口检测与 no_hl 回退、兼容模式、诊断包 |
| [[kb-policy]] | 本知识库自身的位置与维护规则 |
| [[servers]] | 三台服务器清单：角色、路径、服务、任务、端口 |
| [[accounts-secrets]] | 账号、凭据存放位置、授权与轮换待办（不写明文密码） |
| [[toolchain]] | 构建/发布工具链：Node、MySQL、Caddy、amxxpc、GitHub Actions |
| [[release-launcher]] | 启动器发布手册（一步步照做） |
| [[release-amxx]] | 插件包发布手册（一条命令 + 自动生效） |
| [[remote-ops]] | 远程运维手法与 PowerShell 陷阱（114 只能 RDP+队列代理） |
| [[known-issues]] | 已解决的问题与根因（乱码、误踢、差量失效、乱码名字等） |

## 权威边界

- **代码与配置是最终事实**：本 KB 若与仓库代码/线上文件冲突，以现场为准并回写 KB。
- 密码/密钥**不写进本目录**（会进 git）；只写"在哪里"（见 [[accounts-secrets]]）。
- `PROJECT_STATUS.md` 已并入本库，原文件改为指针，不再维护旧数字。
