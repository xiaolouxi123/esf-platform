# 安全策略

> 本仓库是**公开仓库**：任何历史提交都可能被检索到。因此凭据一旦写入仓库即视为已泄露，
> 正确处置方式是轮换，而不是只删除文件。

## 报告漏洞

**请不要在公开 Issue 中披露安全问题。** 优先使用 GitHub 的私密漏洞报告
（仓库 → Security → Report a vulnerability / Security Advisory），或通过仓库维护者私信联系。

请附上：

- 影响范围（哪个组件、哪些版本、是否需要登录）
- 复现步骤与最小证据（不含真实玩家数据）
- 可能的修复方向（可选）

**响应时间**：维护者力争在 **7 天内确认收到**，确认后协调修复与披露时间；
修复发布前请勿公开细节。本平台为小范围社区项目，不提供漏洞赏金。

## 受支持的版本

| 版本 | 状态 |
|---|---|
| 最新 0.6.x | 提供安全修复 |
| 0.5.x 及更早 | 不提供安全修复，建议升级 |

## 不会提交到仓库的内容

- `server/.env`、任何真实数据库密码、`CREDENTIALS.txt`
- `deploy/amxx`（含数据库口令的安装包）、`*.cnf` / `*.pwd` / `ops-key.txt` / 私钥与证书
- 生产服务器登录凭据（Windows administrator、RDP 保存凭据）
- 用户 Token、JWT、更新上传 Token、ops agent key
- `server/updates`、`release/`、安装包与 `dist/` 产物

`.gitignore` 已覆盖上述模式；提交前请再确认没有把临时凭据文件带进来。

## 部署建议

- 生产环境使用独立强密码，**不同机器不复用**；管理员口令定期轮换
- 平台定位为小范围邀请制：生产 `.env` 必须配置 `INVITE_CODE`，否则注册接口没有门槛
- MySQL 不对公网开放，3306 仅对已知游戏服 / 老机放行
- 反向代理 + HTTPS（当前为 Caddy + IP 证书，见 `docs/kb/environment/servers.md`）
- 每日备份（保留 14 天、SHA-256、恢复演练），备份文件含个人信息，只存受限目录
- 更新包上传 Token 与 ops agent key 定期轮换
- 管理接口按角色鉴权；审计日志覆盖关键写操作

## 已知历史事项

- 2026-11-11：两份历史文档曾含明文管理员口令，已从工作区移除并**完成两台服务器口令轮换**；
  git 历史中的旧值因此作废。经评估不重写历史（需 force push，会波及未合并分支），
  记录见 `docs/kb/environment/accounts-secrets.md` 与 `docs/kb/log.md`。
- 客户端安装包尚未做代码签名，Windows SmartScreen 会提示；请只从官网给出的
  GitHub Releases 链接下载。
