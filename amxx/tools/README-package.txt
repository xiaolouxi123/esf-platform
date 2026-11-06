ESF 约战插件套件 r14（AMXX 1.10）— 服主安装说明
==================================================

包名：esf-challenge-plugins-0.4.6-r14.zip
适用：AMX Mod X 1.10.0.5392 / ESF（HLDS）
状态：候选包。安装后仍需按 docs/AMXX_CHALLENGE.md 的 G6 手工用例在真实服务器验收。

一、包内容
----------
解压后应得到 7 个文件：

  esf_platform_auth.amxx     平台身份校验（token、昵称同步、游戏会话）
  esf_ranked_lock.amxx       排位/约战准入锁与观战准入
  test_ranked.amxx           约战主逻辑（识别、开赛、HUD、结算、弃权）
  esf_gamemode.amxx          启动时强制 mp_gamemode（1.0.0，未改）
  install-amxx.ps1           安装/备份/校验/回滚脚本
  README.txt                 本文件
  SHA256SUMS.txt             上述文件的 SHA256（小写，两空格分隔）
  （另：zip 自身的 .zip.sha256 在压缩包外，随发布目录提供）

不要解压 .sma 源码到服务器；本包不含源码、构建目录、.env 或任何凭据。
本包的 .amxx 由 amxxpc 1.10.0.5392 以 -d1 编译（默认 -d2 在同源重复编译时会写出
不稳定的调试字符串，导致同源二进制不可复现）；请勿用其他参数重编后冒充同一发布包。

二、前置检查
------------
1. 服务器已安装 AMX Mod X 1.10.0.5392，且 modules.ini 启用了 sqlx。
2. 已有一个最小权限 MySQL 账号（默认 esf_amxx）；授权范围见 amxx/README.md。
3. 已从平台拿到本服务器的 server_key，且与数据库 servers.server_key 一致。
4. 建议先停服或在换图前安装；Windows 下正在被 HLDS 占用的 .amxx 可能无法覆盖。

三、校验压缩包
--------------
在发布目录执行（PowerShell）：

  Get-FileHash .\esf-challenge-plugins-0.4.6-r14.zip -Algorithm SHA256
  Get-Content .\esf-challenge-plugins-0.4.6-r14.zip.sha256

两者哈希必须一致；不一致不要安装，重新下载/重新构建。

四、安装
--------
1. 把 zip 解压到一个本地目录（不要直接在 zip 里运行脚本）。
2. 先空跑，确认探测到的 AMXX 目录正确：

   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-amxx.ps1 -DryRun

   如自动探测不到，显式指定（指向含 configs\plugins.ini 与 plugins\ 的那一层）：

   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-amxx.ps1 -AmxModxDir "D:\HLDS\esf\addons\amxmodx" -DryRun

3. 正式安装：

   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-amxx.ps1

   脚本会：
   - 用同目录 SHA256SUMS.txt 校验 4 个 .amxx，不匹配立即中止；
   - 把现有 4 个 .amxx、configs\plugins.ini、amxx.cfg 备份到
     <amxx>\backup-<yyyyMMdd-HHmmss>\；
   - 复制缺失/不一致的 .amxx；
   - 仅在 plugins.ini 缺少对应行时追加，重复执行不会重复追加；
   - 仅在 amxx.cfg 尚无平台 cvar 时追加一段“注释模板”，不会写入密码；
   - 任一步失败自动回滚已复制的文件。

4. 编辑 <amxx>\amxx.cfg，填入本服配置（密码只写本机，不要提交、不要发群）：

   platform_sql_host "127.0.0.1:3306"
   platform_sql_user "esf_amxx"
   platform_sql_db   "esf_platform"
   platform_sql_pass "<本机填写>"
   platform_server_key "<servers.server_key>"
   platform_enforce 1
   platform_allow_guest 0
   platform_sync_name 1
   platform_fail_open 1

   ranked_sql_host "127.0.0.1:3306"
   ranked_sql_user "esf_amxx"
   ranked_sql_db   "esf_platform"
   ranked_sql_pass "<本机填写>"
   ranked_server_key "<同一个 server_key>"
   ranked_lock 1
   ranked_fail_open 1

   迁移期如遇数据库不可用，可临时把 platform_fail_open / ranked_fail_open 保持 1，
   让已验证玩家不被锁死；不要在生产长期关闭 platform_enforce。

5. 重启服务器或 changelevel，然后控制台执行：

   amxx plugins

   应看到 4 个插件均为 running；amxx.log 中应出现
   [Platform] 验证通过、[ESF-CHALLENGE] start_full/start_partial 等行。

五、验证
--------
1. 静态/单测（在源码仓库执行）：

   node --test server/test/amxx-auth.test.js server/test/amxx-challenge.test.js server/test/amxx-query.test.js

2. 包内文件校验（PowerShell）：

   Get-Content .\SHA256SUMS.txt
   Get-FileHash .\esf_platform_auth.amxx, .\esf_ranked_lock.amxx, .\test_ranked.amxx, .\esf_gamemode.amxx -Algorithm SHA256

   4 行哈希应与 SHA256SUMS.txt 一致。

3. 游戏内：按 docs/AMXX_CHALLENGE.md 的 TC-1（1v1）、TC-2（2v2）、TC-3（观战）、
   TC-4（中途退出）、TC-5（改名）、TC-6（无 token 访客）逐项人工验收。
   没有真实 HLDS/双账号/四账号条件时，这些用例保持 BLOCKED，不要标记为 PASS。

六、回滚
--------
1. 停服或换图。
2. 找到最近一次安装生成的备份目录：

   Get-ChildItem <amxx> -Directory -Filter "backup-*" | Sort-Object Name -Descending

3. 把备份目录中的 4 个 .amxx 复制回 <amxx>\plugins\；
   plugins.ini 与 amxx.cfg 也一并复制回原位（覆盖前先另存当前版本）。
4. 若安装前没有旧版 .amxx（首次安装），则从 plugins.ini 删除
   “; === ESF r14 plugins ===” 标记块及 4 行插件名，并删除 plugins 下的 4 个 .amxx。
5. 重启服务器，确认 amxx plugins 不再加载 r14。

七、常见问题
------------
- 提示“未找到 AMXX 目录”：用 -AmxModxDir 指向 addons\amxmodx；确认该目录下存在
  configs\plugins.ini 与 plugins\。
- 提示 SHA256 不匹配：包不完整或被改动。重新解压完整包；不要手工改 .amxx。
- 安装后玩家被踢：先看 amxx.log 的 [ESF-REJECT] code=...；确认 server_key、数据库
  授权、token 是否过期。127.0.0.1 的本地房主只记录 local_bypass，不会被踢。
- 约战不开始：确认房间 status=live、server_key 匹配、双方已从平台启动；
  8 秒后会按已识别人数 start_partial 开赛。

八、安全边界
------------
- 安装器不联网、不读取远程地址、不修改 AMXX 目录以外的路径。
- 文档、脚本、包内均不含明文密码、完整 token 或数据库凭据。
- 数据库账号只授予必要的 SELECT/INSERT/UPDATE/EXECUTE；3306 不要暴露到公网。
- 本包是候选版本；生产上线前必须完成 G6 手工验收与回滚演练。
