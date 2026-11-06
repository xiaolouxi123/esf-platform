# ESF AMXX 插件套件设计（r14）

状态：**候选版本**。本文件描述 `feat/amxx-r14` 上四个 AMXX 插件的设计、契约与验收口径；
r14 已完成构建、静态测试、打包；另做过一次 HLDS 起服附加实测（G6a，**非门禁**）。
**G6b 真人验收尚未执行**，不得把本文当作生产验收通过证明。

版本基线：`test_ranked` 1.2.0-r14，`esf_platform_auth` 1.2.0，`esf_ranked_lock` 1.2.0，
`esf_gamemode` 1.0.0（未改）。包名 `esf-challenge-plugins-0.4.6-r14.zip`。

## 1. 范围与非目标

### 1.1 范围

r14 覆盖四件事：平台身份校验、排位/约战准入锁、约战比赛主逻辑、模式兜底。

| 插件 | 源码 | 版本 | 关键入口 |
|---|---|---|---|
| 身份 | `amxx/esf_platform_auth.sma` | 1.2.0（`amxx/esf_platform_auth.sma:25`） | `taskVerify`（`amxx/esf_platform_auth.sma:164`）、`OnTokenChecked`（`:246`） |
| 锁服 | `amxx/esf_ranked_lock.sma` | 1.2.0（`amxx/esf_ranked_lock.sma:26`） | `taskCheckPlayer`（`:100`）、`OnLockChecked`（`:212`） |
| 约战/排位 | `amxx/test_ranked.sma` | 1.2.0-r14（`amxx/test_ranked.sma:2900`） | `taskChallengeIdentify`（`:464`）、`beginChallengeSettlement`（`:624`）、`showIconDisplay`（`:2791`） |
| 模式 | `amxx/esf_gamemode.sma` | 1.0.0（`amxx/esf_gamemode.sma:15`） | `applyMode`（`:25`） |

范围边界：

- 只改游戏服插件与其部署包；平台 API、数据库迁移、启动器不在本包内。
- 只写 `amxx/**`、`docs/AMXX_PLUGIN_DESIGN.md`、`docs/AMXX_CHALLENGE.md`、`dist/**`、`.build/**` 与证据目录。
- 源码与 `server/test/**` 已冻结；发现代码与文档矛盾时只记录，不修改代码。

### 1.2 非目标

- 不修改 `server/src`、`server/sql`、`server/scripts/migrate.js`，不新增表/列/存储过程参数。
- 不实现平台昵称唯一性、每日改名、启动器自动加入；这些由主线程的平台侧负责。
- 不追求与 r13 二进制逐字节一致：r13 由默认调试级别的编译器产出，见第 11 章。
- 不把 G6 手工用例自动化，也不在没有 HLDS/双账号条件时声称通过。

### 1.3 证据基线

```powershell
Select-String -Path amxx\test_ranked.sma -Pattern 'register_plugin\("FCX_BATTLE"'
node --test server/test/amxx-auth.test.js server/test/amxx-challenge.test.js server/test/amxx-query.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File amxx\tools\build-r14.ps1
```

构建日志固定在 `.build/r14/build.log`，包 SHA 固定在 `dist/esf-challenge-plugins-0.4.6-r14.zip.sha256`。
第 10 章的“静态通过”只表示代码/包满足可检查条件，不等价于真人服验收。

## 2. 架构与文件职责

### 2.1 分层

```text
启动器签发 purpose=join/spectate token
        │
        ▼
esf_platform_auth   1.0s 校验 token、同步 users.game_name、写 play_sessions
        │
        ▼
esf_ranked_lock     1.5s 查排位/约战 live 状态，决定放行/观战/踢出
        │
        ▼
test_ranked         2.2/6.2/12.2s 识别约战，之后每 20s 重试；开赛、HUD、结算
        │
        ▼
esf_gamemode        1/4s 兜底应用 esf_force_gamemode（0/2）
```

四个插件通过数据库与 userinfo 解耦：`_platform_token`、`_platform_spectator` 是唯一跨插件内存契约；
其余全部经 `launch_tokens` / `challenge_*` / `play_sessions` 表交互。

### 2.2 文件职责

| 文件 | 职责 | 明确不负责 |
|---|---|---|
| `esf_platform_auth.sma` | token 校验、单次消费、昵称同步、会话记录、统一拒绝 | 不判断排位/约战房间是否该锁 |
| `esf_ranked_lock.sma` | 无 token guest 锁、live 比赛准入、观战放行、统一拒绝 | 不消费 token、不写战绩 |
| `test_ranked.sma` | 约战识别/开赛/计数/HUD/结算/弃权；排位保留原逻辑 | 不校验 token、不做进服准入 |
| `esf_gamemode.sma` | 启动时按 cvar 应用 `mp_gamemode` | 不改地图/模式规则 |

加载顺序建议：`esf_platform_auth` → `esf_ranked_lock` → `test_ranked` → `esf_gamemode`。
`esf_platform_auth` 在 `plugin_init` 注册全部 `platform_*` cvar（`amxx/esf_platform_auth.sma:59-72`）；
`esf_ranked_lock` 注册 `ranked_*`（`amxx/esf_ranked_lock.sma:41-50`）；
`test_ranked` 在 `plugin_init` 末尾注册 `BattleLimt`、`ranked_*`、`battle_*`（`amxx/test_ranked.sma:3009-3018`）。

### 2.3 依赖与可观测性

