---
title: 启动器自动更新与版本策略
category: decision
tags: [launcher, updater, electron-builder, blockmap, release]
updated: 2026-11-08T04:30:00+08:00
---

# 启动器自动更新

## 栈

- Electron + electron-builder（NSIS 安装包），更新由 `electron-updater` 6.8.3 驱动。
- 发布：GitHub Actions（`.github/workflows/release.yml`，tag `v*.*.*` 触发）→ 产出
  `ESF-Platform-Setup-<ver>.exe`、`.exe.blockmap`、`latest.yml` → 上传 release，
  并把**上一版**的 blockmap 补传到新 release（差量需要旧 blockmap 在同一个 release 里）。
- 两台服务器从 GitHub 下载三件套放入 `C:\esf\updates`，`.env` 写
  `LATEST_VERSION` / `DOWNLOAD_URL` / `RELEASE_NOTES`，然后用 platform_settings.notice 广播。

## blockmap 格式（验证差量时必须知道）

- `.exe.blockmap` 是 **gzip 压缩的 JSON**，`checksums` 是 **24 字符 base64 = blake2b-18**（不是 sha256）。
- 分块是 **Rabin 内容定义分块**：min 8192 / avg 16384 / max 32768，window 64。
- 校验差量是否正确：用 electron-updater 的 `downloadPlanBuilder.computeOperations` 复算，
  拼装结果的 sha512 必须等于 `latest.yml` 里的 `sha512`。

实测基线（用于回归）：
- 0.4.8 → 0.4.9：40 个操作，复制 121,553,469 B，下载 7,016,677 B。
- 0.4.9 → 0.4.10：25 个操作，复制 125,286,940 B，下载 3,283,667 B，拼装 128,570,607 B。

## 关键决定

1. **客户端默认 API 改为 `http://119.29.82.217:3000`，并自动迁移旧默认值**
   （`store.cjs`：`LEGACY_DEFAULT_API_BASE_URL` + `migrateApiBaseUrl`）。
   理由：迁机后老默认值会把所有客户端指向即将下线的机器，且不能让用户手动改。
2. **更新缓存自校验**（`sanitizeUpdaterCache`）：若
   `%LOCALAPPDATA%\<app>-updater\current.blockmap` 与同目录 `installer.exe` 不配套
   （sum(block size) 与 installer.exe 实际大小不符），就地清掉缓存。
   理由：旧 blockmap + 新 installer 会让差量拼装 sha512 不匹配，electron-updater 静默回落全量下载
   （曾表现为"下载一半变全量"）。
3. **`LOCALAPPDATA` 必须从 `process.env` 取**，不能用 `app.getPath('localAppData')`（Electron 无此 key，
   日志出现 `Failed to get 'localAppData' path`，缓存校验整个失效）。
4. **结算弹窗只对 60 分钟内的新对局自动弹**，历史战绩点开是"历史态"（见 [[ranked-challenge]]）。
5. 版本号语义：0.4.x 迭代只加功能/修 bug，不破坏配置；旧默认 API 迁移代码随版本保留。

## 已知陷阱

- 发布后必须验证：`latest.yml` 版本、`Cache-Control: no-cache`、exe HEAD 200、Range 206、
  两台 `/api/config` 返回新版本。缺一项都可能让客户端拿到旧 feed。
- 发布流程见 [[release-launcher]]；已知问题见 [[known-issues]]。
