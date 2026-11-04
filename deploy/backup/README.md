# ESF 数据库备份与恢复

生产库很小（`esf_platform`，21 张表，约 0.8 MB），因此使用 **mysqldump 逻辑备份 + SHA-256 + 本地保留 + 可选异地复制**。不引入额外服务，不把数据库密码写进脚本或计划任务参数。

## 生产现状

| 项目 | 值 |
| --- | --- |
| MySQL | 8.0.29，`C:\esf\mysql\bin` |
| 数据库 | `esf_platform` |
| 备份目录 | `C:\esf\backups` |
| 脚本目录 | `C:\esf\backup` |
| 计划任务 | `ESFDBBackup`，每天 04:00，SYSTEM，最高权限 |
| 保留 | 14 天 |
| 备份文件 | `esf_platform-yyyyMMdd-HHmmss.sql` + `.sha256` |
| 状态心跳 | `C:\esf\website\ops\backup.json` |
| 日志 | `C:\esf\backups\backup.log` |

`backup-db.ps1` 使用 `--single-transaction`，对 InnoDB 表做一致性快照；同时导出存储过程、触发器、事件。备份账号只需要：

```sql
CREATE USER 'esf_backup'@'127.0.0.1' IDENTIFIED BY '<strong-random-password>';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER
  ON esf_platform.* TO 'esf_backup'@'127.0.0.1';
GRANT SHOW_ROUTINE ON *.* TO 'esf_backup'@'127.0.0.1';
FLUSH PRIVILEGES;
```

`SHOW_ROUTINE` 是 MySQL 8.0.20+ 的只读全局权限，用于导出 `settle_ranked_match` 等存储过程；没有它 `mysqldump --routines` 会静默漏掉过程。不需要 `PROCESS`、`RELOAD` 或写权限（已在本机与生产 MySQL 8.0.29 验证）。

## 安装 / 更新

1. 把 `backup-db.ps1`、`verify-backup.ps1` 复制到 `C:\esf\backup`。
2. 新建 `C:\esf\backup\backup.cnf`：

```ini
[client]
host=127.0.0.1
port=3306
user=esf_backup
password=<strong-random-password>
default-character-set=utf8mb4
```

3. 限制目录和密码文件 ACL（只允许 SYSTEM 和本机管理员）：

```powershell
icacls C:\esf\backup /inheritance:r
icacls C:\esf\backup /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
icacls C:\esf\backup\backup.cnf /inheritance:r
icacls C:\esf\backup\backup.cnf /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F'
icacls C:\esf\backups /inheritance:r
icacls C:\esf\backups /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
```

4. 注册每日任务：

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\esf\backup\backup-db.ps1" -RequiredPattern settle_ranked_match -StatusFile "C:\esf\website\ops\backup.json"'
$trigger = New-ScheduledTaskTrigger -Daily -At '04:00'
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName 'ESFDBBackup' -Action $action -Trigger $trigger `
  -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force
Start-ScheduledTask -TaskName 'ESFDBBackup'
Get-ScheduledTaskInfo -TaskName 'ESFDBBackup'
```

5. 手动执行一次：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\esf\backup\backup-db.ps1 `
  -RequiredPattern settle_ranked_match -StatusFile C:\esf\website\ops\backup.json
Get-Content C:\esf\backups\backup.log -Tail 10
```

任务返回 `LastTaskResult=0` 且日志出现 `backup ok` 才算成功。

## 校验备份

```powershell
$f = Get-ChildItem C:\esf\backups\*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$expected = (Get-Content ($f.FullName + '.sha256') -Raw).Split(' ')[0]
(Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower() -eq $expected
```

`.sql` 末尾应包含 `-- Dump completed`；脚本在生成时已检查，不完整会自动删除并返回非零。

## 恢复演练（不碰生产库）

`verify-backup.ps1` 会创建临时库、导入、检查 21 张表及 `users`/`servers`/`titles` 行数，然后删除临时库。需要一个有建库/删库/导入权限的临时管理员配置：

```powershell
# 临时 root 配置，演练完立即删除
@'
[client]
host=127.0.0.1
port=3306
user=root
password=<root-password>
default-character-set=utf8mb4
'@ | Set-Content C:\esf\backup\admin-drill.cnf -Encoding ASCII

icacls C:\esf\backup\admin-drill.cnf /inheritance:r
icacls C:\esf\backup\admin-drill.cnf /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F'

$backup = (Get-ChildItem C:\esf\backups\*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\esf\backup\verify-backup.ps1 `
  -BackupFile $backup -AdminDefaultsFile C:\esf\backup\admin-drill.cnf `
  -MySql C:\esf\mysql\bin\mysql.exe

Remove-Item C:\esf\backup\admin-drill.cnf -Force
```

