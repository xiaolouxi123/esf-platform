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
     - 等结算结果落库后所有真人 `quit` 回平台；重试 3 次仍未落库则由 25 秒看门狗兜底退出（末次失败后 12 秒）。
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

## 游戏服部署（r13，历史/已过期）

> **历史/已过期**：本节只保留 r13 记录，不得按此部署。当前发布包与安装步骤见文末
> “r14 部署（当前）”。r13 的二进制不可由当前源码复现，原因见 r14 节与
> `docs/AMXX_PLUGIN_DESIGN.md` 第 11 章。

部署包：`esf-challenge-plugins-0.4.6-r13.zip`（55,562 字节，SHA256 `8FD050FA8FD85A6E34059969BEB2944F25B263AFD7872DEBA9499948513BF7E2`）

1. 备份 `addons/amxmodx/configs/plugins.ini` 和 `amxx.cfg`。
2. 以管理员运行 `install-amxx.bat`；测试期可直接运行 `install-amxx.bat -AllowGuest`。
3. 输入 MySQL 主机、用户、密码（不写死在脚本/分发包里）。
4. 重启游戏服。

需要四个插件：

```text
esf_platform_auth.amxx   6966 bytes
esf_ranked_lock.amxx     5392 bytes
esf_gamemode.amxx        1238 bytes
test_ranked.amxx        30531 bytes
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

- 前端 lint/build、启动器测试 21+39+6、服务端 81/81。
- 生产 API `/api/challenges`、`/api/servers` 冒烟。
- AMXX 编译通过（auth 6,966；lock 5,392；test_ranked 30,531；gamemode 1,238）。
- 本地 HLDS 可加载四个插件并连接数据库。
- `platform_allow_guest` 已编译进 1.1.0 身份插件，源码回归测试 5/5 通过。
- `platform_sync_name` 默认 1，验证通过后自动同步游戏内昵称。
- `test_ranked` 约战识别在 12.2 秒后每 20 秒重试，最多 30 次；断线会清理重试任务。
- 约战击杀/死亡使用独立 `DeathMsg` 计数器，不依赖引擎 `get_user_frags`；1v1 只要识别到一名参赛者即可结算，避免某个 token 失效导致永不结算。
- 约战结算完成后强制回平台（不受 `battle_quit_enable` 影响）；新结果落库后平台强制结束卡住的 `hl.exe` 并弹结果窗口；结算等待落库，25 秒看门狗兜底（末次失败后重挂 12 秒）。
- 身份/锁服插件踢人时写入具体 `reason` 日志，并把原因传给客户端。
- 排位结算等待 `settle_ranked_match` 落库后再退出，12 秒兜底；结束后改用 `disconnect`，平台根据 `lastResult` 强制收掉未退出的 `hl.exe` 并弹排位结算窗。
- 排位进行中，无平台 token 的 guest 会被锁服插件拒绝，避免 1v1 因只有一名平台玩家而永不结算。
- r11/r12/r13 安装器在临时 AMXX 目录验证：`-AllowGuest` 会补写 `platform_allow_guest "1"`，也会把已有的 `"0"` 改为 `"1"`；无开关时保持 `"0"`；缺少 `platform_sync_name` 时补 `"1"`。

待验证：

- 生产游戏服替换 r13 后的真人 2v2 锁服/观战/结算/quit。
- 两个平台账号从启动器进入排位 1v1，确认 `lastResult`、结算窗与 `hl.exe` 退出。
- 观战者在比赛结束后的结果窗口。

## r14 部署（当前）

状态：**候选包**。r14 已完成静态测试、四插件编译与打包；G6 真人用例尚未执行，
安装后必须按本节“手工验收”在真实服务器逐项确认，未执行前不得标记为生产通过。

### 包与校验

- 包名：`esf-challenge-plugins-0.4.6-r14.zip`
- 大小：41,332 字节
- SHA256：`c2d1db3a5c84b8a0b24e1ebda06ebf480d194a9c0abd762d5349bd86d7169026`
- 外层校验文件：`esf-challenge-plugins-0.4.6-r14.zip.sha256`

四个插件（由 `amxxpc` 1.10.0.5392 以 `-d1` 编译，保证同源可复现）：

| 文件 | 大小 | SHA256 |
|---|---|---|
| `esf_platform_auth.amxx` | 5,277 | `7485885cef48cfc6b14a10a9a5b6dfe0809f0d69293bfe74f7192227a08a640e` |
| `esf_ranked_lock.amxx` | 3,918 | `49e764586cb0267081ae97688d31c665ad7fb0c61f7b157488b2807ea406ec75` |
| `esf_gamemode.amxx` | 620 | `c878f71d86cb8286348fcd4bfc62b23ecdc4c874158471c36f649efccdee6a2c` |
| `test_ranked.amxx` | 22,619 | `14ad77da11a7909a93f9adeeef6c8cbe76c0bd9c1963de766f04f1998aa4042b` |

`-d1` 是刻意的：amxxpc 1.10 默认 `-d2` 在同源重复编译极小插件时会写出不稳定的调试字符串，
导致二进制不可复现；r13 的哈希因此不能由当前源码重编复现。包内 `SHA256SUMS.txt` 另含
`install-amxx.ps1` 与 `README.txt` 两行，校验时以文件为准。

校验命令：

```powershell
Get-FileHash .\esf-challenge-plugins-0.4.6-r14.zip -Algorithm SHA256
Get-Content .\esf-challenge-plugins-0.4.6-r14.zip.sha256
Expand-Archive .\esf-challenge-plugins-0.4.6-r14.zip -DestinationPath .\r14 -Force
Get-Content .\r14\SHA256SUMS.txt
Get-FileHash .\r14\*.amxx -Algorithm SHA256
```

### 安装

1. 解压到本地目录，**不要**在 zip 内直接运行脚本。
2. 空跑确认目标目录：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\r14\install-amxx.ps1 -DryRun
   ```

   自动探测失败时显式指定（指向含 `configs\plugins.ini` 与 `plugins\` 的 AMXX 根）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\r14\install-amxx.ps1 `
     -AmxModxDir "D:\HLDS\esf\addons\amxmodx" -DryRun
   ```

3. 正式安装（去掉 `-DryRun`）。安装器会：

   - 用同目录 `SHA256SUMS.txt` 校验 4 个 `.amxx`，不匹配立即中止；
   - 把现有 4 个 `.amxx`、`configs\plugins.ini`、`amxx.cfg` 备份到
     `<amxx>\backup-<yyyyMMdd-HHmmss>\`；
   - 仅复制缺失/不一致的插件；`plugins.ini` 只在缺行时追加，重复执行不重复追加；
   - `amxx.cfg` 只追加注释模板，**不写密码**；
   - 任一步失败自动回滚已复制文件。

4. 编辑 `amxx.cfg` 填入本服配置（密码只写本机）：

   ```cfg
   platform_sql_host "127.0.0.1:3306"
   platform_sql_user "esf_amxx"
   platform_sql_db   "esf_platform"
   platform_sql_pass "<本机填写>"
   platform_server_key "<servers.server_key>"
   platform_enforce 1
   platform_allow_guest 0
   platform_sync_name 1
   platform_fail_open 1

   ranked_sql_host "127.0.0.1:3306"
   ranked_sql_user "esf_amxx"
   ranked_sql_db   "esf_platform"
   ranked_sql_pass "<本机填写>"
   ranked_server_key "<同一个 server_key>"
   ranked_lock 1
   ranked_fail_open 1
   ```

5. 重启服务器或 `changelevel`，控制台 `amxx plugins` 应看到四个插件均为 `running`；
   `amxx.log` 应出现 `[Platform] 验证通过`、`[ESF-CHALLENGE] start_full/start_partial` 等行。

迁移期可临时降级：`platform_enforce 0`、`platform_allow_guest 1`、`ranked_lock 0`；
窗口结束必须恢复。完整 cvar 表见 `docs/AMXX_PLUGIN_DESIGN.md` 第 6 章。

### 回滚

1. 停服或换图。
2. 找最近备份：`Get-ChildItem <amxx> -Directory -Filter "backup-*" | Sort-Object Name -Descending`。
3. 把备份中的 4 个 `.amxx` 复制回 `<amxx>\plugins\`，`plugins.ini`/`amxx.cfg` 复制回原位。
4. 首次安装无旧插件时，删除 `plugins.ini` 中 `; === ESF r14 plugins ===` 标记块及 4 行插件名，
   并删除 `plugins` 下 4 个 `.amxx`。
5. 重启后 `amxx plugins` 不应再加载 r14。

### 手工验收（G6 TC-1..TC-6）

TC-1..TC-6 为真人用例，当前 **BLOCKED（未执行）**；服务器启动与四插件加载已实测（G6a，见
`evidence/g6-hlds-boot.txt`，2026-11-07 06:35）。执行时记录房间 id、`server_key`、
参与者 user_id、`amxx.log` 的 `[ESF-*]` 行、`challenge_results` 行与客户端是否回平台。

| 用例 | 步骤 | 期望 |
|---|---|---|
| TC-1 1v1 | 两个平台账号从启动器进入同一 live 1v1 房；打满阈值 | 单条 DHUD channel 4、两行、规则 `FIRST TO <limit> KILLS|DEATHS`；比分只随约战计数；结束后 `challenge_results` 落库、双方回平台 |
| TC-2 2v2 | 四名平台账号进入 live 2v2；先到 2 人时观察 8 秒兜底 | 满员走 `start_full`；不足走 `start_partial known/expected`；HUD 两行含 2+2 昵称；2v2 结算门槛为 known≥2 且每队≥1 |
| TC-3 观战 | 用 `purpose=spectate` token 进入 live 房 | 放行并执行 `spectate`，写 `_platform_spectator=1`；不显示参赛 HUD、不计入 stats/known/quorum、不能换队 |
| TC-4 中途退出 | 比赛中一方全部退出，20 秒内一人返回；再重复一次让其超时 | 20 秒内返回取消弃权；某队空则另一队胜、全离线按当前比分（平局判 a），日志 `forfeit_arm/forfeit_go` |
| TC-5 改名 | 比赛中客户端改名 | 立即还原为 `g_challengeName`，聊天“比赛中禁止改名”，日志 `code=RENAME_BLOCKED` |
| TC-6 无 token 访客 | 比赛 live 时无 token 进服；另用 127.0.0.1 本地房主复测 | 无 token 被 `CHALLENGE_LOCKED` 踢出；本地房主只记 `local_bypass=1`，不踢 |

补充：PRD 另有 TC-7（结算失败/超时），建议与本表同批执行；超时路径已对齐 `code=SETTLE_TIMEOUT room=<id> force_exit` 日志并在 25 秒处直接 `disconnect`（不再叠加 5 秒；`docs/AMXX_PLUGIN_DESIGN.md` 第 4.5 节）。
