# 0.5.21 交接单（插件中心 / 本地测试修复）

更新时间：2026-11-10 03:45 +08:00  
基线：`main` v0.5.2（b3a9359）  
发布版本：0.5.21

## 本次新增

### 启动器

- 左侧栏新增「插件中心」独立页，不再放在设置抽屉：
  - 本地四个 `.amxx` 的版本、大小、SHA256、匹配状态
  - `platform_enforce` / `ranked_auto_team` / `ranked_lock` / `platform_allow_guest` 运行配置
  - 当前服务器心跳（auth / lock / test_ranked）与全服汇总
  - AMXX 日志目录、最近日志预览
- 测试 profile 隔离：`--test-profile` 在 Chromium 启动前切换 `userData` 到 `%APPDATA%\esf-launcher-test`，settings / 登录态 / localStorage 全部独立。
- 比赛结束强杀：
  - AMXX 写 `addons/amxmodx/logs/esf_match_end.flag`
  - 启动器 2.5 秒轮询，只结束本次启动捕获的 PID，`hl.exe` 壳优先，5 秒未退抛 `GAME_STILL_RUNNING`
  - 不再使用 `taskkill /IM hl.exe /IM no_hl.exe /F /T` 全杀，避免壳与 `no_hl.exe` 重启窗口互相误杀

### 服务端

- 新增 `server/sql/013_amxx_builds.sql` 与 `esf_amxx` 授权
- 新增 `GET /api/plugins/observability`
  - 返回服务器 + `amxx_builds` 心跳
  - 状态：`ok` / `drift` / `stale` / `missing` / `local-only` / `unavailable` / `offline`
  - 无 `amxx_builds` 表时 `heartbeatAvailable=false`，不 500

### AMXX（test_ranked 1.3.4-teamtest）

- 自动分边：识别平台队伍后 `engclient_cmd(id,"jointeam",...)`，0.8 秒校验，失败 8.2 秒重试，最多 3 次
- 比赛期 `change_team` 由 `client_command` 拦截，不再依赖 `g_iWarrior`
- `checkJoint` 只拦比赛期无有效队伍的玩家（观众/淘汰者）`jointeam` 1/2/5，不再影响首次选队和复活
- `TASK_TEAM_ASSIGN=5000`、`TASK_CHALLENGE_GATE=5040`，避开观战任务 4941–4973
- `test_ranked` 心跳：`OnRankedPing` 成功后 `REPLACE INTO amxx_builds`
- HUD 非 ASCII 队伍名回退 `GOOD` / `EVIL`
- 所有 battle/challenge 结束路径都写强杀标记，不再依赖 `battle_quit_enable`

## 验证结果

- `npm.cmd run build`：通过（56 modules，JS 446.54 kB，CSS 183.40 kB）
- `node --test tests/`：3 个测试文件全过（约 15 秒）
- `npx.cmd eslint ...`：通过
- AMXX 编译：0 error（1.10.0.5392）
- 本地端到端：
  - 首次进服 / 选队 / 复活正常
  - 比赛期 V `change_team` 被拦
  - 一杀后启动器强杀进程，`no_hl.exe` 消失
  - `amxx_builds` 出现 `test_ranked / 1.3.4-teamtest`，面板心跳正常
- 未实测：HUD `?????` 若是非队伍名消息，仍需实机确认；`battle_quit_enable 0` 的强杀标记只做了代码路径覆盖，未再跑完整一局

## 产物

- 启动器：0.5.21 安装包 / blockmap / latest.yml（release 产出）
- AMXX：`ESF-AMXX-test-1.3.4/esf-challenge-plugins-0.49.0-test15.zip`（38,392 B，SHA256 `0e81b6f6...`）
- 单插件：`test_ranked.amxx`（25,058 B，SHA256 `5466b626...`）

## 风险 / 回滚

- 启动器新增 `--test-profile` 只影响测试快捷方式，正式快捷方式未改
- 生产安装版 `C:\Users\Administrator\AppData\Local\Programs\esf-launcher\ESF 平台.exe` 未动
- 回滚：安装上一版 0.5.2 安装包；插件回滚用 `_backup-*` 目录或 AMXX 分发上一版 manifest
- 本次不做数据库破坏性迁移；`013_amxx_builds.sql` 只新增表

## 主线程状态

- 代码已合入 `main`，0.5.21 发布由 `scripts/release.ps1` 执行
- 插件包 1.3.4 已打 test15；未自动发布到游戏服，需单独走 `publish-amxx.ps1`
