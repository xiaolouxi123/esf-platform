# 游戏侧验收 Runbook（需本机人工执行）

- 目的：补齐 `docs/ACCEPTANCE-SIM-2026-11-11.md` 中 **API 层无法覆盖**的 4 项
- 日期：2026-11-11
- 结论先说：**这 4 项不能靠脚本代跑**。需要两个真实游戏客户端进服、看 HUD 与控制台输出，
  由人确认结果。本文档把步骤、命令、观察点与证据模板固定下来，便于一次跑完并归档。

## 为什么必须人工

| 项 | 为什么 API 测不了 |
|---|---|
| 开局自动分边 | 发生在 AMXX 插件 → ESF 引擎队伍（`jointeam`），需要真实客户端进服 |
| AFK 180s 提醒 / 300s 判负 | 计时器在插件侧，需要真实在线玩家挂机 3–5 分钟 |
| 赛后 10 秒退出与 PID 强杀 | 需要 `esf_match_end.flag` + 启动器捕获的真实游戏进程 |
| 观战 Token 实际进服 / 锁服排队进服 | 需要客户端真正连接服务器并被放行/拒绝 |

## 前置条件（已核实可用）

- `G:\FCX1\FCX7.02融合版\hl.exe` 存在；`amxxpc.exe` 1.10.0.5392 存在
- `amxx/tools/build-current.ps1` 已实测产出 0.52 的 4 个 `.amxx`（`dist/amxx-0.52/`）
- 本地 dev MySQL 可起（`npm run db:start` + `npm run migrate`），本地 API 可起
- `amxx/local-verify.cjs`：单实例 listen server 验证工具（写 `launcher.cfg` + 启动 hl.exe）
- `esf-launcher` 的 `--test-profile` 提供独立登录态，不碰正式账号

> **安全**：全程使用本地 dev 库与本地 API，**不要连生产库或生产 API**。
> 测试账号用一次性名字，跑完按 `docs/ACCEPTANCE-SIM-2026-11-11.md` 的清理方式删除。

## 关键约束：双开会互相覆盖 token

当前启动器把 `_platform_token` 写进 `<mod>/launcher.cfg`，两个 hl.exe 实例若共用同一个
mod 目录，后写的会覆盖先写的，导致第二个玩家被当成 guest（`RANKED_LOCKED` 踢出，
见 KB `debugging/known-issues` 第 2 条）。**两条可行路径**：

- **路径 A（推荐，先修代码）**：完成 KB `current-state.md` 待办 3 —— 把 token 改为启动参数
  `+setinfo _platform_token <token>`，不再依赖 `launcher.cfg`。之后两个实例各传各的 token，
  复制 mod 目录也不需要了。这是长期正解。
- **路径 B（当前不改代码也能做）**：准备两份独立的 mod 目录，各自写自己的 `launcher.cfg`：

```powershell
$root = 'G:\FCX1\FCX7.02融合版'
Copy-Item "$root\esf" "$root\esf_a" -Recurse
Copy-Item "$root\esf" "$root\esf_b" -Recurse
```

两个实例分别用 `-game esf_a` / `-game esf_b` 启动。目录会占额外空间，验收完可删除。

## 步骤

### 1. 起本地服务

```bash
cd server
npm run db:start && npm run migrate
npm start                     # 确认 .env 指向 dev 库（127.0.0.1:3307），不要指向生产
```

启动器用测试 profile：`cd esf-launcher && npm run dev:test`（独立 userData / 登录态）。

### 2. 准备两个账号与两个 token

注册两个测试账号（若配了 `INVITE_CODE` 记得带上），登录后各取一次 launch token：

```bash
curl -s -X POST http://127.0.0.1:3000/api/launch-token \
  -H "Authorization: Bearer <tokenA>" -H "Content-Type: application/json" \
  -d '{"serverKey":"fcx-1v1-1","purpose":"join"}'
```

拿到两个 32 位 hex token（120 秒内有效、单次使用）。

### 3. 装 0.52 插件到本机 listen server

把 `dist/amxx-0.52/*.amxx` 复制到 `<mod_a>/addons/amxmodx/plugins/`，
`amxx.cfg` 的 `platform_sql_host` / `ranked_sql_host` 指向 **dev 库**
（本机命名管道或 `127.0.0.1:3307`），`platform_server_key` / `ranked_server_key` 设为
`fcx-1v1-1`，`platform_enforce 0`（本机 listen server 房主踢不掉）。

### 4. 单实例先跑通（L3）

```bash
node amxx/local-verify.cjs <tokenA> 测试A esf_cell
```

观察：AMXX 日志出现 token 校验通过、`amxx_builds` 心跳写入 `0.52`、控制台中文不乱码、
`launch_tokens.used_at` 被消费、`play_sessions` 有记录。这一步不通过就不要继续双开。

### 5. 双开跑 1v1 / 2v2

- 实例 A（listen server）：`-game esf_a ... +exec launcher.cfg +map esf_cell`
- 实例 B（加入）：`-game esf_b ... +exec launcher.cfg +connect 127.0.0.1:27015`
- 各自的 `launcher.cfg` 写入各自的 token 与昵称

按平台流程建房 → 邀请 → 接受 → 准备 → 开赛，观察下表。

## 观察点与通过标准

| # | 项目 | 期望 | 证据 |
|---|---|---|---|
| 1 | 开局自动分边 | 进服后双方被分到不同队伍并正常出生，**无需手动 `jointeam`**；注意 ESF 切队有 8 秒冷却 | 游戏内截图 + 控制台输出 |
| 2 | AFK 计时 | 挂机 180 秒出现提醒，300 秒判负；结算里该玩家 `AFK` 标记、固定 −30 | 控制台日志 + `/api/ranked/history` |
| 3 | 赛后退出 | 比赛结束提示 10 秒倒计时，启动器只强杀本次捕获的游戏 PID，平台正常恢复 | 录屏 + `launcher.log` |
| 4 | 观战 / 锁服 | 非参赛者拿 `spectate` token 可进、`join` 被拒；观战上限 4 人（API 层已验，进服行为待确） | 两个客户端截图 + AMXX 日志 |

> 第 1 项目前**已知不通过**：KB `current-state.md` 待办 9 与 `debugging/known-issues` 第 8 条
> 记录 `autoPlayerStart()` 只统计引擎队伍、未下发 `jointeam`。验收时应如实记为 FAIL，
> 修复方案（engclient_cmd + 8.2 秒重试 + 校验）已写在 known-issues 第 8 条。

## 证据归档模板

```text
日期 / 执行人 / 环境（本机 listen server、dev 库、插件 BUILD）：
项目 1 开局自动分边：PASS / FAIL  证据：<截图或日志路径>  备注：
项目 2 AFK 计时：    PASS / FAIL  证据：                  备注：
项目 3 赛后退出：    PASS / FAIL  证据：                  备注：
项目 4 观战/锁服：   PASS / FAIL  证据：                  备注：
结论：可关闭 KB 待办 1 / 仍需修复项：
```

跑完把结果回写 `docs/kb/current-state.md` 待办 1 与 `docs/kb/log.md`，并更新
`docs/ACCEPTANCE-SIM-2026-11-11.md` 的「仍需验证」清单。
