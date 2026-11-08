---
title: 新引擎（ESF Engine 1.0）启动方式
category: decision
tags: [launcher, engine, engine-cfg, esf-engine]
updated: 2026-11-08T08:55:00+08:00
---

# 新引擎（ESF Engine 1.0）启动方式

## 结论

新版整合包（`ESF Engine 1.0 - LucasVilla98`）**没有 hl.exe**，入口是：

```
<根目录>\ESF.exe        169,472 B   Steam 启动壳
<根目录>\ESF_mp.exe     788,992 B   游戏本体
<根目录>\engine\engine.cfg 60 B     启动配置
<根目录>\engine.dll     399,360 B   实际被 CreateProcess 的镜像
<根目录>\steam_appid.txt           内容 225840
```

`ESF.exe` 只做三件事：检查 `steam_appid.txt`（必须是 225840）、调用 Steam 拉起、读 `engine\engine.cfg` 的 `Launcher=` 行并 `CreateProcessA`。**命令行参数会被它丢弃**——所以直接 `ESF.exe +map ... +connect ...` 只会进主菜单。

## 启动器怎么做（0.4.14 起）

`esf-launcher/launcher-core.cjs`：

- `detectEngineCfg(exePath)`：同目录有 `engine\engine.cfg` **且**有 `ESF_mp.exe` 才判定为新引擎，返回 cfg 路径。
- `applyEngineArgs(cfgPath, args)`：
  1. 首次调用把原始 cfg 备份为 `engine.cfg.esf-base`；
  2. 每次从**备份**重建（不是从上一次的结果叠加），去掉参数里的 `-game <mod>`（`Launcher` 行本来就有）；
  3. 写回 `Launcher=<原值> <额外参数>`，latin1 读写保字节。
- `restoreEngineCfg(cfgPath)`：退出时用备份覆盖回去（备份保留，下次仍从它重建）。

`main.cjs`：`spawnGame` 命中新引擎时，先写 cfg，再**不带参数**拉起 `ESF.exe`，日志记 `🎛 新引擎模式` 与最终 `Launcher` 行；`before-quit` 时还原。进程名单补了 `esf_mp.exe` 与 `engine.dll`，关闭/判活都能命中。

## 实测记录（2026-11-08）

- `applyEngineArgs` 两次调用无参数累积；还原后 cfg 与原始 60 B 完全一致。
- `engine.dll` / `ESF_mp.exe` / `ESF.exe` 在本机直接启动都秒退：Steam 未登录且账号需拥有 appid 225840；**等价于正常 GoldSrc 启动的前提条件**，不是启动器的问题。
- 朋友的 EACCES 出在他自造的 `hl.exe` 上；0.4.14 起不再需要假 hl.exe，平台直接改 cfg + 启动 `ESF.exe`。

## 注意

- 不要手动改 `engine.cfg` 后又让启动器跑：它会从 `.esf-base` 重建，手工改动会被覆盖。
- 需要恢复出厂配置时：删 `engine.cfg.esf-base`，再把 `engine.cfg` 写回 `Launcher=engine.dll -game esf`。
- 老整合包（有 hl.exe）不受影响，走原来的 argv 路径。
