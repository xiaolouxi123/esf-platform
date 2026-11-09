---
title: 0.6 反占服与成员面板
category: decision
tags: [0.6, afk, challenge, ranked, member-panel, spectator, queue, admin]
updated: 2026-11-10T07:40:00+08:00
---

# 0.6 反占服与成员面板

用户 2026-11-10 拍板（m09075）后实施，分四期；客户端待随版本发布，服务端与插件已上线。

## 已定决策

- 排位 AFK 固定扣 30 分（`settle_ranked_match` 的 `v_afk=1` 分支），战绩页公开 `AFK` 标记。
- AFK 阈值：180 秒提醒、300 秒判负，cvar `esf_afk_warn` / `esf_afk_limit` 可调。
- 观战上限 4 人，不计入服务器 12/6 名额。
- 锁服允许排队，排位等待者优先（`ranked_queue` 存在 → `priority='ranked'`），颜色区分。
- 成员面板默认展开、全站常驻，展开 320px / 折叠 56px，`Ctrl/Cmd+M` 切换，状态写入 `memberPanelCollapsed`。
- 约战只开放 `fcx-1v1-1`，单局 900 秒，超时按比分结算（平局记 A），另有 180 秒宽限。
- 准备超时 120 秒、空房 600 秒自动解散；结束标记由插件写 `esf_match_end.flag`，启动器 10 秒后强杀。

## 实现位置

- 服务端：`server/src/routes/members.js`（约战子查询）、`server/src/services/challenges.js`（观战/排队/超时）、`server/src/routes/challenges.js`、`server/src/routes/servers.js`、`server/src/routes/admin.js`（`GET /admin/occupancy`）、`server/scripts/migrate.js`（afk 列 + 结算过程）、`server/sql/015_challenge_limits.sql`。
- 客户端：`MemberSidebar.jsx`、`Lobby.jsx`、`ServerRoomList.jsx`、`ChallengePage.jsx`、`RankedPage.jsx`、`AdminPanel.jsx`、`App.css`；`api.cjs`/`main.cjs`/`preload.js` 增加观战、排队、占用看板、比赛结束事件。
- 插件：`fix/amxx-ascii-logs` 的 `test_ranked.sma`（AFK tick 4960、结束倒计时 4961、`writeMatchEndFlag`），BUILD 0.50，包 `esf-challenge-plugins-0.50.zip`（35,880 B，sha256 `ca796ed3…`）。

## 验证

- 成员面板真机 CDP：展开 rail=320/center=872，折叠 rail=56/center=1136，约战文案「约战中 · 已准备」，排位页常驻。
- 接口：准备超时/空房均 `closed`；观战第 5 人 409；排队 join/list/leave 正常；`/api/members` 含 `challenge`。
- 管理台占用看板真机截图 `admin-occupancy.png`（1 房 + 1 排队）。
- 插件心跳：`amxx_builds` 2026-11-10 07:27:58 上报 0.50。

## 边界与遗留

- AFK 全链路需真人实测（3 分钟提醒 / 5 分钟判负 / 10 秒退出 / 战绩 AFK / -30）。
- 观战计数与排队按钮需在真实锁服场景复测。
- 本地兜底重试（DB 故障时保存结算）未实现。
- Caddy 曾自 11/7 起无触发器宕机；已恢复并新增 `ESFCaddyWatch` 每 5 分钟自愈（实测 9 秒内重启）。
- 114 ops agent 心跳停在 06:39，需 RDP 恢复。
