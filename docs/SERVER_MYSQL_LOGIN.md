# 在服务器登录 MySQL

面向需要在 ESF 生产服务器上登录 MySQL 的管理员/开发者。除第 4 节外，命令都在**服务器本机的管理员 PowerShell** 中执行。

> **端口不要照抄文档。** 仓库里 3306 与 3307 两套写法并存（证据见文末「附：端口冲突证据」），生产实际值只能现场核实；登录前先按第 0 步确认，3306/3307 都可能。
>
> 本机工作副本中保留着针对游戏服 `114.132.84.150` 的远程授权脚本（`.run\grant-prod-ranked.cjs:7`）与多 host 授权逻辑（`server\scripts\migrate.js:397-412`）；据运维记录，游戏服 `114.132.84.150` 曾远程连接平台库，说明线上可能并非只监听 loopback。线上实际监听范围仍需按第 0 步实测；先看 `my.ini` 的 `bind-address` 和 `Get-NetTCPConnection`，再把访问范围收紧到游戏服固定 IP 或隧道。

## 0. 最快路径

1. 用 RDP 登录服务器，打开**管理员 PowerShell**。
2. 先核实端口，再登录。

```powershell
# 1) 应用配置里写的端口
(Select-String -Path 'C:\esf\server\.env' -Pattern '^DB_PORT=').Line

# 2) 服务实际监听的端口与地址（连库以它为准）
Select-String -Path 'C:\esf\my.ini' -Pattern '^\s*(port|bind-address)\s*='

# 3) 只从 [mysqld] 段取实际端口，避免误取 [client] 的 port
$section = ''
foreach ($line in Get-Content 'C:\esf\my.ini') {
  if ($line -match '^\s*\[(.+)\]\s*$') { $section = $matches[1] }
  elseif ($section -eq 'mysqld' -and $line -match '^\s*port\s*=\s*(\d+)') {
    $dbPort = $matches[1]
    break
  }
}
$dbPort
```

第 1、2 步的数字应当一致。**不一致时，连接端口用 `my.ini` 的值**（那才是服务真正监听的），应用端口以 `.env` 为准，并尽快把两处改成一致；否则应用会连错端口。

如果 `my.ini` 的 `bind-address` 是某个具体的非 loopback IP（不是 `127.0.0.1`/`0.0.0.0`），把下文所有 `-h 127.0.0.1` 以及 `Test-NetConnection 127.0.0.1` 换成该地址；若是 `0.0.0.0`，仍用 `127.0.0.1` 本机连接。

3. 确认服务与端口，然后登录：

```powershell
Get-Service ESFMySQL
Test-NetConnection 127.0.0.1 -Port $dbPort -InformationLevel Quiet

& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u root -p
```

看到 `mysql>` 提示符即成功。`-p` 后不要跟密码，回车后交互输入。进去后立刻确认端口：

```sql
SELECT @@port AS port, VERSION() AS version;
```

与前面读到的值一致即可。退出：

```sql
exit
```

若 `$dbPort` 为空，说明 `[mysqld]` 里没有 `port=`：按 PID 反查实际监听端口，再手动赋值 `$dbPort = <端口>`。

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object OwningProcess -eq (Get-Process mysqld -ErrorAction SilentlyContinue).Id |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

## 1. 登录前检查

先确认关键路径与账号来源：

| 项目 | 值 | 依据 |
| --- | --- | --- |
| 客户端 | `C:\esf\mysql\bin\mysql.exe` | `deploy\deploy-esf-server.ps1:140` |
| 数据库 | `esf_platform` | 同文件 `:281` |
| 端口 / 监听地址 | 实测值；部署脚本默认仅 `127.0.0.1`，线上是否对游戏服放行以实测为准 | 同文件 `:169-170`（值以现场为准） |
| Windows 服务 | `ESFMySQL` | 同文件 `:138`、`:190` |
| 配置文件 / 数据目录 | `C:\esf\my.ini` / `C:\esf\mysql-data` | 同文件 `:141-142` |
| root 密码 | `C:\esf\CREDENTIALS.txt` | 同文件 `:381-392` |
| 应用 / AMXX 密码 | `C:\esf\server\.env` | 同文件 `:279-290` |

`.env` 是应用侧端口来源，`my.ini` 是服务实际监听端口来源，登录后 `SELECT @@port;` 是第三重确认。三者应一致。

后续命令沿用第 0 步的 `$dbPort`；新开窗口要重新执行第 0 步。

