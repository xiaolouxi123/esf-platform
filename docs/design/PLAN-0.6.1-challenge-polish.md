# 0.6.x 约战页面与三项必做 · 方案树（待审）

> 目标：把约战创建页的排版与模式区分修好，澄清“胜利条件次数”的真实限制，并完成结算兜底、排位锁服提示、观战/AFK 真人验收。所有结论来自代码与实测，不靠猜测；发包版本号由你定。

## 诊断结论（先给证据）

### A1 排版未居中、模式无区分

- 截图里的 1v1 / 2v2 两个块是 `display:flex; align-items:center` 左对齐，没有 `justify-content:center`，也没有纵向排列，所以标题与副标题挤在左侧。
- 两个模式共用同一条 `.is-active` 样式（橙色描边 + `--accent-soft`），点击后看起来一样，无法一眼区分当前模式。
- 胜利条件行是 `1fr / 92px / auto` 三列，输入框与“次”在视觉上没有和左侧标签对齐。

**修复位置**：`esf-launcher/src/App.css`（`.challenge-mode-switch button`、`.challenge-mode-switch button.is-active`、`.challenge-victory-row`）与 `ChallengePage.jsx`（按钮加 `data-mode`）。

### A2 “胜利条件次数”到底能不能自定义

实测代码，不是猜测：

| 层 | 位置 | 实际限制 |
|---|---|---|
| 平台创建 | `server/src/services/challenges.js:65` | `3 ≤ limit ≤ 50`，写入 `challenge_configs.victory_limit` |
| 插件读取 | `test_ranked.sma:516` 的 SQL + `:581` | 开赛时读一次，`3 ≤ limit ≤ 50` 生效，否则回落 10 |
| 中途修改 | 无 | 插件只在开赛识别时读一次，**没有实时下发通道** |

结论：

1. **不是只能 1/3/5/10**。创建时填 7、15 都会按填的值结算，因为插件读的就是数据库里的值。
2. **1 次不支持**：插件下限是 3，填 1 会被回落成 10；服务端也会直接拒绝 `<3`。
3. **不能中途改**：开赛后改数据库不会影响本局，插件已经缓存了 limit。要支持实时改，需要给插件加轮询或服务器命令通道——这是新功能，不是修 bug。

### A3 插件 2v2 模式失效（本次新发现）

`test_ranked.sma` 的 SELECT 列顺序是：

```
0 r.id, 1 p.team, 2 victory_type, 3 victory_limit,
4 t.user_id, 5 r.time_limit_sec, 6 elapsed, 7 r.mode
```

但代码在 `:530` 附近用 `SQL_ReadResult(query, 5, mode, ...)` 读模式，把**剩余时间**当成了 mode；真正的 `r.mode`（index 7）没有被读取。结果：

- `equal(mode, "2v2")` 永远为 false → 2v2 房间被当成 1v1，`slots=1`；
- 玩家进 2v2 房间会看到“1v1”提示，且只等 2 人；
- 这是当前约战 2v2 不可用的直接原因。

### A4 三项必做的现状

| 项 | 现状 | 缺什么 |
|---|---|---|
| ② 结算保存失败本地兜底 | 未实现 | 启动器没有 `pending-results.json` 与重试队列 |
| ④ 排位锁服置灰 | 约战侧有占位文案，排位卡没有 | 排位卡在 `locked` 时仍显示可点入口，没有“暂时无服务器可提供排位” |
| ③ 观战/AFK 真人验收 | 接口与逻辑已有 | 没有两个真人进锁服房间的实测记录 |

## 方案树与执行顺序

```
P0 约战创建页排版与模式色（纯 UI，不改逻辑）
 ├─ 模式块居中、标题/副标题纵向排列
 ├─ 1v1 = 青色高亮，2v2 = 紫色高亮（选中态互换颜色）
 └─ 胜利条件行对齐，次数输入固定 3/5/10 快捷 + 允许 3–50
P1 插件 0.51：修正 mode 列错位（index 5 → 7）
 ├─ 2v2 房间识别 slots=2、提示“2v2”、等 4 人
 └─ 顺带输出 identified 日志便于验收
P2 结算兜底：启动器 pending-results 队列
 ├─ 结算 POST 失败写 userData/pending-results.json
 ├─ 30s / 2min / 10min 三次退避重试，成功即删
 └─ 启动时补传一次，日志可查
P3 排位锁服 UI
 ├─ 排位卡 locked 时整卡置灰 + 「暂时无服务器可提供排位」
 └─ 与约战锁服共用同一套状态文案
P4 观战 + AFK 真人验收脚本（给你照着做）
 ├─ 两名真人：一人参赛、一人观战，验证观战不进队、不算 AFK
 ├─ 观战满 4 人后第 5 人被拒绝
 └─ 结束后双方 10 秒内回平台
```

