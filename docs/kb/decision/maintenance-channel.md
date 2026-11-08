---
title: 114 维护通道（ops 命令队列）
slug: maintenance-channel
status: active
updated: 2026-11-09
tags: [ops, 114, remote, maintenance]
---

# 114 维护通道（ops 命令队列）

## 一句话结论

114 的腾讯云安全组不放行 5985，WinRM 进不去；改成「平台排队命令 + 114 每分钟拉取执行回传」，不再依赖常驻 RDP 会话。

## 为什么不再用 RDP + 队列代理

- RDP 会话断开，`\\tsclient` 映射与前台代理一起消失，任务卡死。
- 无法自动执行（必须有人点开 mstsc）。
- ops 通道由 Windows 计划任务驱动（SYSTEM），机器重启也在。

## 结构

```
管理员/Agent → POST /api/ops（排队）
114 计划任务（每分钟）→ POST /api/ops/claim（x-ops-key，SKIP LOCKED 领一条）
                     → cmd /d /c 执行（默认 C:\，可指定 cwd，最长 600s）
                     → POST /api/ops/:id/result（exitCode + stdout + stderr，32KB 截断）
```

- 表：`ops_jobs`（status: pending/running/done/failed）、`ops_agents`（心跳）。
- 代码：`server/src/routes/ops.js`、`server/sql/013_ops_jobs.sql`。
- 114 侧：`C:\esf-agent\ops-agent.ps1`（仓库 `deploy/ops-agent/`），日志 `C:\esf-agent\ops-agent.log`，单实例 mutex `Global\ESFOpsAgent`。
- 计划任务：`ESFOpsAgent`（SYSTEM，每分钟，Highest）。

## 安全边界

- `OPS_AGENT_KEY` 存在两台 API 机 `.env`，等价于 114 的 SYSTEM 权限。
- 只允许 admin 及以上排队；key 轮换 = 改 `.env` + 改 `C:\esf-agent\ops-key.txt` + 重启任务。
- 输出会回传 stdout/stderr（32KB 截断），不要把密码写进命令。

## 已知问题

- **中文输出可能乱码**：agent 的 `chcp 65001` 让 cmd 按 UTF-8 输出，但回读时按 GBK 解码。修法：`[IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)`。
- 一次性安装脚本（`C:\esf\updates\ops\install-*.ps1`）用完应删除。

## 常用

- 查任务：`SELECT id, status, exit_code, LEFT(stdout, 500) FROM ops_jobs ORDER BY id DESC LIMIT 10;`
- 排队一条：`INSERT INTO ops_jobs (cmd, timeout_sec) VALUES ('...', 60);`
- 心跳：`SELECT * FROM ops_agents;`