```powershell
& 'C:\esf\mysql\bin\mysql.exe' --version
Get-Service ESFMySQL | Format-List Name,Status,StartType
Test-NetConnection 127.0.0.1 -Port $dbPort -InformationLevel Quiet
```

预期：客户端为 `8.0.x`（部署脚本下载的是 8.0.29，`deploy-esf-server.ps1:32`；以实际 `--version` 为准）、服务 `Running`、最后一行 `True`。

- 服务未启动：`Start-Service ESFMySQL`。
- 端口不通：先看 `C:\esf\my.ini` 的 `port` 与 `bind-address`，再看数据目录里的 `*.err` 错误日志和事件查看器。**不要**先改防火墙——部署脚本只创建了 `3000` 的入站规则（`:360-362`）；MySQL 端口不要对 `0.0.0.0/0` 开放，游戏服确需远程连库时只放行其固定公网 IP。

## 2. 登录方式

### 2.1 先认清四个账号

| 账号 | 用途 | 密码位置 | 权限边界 |
| --- | --- | --- | --- |
| `root`@`127.0.0.1`（另有 `root`@`localhost`） | 建库、授权、备份恢复、排障 | `C:\esf\CREDENTIALS.txt`；部分部署也会写 `.env` 的 `DB_ROOT_PASSWORD` | 全局 `ALL PRIVILEGES ... WITH GRANT OPTION`（`deploy-esf-server.ps1:225`） |
| `esf_app`@`127.0.0.1` | 平台后端 API | `.env` 的 `DB_PASSWORD` | `esf_platform.*` 的 `ALL`（`server\scripts\migrate.js:373-378`）——**能读写，不是只读账号** |
| `esf_amxx`@`127.0.0.1`（游戏服侧通常另有 `@114.132.84.150`） | 游戏服 AMXX 插件 | `.env` 的 `AMXX_DB_PASSWORD` | 最小权限：`v_platform_users`、`servers`、`ranked_matches`、`ranked_match_players`、`challenge_rooms`、`challenge_room_players`、`challenge_configs` 的 `SELECT`；`launch_tokens` 的 `SELECT/UPDATE`；`play_sessions` 与 `challenge_player_stats` 的 `SELECT/INSERT/UPDATE`；`settle_ranked_match`、`settle_challenge_match` 的 `EXECUTE`（`migrate.js:383-396`） |
| `esf_backup`@`127.0.0.1` | 每日备份任务 | `C:\esf\backup\backup.cnf` | 只读备份：`SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON esf_platform.*` + `SHOW_ROUTINE ON *.*`（`deploy\backup\README.md:22-25`）；恢复需 root |

`C:\esf\CREDENTIALS.txt` 是部署脚本生成的 root 密码备忘，应用/AMXX 账号只写"见 `.env`"（`deploy-esf-server.ps1:381-392`）。用记事本按需查看，不要把全文贴到聊天、工单或截图里；脚本在文件首行已提示**取用后删除**（`:383`）。

上表是迁移脚本定义的权限基线，实际权限以 `SHOW GRANTS` 为准；游戏服远程 host 要单独核对，不能只看 `@127.0.0.1` 这一行。

### 2.2 root 交互登录（日常运维）

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u root -p
```

关于 `-p`：

- `-P`（大写）是端口，`-p`（小写）是密码，别混。
- 只写 `-p`、后面不跟值，客户端会提示 `Enter password:`；输入不回显，也不会进 PowerShell 历史或进程命令行。
- 不要写 `-pMyPass`（密码会留在命令历史里）。
- 也不要写 `-p MyPass`：短选项 `-p` 与其值之间不能有空格，`MyPass` 会被当成库名，密码仍要交互输入。
- `-p` 后面跟的位置参数是库名，例如 `-p esf_platform` 表示提示输密码并直接进入 `esf_platform`。

统一写 `-h 127.0.0.1`，与 `.env` 的 `DB_HOST` 和部署脚本最终验证走 TCP 的方式一致（`deploy-esf-server.ps1:258-260`）。

root 只用于建库、授权、备份恢复和排障；不要给应用或 AMXX 使用。

### 2.3 应用账号登录（查业务数据）

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u esf_app -p esf_platform
```

密码见 `.env` 的 `DB_PASSWORD`。这个账号对 `esf_platform.*` 有全部权限，**不是只读号**；只读需求靠第 3 节的只读事务约束自己。

