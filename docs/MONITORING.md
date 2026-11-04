# 生产监控

当前采用**外部黑盒探测**，不引入额外监控服务：

- 工作流：`.github/workflows/uptime.yml`
- 频率：每 15 分钟（GitHub Actions schedule，可能延迟）
- 触发：定时 + 手动 `workflow_dispatch`
- 失败：工作流标红并触发 GitHub 通知；不会修改生产环境

## 探测项

| 探测 | 地址 | 通过条件 |
| --- | --- | --- |
| API | `http://119.91.99.176:3000/api/health` | HTTP 200，`ok=true`，`data.db=up` |
| 备份心跳 | `http://119.91.99.176:3000/ops/backup.json` | `ok=true`，`lastSuccessAt` 不超过 30 小时 |
| 静态官网 | `https://xiaolouxi123.github.io/esf-platform/` | HTTP 200，包含 `ESF China` |
| 更新源 | GitHub `releases/latest/download/latest.yml` | HTTP 200，包含 `version:` |

备份心跳由 `deploy/backup/backup-db.ps1` 在每次任务结束后写入；失败时 `ok=false`，避免出现“文件还在但早已不更新”的假安全。

## 手动检查

```powershell
Invoke-RestMethod http://119.91.99.176:3000/api/health
Invoke-RestMethod http://119.91.99.176:3000/ops/backup.json

Invoke-WebRequest https://xiaolouxi123.github.io/esf-platform/ -UseBasicParsing |
  Select-Object StatusCode
Invoke-WebRequest https://github.com/xiaolouxi123/esf-platform/releases/latest/download/latest.yml |
  Select-Object StatusCode
```

GitHub 页面：Actions → `uptime` → `Run workflow`。

## 边界

- GitHub schedule 不是实时告警，最多可能延迟数十分钟；重要时段仍需人工值守。
- GitHub 若暂停定时工作流（长期无仓库活动），监控会停止；每月至少手动触发一次或在仓库产生提交。
- 只检查公网入口，不检查游戏服务器、AMXX 插件或数据库内部指标。
- 备份超过 30 小时未成功会报警；14 天保留策略和恢复演练仍由 `deploy/backup/README.md` 维护。
