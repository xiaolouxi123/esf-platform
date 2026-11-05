# AMXX 插件

## 文件

| 文件 | 作用 |
|---|---|
| `esf_platform_auth.sma` | 平台身份校验：读取 `_platform_token`，消费 token，记录在线时长 |
| `esf_ranked_lock.sma` | 比赛锁服：有 waiting/live 排位赛时只允许参赛玩家进入 |
| `esf_gamemode.sma` | 启动后兜底应用 `esf_force_gamemode`（0 混战 / 2 组队） |
| `test_ranked.sma` | 比赛逻辑：1v1/2v2 自动检测、队伍 HUD、结果回写、结束 5 秒 quit |

`test_ranked.sma` 是从原有 `test.sma` 复制出来的分支，原始 `test.sma` 不被修改。

## 编译

需要 AMXX 1.10 的 `amxxpc.exe` 和 `include` 目录：

```bat
amxxpc.exe esf_platform_auth.sma -i"include" -o"..\plugins\esf_platform_auth.amxx"
amxxpc.exe esf_ranked_lock.sma -i"include" -o"..\plugins\esf_ranked_lock.amxx"
amxxpc.exe test_ranked.sma -i"include" -o"..\plugins\test_ranked.amxx"
```

`amxxpc.exe` 1.10 直接编译 UTF-8 中文源码会报
`error 037: invalid string` / `error 027: invalid character constant`。
编译前先把源码转成 GBK 临时副本，再让 `amxxpc` 编译该副本：

```powershell
$src = 'esf_platform_auth.sma'
$tmp = Join-Path $env:TEMP 'auth-build.sma'
[IO.File]::WriteAllText($tmp, [IO.File]::ReadAllText($src), [Text.Encoding]::GetEncoding(936))
amxxpc.exe $tmp -i"include" -o"..\plugins\esf_platform_auth.amxx"
```

不要为了编译把仓库源码改成 GBK；仓库源码保持 UTF-8。

## 配置

在 `addons/amxmodx/configs/amxx.cfg`：

```cfg
// 身份校验
platform_sql_host "<平台MySQL主机>:<端口>"
platform_sql_user "esf_amxx"
platform_sql_pass "CHANGE_ME"
platform_sql_db "esf_platform"
platform_server_key "fcx-1v1-1"
platform_enforce "1"
platform_allow_guest "0"
platform_sync_name "1"
platform_fail_open "1"
platform_require_name "0"

// 排位锁服 / 比赛结果回写
ranked_sql_host "<平台MySQL主机>:<端口>"
ranked_sql_user "esf_amxx"
ranked_sql_pass "CHANGE_ME"
ranked_sql_db "esf_platform"
ranked_server_key "fcx-1v1-1"
ranked_lock "1"
ranked_fail_open "1"
battle_platform_login "1"
battle_quit_enable "1"
battle_quit_delay "5.0"
```

`ranked_sql_host` 必须和 `platform_sql_host` 指向同一个 MySQL（可写 `host:port`，
例如 `127.0.0.1:3307`）；不要填游戏服自己的公网 IP。两套配置不一致时，
`test_ranked` / `esf_ranked_lock` 会报 `Unknown MySQL server host` 或
`[ranked] 数据库连接失败`。部署包里的 `fix-db-config.ps1` 可自动把
`platform_sql_*` 同步到 `ranked_sql_*`。

数据库账号需要：

- `SELECT` on `v_platform_users`, `launch_tokens`, `ranked_matches`, `ranked_match_players`
- `SELECT` on `challenge_rooms`, `challenge_room_players`, `challenge_configs`
- `SELECT, INSERT, UPDATE` on `challenge_player_stats`
- `SELECT, INSERT, UPDATE` on `play_sessions`
- `EXECUTE` on `settle_ranked_match`, `settle_challenge_match`

## 行为

- 合法平台玩家验证通过后，游戏内昵称自动同步为平台资料里的游戏昵称
- 约战房间晚于进服 12 秒开赛时，插件每 20 秒重试识别，最多约 10 分钟
- 比赛期间非参赛玩家进服会被提示并踢出
- 2v2：双方各 2 人，开赛后禁止换队
- 一方队伍全部出局 → 调用 `settle_ranked_match` 更新平台战绩
- 比赛结束后 5 秒，客户端执行 `quit`，平台托盘自动恢复

## 排障

- `Unknown column 't.user_id' in 'where clause'`：旧版锁服插件的 SQL 缓冲区只有 640，
  查询被截断后丢失 `FROM launch_tokens t`；使用 r4 及以上（1536 缓冲区）。
- `Info string length exceeded`：旧版身份插件对普通进服也写 `_platform_spectator=0`；
  使用 r4 及以上（仅观战者写入）。

## 注意

- 本地 listen server 的房主无法被引擎踢出，本地测试请把 `platform_enforce` 设为 `0`
- 平台推广前如要让非平台玩家进服测试：`platform_allow_guest "1"`。此时无 token/坏 token 只放行进服，不写入平台会话、排位/约战识别或战绩；推广上线后应改回 `0`，否则任何人都能绕过平台身份。
- `platform_sync_name "1"` 会在平台身份验证通过后，把游戏内昵称自动改成平台资料里的游戏昵称；关闭时保持玩家客户端原名，只受 `platform_require_name` 约束。
- 机器人没有平台 token，不参与战绩回写
- 源码中的中文日志建议统一用英文，避免 AMXX 日志按本地代码页读取时乱码
