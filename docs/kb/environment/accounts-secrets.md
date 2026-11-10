---
title: 账号与凭据（只记位置，不记明文）
category: environment
tags: [accounts, secrets, rotation]
updated: 2026-11-08T04:40:00+08:00
---

# 账号与凭据

> 本页**永不写明文密码**。只记录"哪个账号、做什么、密码放在哪、何时该换"。

## 数据库（新机 MySQL 8.0.29）

| 账号 | 用途 | 授权范围 |
|---|---|---|
| `root` | 管理/迁移 | 本机 |
| `esf_app` | 平台 API | `esf_platform.*`，来自 @127.0.0.1 与 @119.91.99.176 |
| `esf_amxx` | 游戏服插件 | 按表/视图枚举授权（新增表要单独 GRANT）；@114.132.84.150 与 @127.0.0.1 |
| `esf_backup` | 备份 | 只读导出 |

- 密码存放：新机 `C:\esf\CREDENTIALS.txt`；本地运维临时文件 `%TEMP%\esf-newbox.pwd`、`%TEMP%\esf-jump\esfops.pwd`。
- 会话中曾出现过的明文密码已通过 KB 规则禁止再记录；如需使用，读上面两个文件。

## 系统账号

| 机器 | 账号 | 说明 |
|---|---|---|
| 新机 119.29.82.217 | `administrator` | WinRM/RDP 运维账号 |
| 老机 119.91.99.176 | `Administrator` / `esfops` | `esfops` 是迁移期临时管理员，**收尾必须删除** |
| 114.132.84.150 | `Administrator` | RDP 自动登录；密码在 `%TEMP%\esf-114-fs.rdp` 的保存凭据里（cmdkey） |

## 密钥与令牌

- 服务端 `.env`：`JWT_SECRET` 沿用迁移前生产值（不写在此处）；`C:\esf\server\.env` 与老机同款。
- 启动器与服务器之间的更新 feed 不需要鉴权（公开静态文件）。
- 游戏侧 `launch_tokens` 由平台签发，10 分钟内有效、单次使用（见 [[ranked-challenge]]）。

## 轮换/清理清单（迁移收尾）

0. **administrator 口令轮换（2026-11-11，P0）**：`ESF_MP_ARCHIVE.md` 曾在公开仓库泄露两台服务器
   administrator 明文口令（11-11 已从文档移除，但 git 历史仍在）。
   - 新机 119.29.82.217：**已完成**，用 `deploy/security/rotate-admin-password.ps1` 轮换并复连验证，
     新值写回 `%TEMP%\esf-newbox.pwd`。
   - 114 游戏服：**待改**，只有 RDP，登录后用 `net user administrator *` 交互式设置（新口令不要与新机相同，
     也不要写进任何脚本/聊天/数据库）。
   - 本机 RDP 保存凭据：`cmdkey /delete:TERMSRV/119.29.82.217`、`cmdkey /delete:TERMSRV/114.132.84.150`
     及 `cmdkey /delete:LegacyGeneric:target=TERMSRV/114.132.84.150`，删除后重新连接并记住新口令。
   - 相关计划任务均为 SYSTEM，改密不影响运行；但改完要确认 114 没有依赖旧口令的自动登录。
   - 轮换完成后 git 历史中的旧值即作废；是否重写历史另行决定（需 force push，会波及未合并分支）。
1. 删除老机 `esfops`，复位 `LocalAccountTokenFilterPolicy`（设回 0 或删除）。
2. 删除老机 RDP 保存凭据（`cmdkey /delete:...`）与 `%TEMP%` 下的密码文件。
3. 轮换 `esf_app` / `esf_amxx` / `esf_backup` 密码，并同步 `.env` 与 `amxx.cfg`。（2026-11-09 已执行一轮，见 log）
4. 确认 `C:\esf\CREDENTIALS.txt` 的 ACL 只给 Administrators。