- 依赖 AMXX 1.10 的 `sqlx` 模块；`modules.ini` 未启用时四个插件都无法完成数据库路径。
- 统一日志前缀：`[Platform]`、`[ESF-REJECT]`、`[ESF-LOCK]`（锁服失败路径）、`[ESF-CHALLENGE]`、`[ESF-SETTLE]`。
- 排查顺序：`amxx plugins` → `amxx modules` → `addons/amxmodx/logs/amxx.log` 的 `[ESF-*]` 行。

```powershell
Get-Content <amxx>\configs\plugins.ini
Select-String -Path amxx\*.sma -Pattern '\[ESF-(REJECT|CHALLENGE|SETTLE)\]'
```

## 3. 平台契约

### 3.1 表与字段

| 表/视图 | 关键列 | 用途 | 证据 |
|---|---|---|---|
| `launch_tokens` | `token CHAR(32) UNIQUE`、`user_id`、`server_key`、`expires_at`、`used_at`、`authorized_until`、`purpose` | 启动凭证；join/spectate | `server/sql/001_schema.sql:30` |
| `v_platform_users` | `id, username, game_name, role, status` | 身份与昵称来源（无 `password_hash`） | `server/sql/001_schema.sql:103` |
| `challenge_rooms` | `id, mode('1v1'/'2v2'), server_key, status('waiting'/'live'/'closed'), max_players` | 房间与 live 状态 | `server/sql/008_challenges.sql:8` |
| `challenge_room_players` | `room_id, user_id, team('a'/'b'), ready` | 队伍归属 | `server/sql/008_challenges.sql:26` |
| `challenge_configs` | `victory_type('kills'/'deaths')`、`victory_limit` | 胜利规则，默认 10 | `server/sql/011_challenge_results.sql:3` |
| `challenge_results` | `winner('a'/'b')`、`score_a`、`score_b`、`victory_type`、`victory_limit` | 结果 | `server/sql/011_challenge_results.sql:12` |
| `challenge_player_stats` | `(room_id,user_id)` 主键、`team,kills,deaths` | 个人统计，UPSERT | `server/sql/011_challenge_results.sql:23` |
| `play_sessions` | 会话记录 | 在线时长 | 身份插件 `:341-344` |

### 3.2 读契约

身份插件按 `token + server_key` 读取用户与用途，条件是“未使用且未过期，或仍在观战授权窗口”：
`amxx/esf_platform_auth.sma:223-232`。成功后将 `used_at` 置为当前时间、`authorized_until` 延长 12 小时
（`amxx/esf_platform_auth.sma:329-335`），因此同一 token 不能再次用于 join，但观战授权在窗口内可用。

约战识别按 `token + server_key + purpose='join' + r.status='live'` 读取房间、队伍、规则与模式：
`amxx/test_ranked.sma:478-487`。`r.mode` 决定 `slots`（2v2=2，否则 1）与 `expected=slots*2`
（`amxx/test_ranked.sma:522-523`）；`victory_limit` 在 3–50 外回退 10（`:544`）。

锁服查询分两条：有 token 的玩家查排位/约战归属（`amxx/esf_ranked_lock.sma:134-153`），
无 token guest 只查“本服是否有 live/waiting 比赛”（`amxx/esf_ranked_lock.sma:178-184`）。
锁服 SQL 缓冲区 1536，避免旧版 640 截断导致的 `Unknown column`。

### 3.3 写契约

结算顺序固定为“先个人统计，后结果过程”：

1. `INSERT INTO challenge_player_stats (...) VALUES ... ON DUPLICATE KEY UPDATE ...`
   （`amxx/test_ranked.sma:662-663`），主键 `(room_id,user_id)` 保证重试幂等。
2. `CALL settle_challenge_match(room_id, winner, score_a, score_b, victory_type, limit)`
   （`amxx/test_ranked.sma:635-638`）。
3. 过程写 `challenge_results`（`ON DUPLICATE KEY UPDATE`）并把 `challenge_rooms.status` 从 `live` 置 `closed`
   （`server/scripts/migrate.js:324` 起）。

过程不做参数合法性校验，也不写统计；参数由插件侧钳制。平台侧必须先执行包含该过程的迁移，
否则结算会一直重试到超时（见第 4 章）。

### 3.4 昵称契约

`platform_sync_name 1` 时，身份插件把 `users.game_name` 同步为游戏内名：最多 31 个 UTF-8 字节，
空值回退 `username`，且不切断多字节字符（`amxx/esf_platform_auth.sma:294-308`、`utf8SafeCopy` `:419-426`）。
`platform_require_name 1` 时昵称不一致直接以 `PLATFORM_NAME_MISMATCH` 拒绝（`:315`）。
平台侧目前没有 `game_name` 唯一约束；唯一性/每日改名是平台职责，不在本包内。

```powershell
Get-Content server\sql\008_challenges.sql
Select-String -Path server\scripts\migrate.js -Pattern 'settle_challenge_match' -Context 0,12
```

## 4. 状态机

### 4.1 房间与插件状态

```text
房间: waiting ──平台 start──> live ──结算过程──> closed
插件: IDLE ──识别成功──> IDENTIFIED ──开赛──> LIVE ──结算──> SETTLING ──成功/超时──> RESET
```

插件不创建/不启动房间；它只观察 `status='live'`。房间在插件识别前关闭时，识别查询返回 0 行，
插件保持 IDLE（`amxx/test_ranked.sma:99`）。

### 4.2 识别

- 进服后 2.2s / 6.2s / 12.2s 各识别一次（`amxx/test_ranked.sma:196-198`），之后每 20s 重试，
  上限约 30 次（`:200`、`taskChallengeRetry` `:207`），覆盖“房间晚于 12 秒才 live”的情况。
