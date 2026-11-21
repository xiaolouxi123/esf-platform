# 0.6.61 交付与验收单

- 日期：2026-11-22
- 状态：**用户已验收（2026-11-22 07:28），已发布 0.6.61（2026-11-22 07:50）**
- 范围：约战 P1–P2、建房目标地图跟随服务器、发布链路服务端 bundle 自动部署、fresh DB 迁移修复、CI 日志
- 发布 commit / tag：`413b286` / `v0.6.61`；main 在发布后追加 `1a2f7b8`（日期同步）与 `6c8b611`（发布脚本缓存修复）
- CI：验收基线 run `44960458237`；发布构建 run `44963191515` 均 success
- 审核版：`C:\Users\Administrator\Desktop\ESF平台-审核版`

## 一、这一版做了什么

### 约战 P1–P2

- 进行中房间可直接观战，观战位 4 人，满席禁用并标明。
- 房主可把房间转让给任意队员；房主直接离开时自动交给最早加入的队友，不再散房。
- 私密房：4–32 位密码，列表显示“私密”，加入必须输入正确密码。
- 约战页“正在进行”支持服务器级候场登记：显示当前名次，可取消；**只登记顺序，不占座、不自动进场**。
- 结算弹层“再来一局”：复制模式/地图/赛制/密码，把仍在空闲的队友带进新房并置为已准备。
- 最近 20 场约战战绩，含胜负、模式、地图、对手、比分、时间。
- 等待房间表补 table/row/columnheader/cell 语义；搜索、全部/可加入/已满筛选；Esc/焦点循环/焦点归还。
- 建房「目标地图」改为只读跟随所选服务器：显示 A2S 上报的当前地图，切换服务器即时更新；无在线约战服时显示「服务器未上报」并禁用创建，不再让人手填地图。

### 工程与发布

- 修复 fresh DB 迁移顺序：`users.status_text` 等 `combat_level`、`ranked_match_players.afk` 等建表完成后再补列；本机在 3308 临时 MySQL 上连续两次迁移通过（48 表 / 1 台服务器）。
- `release.ps1` 现在校验 `deploy/esf-server-bundle.zip` 的 sha256/size/manifest，再随客户端一起部署服务端 bundle：备份源码 → 停 API → 解压 → `npm install` → `migrate.js` → 失败自动回滚并重启旧版；`-SkipServerDeploy` 可只发客户端。
- CI 的 server job 保留 `migrate` 日志，失败时在 job 摘要直接输出错误行。

## 二、自动化证据

| 项目 | 结果 |
|---|---|
| 服务端测试 | 114/114 通过（`cd server && npm.cmd test`，含新增候场登记测试） |
| 启动器测试 | 11 个测试文件、44 项检查全过（`cd esf-launcher && npm.cmd test`） |
| eslint | 通过 |
| vite build | 通过；`dist/assets/index-BUy3lrK-.js` 584.65 kB |
| 版本一致性 | 12 PASS / 0 FAIL / 2 条本地历史 WARN（唯一来源 0.6.61） |
| 服务端 bundle | 171,175 B，sha256 `deb787500cbf7d825c813e96a555e589b6c3c8df8e7e3555086102178dbb5a67`，87 文件 / 27 SQL / 19 路由 |
| 审核版 | `resources/app/archive.cjs` 6,182 B；`dist/assets/index-BUy3lrK-.js` 584,652 B，sha256 `765846a71b8b80ef45ab378d3357bbf67a843fe91211d8503f1dd7f10af0bb50`；package.json 0.6.61 |
| 审核版 CDP 实测 | 2026-11-22 07:32，CDP `http://127.0.0.1:9223`；已登录 yun；底部 `v0.6.61`；进入「约战」建房区显示「目标地图 pkwlz_9 / 实时」；服务器选择器从 `[ESF-EVM]单挑房[2]` 切到 `[ESF-EVM]单挑房[3]` 后地图更新为 `pkylz_9`；`Runtime.exceptionThrown`/`Log.entryAdded` 为空；未做写操作 |

## 三、真人验收项与自动化覆盖

| 验收项 | 自动化覆盖（server/test/challenges.test.js） |
|---|---|
| 2v2 转让/房主离开不散房 | `约战：房主可转让，房主离开不散房`；换队见 `约战：2v2 换队，换队取消准备，1v1 拒绝换队` |
| 私密房密码 | `约战：私密房需要正确密码，列表不泄露密码哈希` |
| 观战位 4 人 | `约战：进行中列表、观战位与个人战绩` |
| 候场登记/取消/名次 | `约战：候场登记按先后排序，可查询与取消` |
| 再来一局带队友 | `约战：房主再来一局会复制新房并带入原成员` |
| 最近 20 场战绩 | `约战：进行中列表、观战位与个人战绩` |
| 表格语义/键盘 | 代码已有 `role=table/row/columnheader/cell`；需人工 Tab/读屏确认 |
| 1180×780 不裁切 | 需人工确认 |
| 目标地图跟随服务器 | 无前端单测；审核版 CDP 实测切服后地图同步，空服禁用逻辑在 `ChallengePage.jsx` 的 `selectedServerKey` 门禁 |

