# AMXX 插件

当前线上插件包：**0.52**（2026-11-10；唯一权威状态见 `docs/kb/current-state.md`）。
`esf_platform_auth.sma` / `esf_ranked_lock.sma` 的 `BUILD` = `"0.52"`，
`esf_ranked_lock.sma` 的 `VERSION` = `"1.3.0"`；`test_ranked.sma` 沿用 FCX_BATTLE `1.2.0-r14` 基线。
构建方式：amxxpc 1.10.0.5392 + `-d1` + UTF-8 无 BOM 直编（详见下文「构建链现状」）。
发布包与安装步骤见 `docs/kb/pattern/release-amxx.md`；`docs/AMXX_CHALLENGE.md`、
`docs/AMXX_PLUGIN_DESIGN.md` 是 r14 时代的历史资料，当前数字以 KB 为准。

## 文件

| 文件 | 作用 |
|---|---|
| `esf_platform_auth.sma` | 平台身份校验：读取 `_platform_token`，消费 token，同步昵称，记录在线会话 |
| `esf_ranked_lock.sma` | 比赛锁服：排位/约战 live 时只允许参赛者与持观战 token 的观众进入 |
| `esf_gamemode.sma` | 启动后兜底应用 `esf_force_gamemode`（-1 不改 / 0 混战 / 2 组队） |
| `test_ranked.sma` | 约战识别、开赛、HUD、计分、结算、弃权；排位保留原逻辑 |
| `tools/build-r14.ps1` | **历史 r14 构建脚本**（GBK 转码、产出 0.4.6-r14 包），不要用于当前 0.52；见「构建链现状」 |
| `tools/install-amxx.ps1` | 离线安装：SHA256 校验、备份、幂等复制、失败回滚、`-DryRun` |
| `tools/README-package.txt` | 打进发布包的服主安装/回滚说明 |

## 编译

需要 AMXX 1.10.0.5392 的 `amxxpc.exe` 与同目录 `include`。本仓库固定使用：

```text
G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\amxxpc.exe
G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\include
```

`amxxpc.exe` 1.10 默认按源码字节原样收录字符串；**必须用 UTF-8 源码直接编译**
（不要转 GBK），否则游戏客户端/控制台把非 ASCII 字节按 UTF-8 解释，中文必然乱码。
编辑器保存时去掉 BOM（test_ranked.sma 历史上带 BOM，会报
`error 010: invalid function or declaration`），构建脚本统一在编译前剥离：

```powershell
$src = 'amxx\test_ranked.sma'
$tmp = '.build\utf8\test_ranked.sma'
New-Item -ItemType Directory -Force (Split-Path $tmp) | Out-Null
$text = [IO.File]::ReadAllText($src).TrimStart([char]0xFEFF)
[IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))

& 'G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\amxxpc.exe' `
  $tmp -d1 -i"G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\include" `
  -o".build\utf8\out\test_ranked.amxx"
```

固定 `-d1` 是构建要求：amxxpc 1.10 默认 `-d2` 在同源重复编译极小插件时会写出不稳定的调试
字符串，导致同源二进制不可复现；`-d1` 保留行号诊断且可复现。
当前 0.52 用上面的 **UTF-8 无 BOM 直编**编译 4 个 `.sma`，再由
`scripts/publish-amxx.ps1` 打包成 `esf-challenge-plugins-0.52.zip` + `manifest.json`。

注意：`amxx/tools/build-r14.ps1` 是 r14 时代脚本，会先把源码转成 **GBK** 再编译并产出
`dist/esf-challenge-plugins-0.4.6-r14.zip`。用它构建当前版本会让客户端/控制台中文乱码
（根因见 `docs/kb/debugging/known-issues.md` 第 1 条），**不要用于 0.52 及以后**，仅作历史参考。

## 测试

```powershell
node --test server/test/amxx-*.test.js
# PowerShell 不展开通配符时用显式列表：
node --test server/test/amxx-auth.test.js server/test/amxx-challenge.test.js server/test/amxx-query.test.js
```

这些是静态回归测试，不替代 G6 真人验收（1v1、2v2、观战、中途退出、改名、guest）。

## 配置

在 `addons/amxmodx/configs/amxx.cfg` 填写（密码只写本机，不要提交）：

