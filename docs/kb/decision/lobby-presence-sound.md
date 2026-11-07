---
title: 状态行与界面音效（0.4.12）
category: decision
tags: [launcher, presence, sound, ui]
updated: 2026-11-08T07:00:00+08:00
---

# 状态行与界面音效（0.4.12）

## 决定

| 决定 | 取值 | 理由 |
|---|---|---|
| 自定义状态存储 | `users.status_text VARCHAR(48) NULL`，`AFTER combat_level` | 一句话状态，48 字够 Discord 式"在做什么"，不占索引 |
| 写入接口 | `PUT /api/members/me/status`（`requireAuth`） | 只能改自己；去控制字符、折叠空白、trim 后 slice(0,48)；空串存 NULL |
| 对外字段 | `/members`、`/members/:id`、`/presence` 均返回 `statusText` | 成员面板与在线列表共用同一字段 |
| 自动活动 | 客户端 `activityOf()` 推导：`匹配中/待准备/比赛中 + 模式` → `游戏中 + 服务器/地图` → `在大厅` → `离线` | 不新增服务端字段，减少写入；状态行优先显示自定义状态，其余显示自动活动 |
| 音效开关 | `settings.soundEnabled`，默认 `true` | 默认开箱即用，玩家可在设置里关 |
| 音效文件 | 7 个 16-bit 44.1k 单声道 WAV，打包进 `src/assets/sfx/` | 自制，无版权问题；体积合计约 216 KB |
| 音量 | hover .22 / click .5 / tab .42 / match .55 / win .6 / lose .55 / error .45 | 压低，不盖游戏声 |
| 去抖 | 同一音效 60ms 内只播一次 | 连续悬停不重播 |
| 触发点 | tab 切页、按钮与成员行 click、`startLocal/joinServer`、匹配成功、结算弹窗（非历史态）胜负、toast error | 只在有意义的动作上发声 |

## 实现位置

- 服务端：`server/src/routes/members.js`（含 PUT status）、`server/src/routes/presence.js`、`server/scripts/migrate.js`（ensureColumn）
- 客户端：`esf-launcher/src/lib/sfx.js`、`App.jsx`、`TitleBar.jsx`、`Lobby.jsx`、`RankedResultModal.jsx`、`SettingsDrawer.jsx`、`MemberSidebar.jsx`
- 样式：`App.css` 的 `.switch`、`.member-status`、`.member-status-edit`、`.field--row`

## 版本

- 0.4.12（提交 43e4b83，tag v0.4.12）：ESF-Platform-Setup-0.4.12.exe 128,739,708 B，blockmap 135,547 B
- 差量基线：0.4.11 → 0.4.12：30 个操作，下载 7,606,741 B，复制 121,132,967 B，拼装 sha512 与 latest.yml 一致

## 相关

- [[launcher-updater]]：发布与差量校验流程
- [[current-state]]：线上版本与数字