### 2.4 AMXX 游戏服账号（只做连通性验证）

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u esf_amxx -p -e "SELECT 1;" esf_platform
```

密码见 `.env` 的 `AMXX_DB_PASSWORD`。这个账号权限最小，**不要**拿它做管理操作。

插件连库参数在 `amxx.cfg` 的 `platform_sql_host` / `ranked_sql_host`（`amxx\README.md:30`、`:40`）。同机部署时先写 `127.0.0.1`；只有确认该 SQLx 版本支持 `host:port` 时才写 `127.0.0.1:<实测端口>`（否则端口会被当成主机名的一部分）。游戏服与数据库不同机时，填数据库服务器的可达地址（当前生产是 `119.91.99.176`），**不要填游戏服自己的 IP**；并且 `ranked_sql_*` 应与已经连通的 `platform_sql_*` 完全一致。只对游戏服的固定公网 IP 放行，不要对 `0.0.0.0/0` 开放 MySQL 端口。README 与安装说明里的 `3306` 示例同样只是示例。

### 2.5 执行单条 SQL 后退出

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u esf_app -p -e 'SELECT CURRENT_USER(), DATABASE();' esf_platform
```

SQL 用**单引号**包住最省事（PowerShell 不展开 `$`）。如果 SQL 内部必须出现单引号，改用双引号并注意 `$` 会被 PowerShell 展开，必要时用反引号转义。

### 2.6 用临时 `.cnf`（脚本/免交互场景）

下面代码块**不能直接执行**：先把 `<port>` 换成第 0 步的实测端口、`<password>` 换成 `CREDENTIALS.txt` 里的 root 密码。

```powershell
$cnf = Join-Path $env:TEMP 'esf-admin.cnf'   # 不要放桌面、仓库或共享目录
@'
[client]
host=127.0.0.1
port=<port>
user=root
password=<password>
default-character-set=utf8mb4
'@ | Set-Content $cnf -Encoding ASCII

icacls $cnf /inheritance:r
icacls $cnf /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F'

try {
  & 'C:\esf\mysql\bin\mysql.exe' --defaults-extra-file="$cnf" -e "SELECT VERSION();"
}
finally {
  Remove-Item $cnf -Force -ErrorAction SilentlyContinue
}
```

要点：

- `--defaults-extra-file` 必须是**第一个**参数（部署脚本 `deploy-esf-server.ps1:259` 也这么用）；放到其它选项后面会被当成未知变量（MySQL 8.0.29 客户端实测报 `unknown variable 'defaults-extra-file=...'`）。
- 用 `-Encoding ASCII`，避免 BOM/UTF-16 让客户端读不了。
- ACL 只保留 `SYSTEM` 和本机 `Administrators`（Windows 的 `icacls` 可直接识别上面的 SID 写法）；用完立即删除。
- 备份脚本的 `C:\esf\backup\backup.cnf` 是 `esf_backup` 只读账号，不要和 root 配置混用；恢复演练需要 root 的 CREATE/DROP 权限（见 `deploy\backup\README.md` / `verify-backup.ps1`）。若按 `deploy\backup\README.md` 做恢复演练，`admin-drill.cnf` / `admin.cnf` 同样要做 ACL 并立即删除。

## 3. 常用只读查询

进入后先选库：

```sql
USE esf_platform;
```

确认身份与环境：

```sql
SELECT VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account;
SHOW TABLES;
```

`SHOW TABLES` 的表数量随迁移版本变化，以实际输出为准；应能看到 `users`、`servers`、`ranked_matches`、`challenge_rooms` 等业务表。

查看当前账号权限：

```sql
SHOW GRANTS FOR CURRENT_USER();
```

用 root 核对 AMXX 账号的实际权限（host 以 `mysql.user` 为准；账号不存在会报错）：

```sql
SHOW GRANTS FOR 'esf_amxx'@'127.0.0.1';
SHOW GRANTS FOR 'esf_amxx'@'114.132.84.150';
```

查看表结构：

```sql
SHOW CREATE TABLE users\G
DESC challenge_rooms;
```

需要严格只读时，用只读事务包住查询：

```sql
START TRANSACTION READ ONLY;
SELECT * FROM users LIMIT 5;
ROLLBACK;
```

中文乱码时，连接加 `--default-character-set=utf8mb4`，PowerShell 先执行 `chcp 65001`。

生产写操作前先备份（见 `deploy\backup\README.md`），并先用 `SELECT` 确认命中范围；不要在生产直接执行来源不明的 `UPDATE`/`DELETE`。

## 4. 从开发机访问（受控方式）

部署脚本默认只监听 `127.0.0.1`；如果线上实际绑定其它地址或对游戏服放行，仍按以下受控顺序：

1. **RDP 到服务器**，在服务器上执行本文命令（最安全、暴露面最小）。
2. 服务器已启用 WinRM 时，用 PowerShell Remoting：