- 识别成功的副作用：记录 `g_challengeRoomId`、清空旧队伍/计数、按 `r.mode` 设 `slots/expected`，
  绑定 `user_id/team`、清零个人计数、读取规则（`:520-597`）。
- 同一玩家重复识别不会重复计数（`:526` 已识别即返回），但换房会整体重置（`:540-560`）。

### 4.3 开赛

满员开赛条件（`checkChallengeReadyToStart` `:610-617`）：`known >= expected` 且 A/B 两队各至少 1 人。
满足后写 `start_full` 日志并 `startChallengeBattle`（`:615-616`），开赛时把个人击杀/死亡清零（`:628-632`）。

8 秒兜底（`taskChallengePartialStart` `:646-666`）：

- 2v2：A/B 各至少 1 人且 `known >= 2`；
- 1v1：`known >= 1`；
- 不满足则转 `armChallengeQuorum()` 进入 20 秒宽限（`:655-659`）；满足则写 `start_partial known=%d expected=%d` 并开赛（`:646-666`）。

开赛后 `g_iBattle=true`，`autoPlayerStart` 对挑战房直接返回（`:2849-2852`），legacy 自动凑人不会提前开赛。

### 4.4 弃权宽限

一方在线参赛者归零时进入 20 秒宽限（`armChallengeForfeit` `:728-735`），日志
`forfeit_arm reason=%s team=%d grace=20`。宽限结束仍为空：某队为空时判另一队胜、全员离线按当前比分（平局判 a），统一走 `settleChallengeForfeit`（`:815-855`）；
期间该队有人重新识别则 `challengeCancelForfeitIfBack` 取消（`:764-780`）。
平局固定判 A（`tie_forfeit` `:838`/`:845`），与平台阈值平局规则一致。

### 4.5 结算

1. `beginChallengeSettlement` 记录 winner/score，拼 stats 与 `CALL` 查询，挂 25 秒看门狗
   （`amxx/test_ranked.sma:668-725`）。
2. stats 失败固定 2.0s 重试，最多 3 次（共 4 次尝试），仍失败写 `code=STATS_FAILED` 后继续结算
   （`:914-930`）。stats 成功写 `stats_saved`。
3. settle 失败同样固定 2.0s、最多 3 次；最终失败写 `code=SETTLE_FAILED` 并返回，不立即 reset
   （`:945-961`）；末次失败会先 `remove_task` 再重挂 12 秒兜底，不与回调竞态。
4. 成功写 `settled`，移除兜底任务并 `resetAll`（`:965-970`）；reset 后对真人执行 `disconnect`
   （`:2839-2855`），约战不受 `battle_quit_enable` 影响。
5. 看门狗/重挂的 `taskForceChallengeEnd` 写 `code=SETTLE_TIMEOUT room=<id> force_exit`、聊天提示并 `resetAll`（`:905-911`）。
   超时后仍由 `resetAll` 排 `battle_quit_delay`（默认 5 秒）`disconnect` 回平台；`force_exit` 是日志终态标记，
   与 R7-3 的“强制退出”语义一致（`:2856-2862`）。

## 5. HUD

### 5.1 形态

约战 HUD 是**单条 DHUD**：`channel=4`、`x=-1.0` 居中、`y=0.02`、两行，第二行是 ASCII 规则
（`amxx/test_ranked.sma:2905-2924`）。格式：

```text
Alice   3 : 2   Bob
FIRST TO 10 KILLS
```

2v2 时第一行为 `A1 + A2    3 : 2    B1 + B2`，仍只有两行（`amxx/test_ranked.sma:2907-2912`；
1v1 分支 `amxx/test_ranked.sma:2913-2916`）。规则行由 `victory_type` 映射为 `KILLS` / `DEATHS`
（`amxx/test_ranked.sma:2906`），阈值来自房间配置并在 3–50 外回退 10（`amxx/test_ranked.sma:570`）。

### 5.2 数据来源

- 比分只累加 `g_challengeKills` / `g_challengeDeaths`（`amxx/test_ranked.sma:2889-2903`），**不使用** `get_user_frags`；
  后者只用于 legacy HUD。
- 参赛者判定是 `g_challengeTeam[i] != 0`；观战者/旁观者 team=0，被跳过（`amxx/test_ranked.sma:2891`、`amxx/test_ranked.sma:2921`）。
- 同时跳过 `g_iWarrior[i]`（已淘汰/观战标记），避免死人继续看到参赛 HUD。

### 5.3 刷新与 legacy 拆分

- 定时 1 秒刷新一次（`amxx/test_ranked.sma:3059`），每次只发一条 DHUD，不会三条互相覆盖；满足 AC-R1-6 的“1 秒内更新”。
- 非约战场景走 `showLegacyIconDisplay`（`amxx/test_ranked.sma:2932-2962`、`amxx/test_ranked.sma:2928`），legacy 比分/HUD 与约战完全分离。
- 识别成功即写结构化日志 `identified room=<id> mode=<1v1|2v2> slots=<n> team=<a|b> known=<n> expected=<n>`（`amxx/test_ranked.sma:576-578`），满足 AC-R2-2。

```powershell
Select-String -Path amxx\test_ranked.sma -Pattern 'set_hudmessage|show_dhudmessage|FIRST TO'
Select-String -Path amxx\test_ranked.sma -Pattern 'get_user_frags' -Context 1,1
```

## 6. cvar 全表

### 6.1 身份插件（`amxx/esf_platform_auth.sma:62-72`）