## 四、真人验收清单（逐项打勾）

1. [x] 2v2 房：4 人进房，房主把房主转给 B 队一人；房主离开后房间仍在，新房主可开赛。
2. [x] 私密房：建房设密码；错误密码被拒并显示行内错误；正确密码进房。
3. [x] 进行中房间：点“观战”进服，确认最多 4 个观战位；满席按钮禁用。
4. [x] 候场登记：同服点“排队”显示名次，可取消；确认它不会自动把人送进比赛。
5. [x] 打完一局后点“再来一局”：新房复制模式/地图/赛制/密码，空闲队友被带入并已准备；在别的房间的队友被跳过且提示点名。
6. [x] “战绩”弹层能看最近 20 场，点任意一场能看结算详情。
7. [x] 等待房间表：Tab 能聚焦房间行和操作按钮，回车/空格可加入；读屏能读出 `columnheader` / `cell` 语义；Esc 关闭弹层后焦点回到触发按钮。
8. [x] 1180×780 最小窗口下，约战页、房间页、结算弹层不裁切，按钮可点。
9. [x] 建房区「目标地图」只读，切换比赛服务器时地图跟着变；确认没有在线约战服时显示“服务器未上报”且创建按钮禁用。

## 五、验收通过后的发布命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 `
  -Version 0.6.61 `
  -Notes "<中文更新说明，保存为 UTF-8 BOM wrapper 后传入>" `
  -Approved
```

发布脚本会依次完成：版本同步 → 重建并校验服务端 bundle → lint/test/build → commit/tag/push → 等 Actions → 下载校验 exe → 部署 217（客户端 + 服务端 bundle + migrate）→ 验证双端 `/api/config`。

若服务端 bundle 部署失败，脚本会从 `C:\esf\backups\server-src-pre-0.6.61-<stamp>.zip` 回滚并重启旧版；先看 `C:\esf\logs\server-bundle-npm.log` / `server-bundle-migrate.log`。

## 五之二、发布结果（2026-11-22 07:50）

- GitHub release：tag `v0.6.61` → `413b286`，release run `44963191515` success。
- 安装包：`ESF-Platform-Setup-0.6.61.exe`，129,198,606 B，sha512 `nmFkSkmqU+EMRkABMIb6i3TlJJoyWnWyAkYJbldlDidvUEu5wU7djw5h/yHj33WiSFyeGLBN0KYwFfOcVyvcJw==`。
- 217 更新目录：远端 exe 大小与 sha512 同上；公网 `/updates/latest.yml` 200，`/updates/ESF-Platform-Setup-0.6.61.exe` HEAD 200 / 129,198,606；Range 206。
- 双端配置：`http://119.29.82.217:3000/api/config` 与 `http://119.91.99.176:3000/api/config` 均 `latestVersion=0.6.61`，`releaseNotes` 208 字符，中文正常。
- 发布事故与修复：首次构建（tag `87130c0`）的版本说明因 PowerShell 5.1 默认 ANSI 读取无 BOM 脚本而乱码；修正后重打 tag 到 `413b286`。第二次部署时 `release.ps1` 通过镜像拿到旧 `latest.yml`（同版本号、旧 sha512/size），误判旧安装包“already present and verified”并部署了 129,199,400 B 的旧包；已强制从 GitHub 直接下载新包、核对 sha512 后覆盖 217。`scripts/release.ps1` 已改为对 `latest.yml` / blockmap / exe 分片加 cache-busting 查询，并校验 `latest.yml` 的 version，避免同版本旧元数据再次误判。
- 已安装旧 0.6.61 的用户不会自动重装：新旧包功能一致，差异只在客户端内置版本记录；新下载用户拿到的是修正包。

## 六、已知限制

- 候场只是顺序登记，不是自动排队进场；不要按“会自动开赛”验收。
- 目标地图取自服务器 A2S 轮询结果（后端 15 秒一轮），刚换图时最多滞后一个轮询周期；这是“服务器当前地图”，不是建房者自选地图。
- 验收时线上还是 0.6.60；现在线上已是 0.6.61，审核版与线上共用同一个 API。客户端旧版看不到“再来一局”。
- 真实 FCX 模型包安装、0.6.58→0.6.60 自动更新仍按 `docs/ACCEPTANCE-DEFERRED-2026-11-22.md` 暂缓，不计入本单通过。
