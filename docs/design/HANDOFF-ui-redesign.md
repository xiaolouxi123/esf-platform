# UI 重设计 · 新对话交接单

> 用途：把 ESF 启动器的界面重设计从旧对话切到新对话时，把这份文件（或下面「开场提示」）粘过去即可继续。

> **状态：0.5.0 · UI Beta · 界面冻结**
> P0–P9 已全部落地（10 个提交，`3e49406` → `586fc07`），版本号提到 **0.5.0**，界面进入 Beta 观察期：**暂时不再修改界面**，问题与建议走大厅频道 / 版本记录弹层，汇总后统一在 0.5.x 再动。
> 发布前只剩发版步骤（按 `docs/kb/pattern/release-launcher.md`）：改 `.env` 的 `LATEST_VERSION` / `DOWNLOAD_URL` / `RELEASE_NOTES` → `npm.cmd run dist` → 上传安装包与 `latest.yml` → 核对两台 `/api/config`。

## 一句话目标

把 `esf-launcher` 的界面从「企业后台」重做成「游戏启动器」：深色舞台、单一橙色强调、成员面板常驻、交互有反馈与音效；分 P0–P4 落地，每阶段一个可回滚的提交 + 一页归藏交付文档。

## 当前进度（截至 2026-11-08）

| 阶段 | 内容 | 状态 | 提交 |
| --- | --- | --- | --- |
| P0 | 设计令牌 + 基础表面（tokens.css、背景/卡片/标题栏底色） | ✅ 已提交 | `3e49406` |
| P1 | 外壳：胶囊导航、金币/在线胶囊、左 rail、状态栏 | ✅ 已提交 | `61ac33e` |
| P1 文档 | 归藏瑞士风交付页（前后对比 + 验收） | ✅ 已提交并登记作品库 | `fede49d` |
| P2 | 大厅内容：hero 信息层级、快捷三卡、在线房间表、公告 | ⬜ 待做 | — |
| P3 | 其余页：排位 / 约战 / 服务器 / 军备库 / 设置 / 管理台 | ⬜ 待做 | — |
| P4 | 清理 App.css 旧规则与死代码，出整套对照截图 | ⬜ 待做 | — |

线上版本仍是 **0.4.13**（P0/P1 只进了源码与 main，未发版）。所以新对话不要假设用户已经看到新壳——要发版时按 `docs/kb/pattern/release-launcher.md` 走。

## 代码与资产在哪

- 令牌：`esf-launcher/src/styles/tokens.css`（三层背景、4 档圆角、8 档字号、间距/阴影/动效/角色色）
- 外壳覆盖段：`esf-launcher/src/App.css` **文件末尾**「P1 · 外壳」注释开始的那一段（约 160 行；旧规则一条没删，全部靠覆盖生效）
- 顶栏：`esf-launcher/src/components/TitleBar.jsx`（`coins` / `online` props → `.tb-chips`）
- 大厅传参：`esf-launcher/src/components/Lobby.jsx`（`<TitleBar coins={coins} online={onlineServers.length}>`）
- 效果图（可交互 HTML + 1440×900 截图）：`docs/design/mockups/` —— `lobby / ranked / result / interaction` 四套 + 共用 `tokens.css` + `sfx/` 七个音效
- 设计审计长文：`docs/design/ESF-UI-AUDIT.md`（110 色 / 532 rgba / 27 圆角 / 37 字号 / 49 阴影的实测数据）
- 归藏交付页：`docs/design/p1-shell.html`（render 用 `dsh-guizang-design` 的 `guizang-page-skill`）

## 硬约束（用户明确要求过）

1. **右侧成员面板必须存在**，按头衔分组、在线点、角色配色、管理台入口、搜索——这是第一版被否掉的原因。
2. **要游戏感**，不要企业仪表盘：背景用 `src/assets/bg.jpg`（龙珠场景，实为 PNG），hero 用实景裁切 + 压暗，CTA 用切角橙色。
3. **成员名字按角色亮色**，支持自定义状态/活动（Discord 式，已实现：`users.status_text` + 自动活动推导）。
4. **交互要有反馈与音效**（已实现 7 个合成音 + 设置里总开关）。
5. **涉及功能改动先问用户**，只改设计/交互可以直接做。
6. 中文界面；不要引入商业组件库；不破坏现有 electron 打包流程。

## 开发与预览（重要，踩过坑）

```powershell
# 1) 先关掉已安装的 ESF 平台（单实例锁会挡掉 dev 实例）
Get-Process | Where-Object { $_.MainWindowTitle -like '*ESF*' } | Stop-Process -Force
# 2) 清掉 ELECTRON_RUN_AS_NODE（DSH 注入 =1，electron 会被当 Node 跑）
cmd /c "set ELECTRON_RUN_AS_NODE=&& cd /d C:\Users\Administrator\Desktop\esf-launcher\esf-launcher && npm.cmd run dev"
```

- 截图用 PrintWindow（`PrintWindow(hwnd, hdc, 2)`），窗口最小化时先 `ShowWindow(hwnd, 9)`
- **禁止** PowerShell 文本管道改 UTF-8 源码（`Get-Content -Raw | Set-Content -Encoding UTF8` 会双重转码成乱码）；一律用 `write` / `edit` 工具
- CSS 类名别用 `.main`（和布局的 `.main` grid 冲突）、别用 `.status`（和状态栏冲突）
- 端口：vite 可能 5173 被占而用 5174；electron 固定连 5173，起之前确认只有一个 vite

## P2 建议的验收清单

- [ ] hero：地图名 44px 主标题 + 模式标签 + 三个 HUD 数据 + 开始游戏主 CTA
- [ ] 快捷三卡：我的收藏服 / 天梯排位 / 约战大厅，信息一行可读
- [ ] 在线房间表：房间名、地图、延迟信号条、人数、星标、加入按钮对齐
- [ ] 公告与最近上架：标题层级一致，长文本可折叠
- [ ] 1180px 最小宽度不溢出；截图与效果图 `docs/design/mockups/lobby.png` 对照
- [ ] `npx.cmd eslint .` + `node --test tests/` + `npm.cmd run build` 全绿

## 开场提示（直接粘到新对话）

> 继续 ESF 启动器的 UI 重设计（P2 大厅）。先读 `C:\Users\Administrator\Desktop\esf-launcher\docs\design\HANDOFF-ui-redesign.md` 和 `docs/design/ESF-UI-AUDIT.md`，再看 `esf-launcher/src/styles/tokens.css` 与 `App.css` 末尾的「P1 · 外壳」段；P0/P1 已提交（3e49406、61ac33e），线上仍是 0.4.13，不要假设用户已看到新界面。按 P2 的验收清单做大厅内容，先改代码再截真机图；每阶段交付一页 guizang 文档（skill 在 `C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-guizang-design\skills\guizang-page-skill`），涉及功能改动先问我。
