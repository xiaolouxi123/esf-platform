---
title: 远程运维手法与 PowerShell 陷阱
category: pattern
tags: [remote, winrm, rdp, powershell]
updated: 2026-11-08T04:45:00+08:00
---

# 远程运维

## 三台机器的通道

| 机器 | 可用通道 | 备注 |
|---|---|---|
| 119.29.82.217（新） | WinRM（administrator）+ RDP | `New-PSSession -ComputerName 119.29.82.217 -Credential ...` |
| 119.91.99.176（老） | WinRM（esfops）+ RDP | `LocalAccountTokenFilterPolicy=1` 才允许本地管理员远程 |
| 114.132.84.150（游戏服） | **只有 RDP** | 5985 在监听但云安全组不放行；用 `\\tsclient\C` 队列代理 |

## 114 的队列代理

- `%TEMP%\esf-114\agent114.ps1` 在 RDP 会话里循环：读 `cmd-*.txt` → `cmd.exe /d /c "chcp 65001>nul & <cmd>"` → 写 `out-*.txt`。
- **mstsc 断开或关闭，代理就死**（它活在交互会话里）。要长期跑必须保持 RDP 连接（可最小化）。
- 启动代理：在远端提权 cmd 里执行
  `powershell -NoProfile -ExecutionPolicy Bypass -File "\\tsclient\C\Users\Administrator\AppData\Local\Temp\esf-114\agent114.ps1"`
- 投命令：本地写 `cmd-<id>.txt`（单行、无中文），等 `out-<id>.txt` 出现。

## RDP 自动化（Windows 到 Windows）

- 重连：`mstsc %TEMP%\esf-114-fs.rdp`（文件里含 `keyboardhook:i:2`、`redirectclipboard:i:1`、`drivestoredirect:s:C:\`）。
- 截图：先 `ShowWindow(hwnd, 9)` + `SetForegroundWindow`，再 `PrintWindow(hwnd, hdc, 2)`；整屏用 `CopyFromScreen`。
- 输入：点客户区内坐标（如 `r.Left+400, r.Top+300`）让远端获得焦点 → `SendKeys` 或剪贴板 `Ctrl+V`；
  直接 Win+R 常常落到本机（本地也弹"运行"框）。

## PowerShell 5.1 陷阱（踩过的坑）

1. **UTF-8 脚本被按 ANSI/GBK 读**：中文变量会变成乱码/解析错误。
   → 远程脚本一律 ASCII-only；中文用 base64 传参后 `[Text.Encoding]::UTF8` 解码。
2. **`Get-Content -Raw | Set-Content -Encoding utf8` 会把 UTF-8 源码双重转码并加 BOM**。
   → 文本编辑只用 edit/read 工具；构建脚本读文本后 `TrimStart([char]0xFEFF)` 再写无 BOM 副本。
3. **`Invoke-RestMethod` 遇到带 BOM 的 JSON 会返回字符串**，`$obj.version` 为空。
   → 生成端写无 BOM；消费端加 `if ($s -is [string]) { $s = ($s -replace '^\uFEFF','') | ConvertFrom-Json }`。
4. `npm` 用 `npm.cmd`；`npm.ps1` 被执行策略拦。
5. `Start-Job` 的结果跨 `pwsh` 调用不存在，别指望"后台作业"能跨命令存活。
6. `schtasks /end` 不会杀掉 node 进程；要按端口杀（`Get-NetTCPConnection -LocalPort 3000`）。
