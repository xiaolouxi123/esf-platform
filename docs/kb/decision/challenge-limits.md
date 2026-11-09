# 约战限时与单服开放（0.5.23）

状态：已上线（0.5.23，2026-11-10）
相关：`decision/ranked-challenge.md`、`decision/amxx-plugins.md`

## 决定

- 约战（challenge）只开放 **「单挑 1」= `fcx-1v1-1`**，避免长期占用其它服务器。
- 每局**限时 15 分钟**（900 秒）。到点不按当前是否打完，直接按**当前击杀比分**结算：比分高者胜，平局记 A 队。
- 服务端宽限 180 秒：超过 `time_limit_sec + 180` 仍未结算的房间，列表/创建时自动置为 `closed`，防止僵尸房间占位。
- 插件里每 10 秒扣一次剩余时间；剩 5 分钟起每分钟提示；归零调用 `forceChallengeTimeout()`，与正常结算走同一个 `beginChallengeSettlement()`。

## 实现位置

| 层 | 文件 | 要点 |
| --- | --- | --- |
| 服务端 | `server/src/services/challenges.js` | `CHALLENGE_SERVER_KEY='fcx-1v1-1'`、`CHALLENGE_TIME_LIMIT_SEC=900`、`CHALLENGE_TIME_GRACE_SEC=180`；`createRoom` 拒绝其它 serverKey；`roomBase` 返回 `timeLimitSec`/`endsAt`；`expireStaleRooms()` |
| 迁移 | `server/scripts/migrate.js` | `challenge_rooms.time_limit_sec INT UNSIGNED NOT NULL DEFAULT 900` |
| 插件 | `amxx/test_ranked.sma`（分支 `fix/amxx-ascii-logs`） | `#define TASK_CHALLENGE_TIMEOUT 4950`；`g_challengeRemaining`；`OnChallengeIdentify` 读 `time_limit_sec` 与 `TIMESTAMPDIFF`；`taskChallengeTimeout()`；`forceChallengeTimeout()`；`resetAll()` 清理任务 |
| 客户端 | `esf-launcher/src/components/ChallengePage.jsx` | 服务器下拉只列 `fcx-1v1-1`；房间卡片显示「限时 15 分钟」；进行中显示「剩余 N 分钟」；创建表单默认 `serverKey='fcx-1v1-1'` |

## 边界

- `endsAt` 只在房间 `status='live'` 且 `started_at` 有值后返回；等待中的房间为空，属预期。
- 超时结算同样会写 `challenge_player_stats` 与 settle 存储过程，不跳过正常结算链路。
- 服务端限制对旧客户端也生效（约战按钮会收到 400「目前约战只开放『单挑 1』服务器」）。
- 插件 0.49 的 `BUILD` 常量为 `"0.49"`，可通过 `amxx_builds` 心跳确认线上版本。

## 验证

- `POST /api/challenges` 指定 `fcx-1v1-2` → 400；指定 `fcx-1v1-1` → 201，`timeLimitSec=900`。
- 房间关闭 → 200；`GET /api/challenges` 列表清空。
- 114 自动更新到 0.49：`amxx_builds` 两行 `platform_auth/ranked_lock = 0.49`（2026-11-10 04:47）。
- 真实客户端（test profile + 生产 API）创建房间，卡片显示「限时 15 分钟」，服务器下拉只有「单挑 1」。

## 后续可用的防占服手段（未实现）

- 等待房间 10 分钟未开始自动解散；房主掉线自动转让/关闭
- 对局中 AFK（3 分钟无输入）踢回大厅
- 同一账号冷却（房间结束后 10 分钟内不能再开）
- 每日约战场次上限、观众位上限
- 排位队列与约战互斥；凌晨时段只允许 1v1
- 管理台增加「当前约战占用」看板
