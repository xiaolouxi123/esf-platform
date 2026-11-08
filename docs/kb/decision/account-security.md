---
title: 账号安全（登录锁定 / 忘记密码 / 邮箱绑定）
slug: account-security
status: active
updated: 2026-11-09
tags: [security, auth, email, release]
---

# 账号安全（0.4.15）

## 一句话结论

密码重置走邮箱验证码（QQ 邮箱 SMTP），账号级锁定 10 次/15 分钟；管理台保留"临时密码 + 强制改密"兜底，邮件没配也能救号。

## 决策

- **验证码走邮件，不走短信**：成本为零、可自助；QQ 邮箱是玩家的主要联系方式。
- **验证码只存 sha256(code + ':' + jwtSecret)，不存明文**，5 次尝试上限，15 分钟过期。
- **重置成功后 `token_version + 1`**：所有旧会话立即失效（与改密/封禁同一条撤销路径）。
- **忘记密码接口防枚举**：账号不存在也返回 200 + 统一文案；未绑定邮箱才返回 409 `EMAIL_NOT_BOUND`，提示联系管理员。
- **账号锁定是本地的**（`users.failed_login_count` / `locked_until`），不是 IP 限流；IP 限流（5 次/分钟）仍保留，两者互补。
- **锁定期间密码正确也不放行**，必须等 15 分钟或走「忘记密码」/管理台重置。
- **管理台重置生成一次性临时密码**（`ESF-` + 8 位 base64url），`must_change_password=1`，登录后强制改密，改完自动登出。
- **邮件服务未配置时**：接口返回 503「邮件服务尚未配置，请联系管理员重置密码」，不阻塞注册/登录/管理台重置。

## 数据模型

- `users` 新增：`email VARCHAR(190)`（唯一索引 `uk_email`）、`email_verified_at`、`must_change_password`、`failed_login_count`、`locked_until`。
- `email_codes`：`user_id, email, code_hash, purpose(bind|reset), attempts, expires_at, used_at`。
- `password_reset_tokens`：`user_id, token_hash, expires_at, used_at`。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/forgot/send` | 发重置码（防枚举；未绑邮箱 409） |
| POST | `/api/auth/forgot/verify` | 6 位码换 64 hex resetToken（15 分钟） |
| POST | `/api/auth/forgot/reset` | 新密码 + token_version+1 + 清锁定 |
| POST | `/api/auth/email/code` | 登录态下发绑定码 |
| POST | `/api/auth/email/bind` | 校验并绑定邮箱 |
| POST | `/api/admin/users/:id/reset-password` | 管理台重置（临时密码，一次返回） |

## 配置

两台 API 机 `.env` 需要：

```
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=<QQ 邮箱地址>
SMTP_PASS=<SMTP 授权码，不是 QQ 密码>
SMTP_FROM=ESF 平台 <QQ 邮箱地址>
LOGIN_MAX_FAILURES=10
LOGIN_LOCK_MINUTES=15
RESET_CODE_TTL_MINUTES=15
```

QQ 邮箱授权码获取：QQ 邮箱网页 → 设置 → 账户 → POP3/IMAP/SMTP 服务 → 开启并生成授权码。

## 已知边界

- 没有 2FA、没有设备会话列表、没有密码强度校验（仅 ≥8）。
- 邮件发送依赖腾讯 SMTP，失败会返回 503；未做重试队列。
- 锁定计数按账号累计，攻击者可用大量账号刷锁（成本低但影响面有限）。