| cvar | 默认 | 作用 | 迁移期建议 |
|---|---|---|---|
| `platform_sql_host` | `""` | 平台 MySQL，可写 `host:port` | 必填；与 `ranked_sql_host` 指向同一库 |
| `platform_sql_user` | `esf_amxx` | 最小权限账号 | 保留默认名，按第 8 章授权 |
| `platform_sql_pass` | `""` | 密码，只写本机 `amxx.cfg` | 不进仓库/包/文档；安装器只写注释模板 |
| `platform_sql_db` | `esf_platform` | 库名 | 与平台一致 |
| `platform_server_key` | `""` | 本服 key，绑定 token/房间 | 必填，与 `servers.server_key` 一致 |
| `platform_enforce` | `1` | 拒绝时是否真踢 | 生产 `1`；本地调试可 `0` |
| `platform_allow_guest` | `0` | 无 token 是否放行 | 测试可 `1`，推广必须回 `0` |
| `platform_sync_name` | `1` | 同步 `users.game_name` | 保持 `1` |
| `platform_fail_open` | `1` | 数据库不可用时容灾放行 | 迁移期 `1`，稳定后按安全策略评估 |
| `platform_debug` | `0` | 调试日志（token 只打前 6 位） | 生产 `0` |
| `platform_require_name` | `0` | 强制昵称与平台一致 | 需要强一致时再开 |

### 6.2 锁服插件（`amxx/esf_ranked_lock.sma:44-50`）

| cvar | 默认 | 作用 | 迁移期建议 |
|---|---|---|---|
| `ranked_sql_host` | `""` | 排位/约战库 | 与 `platform_sql_host` 同库 |
| `ranked_sql_user` | `esf_amxx` | 账号 | 同身份插件 |
| `ranked_sql_pass` | `""` | 密码 | 只写本机 |
| `ranked_sql_db` | `esf_platform` | 库名 | 同平台 |
| `ranked_server_key` | `""` | 本服 key | 与 `platform_server_key` 一致 |
| `ranked_lock` | `1` | 是否启用锁服 | 生产 `1`；回滚时可 `0` |
| `ranked_fail_open` | `1` | DB 失败时容灾放行 | 迁移期 `1` |

### 6.3 约战/排位主逻辑（`amxx/test_ranked.sma:2918-2927`）

| cvar | 默认 | 作用 | 迁移期建议 |
|---|---|---|---|
| `BattleLimt` | `10` | legacy 排位淘汰阈值（拼写沿用历史） | 不改；与约战 `victory_limit` 无关 |
| `ranked_sql_*` | 同上 | 结算/识别连接 | 与锁服一致 |
| `battle_quit_enable` | `1` | 排位结束是否 quit | 约战不受此开关影响 |
| `battle_quit_delay` | `5.0` | quit 延迟秒 | 保留 5.0，给平台读 `lastResult` |
| `battle_platform_login` | `1` | 跳过旧 amx 账号库 | 平台模式保持 `1` |

### 6.4 模式插件（`amxx/esf_gamemode.sma:22`）

| cvar | 默认 | 作用 | 迁移期建议 |
|---|---|---|---|
| `esf_force_gamemode` | `-1` | `-1` 不改；`0` 混战；`2` 组队 | 保持 `-1` 或按服设置 |

r13 → r14 **没有新增 cvar**；变化在 `test_ranked` 内部逻辑与版本号。迁移期降级顺序：
先把 `platform_enforce`/`ranked_lock` 设 `0`（或 `platform_allow_guest 1`）→ 重启 → 观察 →
再恢复 `1`；不要靠改源码回退。

```powershell
Select-String -Path amxx\*.sma -Pattern 'register_cvar'
Select-String -Path amxx\test_ranked.sma -Pattern 'register_cvar\("BattleLimt"'
```

## 7. 错误码封闭表

### 7.1 封闭集合

| 错误码 | 触发 | 踢出/日志文本 | 代码位置 |
|---|---|---|---|
| `PLATFORM_TOKEN_MISSING` | userinfo 无 `_platform_token` | `<CODE>: 缺少平台启动凭证…` | `amxx/esf_platform_auth.sma:177` |
| `PLATFORM_TOKEN_INVALID` | token 非 32 位小写 hex / 默认拒绝码 | `<CODE>: …` | `amxx/esf_platform_auth.sma:187`、`amxx/esf_platform_auth.sma:434` |
| `PLATFORM_TOKEN_EXPIRED` | 查询 0 行（过期/已用/不匹配） | `<CODE>: …` | `amxx/esf_platform_auth.sma:264` |
| `PLATFORM_DB_UNAVAILABLE` | 未配置/连接失败/查询失败 | `<CODE>: 平台验证服务不可用…` | `amxx/esf_platform_auth.sma:204`、`amxx/esf_platform_auth.sma:208`、`amxx/esf_platform_auth.sma:217`、`amxx/esf_platform_auth.sma:251`、`amxx/esf_platform_auth.sma:460` |
| `PLATFORM_NAME_MISMATCH` | `require_name=1` 且昵称不一致 | `<CODE>: …` | `amxx/esf_platform_auth.sma:315` |
| `PLATFORM_ACCOUNT_INACTIVE` | 用户 `status` 非 active | `<CODE>: …` | `amxx/esf_platform_auth.sma:284` |
| `RANKED_LOCKED` | 有排位但非本场参赛者 | `<CODE>: 排位赛进行中…` | `amxx/esf_ranked_lock.sma:210`、`amxx/esf_ranked_lock.sma:249`、`amxx/esf_ranked_lock.sma:259` |
| `CHALLENGE_LOCKED` | 有 live 约战且非参赛/非观战 | `<CODE>: 本服务器正在进行约战…` | `amxx/esf_ranked_lock.sma:206`、`amxx/esf_ranked_lock.sma:244` |
| `LOCK_DB_UNAVAILABLE` | 锁服数据库不可用且未容灾 | `<CODE>: 排位赛校验服务…` | `amxx/esf_ranked_lock.sma:174`、`amxx/esf_ranked_lock.sma:197`、`amxx/esf_ranked_lock.sma:220` |
| `LEGACY_ABUSE` | legacy 旧模式违规路径 | 踢出（legacy） | `amxx/test_ranked.sma:2001`、默认参数 `amxx/test_ranked.sma:2398` |
| `RENAME_BLOCKED` | 比赛中改名被还原 | 聊天“比赛中禁止改名”；日志 `code=RENAME_BLOCKED` | `amxx/test_ranked.sma:235` |
| `STATS_FAILED` | 个人统计 4 次尝试仍失败 | 继续结算；日志 `code=STATS_FAILED` | `amxx/test_ranked.sma:926` |
| `SETTLE_FAILED` | 结果过程 4 次尝试仍失败 | 日志 `code=SETTLE_FAILED`，重挂 12 秒兜底 | `amxx/test_ranked.sma:957` |
| `SETTLE_TIMEOUT` | 看门狗（25s）或末次重挂（12s）触发 | 日志 `code=SETTLE_TIMEOUT`，聊天提示 | `amxx/test_ranked.sma:909` |

