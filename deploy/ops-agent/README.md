# 游戏服维护通道（pull 模式）

114 的入站 5985 被云安全组挡着，WinRM 走不通；RDP 里的临时脚本又依赖人工。这套东西把方向反过来：**agent 主动来平台领任务**。

```
平台（119.29.82.217）           游戏服（114.132.84.150）
┌────────────────────┐          ┌──────────────────────┐
│ ops_jobs 队列       │◀──claim──│ 计划任务 ESFOpsAgent  │
│ POST /api/ops      │          │ 每 1 分钟带 key 来问   │
│ POST /api/ops/claim│──job────▶│ 执行 cmd，捕获输出     │
│ POST /api/ops/:id/result◀─────│ 回传 exit/stdout      │
└────────────────────┘          └──────────────────────┘
```

## 服务端

- 表：`server/sql/013_ops_jobs.sql`（`ops_jobs` 任务队列、`ops_agents` 心跳）
- 路由：`server/src/routes/ops.js`
  - `POST /api/ops`（需登录 + admin/owner）排队一条命令
  - `POST /api/ops/claim`（`x-ops-key`）agent 领一条，`SKIP LOCKED` 防并发抢
  - `POST /api/ops/:id/result`（`x-ops-key`）回传结果，输出截断 32KB
  - `GET /api/ops`、`GET /api/ops/:id`（需登录 + admin/owner）查任务与心跳
- 配置：`server/.env` 里 `OPS_AGENT_KEY=<32 hex>`；不配则 claim 返回 503

## 114 游戏服

- 目录 `C:\esf-agent`：`ops-agent.ps1`、`ops-key.txt`（ACL 只给 SYSTEM/Administrators）、`ops-agent.log`
- 计划任务 `ESFOpsAgent`：SYSTEM、每分钟、最高权限、隐藏窗口
- 安装：用平台生成的一次性安装脚本（含 key，装完删除），或在服务器上手动跑
  `install-ops-agent.ps1 -Key <key>`
- 单实例锁：`Global\ESFOpsAgent` mutex，慢任务不会和下一分钟重叠
- 超时：默认 120 秒（任务可指定，上限 600），超时 kill 并回传 exit=124

## 安全边界

`x-ops-key` 等价于 114 的 SYSTEM 权限，任何拿到它的人都能在该机执行任意命令。因此：

- key 只存在于 `server/.env` 与 `C:\esf-agent\ops-key.txt`（icacls 限制）
- 一次性安装脚本用完即删（`C:\esf\updates\ops\install-*.ps1`）
- 换 key：改 `.env` → 重启 ESFAPI → 重写 `ops-key.txt`（agent 下次运行即生效）

## 常见操作

```powershell
# 在平台上排一条命令（需要 admin/owner 登录后的 Bearer token）
curl -X POST https://119.29.82.217/api/ops ^
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" ^
  -d "{\"cmd\":\"dir C:\\\\esf\\\\agent\",\"timeoutSec\":60}"

# 查最近任务
curl https://119.29.82.217/api/ops?limit=10 -H "Authorization: Bearer <token>"
```

典型用途：看 `qconsole.log`、重启 rehlds、替换插件、取服务器日志、查磁盘/进程。
