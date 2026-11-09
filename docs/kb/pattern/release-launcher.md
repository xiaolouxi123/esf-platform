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

## 7. 一条命令发布（`scripts/release.ps1`）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.5.2 -Notes "0.5.2 ..."
```

- 自动完成 bump → eslint / tests / build → commit + tag + push → 等 GitHub Release → 下载校验 → 双机部署（资产、`.env`、notice、重启）→ 公网校验。
- 中文 Notes 必须来自 UTF-8 的 `%TEMP%\esf-notes-<ver>.txt`（脚本只读字节，ASCII-only）。
- **资产下载已改造**：GitHub 直连经常 0 字节卡死；现在小文件（latest.yml / blockmap）先走镜像，exe 走 `ghfast.top` / `gh-proxy.com` / 直连三源分块并发（每 10MB 一块、2 路并发、逐块 sha512 汇总校验），单块失败自动换源重试。
- 已知剩余瓶颈：仍是「本地下载 128MB → WinRM 推两台（约 4–5 分钟/台）」。下一步目标：只推新机，老机从 `https://119.29.82.217/updates/` 自取并校验，省一半时间。