### 7.2 统一拒绝格式

两个拒绝入口都把踢人原因固定为 `"<CODE>: <中文短句>"`：

- 身份：`amxx/esf_platform_auth.sma:439` 组 `"%s: %s"`，日志 `[ESF-REJECT] code=… id=… name=… ip=… server=…`
  （`amxx/esf_platform_auth.sma:441`），延迟 1.5s 踢（`amxx/esf_platform_auth.sma:455`）。
- 锁服：`amxx/esf_ranked_lock.sma:262` 组同样格式，日志带 `name=`/`ip=`（`amxx/esf_ranked_lock.sma:265`），延迟 1.0s 踢（`amxx/esf_ranked_lock.sma:281`）。

`127.0.0.1`/`::1` 在锁服路径只记 `local_bypass=1`，不踢（`amxx/esf_ranked_lock.sma:267-271`）；身份路径通过
`platform_enforce=0` 或容灾放行处理本地 listen server。

### 7.3 容灾与边界

- 身份：`platform_fail_open=1` 时数据库不可用会放行并写 `[Platform] verify_timeout=1`（`amxx/esf_platform_auth.sma:460-466`）。
- 锁服：`ranked_fail_open=1` 时查询失败只告警不踢，并写 `[ESF-LOCK] verify_timeout=1`（`amxx/esf_ranked_lock.sma:168-176`）。
- 所有 token 日志只允许前 6 位（`TOKEN_LOG_PREFIX`，`amxx/esf_platform_auth.sma:406`）；完整 token 绝不出现在日志。
- 错误码是封闭集合；新增码必须同时更新本文、PRD R6 与平台对账逻辑。

```powershell
Select-String -Path amxx\*.sma -Pattern 'PLATFORM_|RANKED_LOCKED|CHALLENGE_LOCKED|LOCK_DB_UNAVAILABLE|LEGACY_ABUSE|RENAME_BLOCKED|STATS_FAILED|SETTLE_FAILED|SETTLE_TIMEOUT'
```

## 8. 安全与最小权限

### 8.1 数据库账号

推荐账号 `esf_amxx`，只授予：

```sql
SELECT ON esf_platform.v_platform_users TO 'esf_amxx'@'<游戏服内网IP>';
SELECT ON esf_platform.launch_tokens TO 'esf_amxx'@'<游戏服内网IP>';
SELECT ON esf_platform.ranked_matches TO 'esf_amxx'@'<游戏服内网IP>';
SELECT ON esf_platform.ranked_match_players TO 'esf_amxx'@'<游戏服内网IP>';
SELECT ON esf_platform.challenge_rooms TO 'esf_amxx'@'<游戏服内网IP>';
SELECT ON esf_platform.challenge_room_players TO 'esf_amxx'@'<游戏服内网IP>';
SELECT ON esf_platform.challenge_configs TO 'esf_amxx'@'<游戏服内网IP>';
SELECT, INSERT, UPDATE ON esf_platform.challenge_player_stats TO 'esf_amxx'@'<游戏服内网IP>';
SELECT, INSERT, UPDATE ON esf_platform.play_sessions TO 'esf_amxx'@'<游戏服内网IP>';
EXECUTE ON PROCEDURE esf_platform.settle_ranked_match TO 'esf_amxx'@'<游戏服内网IP>';
EXECUTE ON PROCEDURE esf_platform.settle_challenge_match TO 'esf_amxx'@'<游戏服内网IP>';
```

不要授予 `ALL`、`DROP`、`ALTER`、`CREATE`、`FILE`、`PROCESS`；账号 host 限定为游戏服内网地址。
`users` 表本身不需要直读，身份插件只读 `v_platform_users`（`amxx/esf_platform_auth.sma:18`）。

### 8.2 凭据与 token

- 仓库、文档、包内一律不写明文密码；`platform_sql_pass`/`ranked_sql_pass` 默认空，部署时只在
  本机 `amxx.cfg` 填写。安装器只追加注释模板，不提示、不落盘密码（`amxx/tools/install-amxx.ps1:60` 附近）。
- 启动 token 是凭证：日志只打前 6 位（`amxx/esf_platform_auth.sma:406`、`amxx/esf_platform_auth.sma:237`）；
  拒绝日志只含 `code/id/name/ip/server`（`amxx/esf_platform_auth.sma:441`），不含 token。
