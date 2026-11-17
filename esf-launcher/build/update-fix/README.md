# ESF 平台 · 更新修复（一次性小工具）

给 **0.6.52 及更早版本** 用：这些版本的「立即重启安装」是坏的（脚本以 detached 方式启动，
父进程退出就被系统回收），点多少次都不会装。

## 玩家怎么用
1. 下载 `ESF-Platform-UpdateFix.exe`（约 18 KB），放桌面即可。
2. 双击。它会自己找平台目录、优先用已经下好的安装包；没有才下载。
3. 自动关掉平台 → 静默就地安装 → 重新打开。全程 30 秒左右，游戏本体不会动。

## 实现要点
- 目录定位顺序：`-Dir` 参数 → 运行中的 `ESF 平台.exe` → HKCU/HKLM 卸载表里 DisplayName 含 ESF
  的 InstallLocation / DisplayIcon → `%LOCALAPPDATA%\Programs\esf-launcher` → 桌面与各盘深度 3 搜索。
- 安装包：`%LOCALAPPDATA%\esf-launcher-updater\pending\ESF-Platform-Setup-<ver>.exe`（版本必须
  不低于 latest.yml 里的最新版），否则从 `https://119.29.82.217/updates/latest.yml` 拿版本并下载。
- 关闭平台：`CloseMainWindow` 等 8 秒，不退出就强制结束（托盘里挂着也能装）。
- 安装：`Arguments = "/S /D=" + 目录`（NSIS 要求 /D= 最后且不带引号，含空格、中文都可以）。
- 日志：`%TEMP%\esf-update-fix.log`。

## 编译
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build-update-fix.ps1
```

## 为什么以后不会再全量
NSIS 安装包会把自己复制到 updater 缓存（`installer.exe`），electron-updater 拿它 + 旧版本的
`.blockmap` 做二进制差分。绿色解压/直接拷文件夹的安装没有这份缓存，第一次只能全量；
本工具跑一次就会把 0.6.53 的安装包写进缓存，之后每次都能差量。
