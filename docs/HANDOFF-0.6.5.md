# 交接：0.6.5 体验修复与 UI 审核（2026-11-17）

仓库：`C:\Users\Administrator\Desktop\esf-launcher`，分支 main，线上 0.6.4。

## 一、必须修的 4 项（本批）

1. **排位匹配成功聚焦态**
   - 文件：`esf-launcher/src/components/RankedPage.jsx`
   - 当页面处于「对局已找到 / 等待准备」状态时，只渲染对局卡（双方玩家、准备、取消对局）；隐藏 hero 段位区、战绩列表、排行榜。取消/结束后恢复。
   - 现状：全部区块同时显示，内容挤在一起（用户截图 2026-11-17）。

2. **成员分组版式**
   - 文件：`esf-launcher/src/components/MemberSidebar.jsx`、`App.css`
   - 我上一版把分组头改成 flex 按钮后，标签与计数被挤到两端、行距变大。要求：整行可点、标签左对齐、计数右对齐、组头与成员行紧凑（行高与 0.6.3 一致），组可折叠。

3. **字号回退**
   - 用户反馈 P3 统一字号后「字体变大、不生动」。把标题/正文/辅助字号与字重回退到 P2 观感，仅保留对齐与层级修正；渲染模式卡保持居中、说明单行省略。

4. **设置页对齐**
   - 文件：`esf-launcher/src/components/SettingsDrawer.jsx`、`App.css`
   - 分区标题（游戏目录/平台连接…）与内容左对齐、垂直间距统一；长路径/API 已做截断 + 悬停看全值，确认生效。

## 二、动态效果（用户已同意方向，待实现）

- 大厅龙珠：七颗缓慢自转 + 呼吸辉光，CSS/轻 canvas，不加载视频
- 背景：底图 30s 极慢平移缩放（Ken Burns）
- Logo/标题：hover 橙色辉光扫过 + 1.02 放大
- 在线状态点呼吸；数字橙色渐变、角色名角色色
- 大厅 hero 每 12s 淡入淡出轮换 2–3 张图
- 全部支持 `prefers-reduced-motion` 与设置里的「减少动态效果」开关

## 三、UI 审核（guizang）

范围 9 页：大厅、排位、约战、服务器、资源库、管理台、设置、登录、插件中心。
每页四项：信息位置与层级、交互反馈、字体与对齐、动态效果。
产出：guizang 页 + 截图标注，问题按「问题 → 影响 → 改法 → P0/P1/P2」，先不改代码。
证据用 `esf-launcher` 的 test profile + CDP 截图存 `%TEMP%\esf-test\`。

## 四、插件与线上状态

- 插件 0.53 已发布（更新源 version 0.53）：`test_ranked.amxx` 26,922 B / SHA256 `5096845D…`，含「再来一局」菜单、30 秒倒计时、最多 3 局、3-2-1 复活。
- 今日待测：单挑 1 双人打一局 → 看菜单/倒计时/再来一局/3 局上限；管理台插件面板看心跳 0.53。
- 线上平台 0.6.4（两机 config 与 latest.yml 已确认）；0.6.3 修复记录在 `esf-launcher/src/data/releases.json`。
- 更新提示按钮已改浅绿并紧跟「重启后生效」文字（提交 fec2b75/af31cab）。

## 五、纪律

- 测试账号用完立即隐藏/删除，不在成员列表留痕（当前可见 7 个真实账号）。
- 测试实例用优雅退出，禁止 taskkill 留幽灵托盘图标。
- 发布前 `node scripts/check-versions.cjs` 必须 12 PASS；Notes 必须 UTF-8 BOM，发布后用 `/api/config` 校验中文。
- 每次交付附「剩余任务表」。

## 六、剩余任务（长期）

- 老 114 残留 0.2.1 对齐（需 RDP/ops agent）
- 老 119 清理 esfops / LocalAccountTokenFilterPolicy / 安装脚本
- 真人 1v1/2v2 全链路验收
- 客户端健壮性（ErrorBoundary、渲染进程崩溃恢复）
- 后端 DB 断连重试、备份恢复演练、Node 版本收敛
- 代码签名
