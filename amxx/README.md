# AMXX 插件

## 文件

| 文件 | 作用 |
|---|---|
| `esf_platform_auth.sma` | 平台身份校验：读取 `_platform_token`，消费 token，记录在线时长 |
| `esf_ranked_lock.sma` | 比赛锁服：有 waiting/live 排位赛时只允许参赛玩家进入 |
| `test_ranked.sma` | 比赛逻辑：1v1/2v2 自动检测、队伍 HUD、结果回写、结束 5 秒 quit |

`test_ranked.sma` 是从原有 `test.sma` 复制出来的分支，原始 `test.sma` 不被修改。

## 编译

需要 AMXX 1.10 的 `amxxpc.exe` 和 `include` 目录：

```bat
amxxpc.exe esf_platform_auth.sma -i"include" -o"..\plugins\esf_platform_auth.amxx"
amxxpc.exe esf_ranked_lock.sma -i"include" -o"..\plugins\esf_ranked_lock.amxx"
amxxpc.exe test_ranked.sma -i"include" -o"..\plugins\test_ranked.amxx"
```

## 配置

在 `addons/amxmodx/configs/amxx.cfg`：

```cfg
// 身份校验
platform_sql_host "127.0.0.1:3306"
platform_sql_user "esf_amxx"
platform_sql_pass "CHANGE_ME"
platform_sql_db "esf_platform"
platform_server_key "fcx-1v1-1"
platform_enforce "1"
platform_fail_open "1"

// 排位锁服 / 比赛结果回写
ranked_sql_host "127.0.0.1:3306"
ranked_sql_user "esf_amxx"
ranked_sql_pass "CHANGE_ME"
ranked_sql_db "esf_platform"
ranked_server_key "fcx-1v1-1"
ranked_lock "1"
ranked_fail_open "1"
battle_quit_enable "1"
battle_quit_delay "5.0"
```

数据库账号需要：

- `SELECT` on `v_platform_users`, `launch_tokens`, `ranked_matches`, `ranked_match_players`
- `SELECT, INSERT, UPDATE` on `play_sessions`
- `EXECUTE` on `settle_ranked_match`

## 行为

- 比赛期间非参赛玩家进服会被提示并踢出
- 2v2：双方各 2 人，开赛后禁止换队
- 一方队伍全部出局 → 调用 `settle_ranked_match` 更新平台战绩
- 比赛结束后 5 秒，客户端执行 `quit`，平台托盘自动恢复

## 注意

- 本地 listen server 的房主无法被引擎踢出，本地测试请把 `platform_enforce` 设为 `0`
- 机器人没有平台 token，不参与战绩回写
- 源码中的中文日志建议统一用英文，避免 AMXX 日志按本地代码页读取时乱码
