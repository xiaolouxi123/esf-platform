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

## 线上配置（2026-11-09）

- 两台 API 机 `.env` 已配：`SMTP_USER=503982138@qq.com`，`SMTP_FROM=ESF 平台 <503982138@qq.com>`，授权码只存在 `.env`（不入 git）。
- `nodemailer.verify()` 通过，测试邮件返回 250 queued。
- 「忘记密码」全链路已实测：发码 200（maskedEmail `50*******@qq.com`）→ 校验换 token 200 → 重置 200 → 新密码登录 200、旧密码 401。

## 已知边界

- 邮件发送依赖腾讯 SMTP，失败会返回 503；未做重试队列。
- 锁定计数按账号累计，攻击者可用大量账号刷锁（成本低但影响面有限）。

## 密钥轮换（2026-11-09）

- esf_app（API 连库）：已轮换；新密码只写在两台机 C:\esf\server\.env 的 DB_PASSWORD，以及新机 C:\esf\CREDENTIALS.txt（ACL 只留 SYSTEM/Administrators）。
- esf_backup（备份账号）：已轮换；同步改写 C:\esf\backup\backup.cnf，手动跑 ackup-db.ps1 通过（size=184982，sha256=9fc58449…）。
- esf_amxx（两服插件连库）：已轮换；两服 esf\addons\amxmodx\configs\amxx.cfg 的 platform_sql_pass/anked_sql_pass 已替换（备份 mxx.cfg.bak-rotate-20261109），杀 rehlds 后 HLSM 重启，mxx_builds 心跳 21:26:18 恢复、两服 A2S 在线。
- 轮换后验证：两机 /api/health db=up；登录接口错误码正常（401）；server_status 两服 online=1。
- 密码不再出现在聊天/文档/KB；查当前值只从 C:\esf\CREDENTIALS.txt 读。

## 0.4.16：两步验证、设备会话、密码强度、安全头

- TOTP（`server/src/services/totp.js`）：SHA1 / 6 位 / 30 秒，`verify` 容窗口 ±1；开启后可下载 10 个 `XXXX-XXXX` 备用码，**只存 sha256、用后即删**，密码登录通过后由 `/auth/2fa/verify` 校验。
- 会话表 `user_sessions`：登录创建 jti（16 字节 hex），JWT 带 `jti` + `scope=access`；中间件逐请求校验会话未撤销；登出只撤当前会话，改密/封禁/重置仍 bump `token_version` 踢全部会话。`GET /auth/sessions` 列出 90 天内设备（UA/IP/最后活跃），可单个撤销或 `revoke-others`。
- 密码策略 `server/src/lib/password.js`：≥10 位、≥3 类字符、拒绝常见弱口令、不能含账号名/邮箱名；注册、重置、改密、管理台临时密码统一走它。
- 安全响应头（`middleware/securityHeaders.js`）：nosniff、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、COOP；HTTPS 下 HSTS 一年；`/api/*` 加 CSP `default-src 'none'` 与 `Cache-Control: no-store`。
- 登录 2FA 响应：密码正确但账号开了 2FA 时返回 `{ twoFactorRequired: true, challengeToken }`（5 分钟、scope=2fa），前端弹动态码/备用码面板。
- 端到端验证（2026-11-09）：开启 → 登录要求 2FA → TOTP 通过 → 会话列表含当前设备 → 备用码登录成功且二次使用 401 → 关闭成功；弱密码注册 400。
- 已知边界：未做 2FA 重置（丢手机只能靠管理员改库/重置密码流程再关闭）；未做设备指纹，UA 可能被伪造；限流仍按 IP。
- 注意：备用码是 9 字符（`XXXX-XXXX`），校验正则必须是 `{8,}` 而不是 `{10,}`（0.4.16 修复的一条实际 bug）。
