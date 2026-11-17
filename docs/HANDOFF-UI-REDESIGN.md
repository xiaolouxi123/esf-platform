# 交接：UI 设计重构（给 session-1861e466）

写于 2026-11-18。这份文件是「排版/字体修复」这一轮留下的约束与现状，重构时请先读完再动手，
避免把已经修好的东西改回原样。

## 1. 本轮已修（请不要回退）

| 位置 | 问题 | 现在的做法 |
| --- | --- | --- |
| `esf-launcher/src/components/AssetLibrary.jsx` + `src/App.css` | 1322 宽窗口下资源名被挤成竖排 | 列表行改为「缩略图 + 两行信息 + 操作」三列网格 `46px minmax(0,1fr) 104px`；名称/路径 `title` 悬停看全值 |
| `src/App.css`（0.6.6 修版块，文件末尾） | 排位 hero 的积分/胜负/胜率与 1v1/2v2/开始匹配重叠被裁 | `.ranked-page > .ranked-hero, .challenge-hero, .servers-hero, .assets-hero { flex: 0 0 auto; max-height: none; }` |
| 同上 | 资源库「安装位置」路径框被 flex 压到 14px 高 | `.assets-dir { flex: 0 0 auto; min-height: 30px; }` |
| 同上 | 8~9px 中文糊成一团 | 成员头衔 / 角色徽标 / 左边快捷栏「地图·频道·插件」/ 资源类型标签 / 设置路径标签统一 10px |
| `src/components/RegisterPage.jsx` `LoginPage.jsx` `api.cjs` | 注册返回「参数不合法」看不出原因 | 客户端按服务端策略校验（≥10 位、含三类字符、不含账号名），并显示服务端 `details[0].message` |

## 2. 硬约束

1. **不要改 `amxx/*.sma`**：插件「再来一局」合并是另一条在跑的线（`amxx/test_ranked.sma` 有未完成改动）。
2. **不要动 `window.electronAPI` 的形状**：`tests/main.test.cjs` 会枚举 IPC 通道名，新增/改名要同步测试。
3. **不要改 `esf-launcher/build/installer.nsh`**：那是「更新不删游戏本体」的保护逻辑。
4. 字号改动请瞄准「层级对比」而不是整体放大：`--fs-*` 令牌在 `src/styles/tokens.css`，App.css 目前 0 处引用；要么全量迁移到令牌，要么别只改零散几处。
5. 改 1322×901 与 1100×760 两个尺寸都要看：桌面用户常见就是这两个窗口大小。

## 3. 自查工具

`esf-launcher/scripts/audit-fonts.cjs` 会把大厅/排位/约战/服务器/资源库/管理台/设置抽屉逐个渲染，
扫出「文字被裁（clip-x / clip-y）、字号 < 10px」的元素并写成 JSON：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 必须清掉，否则 electron 会当 node 跑
node_modules\electron\dist\electron.exe scripts/audit-fonts.cjs --width=1322 --height=901 --out=font-audit.json
```

截图工具：`node_modules\electron\dist\electron.exe scripts/shot.cjs --state=dashboard --click=nth:4:.nav-item`
（`--state=register` 出注册页；产物在 `shots/`，已 gitignore）。

## 4. 当前基线

- 版本 v0.6.51 已上线；下一版按 0.6.52 走（两位小数递增，不做 0.7 迁移）。
- `node scripts/check-versions.cjs` 必须 12 PASS 才能发版。
- 字体栈：`'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif`（`src/index.css:25`），不要换成在线字体。
