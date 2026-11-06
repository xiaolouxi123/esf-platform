# 约战模式与 AMXX 对接

本文说明 0.4.6 以后平台约战模式的完整链路，以及游戏服插件的部署方式。

## 流程

1. 房主在“约战大厅”创建房间，必须选择服务器，并设置：
   - `1v1` 或 `2v2`
   - 胜利条件 `kills` / `deaths`
   - 阈值 `3–50`
2. 双方入座、准备，房主点“开始约战”。
3. `startRoom` 将房间置为 `live`，同一服务器只能有一个 live 约战。
4. 平台为参赛者签发 `purpose=join` 的启动令牌，为观战者签发
   `purpose=spectate` 的令牌。
5. AMXX：
   - `esf_platform_auth` 校验令牌，写入 `_platform_spectator`，并在
     `platform_sync_name 1`（默认）时把游戏内昵称改成平台资料的游戏昵称。
   - `esf_ranked_lock` 识别 live challenge：
     - 参赛者放行；
     - `purpose=spectate` 放行并执行 `spectate`；
     - 其他玩家踢出。
   - `test_ranked` 进服后先做 2.2/6.2/12.2 秒识别，并每 20 秒重试一次
     （最多约 10 分钟），避免房间晚于 12 秒开赛时漏识别；识别后按房间规则
     统计击杀/死亡，达到阈值后：
     - 写 `challenge_player_stats`；
     - 调用 `settle_challenge_match` 写 `challenge_results` 并关闭房间；
     - 等结算结果落库后所有真人 `quit` 回平台；12 秒未落库则超时兜底退出。
6. 平台轮询 `/api/challenges` 的 `lastResult`，约战进入 live 后启动器自动
   进入服务器；出现新结果时强制结束仍卡住的 `hl.exe` 并弹出战绩窗口。
   参赛者和观战者都能看到结果。

## 数据表

- `challenge_rooms`：房间、模式、服务器、状态。
- `challenge_room_players`：A/B 队、准备状态。
- `challenge_invites`：邀请。
- `challenge_configs`：胜利条件与阈值。
- `challenge_results`：胜队、比分、规则、结束时间。
- `challenge_player_stats`：每名参赛者的击杀/死亡。
- `challenge_spectators`：观战者，用于赛后查看结果。
- `launch_tokens.purpose`：`join` / `spectate`。

迁移由 `server/scripts/migrate.js` 执行；当前为 29 张表。

## 关键接口

- `GET /api/challenges` → `{myRoom, rooms, invites, lastResult}`
- `POST /api/challenges` → 创建房间，必须带 `serverKey/victoryType/victoryLimit`
- `POST /api/challenges/:id/start` → 满员且全员准备后锁服
- `GET /api/challenges/:id/result`
- `GET /api/servers` → 每台服务器带
  `locked/challenge/canJoin/canSpectate`
- `POST /api/launch-token` body `{serverKey, purpose}`

## 游戏服部署

部署包：`esf-challenge-plugins-0.4.6-r12.zip`（54,991 字节，SHA256 `901A29FB76E4E0CC2B9F07EB62D1CFA42E64B99D040DDC3FD0C2A227C7788A5F`）

1. 备份 `addons/amxmodx/configs/plugins.ini` 和 `amxx.cfg`。
2. 以管理员运行 `install-amxx.bat`；测试期可直接运行 `install-amxx.bat -AllowGuest`。
3. 输入 MySQL 主机、用户、密码（不写死在脚本/分发包里）。
4. 重启游戏服。

需要四个插件：

```text
esf_platform_auth.amxx   6966 bytes
esf_ranked_lock.amxx     5027 bytes
esf_gamemode.amxx        1238 bytes
test_ranked.amxx        30443 bytes
```

游戏服数据库必须与平台 API 使用同一套 `esf_platform`，或已执行同样的
`011/012` 迁移与存储过程。

平台推广前如需让非平台玩家进服测试，在 `amxx.cfg` 加：

```cfg
platform_allow_guest "1"
```

该开关只放行进服，不伪造平台身份，也不写平台会话、排位/约战识别或战绩。
正式推广后必须改回 `0`。安装器会给缺少该配置的 `amxx.cfg` 补上默认 `0` 的行；
测试期使用 `-AllowGuest` 时，会补写 `1`，或把已有的 `platform_allow_guest "0"`
改为 `1`。含非 ASCII 字符的配置不会被自动改写，需手动修改。
过期/未知 token 在 `platform_allow_guest 1` 时也按 guest 放行，避免旧凭证把玩家挡在门外。

进服自动同步昵称由 `platform_sync_name` 控制，默认 `1`：

```cfg
platform_sync_name "1"
```

合法平台玩家验证通过后，游戏内昵称会改成平台资料里的游戏昵称；guest 不做改名。
关闭时保持客户端原名，只受 `platform_require_name` 约束。

## 已验证 / 待验证

已验证：

- 前端 lint/build、启动器测试 21+39+6、服务端 79/79。
- 生产 API `/api/challenges`、`/api/servers` 冒烟。
- AMXX 编译通过（auth 6,966；lock 5,027；test_ranked 30,443；gamemode 1,238）。
- 本地 HLDS 可加载四个插件并连接数据库。
- `platform_allow_guest` 已编译进 1.1.0 身份插件，源码回归测试 5/5 通过。
- `platform_sync_name` 默认 1，验证通过后自动同步游戏内昵称。
- `test_ranked` 约战识别在 12.2 秒后每 20 秒重试，最多 30 次；断线会清理重试任务。
- 约战击杀/死亡使用独立 `DeathMsg` 计数器，不依赖引擎 `get_user_frags`；1v1 只要识别到一名参赛者即可结算，避免某个 token 失效导致永不结算。
- 约战结算完成后强制回平台（不受 `battle_quit_enable` 影响）；新结果落库后平台强制结束卡住的 `hl.exe` 并弹结果窗口；结算等待落库，12 秒兜底。
- 身份/锁服插件踢人时写入具体 `reason` 日志，并把原因传给客户端。
- r11/r12 安装器在临时 AMXX 目录验证：`-AllowGuest` 会补写 `platform_allow_guest "1"`，也会把已有的 `"0"` 改为 `"1"`；无开关时保持 `"0"`；缺少 `platform_sync_name` 时补 `"1"`。

待验证：

- 生产游戏服替换插件后的真人 2v2 锁服/观战/结算/quit。
- 观战者在比赛结束后的结果窗口。
