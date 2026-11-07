---
title: 插件包发布手册
category: pattern
tags: [release, amxx, checklist]
updated: 2026-11-08T04:45:00+08:00
---

# 插件包发布

## 前置

- 源码改动在 `amxx/*.sma`（UTF-8，无 BOM）。
- 编译器 `amxxpc.exe` 1.10.0.5392，固定 `-d1`；构建脚本 `amxx/tools/build-r14.ps1`（会自动去 BOM、不转 GBK）。

## 构建与打包

```powershell
cd C:\Users\Administrator\Desktop\esf-launcher
powershell -NoProfile -ExecutionPolicy Bypass -File .\amxx\tools\build-r14.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-amxx.ps1 `
  -Version <ver> -SourceDir <四件套所在目录> -Notes "<变更说明>"
```

- 产出：`esf-challenge-plugins-<ver>.zip` + `manifest.json`（无 BOM！），上传到新机 `C:\esf\updates\amxx`。
- 记录 sha256/size，便于回查。

## 生效

- 114 上 `ESFAmxxUpdate` 每 10 分钟自动拉取：比对版本 → 校验 sha256 → 备份 → 替换两台服的 plugins → 杀 rehlds（HLSM 自动拉起）。
- 查看进度：`C:\esf-agent\amxx-update.log`、`C:\esf-agent\amxx-version.txt`。

## 验证（必做）

1. 日志出现 `update available: <旧> -> <新>`、`applied to FcxServer - ...`、`version recorded: <新>`。
2. 两台服插件文件大小/sha256 与包内一致（`Get-FileHash`）。
3. **构建心跳**：`SELECT * FROM amxx_builds ORDER BY updated_at DESC;` 应出现新 build。
4. 进服看控制台：插件加载无 error；中文 `client_print` 正常；排位锁不误踢。

## 回滚

- `C:\esf-agent\backups\<时间戳>\<服务器名>\` 下有上一版 .amxx；
  复制回 `esf\addons\amxmodx\plugins`，删 `amxx-version.txt`（或写回旧版本号）并让任务重跑即可。