预期输出：

```text
restore ok tables=21 users=4 servers=2 titles=6 routine=1
```

行数随线上数据变化，关键是 `restore ok` 且退出码 0、`routine=1`；临时库名形如 `esf_restore_check_yyyyMMdd_HHmmss`，脚本默认自动删除。

> 该演练是“备份能否恢复”的验证，不是生产切换。生产恢复见下一节。

## 生产恢复（破坏性操作）

只有在确认需要回滚时执行；先保留当前库的另一份备份。

1. 停止 API 写入：
   - 计划任务 `ESFAPI` 停止，或停止对应 Node 进程。
2. 再生成一份“恢复前快照”（可选但强烈建议）。
3. 新建恢复库并导入，确认无误后再切换：

```powershell
$mysql = 'C:\esf\mysql\bin\mysql.exe'
$admin = 'C:\esf\backup\admin.cnf'   # 临时 root 配置，限制 ACL
$sql = 'C:\esf\backups\esf_platform-YYYYMMDD-HHMMSS.sql'

& $mysql --defaults-extra-file=$admin -e "CREATE DATABASE esf_platform_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
cmd.exe /c "`"$mysql`" --defaults-extra-file=`"$admin`" esf_platform_restore < `"$sql`""
& $mysql --defaults-extra-file=$admin -N -e "SELECT COUNT(*) FROM esf_platform_restore.users;"
```

4. 确认数据后，再把 `esf_platform` 改名/切换。**不要直接用 `DROP DATABASE esf_platform` 做第一次演练。**
5. 启动 API，检查 `http://119.91.99.176:3000/api/health` 返回 `db:up`，再让客户端登录验证。
6. 删除临时管理员配置和恢复库。

## 异地副本

当前只有 `C:\esf\backups`，属于同机同盘，能防误删/逻辑损坏，不能防整机或磁盘故障。建议增加第二块盘或对象存储，并在任务参数中加：

```text
-OffsiteDir D:\esf-backups
```

或 UNC 路径。脚本会复制 `.sql` 和 `.sha256`；复制失败只记 `WARNING`，不会删除本地备份。生产服务器如果没有第二块盘，至少定期把最新备份下载到另一台机器/私有对象存储，并定期做一次下载后的恢复演练。

## 备份心跳与外部监控

任务成功后会原子写入 `C:\esf\website\ops\backup.json`，由 Express 静态站点暴露为：

```text
http://119.91.99.176:3000/ops/backup.json
```

文件只含 `ok`、`lastAttemptAt`、`lastSuccessAt`、`file`、`size`、`sha256`、`requiredPattern`，不含密码或玩家数据。失败时 `ok=false` 并带 `error`，不会保留旧的成功时间。

`.github/workflows/uptime.yml` 每 15 分钟检查一次：API `db:up`、备份 `ok=true` 且不超过 30 小时、静态官网可访问、Release feed 可访问。任一失败，GitHub Actions 会标红并触发仓库 owner 的 GitHub 通知（以账号通知设置为准）。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `Access denied` | 检查 `backup.cnf` 的 host/user，确认 MySQL 账号是 `'esf_backup'@'127.0.0.1'` |
| `mysqldump: Couldn't execute ... SHOW CREATE PROCEDURE` | 补 `SHOW_ROUTINE` 或检查 `--routines` 权限 |
| 备份成功但缺 `settle_ranked_match` | 备份账号没有 `SHOW_ROUTINE`；补授权后重跑，并用 `-RequiredPattern settle_ranked_match` 让任务失败可见 |
| 备份文件只有几 KB / 无 `Dump completed` | 脚本会自动删除并返回 1；查看 `backup.log` 的 mysqldump stderr |
| 任务 `LastTaskResult` 非 0 | `Get-ScheduledTaskInfo -TaskName ESFDBBackup`，再查 `backup.log`；确认 SYSTEM 对 `C:\esf\backup` 有读权限 |
| 恢复报 `Unknown database` | 先 `CREATE DATABASE`，或用管理员账号导入 |
| 恢复报 `DEFINER` 不存在 | 用 root 导入，或先创建对应账号；生产库的存储过程 definer 是 root |

## 安全边界

- 不把 `.cnf`、`.sql`、`.sha256` 提交到仓库。
- 不把密码放进计划任务参数（任务只引用脚本，脚本只引用 `.cnf`）。
- `.cnf` ACL 只允许 SYSTEM/Administrators；演练用 root 配置用完立即删除。
- 备份包含玩家账号、邮箱、密码哈希、金币/排位数据，按个人信息对待；异地副本要加密或放私有存储。
