---
title: AMXX 插件：构建、日志与自动更新
category: decision
tags: [amxx, build, utf8, auto-update, heartbeat]
updated: 2026-11-08T04:35:00+08:00
---

# AMXX 插件

## 受管插件

| 插件 | 职责 |
|---|---|
| `esf_platform_auth.amxx` | 平台身份校验、guest 放行策略、写构建心跳 |
| `esf_ranked_lock.amxx` | 排位锁：有比赛时踢非参赛者；guest 凭新鲜 token 兜底放行 |
| `esf_gamemode.amxx` | 模式守卫（比赛模式/地图） |
| `test_ranked.amxx` | 排位对局流程（匹配、准备、结算上报） |

源码在仓库 `amxx/*.sma`（UTF-8），构建脚本 `amxx/tools/build-r14.ps1`。

## 构建决定

1. **直接用 UTF-8 源码编译，不再转 GBK**（0.46 起）。
   原因：构建时若先转 GBK，二进制里存的是 GBK 字节，而客户端/引擎按 UTF-8 解释 → 中文提示必乱码
   （曾出现"鎬ュ埌"这类 UTF-8 误读）。UTF-8 直编后 `client_print` 中文正常。
2. **编译器固定 `amxxpc.exe` 1.10.0.5392 + `-d1`**。
   `-d0` 会去掉调试段（体积和线上不一致），默认 `-d2` 带调试信息（体积明显变大）；`-d1` 才和线上字节一致。
3. **编译前剥离 BOM**：`[IO.File]::ReadAllText($p).TrimStart([char]0xFEFF)`，写无 BOM UTF-8 临时副本。
   原因：带 BOM 的 .sma 会报 `error 010: invalid function or declaration`。
4. Pawn 不接受 `'\''` 这种转义；拼 SQL 字符串时用数字码（39 单引号 / 34 双引号 / 92 反斜杠）。
5. **给控制台看的日志一律英文/ASCII**：HLDS 控制台把非 ASCII 按 UTF-8 解释，
   GBK 字节必然显示成 `????`；游戏内 `client_print` 用 UTF-8 中文没问题。

## 构建心跳（可观测性）

- 新机 MySQL 表：`amxx_builds(server_key, plugin, build, updated_at)`，主键 (server_key, plugin)。
- 插件连库成功后 `REPLACE INTO amxx_builds ...`，因此**不需要 RDP 也能确认线上跑的哪一版**。
- 查询：`SELECT * FROM amxx_builds ORDER BY updated_at DESC;`
- 授权是**按表枚举**的：给 `esf_amxx` 新建的表必须单独 `GRANT`，否则心跳静默失败。
  同理，插件只能查 `v_platform_users` 视图（root 定义、SQL SECURITY DEFINER），不能查 `users` 基表。

## 自动更新管线

- 发布：`scripts/publish-amxx.ps1 -Version <ver> -SourceDir <dir>`
  → 生成 `esf-challenge-plugins-<ver>.zip` + `manifest.json`（version/file/size/sha256/plugins[]）
  → 经 WinRM 上传到新机 `C:\esf\updates\amxx`。
  **manifest 必须无 BOM**（PS 5.1 的 `Set-Content -Encoding UTF8` 会加 BOM，导致 114 解析成字符串）。
- 消费：114 上计划任务 `ESFAmxxUpdate`（SYSTEM，每 10 分钟）跑 `C:\esf-agent\amxx-updater.ps1`：
  拉 manifest → 比对 `amxx-version.txt` → 下载 zip 校验 sha256 → 备份到 `C:\esf-agent\backups\<时间戳>\`
  → 替换 Desktop 下所有 `FcxServer*` 的 `esf\addons\amxmodx\plugins` → 写版本 → `taskkill rehlds`（HLSM 自动重启）。
- 日志：`C:\esf-agent\amxx-update.log`。

发布步骤见 [[release-amxx]]；线上版本见 [[current-state]]。
