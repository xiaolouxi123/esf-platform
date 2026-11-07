---
title: 排位 / 约战业务规则
category: decision
tags: [ranked, challenge, lock, token]
updated: 2026-11-08T04:35:00+08:00
---

# 排位与约战

## 战绩与结算弹窗

- 服务端：`server/src/services/ranked.js` 的 `history()` + `GET /api/ranked/history?limit=N`（需登录）。
- 客户端：`ranked:history` IPC → 排位页「我的战绩」；`RankedResultModal` 历史态显示「关闭」。
- **自动弹窗规则：只有 finish 时间在 60 分钟内的对局才自动弹出**；更早的对局只在历史列表里点开。
  理由：补发/补录的旧对局不该打断玩家。
- 已看过的对局记在 `localStorage` 的 `esf:seenRankedResult`，同一条不会重复弹。

## 约战房号（按天）

- 表 `challenge_rooms` 增加 `day_date`（本地日期）+ `day_seq`（当天序号），唯一键 `uniq_challenge_day_seq`。
- 建房时在同一事务里 `SELECT max(day_seq) ... FOR UPDATE` 取号，撞唯一键重试（最多 3 次）。
  理由：并发建房时纯自增会撞号；按天重置则符合"今天第 3 房"的产品语义。
- 管理台/客户端展示用 `displayNo`（当天序号），API 内部仍用自增 `id`。

## 入场令牌与 guest 规则

- 启动器点"开始游戏"时向平台申请 `launch_tokens`（purpose=join，绑定 server_key），
  把 `_platform_token` / `_platform_user` 写进 `launcher.cfg`，游戏用 `+exec launcher.cfg` 载入。
- 插件侧：有 token → 校验并记录平台身份；**没有 token 但有 `platform_allow_guest 1` → 按 guest 放行**（测试期）。
- `esf_ranked_lock`：本服存在 `waiting/live` 比赛时，非参赛玩家会被踢，提示 `RANKED_LOCKED: …`。

## 已知缺口与兜底（插件 0.48）

- 缺口：游戏进程没执行 launcher.cfg（旧启动器/残留 userinfo）时，玩家以 guest 身份进服，
  即使平台已给该玩家签发了令牌，也会被排位锁误踢。
- 兜底：guest 玩家若**用户名出现在本场参赛名单**，且本服 10 分钟内有**未被使用**的 launch_token →
  判定为本场参赛者并放行（写日志 `guest bound by fresh token`）。
- 长期修法：启动器把 `+setinfo _platform_token …` 直接拼进 HL 命令行，不再依赖 cfg（随下一版启动器）。
- 排位锁的 fail-open 行为：SQL 失败按 `ranked_fail_open` 处理（宁可放行，不误踢）。因此插件只能访问
  有授权的表/视图（见 [[amxx-plugins]] 的授权约束）。