- 包内 `SHA256SUMS.txt` 只含二进制/脚本哈希，不含任何配置值。

### 8.3 网络暴露

MySQL 3306 只监听内网/本机，禁止公网直连。上线前在数据库主机确认：

```powershell
Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
Test-NetConnection -ComputerName <数据库内网IP> -Port 3306
```

`LocalAddress` 应为 `127.0.0.1` 或内网地址；从公网机器 `Test-NetConnection` 应失败。若必须跨机，
用防火墙只放行游戏服 IP，不要用 `0.0.0.0/0`。数据库连接当前不启用 TLS，跨公网传输不可接受。

## 9. 部署与回滚

### 9.1 包内容

`dist/esf-challenge-plugins-0.4.6-r14.zip` 固定包含 7 个文件：

```text
esf_gamemode.amxx
esf_platform_auth.amxx
esf_ranked_lock.amxx
test_ranked.amxx
install-amxx.ps1
README.txt
SHA256SUMS.txt
```

不含 `.sma`、`.build`、`.env`、数据库配置或凭据。包 SHA256 与四个 `.amxx` 的哈希见
`docs/AMXX_CHALLENGE.md` 的 r14 节；`SHA256SUMS.txt` 为小写 `<hash>  <name>`，两空格分隔。

### 9.2 安装

```powershell
# 1) 校验外层 zip
Get-FileHash .\esf-challenge-plugins-0.4.6-r14.zip -Algorithm SHA256
Get-Content .\esf-challenge-plugins-0.4.6-r14.zip.sha256

# 2) 解压到本地目录（不要在 zip 内直接运行）
Expand-Archive .\esf-challenge-plugins-0.4.6-r14.zip -DestinationPath .\r14 -Force

# 3) 空跑：只打印计划并校验 SHA256SUMS
powershell -NoProfile -ExecutionPolicy Bypass -File .\r14\install-amxx.ps1 -DryRun

# 4) 正式安装（可用 -AmxModxDir 显式指定）
powershell -NoProfile -ExecutionPolicy Bypass -File .\r14\install-amxx.ps1 `
  -AmxModxDir "D:\HLDS\esf\addons\amxmodx"
```

安装器行为（`amxx/tools/install-amxx.ps1`）：

- 读同目录 `SHA256SUMS.txt`，逐个校验 4 个 `.amxx`，不匹配立即中止（`amxx/tools/install-amxx.ps1:46`、`amxx/tools/install-amxx.ps1:82`）。
- 目标探测顺序：`-AmxModxDir` → WMI `hlds.exe` 的 `-game` 推断 → 常见 `addons\amxmodx` 路径（`amxx/tools/install-amxx.ps1:123-170`）。
- 变更前备份现有 4 个 `.amxx`、`plugins.ini`、`amxx.cfg` 到
  `<amxx>\backup-<yyyyMMdd-HHmmss>\`（`amxx/tools/install-amxx.ps1:315-326`）。
- `plugins.ini` 只在缺失时追加，重复执行幂等；`amxx.cfg` 只追加注释模板，不写密码（`amxx/tools/install-amxx.ps1:271-290`）。
- 任一步失败用备份回滚已复制文件（`amxx/tools/install-amxx.ps1:220-230` 起）。
- 不联网、不写 AMXX 目录以外路径。

### 9.3 回滚

```powershell
# 找最近备份
Get-ChildItem <amxx> -Directory -Filter "backup-*" | Sort-Object Name -Descending

# 停服/换图后，把备份中的 4 个 amxx、plugins.ini、amxx.cfg 复制回原位
Copy-Item .\<amxx>\backup-<stamp>\*.amxx .\<amxx>\plugins\ -Force
Copy-Item .\<amxx>\backup-<stamp>\plugins.ini .\<amxx>\configs\plugins.ini -Force
Copy-Item .\<amxx>\backup-<stamp>\amxx.cfg .\<amxx>\amxx.cfg -Force
```

首次安装没有旧 `.amxx` 时，删除 `plugins.ini` 中 `; === ESF r14 plugins ===` 标记块及 4 行插件名，
并删除 `plugins` 下 4 个 `.amxx`。重启后 `amxx plugins` 不应再加载 r14。

### 9.4 迁移期降级

数据库/平台未就绪时，可临时在 `amxx.cfg`：

```cfg
platform_enforce "0"
platform_allow_guest "1"
ranked_lock "0"
```

这会让玩家绕过平台准入，只用于迁移窗口；恢复后必须改回 `platform_enforce 1`、`allow_guest 0`、
`ranked_lock 1` 并重启。cvar 降级不改变二进制，回滚二进制仍按 9.3。

### 9.5 构建可复现性

构建脚本 `amxx/tools/build-r14.ps1` 固定编译器
`G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\amxxpc.exe`（1.10.0.5392）、
include 同目录 `include`、UTF-8→GBK 临时副本、输出 `.build/r14/out`，并生成固定顺序/固定时间戳的 zip。
编译器以 `-d1` 调用：默认 `-d2` 在 amxxpc 1.10 上会为极小插件写出不稳定的调试字符串，
同源两次编译可差 170 字节；`-d1` 保留行号诊断且可复现。因此 r14 的 SHA 与 r13 不同是预期行为。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File amxx\tools\build-r14.ps1
Get-Content .build\r14\build.log -Tail 20
Get-FileHash dist\esf-challenge-plugins-0.4.6-r14.zip -Algorithm SHA256
```

## 10. 验收矩阵