```powershell
Enter-PSSession -ComputerName 119.91.99.176 -Credential (Get-Credential)
# 进入远程会话后，按第 0/2 节在服务器上执行 mysql.exe
```

3. 仅当服务器已安装并加固 OpenSSH Server 时，才做本地端口转发。仓库中没有生产 SSH 通道的证据，默认按前两种方式：

```powershell
# <port> 换成第 0 步实测的服务端端口；<user> 换成服务器上的实际账号
ssh -L 13307:127.0.0.1:<port> <user>@119.91.99.176
```

另开一个**本地**窗口，用本机的 MySQL 客户端连转发端口：

```powershell
mysql -h 127.0.0.1 -P 13307 -u esf_app -p esf_platform
```

隧道把连接落到服务器的 `127.0.0.1:<port>`，所以 `@127.0.0.1` 的账号能正常匹配。

不要为了连库临时安装/开放服务；不要在腾讯云安全组把 MySQL 端口放行给 `0.0.0.0/0`。如果游戏服必须远程连库，只放行其固定公网 IP，并保持账号最小权限；优先 RDP/WinRM/隧道（部署脚本默认只放行 `3000`，见 `deploy-esf-server.ps1:360-362`、`:397`）。

## 5. 故障排查

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| `ERROR 2003 (HY000): Can't connect ... (10061)` | 服务未启动、端口不对、远程连了只监听 `127.0.0.1` 的实例 | `Get-Service ESFMySQL`；按第 0 步三步核实端口后重试；确认在服务器本机执行 |
| `ERROR 2002 (HY000): Can't connect ... (local)` | 客户端尝试走命名管道/Socket，而本地实例不存在 | 生产显式走 TCP：`-h 127.0.0.1 -P $dbPort`；不要使用 `DB_ROOT_SOCKET` 这类开发配置 |
| `ERROR 1045 (28000): Access denied ...` | 用户名/密码错，或账号 host 不匹配 | 统一用 `-h 127.0.0.1`；root 执行 `SELECT User,Host FROM mysql.user;` 核对 |
| `ERROR 1130 (HY000): Host '...' is not allowed to connect` | 账号 host 不匹配；`root`/`esf_app` 通常只有 `@127.0.0.1`，`esf_amxx` 可能另有历史远程 host（见 2.1、`migrate.js:397-412`） | 先 `SELECT User,Host FROM mysql.user;` 核对；不要新增远程账号，走 RDP/WinRM/受控隧道 |
| `ERROR 2005 (HY000): Unknown MySQL server host` | `-h` 里写了端口或主机名写错 | `-h` 只写主机，端口用 `-P`（如 `-h 127.0.0.1 -P $dbPort`，不要写 `-h 127.0.0.1:3306`） |
| `ERROR 1049 (42000): Unknown database` | 库名错、把密码写成了库名、迁移未执行 | 核对库名 `esf_platform`；在 `C:\esf\server` 执行 `node scripts\migrate.js`（等价 `npm run migrate`） |
| `ERROR 1044/1142 (42000): Access denied for ...` | 当前账号权限不足，常见于用 `esf_amxx` 做管理操作 | 查看 `SHOW GRANTS FOR CURRENT_USER();`；管理操作换 `root`，不要给 `esf_amxx` 扩权 |
| 能连上但表很少/缺表 | 迁移未跑或跑在别的库 | `SHOW DATABASES;` 确认库；重跑迁移 |
| 中文乱码 | 客户端/终端编码不一致 | 加 `--default-character-set=utf8mb4`；PowerShell 执行 `chcp 65001` |
| `mysql.exe` 不是内部或外部命令 | MySQL `bin` 不在 PATH | 用完整路径 `C:\esf\mysql\bin\mysql.exe` |
| 忘记 root 密码 | 凭证文件缺失或被删 | 先查 `C:\esf\CREDENTIALS.txt` 和 `.env` 的 `DB_ROOT_PASSWORD`；仍失败再安排维护窗口按 MySQL 官方流程处理，不要在生产随手 `--skip-grant-tables` |

## 6. 安全边界