```cfg
// 身份校验
platform_sql_host "127.0.0.1:3306"
platform_sql_user "esf_amxx"
platform_sql_pass "<本机填写>"
platform_sql_db "esf_platform"
platform_server_key "fcx-1v1-1"
platform_enforce 1
platform_allow_guest 0
platform_sync_name 1
platform_fail_open 1
platform_debug 0
platform_require_name 0

// 排位/约战锁服与结算
ranked_sql_host "127.0.0.1:3306"
ranked_sql_user "esf_amxx"
ranked_sql_pass "<本机填写>"
ranked_sql_db "esf_platform"
ranked_server_key "fcx-1v1-1"
ranked_lock 1
ranked_fail_open 1
battle_platform_login 1
battle_quit_enable 1
battle_quit_delay 5.0

// 模式兜底（-1 不改；0 混战；2 组队）
esf_force_gamemode -1
```

| cvar | 默认 | 说明 |
|---|---|---|
| `platform_enforce` | `1` | 拒绝时是否真踢；本地调试可 `0` |
| `platform_allow_guest` | `0` | 无 token 是否放行进服；推广后必须 `0` |
| `platform_sync_name` | `1` | 验证通过后把昵称同步为平台 `game_name` |
| `platform_fail_open` | `1` | 身份数据库不可用时容灾放行 |
| `platform_require_name` | `0` | 强制游戏内昵称与平台一致 |
| `ranked_lock` | `1` | 是否启用排位/约战锁服 |
| `ranked_fail_open` | `1` | 锁服数据库不可用时容灾放行 |
| `BattleLimt` | `10` | legacy 排位淘汰阈值（拼写沿用历史） |
| `battle_quit_enable` | `1` | 排位结束是否 quit；约战始终回平台 |
| `battle_quit_delay` | `5.0` | quit 延迟秒，给平台读 `lastResult` |

`ranked_sql_host` 必须和 `platform_sql_host` 指向同一个 MySQL（可写 `host:port`，例如
`127.0.0.1:3307`）；不要填游戏服自己的公网 IP。两套配置不一致时，`test_ranked` /
`esf_ranked_lock` 会报 `Unknown MySQL server host` 或 `[ranked] 数据库连接失败`。

## 数据库最小权限

账号 `esf_amxx` 只授予以下权限（host 限定为游戏服内网地址）：

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

不要授予 `ALL`、`DROP`、`ALTER`、`CREATE`、`FILE`、`PROCESS`。MySQL 3306 只监听内网/本机，
禁止公网直连；跨公网无 TLS，不可接受。

## 行为

- 合法平台玩家验证通过后，游戏内昵称同步为平台资料里的游戏昵称（≤31 UTF-8 字节）。
- 进服后 2.2/6.2/12.2 秒识别约战，之后每 20 秒重试一次，最多约 10 分钟。
- 满员立即开赛；8 秒时若已识别人数满足 quorum（1v1 known≥1；2v2 每队≥1 且 known≥2）则 `start_partial` 开赛，否则进入 20 秒 quorum 宽限，不足按 R8 弃权规则结算。
- 约战 HUD 为单条 DHUD：channel 4、x=-1.0、两行、ASCII 规则 `FIRST TO <limit> KILLS|DEATHS`；
  观战者不显示；每 1 秒刷新一次，击杀/死亡后 1 秒内更新比分。
- 比赛期间非参赛玩家进服会被提示并踢出；改名会被还原并提示“比赛中禁止改名”。
- 一方在线参赛者归零进入 20 秒弃权宽限；期间回来可取消。超时后该队判负、另一队胜；全员离线按当前比分，平局判 a。
- 结算先写 `challenge_player_stats`，再调 `settle_challenge_match`；失败固定 2 秒重试 3 次（共 4 次尝试），
  仍失败后重挂 12 秒兜底并回平台；结算开始另挂 25 秒看门狗防止回调丢失。

## 排障

- `Unknown column 't.user_id' in 'where clause'`：旧版锁服 SQL 缓冲区只有 640，查询被截断；
  r14 为 1536（`esf_ranked_lock.sma:134-153`）。
- `Info string length exceeded`：旧版身份插件对普通进服也写 `_platform_spectator=0`；
  r14 仅观战者写入。
- 玩家被踢：先看 `amxx.log` 的 `[ESF-REJECT] code=...`，再核对 `server_key`、数据库授权、
  token 是否过期；127.0.0.1 本地房主只记录 `local_bypass=1`。
- 约战不开始：确认房间 `status=live`、`server_key` 匹配、双方从平台启动；8 秒后应出现
  `start_partial`。
