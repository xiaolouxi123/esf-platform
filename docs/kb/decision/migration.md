---
title: 服务器迁移（老 119 → 新 119.29.82.217）
category: decision
tags: [migration, infrastructure, mysql, https]
updated: 2026-11-08T04:30:00+08:00
---

# 服务器迁移

## 背景

原生产全部压在一台 2012 R2（119.91.99.176，主机名 `172_16_0_9`）：MySQL + Node API + 更新 feed。
需求：迁到新机 119.29.82.217（Windows Server 2022，4C/4G，主机名 `10_1_0_13`），
游戏服 114.132.84.150（Server 2016）保持不变，只改它连的数据库地址。

## 决定

| 决定 | 理由 |
|---|---|
| MySQL 8.0.29 + Node 18.20.8 装在新机 `C:\esf\` 下 | 不污染系统目录，卸载/迁移都是一次目录拷贝 |
| 数据库名保持 `esf_platform`、保留原 `JWT_SECRET` | 老会话/令牌不失效，前端不用改 |
| 老机 `.env` 的 `DB_HOST` 直接指向新机 | 迁移期最小改动，先切库再切机；切完仍可随时切回（已备份 `server.env.pre-dbswitch`） |
| 用 Caddy 2.11.8 做 HTTPS 反代，Let's Encrypt 签发 **IP 证书**（shortlived，6 天自动续期） | 没有域名，又必须要 HTTPS 给更新源用（electron-updater 走 https） |
| 防火墙只放 3389/5985/3000；3306 只放 114 与老 119 | 数据库不对公网开放 |
| 备份用 `mysqldump --single-transaction --routines --triggers --events --set-gtid-purged=OFF --default-character-set=utf8mb4`，gzip+base64 传输 | 纯文本传输会把 UTF-8 转坏（出现过 ERROR 1064 乱码），二进制才安全 |

## 迁移后的事实

- 新机：#MySQL 服务 `ESFMySQL`、API `ESFAPI`、Caddy `ESFCaddy`，全部 SYSTEM/开机自启，失败重试。
- 数据库账号：`esf_app`（API，@127.0.0.1 与 @老 119）、`esf_amxx`（游戏服 @114）、`esf_backup`。
- `node scripts/migrate.js` 建表 39 张（含后续新增列/唯一键），数据恢复 30 张表、users 7 行。
- 老机仍可访问（保留回滚能力），但已指向新库；两台 API 都健康（`/health` → `db=up`）。
- 更新源统一为 `https://119.29.82.217/updates/`；客户端旧默认地址会在启动时自动迁移。

## 风险与遗留

- 迁移期间数据库是单点，没有主从；新机挂了只能回切老机（老机 MySQL 仍在，但数据是迁移时点）。
- 老机的本地管理员 `esfops` 与 `LocalAccountTokenFilterPolicy=1` 是为远程运维临时开的，**收尾时必须清理**。
