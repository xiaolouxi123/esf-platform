# ESF AMXX r14 一键部署（HLSM 托管服务器）

远端服务器用的是 **HL Server Monitor（HLSM）** 托管 hlds.exe，不是直接监控 hlds 进程。  
本目录把 r14 包发布到公网，并提供一条命令完成「下载 → 校验 → 安装 → 让 HLSM 自动重启」。

## 一次性执行（远端 PowerShell）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr 'https://cdn.jsdelivr.net/gh/xiaolouxi123/esf-platform@dist-amxx-r14/deploy/amxx-r14/remote-install.ps1' -UseBasicParsing -OutFile $env:TEMP\esf-amxx-install.ps1; & $env:TEMP\esf-amxx-install.ps1"
```

先看计划、不写文件：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr 'https://cdn.jsdelivr.net/gh/xiaolouxi123/esf-platform@dist-amxx-r14/deploy/amxx-r14/remote-install.ps1' -UseBasicParsing -OutFile $env:TEMP\esf-amxx-install.ps1; & $env:TEMP\esf-amxx-install.ps1 -DryRun"
```

GitHub raw 备用地址（jsDelivr 不可达时）：

```
https://raw.githubusercontent.com/xiaolouxi123/esf-platform/dist-amxx-r14/deploy/amxx-r14/esf-challenge-plugins-0.4.6-r14.zip
```

## 脚本做什么

1. 从公网下载 `esf-challenge-plugins-0.4.6-r14.zip`（41,392 B）。
2. 校验 SHA256：`d4ef8670e702e663b86d1da14f046d23af2bedc076cf168d2942c19f55156be4`。
3. 定位实例：优先用正在运行的 `hlds.exe`（HLSM 启动）反推 AMXX 目录；找不到则扫描 `Desktop`、`C:\HLDS`、`D:\HLDS`、`C:\esf` 下的 `esf\addons\amxmodx`。
4. 调用包内 `install-amxx.ps1`：先备份到 `backup-<时间戳>`，再写 4 个 `.amxx` 并登记 `plugins.ini`，幂等。
5. 结束对应 `hlds.exe`，由 HLSM 自动重启；最多等 120 秒确认端口恢复。
6. 全部动作写入 `%TEMP%\esf-amxx-r14.log`。

## 常用参数

| 参数 | 作用 |
|---|---|
| `-DryRun` | 只下载/校验/探测并打印计划，不写不重启 |
| `-NoRestart` | 只安装，不结束进程 |
| `-ServerRoot "路径"` | 显式指定服务器根目录，可传多个 |
| `-AmxModxDir "路径"` | 只装一个显式 AMXX 目录 |
| `-RegisterTask -TaskTime 05:30` | 注册每日计划任务（只在包版本变化时才动作） |
| `-UnregisterTask` | 删除计划任务 |
| `-Force` | 没检测到 HLSM 窗口时也执行重启 |

## 自动更新（可选）

```powershell
& $env:TEMP\esf-amxx-install.ps1 -RegisterTask -TaskTime 05:30
```

计划任务每天运行：插件文件哈希与公网包一致时**零写入、零重启**；不一致才安装并重启，避免无意义的掉线。

## 回滚

每个 AMXX 目录下会生成 `backup-<yyyyMMdd-HHmmss>\`（4 个旧 `.amxx`、`plugins.ini`）。  
恢复：把备份文件复制回原位，然后在 HLSM 里重启对应服务器。

## 包信息

- 包：`esf-challenge-plugins-0.4.6-r14.zip`，41,392 B
- SHA256：`d4ef8670e702e663b86d1da14f046d23af2bedc076cf168d2942c19f55156be4`
- 内容：`esf_platform_auth.amxx`、`esf_ranked_lock.amxx`、`test_ranked.amxx`、`esf_gamemode.amxx`、`install-amxx.ps1`、`README.txt`、`SHA256SUMS.txt`
- 版本：test_ranked `1.2.0-r14`，auth/lock `1.2.0`

## 注意

- 需要管理员权限（读取其它用户进程命令行、结束 hlds.exe）。
- 首次建议先 `-DryRun`，确认探测到的 AMXX 目录正是 1v1 和 测试 两个实例。
- 如果 HLSM 没有自动拉起，脚本会提示；在 HLSM 里手动重启即可。
- 本包是 r14 候选包：G1–G4 自动/静态审计通过，G6b 真人多客户端验收仍为 BLOCKED。