状态口径：**静态通过**=已按 AC 逐条 grep/测试核对且文档与代码一致；**已修复待复审**=verifier 发现后本轮已改、等待独立复审；
**平台侧**=不在本仓库可验证；**BLOCKED**=需要真人/HLDS，未执行。G6 门禁整体为 BLOCKED，单次 HLDS 起服实测不改变门禁结论。

| 需求 | AC | 验证方式 | 责任面 | 状态 |
|---|---|---|---|---|
| R1 HUD | R1-1..R1-5 | `Select-String` channel 4/x=-1.0/两行/比分来源/观战跳过；静态检查 | 插件 | 已修复待复审：单条 DHUD `amxx/test_ranked.sma:2882-2926`（channel 4、x=-1.0、取 `g_challengeKills/Deaths`、跳过观战者） |
| R1 HUD 刷新 | R1-6 | 击杀后 ≤1s 刷新 | 插件 | 已修复待复审：1s 定时 `amxx/test_ranked.sma:3059`；运行时录屏 BLOCKED |
| R2 自动加入/识别 | R2-1、R2-3、R2-5 | 启动器 5s 轮询、token join、识别查询 | 平台+插件 | 插件已修复待复审（`:483-601`）；平台侧 `esf-launcher/src/components/Lobby.jsx:132-174` 待集成 |
| R2 识别日志 | R2-2 | 日志 `identified room=… mode=… slots=… team=…` | 插件 | 已修复待复审：`amxx/test_ranked.sma:576-578` |
| R2 重试窗口 | R2-4 | 启动器 `autoJoinRef` 先置位再 join | 平台 | 平台侧（`esf-launcher/src/components/Lobby.jsx:141-143`） |
| R3 胜利条件 | R3-1..R3-5 | `victory_limit` 团队累计、3–50 回退 10、kills 高胜/deaths 低胜 | 插件 | 已修复待复审：`amxx/test_ranked.sma:570`（夹取）、`:826-849`（弃权判胜）、`:874-899`（达阈值判胜） |
| R4 昵称同步 | R4-1..R4-3、R4-4 | `game_name` 31 字节、空回退 username、UTF-8 安全 | 平台+插件 | 插件已修复待复审（`amxx/esf_platform_auth.sma:294-317`）；平台唯一性见 `server/src/routes/me.js:113-143` |
| R5 比赛改名 | R5-1..R5-4 | `client_infochanged` 还原、聊天提示、日志 | 插件 | 已修复待复审：`amxx/test_ranked.sma:210-236`（`code=RENAME_BLOCKED rename_blocked id=`） |
| R6 错误码 | R6-1..R6-5 | 封闭码、`"<CODE>: <中文>"`、窗口/超时、token 前 6 位、127 例外 | 插件 | 已修复待复审：auth `esf_platform_auth.sma:441`、`:463`（`verify_timeout=1`）、`:237`（`token_prefix`）；lock `esf_ranked_lock.sma:123-129`（`:125` 容灾日志）、`174/197/220`、`:265-281` |
| R7 结算 | R7-1、R7-4..R7-6 | stats→CALL、2.0s×3、失败继续、≤25s | 插件+DB | 已修复待复审：`amxx/test_ranked.sma:905-967`（25s 看门狗 + 末次失败重挂 12s、SETTLE_RETRY/SETTLED、UPSERT 幂等） |
| R7 重试日志 | R7-2 | 日志 `SETTLE_RETRY attempt=<n>` | 插件 | 已修复待复审：`amxx/test_ranked.sma:952` |
| R7 超时语义 | R7-3 | `SETTLE_FAILED attempts=4`、`SETTLE_TIMEOUT force_exit` 断开 | 插件 | 已修复待复审：`:718`（25s 看门狗）、`:957-958`（失败后 remove+重挂 12s）、`:909`（TIMEOUT force_exit） |
| R8 开赛/弃权 | R8-1..R8-7 | mode→slots、满员+8s partial、20s 宽限、队空判另一队、tie→a、legacy 隔离 | 插件 | 已修复待复审：识别/开赛 `:483-601`、quorum `:646-666`、弃权 `:728-860`（断线比分保留）、legacy 隔离 `:2076` |
| R9 结构化日志 | R9-1..R9-5 | 前缀、room/attempt/code、无凭据 | 插件 | 已修复待复审：`[ESF-REJECT]`（auth `:441`）、`[ESF-LOCK]`（lock `:265`）、`[ESF-SETTLE] room=… attempt=… code=…`（test_ranked `:909`、`:921`、`:926`、`:952`、`:957`、`:965`） |
| R10 锁服/观战 | R10-1..R10-6 | 无 token guest、spectate 标记、2v2 门槛、1536 缓冲 | 插件 | 已修复待复审：guest 双表 `esf_ranked_lock.sma:177-220`；观战读取/跳过 `test_ranked.sma:132`、`:489`、`:641`、`:802-813`；quorum `:780-798` |
| R11 构建/发布 | R11-1..R11-6 | 4 插件 0 error、版本、7 文件包、SHA、无源码/凭据 | 构建 | 静态通过（见第 9 章与 `docs/AMXX_CHALLENGE.md`） |
| G6 服务器启动 | G6a | HLDS 加载 4 插件、DB 初始化、无插件错误 | 人工+运维 | 附加实测（非门禁）：2026-11-07 06:35 hlds.exe 起服并加载四插件，见 `evidence/g6-hlds-boot.txt`；该证据非 verifier 生成，不能计为门禁 PASS |
| G6 真人验收 | G6b TC-1..TC-6 | 1v1/2v2/观战/中途退出/改名/guest | 人工+运维 | **BLOCKED**（本机无可用 HL 客户端，需 114 或用户端） |