- 结算不结束：确认已执行包含 `settle_challenge_match` 的迁移；12 秒后应出现
  `[ESF-SETTLE] code=SETTLE_TIMEOUT` 并结束本场。

## 注意

- 本地 listen server 的房主无法被引擎踢出，本地测试请把 `platform_enforce` 设为 `0`。
- `platform_allow_guest "1"` 只放行进服，不伪造身份、不写平台会话/战绩；上线后必须改回 `0`。
- `platform_sync_name "1"` 会在验证通过后把游戏内昵称改成平台资料昵称；关闭时保持客户端原名。
- 机器人没有平台 token，不参与战绩回写。
- 源码中文日志建议统一英文，避免 HLDS 控制台按 UTF-8 解释 GBK/混合字节时乱码；
  `client_print` 等游戏内文案用 UTF-8 中文即可（客户端按 UTF-8 渲染）。
- 两个插件连上数据库后会向 `amxx_builds` 表写心跳（`server_key, plugin, build`），
  RDP 不可达时用它确认线上实际运行的构建版本。
- 无 `_platform_token` 的玩家进服时，若数据库里存在同名参赛记录且本服有 10 分钟内
  未使用的 token，`esf_ranked_lock` 会按「参赛玩家兜底」放行；否则按 `RANKED_LOCKED` 踢出。
- 旧发布包的 SHA 只对应旧源码，不要拿来校验当前包。

## 构建链现状（2026-11-11）

- **当前线上 0.52**：`amxxpc.exe` 1.10.0.5392 + `-d1` + **UTF-8 无 BOM 直编**，
  再由 `scripts/publish-amxx.ps1` 打包成 `esf-challenge-plugins-0.52.zip` + `manifest.json`，
  经 114 的 `ESFAmxxUpdate` 自动生效。权威状态见 `docs/kb/current-state.md`，
  发布步骤见 `docs/kb/pattern/release-amxx.md`。
- **`amxx/tools/build-r14.ps1` 是 r14/0.4.6 时代的历史脚本**：转 GBK 后编译、产出
  `esf-challenge-plugins-0.4.6-r14.zip`，**不要用于 0.52 及以后**，仅作历史参考。
- 2026-11-11 已把线上分支 `fix/amxx-ascii-logs`（BUILD 0.52）合入 main，
  main 自此是插件源码的唯一基线；`amxx/tools/` 随合并进入仓库，但不代表它当前可用。

## 服务器插件自动更新（2026-11-07 起）

链路：本机打包上传 → 新平台静态目录 → 114 定时任务拉取替换 → HLSM 自动重启游戏服。

1. 发布（本机，打包 4 个受管插件：`esf_gamemode` / `esf_platform_auth` / `esf_ranked_lock` / `test_ranked`）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-amxx.ps1 `
     -SourceDir C:\esf-build\amxx -Version 2026.11.08-1 -Notes "本次改动"
   ```

   产物落到 `C:\esf-release\amxx\`，并经 WinRM 上传到新机 `C:\esf\updates\amxx\`
   （`esf-challenge-plugins-<ver>.zip` + `manifest.json`，manifest 必须无 BOM）。

2. 服务器目录：`https://119.29.82.217/updates/amxx/manifest.json`、
   `https://119.29.82.217/updates/amxx/esf-challenge-plugins-<ver>.zip`（Caddy HTTPS 反代，
   见 `docs/kb/environment/servers.md`）。

3. 114 游戏服：计划任务 `ESFAmxxUpdate`（SYSTEM，每 10 分钟）跑
   `C:\esf-agent\amxx-updater.cmd` → `amxx-updater.ps1`：
   比对 `C:\esf-agent\amxx-version.txt` → 下载并校验 sha256 → 备份到
   `C:\esf-agent\backups\<时间戳>\<服务器名>\` → 替换两套 `FcxServer*` 的
   `esf\addons\amxmodx\plugins\` → 写版本 → 杀 `rehlds.exe` 让 HLSM 2.4 重启。
   日志：`C:\esf-agent\amxx-update.log`。

4. 注意：`amxx.cfg` 里的 SQL host/密码由迁移维护，插件包不包含 `amxx.cfg`，
   更新不会覆盖数据库配置。

5. 控制台编码：HLDS 控制台按 UTF-8 解释非 ASCII，GBK 编译出的中文日志会显示成
   `??λ`；`qconsole.log` 里仍是 GBK 字节（GBK 编辑器可读）。给控制台看的日志请用英文/ASCII。
