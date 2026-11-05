# 约战模式与 AMXX 对接

本文说明 0.4.5 以后平台约战模式的完整链路，以及游戏服插件的部署方式。

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
   - `esf_platform_auth` 校验令牌并写入 `_platform_spectator`。
   - `esf_ranked_lock` 识别 live challenge：
     - 参赛者放行；
     - `purpose=spectate` 放行并执行 `spectate`；
     - 其他玩家踢出。
   - `test_ranked` 按房间规则统计击杀/死亡，达到阈值后：
     - 写 `challenge_player_stats`；
     - 调用 `settle_challenge_match` 写 `challenge_results` 并关闭房间；
     - 5 秒后所有真人 `quit` 回平台。
6. 平台轮询 `/api/challenges` 的 `lastResult`，弹出战绩窗口。
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

部署包：`esf-challenge-plugins-0.4.5-r7.zip`

1. 备份 `addons/amxmodx/configs/plugins.ini` 和 `amxx.cfg`。
2. 以管理员运行 `install-amxx.bat`。
3. 输入 MySQL 主机、用户、密码（不写死在脚本/分发包里）。
4. 重启游戏服。

需要四个插件：

```text
esf_platform_auth.amxx
esf_ranked_lock.amxx
esf_gamemode.amxx
test_ranked.amxx
```

游戏服数据库必须与平台 API 使用同一套 `esf_platform`，或已执行同样的
`011/012` 迁移与存储过程。

平台推广前如需让非平台玩家进服测试，在 `amxx.cfg` 加：

```cfg
platform_allow_guest "1"
```

该开关只放行进服，不伪造平台身份，也不写平台会话、排位/约战识别或战绩。
正式推广后必须改回 `0`。r7 安装器会给缺少该配置的 `amxx.cfg` 补上默认 `0` 的行，
已有配置不会被覆盖；测试期可在安装时直接使用 `-AllowGuest` 写入 `1`。

## 已验证 / 待验证

已验证：

- 前端 lint/build、启动器测试、服务端 59/59。
- 生产 API `/api/challenges`、`/api/servers` 冒烟。
- AMXX 编译通过。
- 本地 HLDS 可加载四个插件并连接数据库。
- `platform_allow_guest` 已编译进 1.1.0 身份插件，源码回归测试 4/4 通过。
- r7 安装器在临时 AMXX 目录验证：`-AllowGuest` 会写入 `platform_allow_guest "1"`，已有配置不会被覆盖。

待验证：

- 生产游戏服替换插件后的真人 2v2 锁服/观战/结算/quit。
- 观战者在比赛结束后的结果窗口。
