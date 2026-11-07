---
title: 启动器发布手册
category: pattern
tags: [release, launcher, checklist]
updated: 2026-11-08T04:45:00+08:00
---

# 启动器发布

## 1. 版本与变更

- 改 `esf-launcher/package.json` 与 `package-lock.json` 的 `version`（用 node 改 JSON，别手抖）。
- 在 `CHANGELOG.md` 顶部加一节（Added / Changed / Fixed）。

## 2. 本地验证（必须全绿再提交）

```powershell
cd C:\Users\Administrator\Desktop\esf-launcher\esf-launcher
npx.cmd eslint src main.cjs api.cjs launcher-core.cjs preload.js
node --test tests/
npm.cmd run build
```

## 3. 提交与发版

```powershell
git add -A
git commit -m "feat(launcher): <一句话>"
git push origin main
git tag v<ver>
git push origin v<ver>
```

- tag 触发 GitHub Actions `release.yml`，产出 exe + blockmap + latest.yml（并把上一版 blockmap 补传）。
- 等 release 变成 published，再下载资产复核 sha512。

## 4. 部署到两台服务器

用 `%TEMP%\esf-deploy-<ver>.ps1`（ASCII-only + 公告 base64）：
1. 拷 exe / exe.blockmap / latest.yml 到 `C:\esf\updates`（两台机）。
2. 改 `.env`：`LATEST_VERSION` / `DOWNLOAD_URL` / `RELEASE_NOTES`。
3. 杀 3000 端口进程 → `schtasks /run /tn ESFAPI` → `/health` 应为 `db=up`。
4. 更新 `platform_settings.notice`（DB 写入，走 node 脚本）。

## 5. 外网复核（缺一不可）

- `https://119.29.82.217/updates/latest.yml` 返回新版本、`Cache-Control: no-cache`。
- exe HEAD 200、`Accept-Ranges: bytes`；`Range: bytes=0-99` 返回 206。
- 两台 `/api/config` 的 `latestVersion` / `downloadUrl` / `notice` 都是新值。

## 6. 差量自检（可选但推荐）

用 electron-updater 的 `computeOperations` 复算上一版 → 本版，拼装 sha512 必须等于 `latest.yml` 的 sha512。
参考基线见 [[launcher-updater]]。