## 测试与验收（每条都要有证据）

| 编号 | 测试 | 通过标准 |
|---|---|---|
| T0 | lint + `node --test tests/` + `npm run build` | 全绿，产物可启动 |
| T1 | CDP 截图约战页 | 模式块居中；1v1 青色 / 2v2 紫色明显不同 |
| T2 | 创建 1v1 房 limit=7 | API 返回 `victoryLimit=7`，插件日志 `胜利条件：击杀 7 次` |
| T3 | 创建 2v2 房 | 插件日志 `identified ... slots=2`，进房提示“2v2” |
| T4 | 断网模拟结算失败 | `pending-results.json` 生成，恢复网络后自动补传成功 |
| T5 | 排位锁服 | 排位卡置灰并显示“暂时无服务器可提供排位” |
| T6 | 真人观战/AFK | 观战者不进队、不触发 AFK；参赛者挂机 300s 被判负且扣 30 |

T2/T3 需要一台可控的本地 hlds（不用 114），用现有 `amxx_builds` 与 `qconsole.log` 验证；T4 用断网/改错 API 地址模拟；T6 需要你和朋友各开一个客户端。

## 需要你拍板的三件事

1. **次数范围**：按现状保留 3–50 + 快捷 3/5/10，还是只允许 3/5/10（1 次不支持，要支持得同时改服务端与插件下限）？
2. **2v2 列错位修复**要进插件 0.51 并让 114 自动更新，是否同意？
3. **发包版本号**：建议 0.6.1，但由你定；我会在本地模拟全部通过后把证据发你，再等你点头部署。

## 明确不做（本轮）

- 开赛后实时修改胜利条件（需要新通道，收益低）
- 胜利条件新增“限时/占点”等新模式
- 观战拖拽调宽、观众席聊天


## 实施记录（2026-11-10 晚）

### P2 结算兜底（已完成，模拟验证）

- 插件 0.52：结算失败时写 `addons/amxmodx/logs/esf_pending_result.json`（matchId / winner / players[userId,team,afk]），BUILD 0.52；已发布并被 114 自动拉取（心跳 0.52，08:37:18）。
- 平台：新增 `POST /api/ranked/settle`（requireAuth）+ `settleFromClient()`，走 DB 过程 `settle_ranked_match` 以保留 AFK −30；重复调用幂等。
- 启动器：启动 6 秒后与检测到 `esf_match_end.flag` 时各尝试补交一次，失败按 30 秒 / 2 分钟 / 10 分钟重试，成功后删除 JSON。
- 模拟证据（match 7，A/B 各 1000 分）：首次 `alreadySettled=false`、二次 `true`；A 1000→1025（胜 +25），B 1000→970（AFK 判负 −30）；profiles 各 1W/1L，二次调用未重复加分。

### P3 排位无服置灰（已完成，模拟验证）

- `RankedPage` 收到 `servers` 后计算 `availableServers = online && !locked`；为 0 时开始匹配按钮禁用、文案「暂无可用服务器」、下方提示「暂时无服务器可提供排位，请稍后再试。」
- 模拟证据：两台服各插一场 live 排位（fcx-1v1-1 / fcx-1v1-2 → `locked=true, lockType=ranked`），真机 CDP 读取 `{disabled:true, text:'暂无可用服务器', hint:'暂时无服务器可提供排位，请稍后再试。'}`，截图 `rank-no-server.png`；随后清理模拟比赛。

### 仍待真人验收（P4）

- 观战 4 人上限与「观战 X/4」按钮、锁服排队、AFK 180s 提醒 / 300s 判负、赛后 10 秒退出与结算补交——需要你与朋友实战一局（可用 1v1 单挑房）。
