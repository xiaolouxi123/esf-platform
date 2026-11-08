---
title: "P6 · 资源库与管理台"
subtitle: "两页同一种收法：数字进 hero，列表进表格，右侧补一栏说明"
kicker: "DESIGN SYSTEM · P6"
date: "2026.11.09"
author: "ESF 平台"
---

# P6 · 资源库与管理台

一句话：**这两页原来都是「卡片堆」，现在都收成「hero + 一行筛选 + 一张表」。** 资源库把封面大卡压成带缩略图的七列表，右侧多一栏安装说明；管理台把四格数字卡塞进 hero，后面每个分区共用同一张卡和同一套表头。

## 改了三个地方

- **hero 收口**：42px 标题、三格 HUD（资源库：已上架 / 模型 / 总下载；管理台：账号 / 待审资源 / 在线·启用），右侧「刷新 + 主操作」；管理台原来的四格统计卡整块删掉，第四个「今日进场」并进 hero 的标签行
- **资源库改成一张表**：一行筛选（搜索 + 类型计数 chip）+ 七列表格（缩略图 / 资源 / 落地路径 / 作者 / 大小 / 下载 / 安装），表脚写「共 N 条”；右侧 280px 常驻「安装位置」卡（模组目录、备份说明、允许的文件类型、审核规则）
- **管理台统一分区**：服务器列表、格斗等级、玩家管理、操作日志全部用同一种卡（圆角 16、1px 边、13×16 内边距）和同一套表头（10px 字距）；hero 的「登记服务器」会滚到服务器区并把登记表单点开

### 上传面板一行封面

- 原来三行字段 + 一张空封面框，现在两行：类型 / 名称 / 版本 / 说明，落地路径 / 封面（一行：预览 + 选择封面）
- 面板本身也是一张卡，和下面的表格同宽同边距

## 为什么这样改

1. **资源库的本质是「找一条，然后装」**，不是相册。没有真封面时那 224px 的组合只是留白；表格一行能同时读到路径、体积、下载量和安装按钮。
2. **数字归位。** 四张统计卡占掉 160px，而玩家只在进页面时扫一眼；塞进 hero 后整页少一层容器，也省下一次「卡片—卡片」的视线跳跃。
3. **管理台的读者是管理员，不是访客。** 主操作是「登记服务器」，所以 CTA 直接把人送到表单，而不是让人再找一次按钮。
4. **一致性比新意值钱。** P2 到 P5 已经把「hero + 一行筛选 + 表 + 卡脚」定成这套界面的语言；这两页只换内容，不发明新组件。
5. **不动逻辑。** 上传、安装、审核、改服务器全部沿用原来的函数，改动集中在 JSX 结构和 CSS。

## 代码落点

| 文件 | 改动 |
| --- | --- |
| `src/components/AssetLibrary.jsx` | 页头改 hero（三格 HUD + 刷新 + 上传资源）、筛选压成一行、卡片网格改七列表 + 表脚、右侧新增安装说明卡、上传面板改两行并把封面收成一行、`openUpload()` 滚到面板并聚焦 |
| `src/components/AdminPanel.jsx` | 页头与四格统计卡改 hero（三格 HUD + 刷新 + 登记服务器）、新增 `serversRef` 与 `gotoRegisterServer()`、服务器区包进 `.admin-servers-block` |
| `src/App.css` | 追加「P6 · 资源库 / 管理台」段约 380 行：两页去外层容器、hero 尺寸与裁切、`.assets-body` 两栏、七列表格、上传面板两行、`.admin-section` / `.admin-table` 收口、1180 断点 |
| `scripts/mock-preload.cjs` | 补 `admin.servers` mock（两台，含 `ip` / `mode` / `sort`），修掉管理台「不是函数」的报错 |

<!-- aside: 计数为什么准 -->
**计数依赖「一次取全量」。** 原来资源列表按类型发给后端过滤，前端的「模型 2 / 声音 1」只能数到当前筛选的结果。P6 改成一次取回、前端按类型筛，HUD 和 chip 上的数字才是全量的。

<!-- aside: 留白关在卡里 -->
表脚用 `margin-top: auto` 贴到卡底：条目少的时候，空白留在表格卡内部，而不是把整页撑出下半屏的空洞。

**可以看到的东西**：两页的 hero 三格、资源表七列、安装说明卡、上传面板、管理台各分区的表头，截图里都能核对；安装 / 上传 / 审核 / 登记这些动作本身没动。

## 前后对比

### 资源库

![改前 · 四张封面大卡](/Users/Administrator/Desktop/esf-launcher/docs/design/mockups/app-before-p6-assets.png)

![改后 · 一屏表格加右栏](/Users/Administrator/Desktop/esf-launcher/docs/design/mockups/app-after-p6-assets.png)

### 管理台

![改前 · 四格数字卡](/Users/Administrator/Desktop/esf-launcher/docs/design/mockups/app-before-p6-admin.png)

![改后 · 数字进 hero](/Users/Administrator/Desktop/esf-launcher/docs/design/mockups/app-after-p6-admin.png)

### 状态

![上传面板 · 两行字段](/Users/Administrator/Desktop/esf-launcher/docs/design/mockups/app-after-p6-upload.png)

![最小宽度 1180](/Users/Administrator/Desktop/esf-launcher/docs/design/mockups/app-after-p6-1180.png)

## 验收清单

- [ ] 资源库 / 管理台 hero 与大厅、排位、约战、服务器同款：42px 标题、三格 HUD、右侧刷新 + 主操作
- [ ] 资源库一屏装完：搜索 + 类型计数一行、七列表、表脚「共 N 条」、右侧安装说明卡
- [ ] 类型 chip 上的计数是全量（全部 4 / 模型 2 / 声音 1 / 特效 1 / 其它 0）
- [ ] 上传面板两行字段，封面一行；打开后自动滚到面板并聚焦第一个输入框
- [ ] 管理台四格数字卡消失，账号 / 待审资源 / 在线·启用进 hero，今日进场进标签行
- [ ] 各分区共用同一张卡与同一套表头；「登记服务器」滚到服务器区并展开表单
- [ ] 1180×780 不横向溢出，表格列不换行
- [ ] `npx eslint .` · `node --test tests/` · `npm run build` 全绿

## 下一步

P7 收尾：设置页（现在是抽屉）和登录 / 注册页还是旧语言；统一后把 P0–P6 的覆盖段合并回原位，删掉历史样式。之后再做一次全局走查：空态、错误态、加载态。