- 不在聊天、截图、Issue、Git 提交里出现密码、`.env` 内容或 `CREDENTIALS.txt` 全文；`CREDENTIALS.txt` 取用后删除。
- 不在命令行写 `-p<password>`；用交互输入或受限 `.cnf`。
- `root` 只在维护窗口使用；`esf_app` 实际可写整个库，不要当只读号；`esf_amxx` 保持最小权限。
- 不对 `0.0.0.0/0` 暴露 MySQL 端口（以本机实测值为准）；游戏服确需连库时只白名单其固定公网 IP，优先走 RDP/WinRM/受控隧道。
- 生产写操作前先备份，先 `SELECT` 确认范围再 `UPDATE`/`DELETE`。
- 临时 `.cnf` 用完删除；部署中断时检查 `C:\esf\mysql-root.cnf` 是否残留（部署脚本成功时会删除，失败可能留下，内含 root 密码）。
- `.run\grant-prod-ranked.cjs` 第 5 行含明文 root 密码（`.run/` 已被 `.gitignore:11` 忽略，但文件仍在磁盘上）：不要外发或截图，建议轮换该密码，并改为从 `.env` 读取。
- 操作结束执行 `exit`，关闭不需要的远程会话和隧道。

## 7. 验收

在服务器上执行，应能返回 `8.0.x`、`esf_platform`、`esf_app@127.0.0.1`：

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u esf_app -p -e 'SELECT VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account;' esf_platform
```

再确认 `SHOW TABLES` 能看到业务表：

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u esf_app -p -e 'SHOW TABLES;' esf_platform
```

确认两个结算存储过程存在：

```powershell
& 'C:\esf\mysql\bin\mysql.exe' -h 127.0.0.1 -P $dbPort -u esf_app -p -e "SHOW PROCEDURE STATUS WHERE Db='esf_platform';" esf_platform
```

应看到 `settle_ranked_match` 和 `settle_challenge_match`。

检查清单：

- [ ] `.env` 的 `DB_PORT`、`my.ini` 的 `port=`、`SELECT @@port` 三处一致
- [ ] `Get-Service ESFMySQL` 为 `Running`，`Test-NetConnection 127.0.0.1 -Port $dbPort` 为 `True`
- [ ] root 与 esf_app 至少各成功登录一次
- [ ] `SHOW TABLES` 能看到 `users`、`servers` 等业务表
- [ ] `SHOW PROCEDURE STATUS` 能看到 `settle_ranked_match`、`settle_challenge_match`
- [ ] 密码没有出现在命令、文档、聊天或截图里
- [ ] 临时 `.cnf` 已删除，`C:\esf\mysql-root.cnf` 无残留，远程隧道/会话已关闭
- [ ] 安全组未对 `0.0.0.0/0` 放行 MySQL 端口（以本机实测值为准）；如游戏服连库，仅白名单其固定 IP

## 附：端口冲突证据

| 来源 | 写的端口 |
| --- | --- |
| `deploy\deploy-esf-server.ps1:26`（部署脚本的 `$DbPort`） | `3307` |
| `deploy\backup\README.md:39`、`:99`（备份与恢复演练） | `3306` |
| `deploy\amxx\安装说明.txt:40`、`:46`（游戏服访问 MySQL） | `3306` |
| `amxx\README.md:30`、`:40`（同文件 `:53` 又举例 `3307`） | `3306` |
| `.run\grant-prod-ranked.cjs:5`（生产授权脚本，配置为连接 `127.0.0.1`） | `3306` |

部署脚本把 `$DbPort` 同时写进 `C:\esf\my.ini`（`:169`）和 `C:\esf\server\.env`（`:280`），两者正常应一致；上表说明文档、备份说明和一次性脚本里 3306/3307 并存，所以只能现场核实。

## 附：事实来源

- `deploy\deploy-esf-server.ps1:23`（`$Root = 'C:\esf'`）、`:26`（`$DbPort`）、`:28`（服务器 IP）、`:32`（MySQL 8.0.29 下载地址）
- 同文件 `:140`（`mysql.exe`）、`:141-142`（`my.ini` / `mysql-data`）、`:168-170`（`datadir` / `port` / `bind-address=127.0.0.1`）
- 同文件 `:138`、`:190`、`:195-201`（服务 `ESFMySQL`）、`:205`、`:279-290`（`.env` 的 `DB_*` / `AMXX_*`）、`:225`（root 授权）、`:327`（`node scripts\migrate.js`）、`:360-362`（只放行 3000）、`:381-392`（`CREDENTIALS.txt`，`:383` 提示用后删除）
- `server\scripts\migrate.js:373-378`（`esf_app` 获得 `esf_platform.*` 全部权限）、`:383-396`（`esf_amxx` 最小权限清单）
- `server\src\env.js:58`（`DB_PORT` 缺省回落到 3306，所以不要删 `.env` 的 `DB_PORT`）
- `server\.env.example`（`DB_PORT` 的示例值，不是生产实际值）