静态验证命令：

```powershell
node --test server/test/amxx-auth.test.js server/test/amxx-challenge.test.js server/test/amxx-query.test.js
Select-String -Path amxx\test_ranked.sma -Pattern 'g_challengeExpected|start_partial|forfeit_arm|FIRST TO'
Select-String -Path amxx\esf_ranked_lock.sma -Pattern 'LOCK_DB_UNAVAILABLE|CHALLENGE_LOCKED|RANKED_LOCKED'
```

## 11. 协调与风险

### 11.1 与主线程迁移的接口边界

本包只依赖第 3 章的表/过程；主线程必须保证：

- `challenge_rooms.status` 在开赛前置 `live`，结束后由过程置 `closed`；同一 `server_key` 同时只有一个 live。
- `challenge_room_players.team` 写 `a`/`b`；`mode` 写 `1v1`/`2v2`；`challenge_configs` 先于开赛写入。
- `launch_tokens.purpose` 为 `join`/`spectate`，`token` 为 32 位小写 hex，`server_key` 与房间/服务器一致。
- 已执行包含 `settle_challenge_match` 的迁移；平台读结果以 `challenge_results`/`lastResult` 为准。
- `users.game_name` 允许 31 字节以内 UTF-8；平台侧负责唯一性与每日改名（`server/src/routes/me.js:115-143`，当前无唯一约束）。
- 启动器侧 `Lobby.jsx` 在 `room.status==='live'` 时自动进服；当前实现先写 `autoJoinRef` 再发 join（`esf-launcher/src/components/Lobby.jsx:141-143`），join 失败不会重试——自动进服可靠性属平台侧待办（R2-4），插件只负责进服后的识别与开赛。

本仓库没有修改 `server/src`、`server/sql`、`server/scripts/migrate.js`、`esf-launcher`；
若平台字段/状态语义变化，先改契约文档与迁移，再改插件，避免插件先行读到半成品状态。

### 11.2 r13 包不可复现

r13 的 55,562 字节包与哈希是历史产物；其编译器默认调试级别（`-d2`）在 amxxpc 1.10 上存在
非确定调试字符串问题（同源两次编译可差百余字节，见本次构建调查）。因此：

- **不得**用当前源码 + 默认参数重编后声称得到 r13 的 SHA；
- r14 固定 `-d1` 并记录新 SHA，r13 只作为历史版本保留（`docs/AMXX_CHALLENGE.md` 已标注过期）。

### 11.3 G6 手工项

**G6a 附加实测（非门禁）**（2026-11-07 06:35，队长执行）：用 `C:\Program Files (x86)\kkduizhan\Games\cs\hlds.exe`
以 `-game esf -heapsize 262144 +map fcx_kaioplanet` 启动，AMXX 1.10.0.5461 加载成功，
r14 四插件均初始化、`[test_ranked] 平台库已初始化 (127.0.0.1:3307)`、lock/auth 数据库连接成功，
无插件报错；记录见 `evidence/g6-hlds-boot.txt`。注意 `ape_foreshadow` 地图会触发
`Hunk_Alloc: failed on 65640 bytes`（环境内存限制，非插件缺陷），换小图即可。

**G6b 仍 BLOCKED**：TC-1..TC-6（1v1、2v2、观战、中途退出、改名、无 token guest）需要真实 HL 客户端
与 2/4 个平台账号；本机 `hl.exe` 崩 `hw.dll 0xC000001D`，无法完成真人链路。执行时至少记录：
房间 id、`server_key`、四名玩家 user_id、`amxx.log` 的 `[ESF-*]` 行、`challenge_results` 行、
客户端是否回平台。未执行前 r14 只能称“候选包”。

### 11.4 已知偏差与处理（不伪造通过）

| 偏差 | 证据 | 影响 | 处理建议 |
|---|---|---|---|
| 本轮已修（2026-11-07 06:31，team-fix） | `amxx/test_ranked.sma:235`、`:576`、`:909`、`:926`、`:952`、`:957`、`:3059`；auth `:441`、`:463`；lock `:265` | 改名日志 `rename_blocked id=`、identified 带 `slots=`、SETTLE 统一 `room attempt code`、失败重挂 12s、`verify_timeout=1`、`[ESF-LOCK]` | 已通过 33/33 静态测试与 98/98 全量 server 测试；等待独立复审与 G6b |
| 过程无参数校验 | `server/scripts/migrate.js:324` | 非法 winner/limit 可写库 | 平台侧/迁移加校验，插件侧已钳制 limit |

### 11.5 风险清单

- **凭据**：密码只在本机 `amxx.cfg`；包/文档/日志不得出现完整 token（只前 6 位）。
- **3306 暴露**：数据库必须内网/本机；跨公网无 TLS，禁止。
- **token 重放**：join 单次消费；spectate 依赖 12h 授权窗口，过期即拒。
- **平局**：阈值平局保留 b（排位 legacy），弃权平局判 a；平台展示需与插件一致。
- **观战早于 live**：平台观战 token 可在 live 前进入；live 后 2 秒内由 `test_ranked` 强制 `spectate`（`:802-813`），不计识别/统计。
- **过程参数**：`settle_challenge_match` 不校验 winner/limit；插件已钳制，平台调用方仍需自律。

```powershell
git status --short
Get-Content .omd\plans\amxx-plugin-suite\evidence\g1-build.log -Tail 30
Get-Content dist\esf-challenge-plugins-0.4.6-r14.zip.sha256
```
