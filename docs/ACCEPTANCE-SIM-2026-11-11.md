# 本机模拟验收记录（0.6.1）

- 日期：2026-11-11
- 目的：真人凑不齐时，用本机模拟替代 `docs/kb/current-state.md` 待办 1 中**可在 API 层验证**的部分
- 环境：本机 dev MySQL（`127.0.0.1:3307`，命名管道 `ESFDevMySQL`）+ 本地 Express API（`app.listen(0)`），**不连生产**
- 脚本：`server/scripts/acceptance-sim.cjs`（自建临时用户/房间/比赛，`finally` 全量清理，可重复运行）
- 复现命令：

```bash
cd server
npm run db:start        # 本环境注意：见下方「环境注意」
npm run migrate
npm run test:acceptance
```

> 环境注意：本工作区的执行环境会清理命令派生的子进程树，`db:start` 拉起的 mysqld 会被连带杀掉；
> 需要把 mysqld 作为受管后台任务直接运行（参数见 `server/scripts/dev-db.cjs` 的 `start()`）。

## 结果：9 PASS / 0 FAIL

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 观战 4 人上限 | PASS | 前 4 人 201，第 5 人 409「观战位已满（最多 4 人）」，表内 `spectators=4` |
| 2 | 观战空位释放后可再进 | PASS | leave → 3 人，join → 4 人，返回 `limit=4` |
| 3 | 锁服排队：排位等待者优先 | PASS | `count=2`，position1 `priority=ranked`，position2 `challenge` |
| 4 | 退出排队无残留占位 | PASS | 剩余 1 人 |
| 5 | 非参赛者不能补交结算（未结算比赛） | PASS | 400「只有参赛玩家可以补交结算」 |
| 6 | AFK 判负 -30 / 胜者 +25 / 普通败者 -20 | PASS | `1025 / 980 / 970`，`afk=1` 落库 |
| 7 | 战绩接口公开 AFK 标记 | PASS | `/api/ranked/history` 含 `afk:true` |
| 8 | 结算补交幂等 | PASS | 第二次 `alreadySettled=true`，rating 未变 |
| 9 | 已结算比赛的非参赛者仍被拒绝 | PASS | 400，且不返回比赛详情 |

回归：修复后 `npm test`（后端）**81/81 通过**，启动器 3 文件 / 66 检查点通过。

## 本次发现并修复的缺陷

**`/api/ranked/settle` 信息泄露（已修）**：`server/src/services/ranked.js` 的 `settleFromClient()` 原本先做
「已结算 → 返回 `alreadySettled:true` + `getMatch(matchId, null)`」短路，再校验参赛者身份。
结果任何已登录用户都能借这个分支拿到任意已结算比赛的完整详情（玩家用户名、ELO、AFK 标记）。
修复：把参赛者校验移到幂等短路之前，且合法参赛者重复提交时改用 `getMatch(matchId, callerId)`。
验收项 5/9 覆盖了修复前后两种状态。

## 仍需真人或双开 hl.exe 验证（API 层无法覆盖）

1. **开局自动分边**：AMXX 插件 `jointeam` 下发（KB 待办 9，`known-issues` 第 8 条），需进服看引擎队伍
2. **AFK 180s 提醒 / 300s 判负的计时触发**：插件侧计时；本记录只验证结算侧的 -30 规则与 AFK 标记
3. **赛后 10 秒退出与启动器按 PID 强杀**：需 `esf_match_end.flag` + 真实游戏进程
4. **观战 Token 实际进服、锁服排队时的真实进服行为**：需游戏客户端
5. 真人对局手感、外网延迟、多端并发

本机具备双开条件：`G:\FCX1\FCX7.02融合版\hl.exe` 与 `amxxpc.exe`（1.10.0.5392）均存在，
`amxx/local-verify.cjs` 可拉本机 listen server，`esf-launcher` 的 `--test-profile` 提供独立登录态。
建议用两个平台账号 + 两个 token 双开 hl.exe 跑一局，补齐 1/3/4 项。

## 结论

待办 1 中**服务端规则层已验收通过**，剩余部分属于游戏端/启动器运行时行为，
不能靠 API 测试替代；`docs/kb/current-state.md` 待办 1 已同步标注。
