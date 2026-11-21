# 0.6.61 交付与验收单

- 日期：2026-11-22
- 状态：**待用户验收，未打 tag、未发布**
- 范围：约战 P1–P2、发布链路服务端 bundle 自动部署、fresh DB 迁移修复、CI 日志
- 候选 commit：`a6e3374`（已 push origin/main）
- CI：run `44960458237`，server / launcher 两个 job 均 success
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
| vite build | 通过；`dist/assets/index-ClKH98hZ.js` 584.66 kB |
| 版本一致性 | 12 PASS / 0 FAIL / 2 条本地历史 WARN（唯一来源 0.6.61） |
| 服务端 bundle | 171,175 B，sha256 `deb787500cbf7d825c813e96a555e589b6c3c8df8e7e3555086102178dbb5a67`，87 文件 / 27 SQL / 19 路由 |
| 审核版 | `resources/app/archive.cjs` 6,182 B；`dist/assets/index-ClKH98hZ.js` sha256 `8c3faf09ca759f98ffaceb595ef7bba549333d5228cb817a44932ed5ce809ac1`；package.json 0.6.61 |
| 审核版 CDP 实测 | 2026-11-22 07:13，CDP `http://127.0.0.1:9223`；已登录 yun；底部 `v0.6.61`；从大厅进入「约战」；已有房间 #4 1v1 等待中 1/2 正常渲染；`Runtime.exceptionThrown`/`Log.entryAdded` 为空；未做写操作，未关闭该房间 |

## 三、真人验收清单（逐项打勾）

1. [ ] 2v2 房：4 人进房，房主把房主转给 B 队一人；房主离开后房间仍在，新房主可开赛。
2. [ ] 私密房：建房设密码；错误密码被拒并显示行内错误；正确密码进房。
3. [ ] 进行中房间：点“观战”进服，确认最多 4 个观战位；满席按钮禁用。
4. [ ] 候场登记：同服点“排队”显示名次，可取消；确认它不会自动把人送进比赛。
5. [ ] 打完一局后点“再来一局”：新房复制模式/地图/赛制/密码，空闲队友被带入并已准备；在别的房间的队友被跳过且提示点名。
6. [ ] “战绩”弹层能看最近 20 场，点任意一场能看结算详情。
7. [ ] 1180×780 最小窗口下，约战页、房间页、结算弹层不裁切，按钮可点。

## 四、验收通过后的发布命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 `
  -Version 0.6.61 `
  -Notes "<中文更新说明，保存为 UTF-8 BOM wrapper 后传入>" `
  -Approved
```

发布脚本会依次完成：版本同步 → 重建并校验服务端 bundle → lint/test/build → commit/tag/push → 等 Actions → 下载校验 exe → 部署 217（客户端 + 服务端 bundle + migrate）→ 验证双端 `/api/config`。

若服务端 bundle 部署失败，脚本会从 `C:\esf\backups\server-src-pre-0.6.61-<stamp>.zip` 回滚并重启旧版；先看 `C:\esf\logs\server-bundle-npm.log` / `server-bundle-migrate.log`。

## 五、已知限制

- 候场只是顺序登记，不是自动排队进场；不要按“会自动开赛”验收。
- 0.6.61 的审核版和线上 0.6.60 共用同一个 API；审核版里的约战新功能依赖已部署到 217 的 0.6.61 服务端，客户端旧版看不到“再来一局”。
- 真实 FCX 模型包安装、0.6.58→0.6.60 自动更新仍按 `docs/ACCEPTANCE-DEFERRED-2026-11-22.md` 暂缓，不计入本单通过。
