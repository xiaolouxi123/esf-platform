---
name: ESF 平台（ESF Platform Launcher）
description: 深色舞台、橙光行动的龙珠对局大厅——把「约一局」变成「今晚有一场」。
colors:
  night-stage: "#0b0e14"
  night-raised: "#121722"
  night-float: "#1a2130"
  night-sunken: "#222a3a"
  stage-ink: "#1c0f03"
  text-bright: "#eef1f7"
  text-muted: "#a4adc2"
  text-dim: "#7a8399"
  amber-action: "#ff8a1f"
  amber-ember: "#ff5d1f"
  amber-bright: "#ff9e45"
  amber-soft-text: "#ffd9b0"
  amber-wash: "rgba(255, 138, 31, 0.14)"
  hairline: "rgba(255, 255, 255, 0.07)"
  hairline-strong: "rgba(255, 255, 255, 0.14)"
  oni-green: "#3ddc97"
  danger-red: "#ff5f6d"
  warn-gold: "#ffc861"
  ki-cyan: "#3fd0ff"
  role-owner: "#ff9e45"
  role-admin: "#ff7385"
  role-ops: "#58d9ff"
  role-creator: "#b79dff"
typography:
  display:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  h1:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  h2:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  micro:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  xs: "6px"
  sm: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button-primary:
    backgroundColor: "{colors.amber-action}"
    textColor: "{colors.stage-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.amber-bright}"
    textColor: "{colors.stage-ink}"
    rounded: "{rounded.sm}"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, 0.035)"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  chip:
    textColor: "{colors.text-muted}"
    rounded: "7px"
    padding: "4px 9px"
  chip-active:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber-soft-text}"
    rounded: "{rounded.xs}"
  card:
    backgroundColor: "{colors.night-float}"
    rounded: "{rounded.lg}"
    padding: "16px"
  field:
    backgroundColor: "rgba(0, 0, 0, 0.28)"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  nav-item:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "8px 15px"
  nav-item-active:
    backgroundColor: "{colors.amber-action}"
    textColor: "{colors.stage-ink}"
    rounded: "{rounded.pill}"
---
# Design System: ESF 平台

## Overview

**Creative North Star: "夜战擂台"**

ESF 平台不是一个后台，而是「今晚开一场」的开赛控制台。虚化压暗的龙珠海报铺满整窗，左上渗出暖橙、右下渗出冰蓝，像深夜擂台边的两盏灯。主角永远是比赛本身：对局卡、席位、比分、延迟数字；光线只负责把擂台边缘照亮，不抢人。

密度上它是 Operate 界面：三段外壳（64px 顶栏 / 内容 / 28px 状态栏）、左侧窄轨导航、中央舞台、右侧 300px 成员名单常驻。信息严格三层（主 / 次 / 弱），字号只用 8 档；但氛围层不克制——玻璃面板、1px 发丝线、主按钮的内高光，让工具界面保留街机机台的重量感。

明确的拒绝：不要企业仪表盘的白底卡片与浅色表格；不要紫蓝渐变的 SaaS 风；不要给所有元素加发光；不要用投影堆叠来假装层级（层级由色调与描边承担）。橙色是行动色，不是装饰色。

**Key Characteristics:**
- 深色三层舞台（#0b0e14 / #121722 / #1a2130），单一琥珀橙 #ff8a1f 只给行动与选中
- 玻璃只做浮层：rgba 面板 + blur(14px) + 1px 发丝线；正文卡片优先不透明色调分层
- 机台按键：1px 内高光 + 橙色外发光 + 按下下沉 1px
- 系统字体（Segoe UI / Microsoft YaHei UI），无 webfont；眉标用 11px 大写 + 0.08–0.2em 字距
- 四档圆角 6 / 10 / 16 / 999；1px 描边；图标 24 viewBox、1.7 描边、圆头
- 动效两档：120ms 状态反馈、180–200ms 浮层；可被「减少动效」整体关闭

## Colors

一块炭蓝舞台，一支琥珀橙，四枚语义色；除此之外只用白与灰。

### Primary
- **琥珀行动** (#ff8a1f): 主按钮渐变起点、当前导航项底色、进度与关键数字。它是全系统唯一的「可行动」信号。
- **熔岩橙** (#ff5d1f): 主按钮渐变终点、品牌标渐变、橙色外发光的基色。
- **亮琥珀** (#ff9e45): 悬停提亮；只在已有橙色的元素上使用。
- **暖沙** (#ffd9b0): 橙色浅底上的文字（选中导航、chip、pill），保证 4.5:1 对比。
- **舞台墨** (#1c0f03): 橙底上的深色标签文字，主按钮文字专用。

### Secondary
角色色只用于成员名单与头衔徽章的身份识别，不参与行动层级，不做大面积底色。
- **所有者橙** (#ff9e45): 所有者头衔点与徽章。
- **管理员红** (#ff7385): 管理员头衔点与徽章。
- **运营蓝** (#58d9ff): 运营头衔点与徽章。
- **作者紫** (#b79dff): 作者头衔点与徽章。

### Neutral
- **舞台底** (#0b0e14): 窗口底与背景遮罩的基色。
- **抬升面** (#121722): 侧栏、常驻面板、玻璃面板的底色（以 rgba(18,23,34,.86) 形式使用）。
- **悬浮面** (#1a2130): 卡片、弹窗、选中行。
- **凹陷面** (#222a3a): 输入框内嵌区、进度槽。
- **正文白** (#eef1f7): 正文与标题的主文字色。
- **次级灰** (#a4adc2): 列表次信息、说明文字。
- **弱信息灰** (#7a8399): 时间、来源、离线态；不低于 11px。
- **发丝线** (rgba(255,255,255,0.07)): 所有分隔与描边，永不使用纯白边框。
- **强发丝线** (rgba(255,255,255,0.14)): 输入框、可交互容器的边界。

### Named Rules
**The One Voice Rule.** 橙色只出现在「可行动 / 已选中 / 关键数字」三类位置，单屏面积约 10% 以内；同一屏不允许出现第二个暖色强调。

**The Three-Stage Rule.** 背景只有三层：舞台 #0b0e14、抬升 #121722、悬浮 #1a2130；输入与凹槽用 #222a3a。不要新增第四层「更深的黑」。

**The One-Step Semantic Rule.** 成功 / 危险 / 警告 / 信息各只有一档色（#3ddc97 / #ff5f6d / #ffc861 / #3fd0ff），不做深浅阶梯，也不用它们做装饰。

## Typography

**Display Font:** Segoe UI (with Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif)
**Body Font:** Segoe UI (with Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif)
**Mono Font:** ui-monospace (with SFMono-Regular, Consolas, monospace)

**Character:** 系统字保证中文在 Windows 上锐利、无下载等待；层级靠字号、字重与字距，而不是换字体。等宽只给 IP、端口、版本号、路径与代码，给「可核对的事实」一种仪表感。

### Hierarchy
- **Display** (700, 32px, 1.15, -0.02em): 页面主标题与大数字，一屏最多一处。
- **Headline** (700, 24px, 1.2): 区块标题，如「对局已找到」「我的战绩」。
- **Title** (600, 18px, 1.3): 卡片标题、弹窗标题、成员分组名。
- **Body** (400, 14px, 1.5): 正文与列表主信息；长文本控制在 65–75 字符宽。
- **Label** (500, 13px, 1.4): 表单标签、按钮文字、列表次信息。
- **Caption** (400, 12px, 1.45): 辅助说明、时间、来源。
- **Micro** (600, 11px, uppercase, 0.08em): 表头、眉标、徽章；最小可用字号。
- **Mono** (400, 12px): IP、端口、版本号、路径。

### Named Rules
**The Eyebrow Rule.** 大写 + 字距只用于分组眉标（DRAGON BALL · ESF、段位、表头），字距 0.08–0.2em；正文与按钮永不加宽字距。

**The No-Half-Pixel Rule.** 新字号只能取上表 8 档；现存 12.5px / 11.5px 属历史遗留，改动时向下归并到 12 / 11。

## Layout

桌面独占的固定外壳：`--shell-top: 64px`、`--shell-bottom: 28px`，中间 `minmax(0, 1fr)`。工作区是「窄轨 + 舞台 + 成员栏」三列：宽屏 72px + 1fr + 320px，常规 58px + 1fr + 300px，成员栏可折叠为 56px 的竖条（保留在线人数）。

间距以 4px 为基：4 / 8 / 12 / 16 / 24 / 32。工作区 padding 8–10px、列间距 8–10px；卡片内边距 16px；表格行高 44px；状态栏 28px。窗口默认 1320×900，最小 1180×780；断点集中在 1400 / 1340 / 1260 / 1180 / 1080 / 980，只做密度压缩，不改信息架构。

没有移动端布局，也没有汉堡菜单：导航永远是顶栏胶囊 + 左侧窄轨两套并存。

## Elevation & Depth

混合体系，三层很清楚：**氛围层**（背景图 blur(16px) brightness(0.52) saturate(1.28) + 两枚径向光：左上 rgba(255,138,31,.18)、右下 rgba(63,208,255,.10)）→ **玻璃层**（rgba(18,23,34,.86) + blur(14px) + 1px 发丝线）→ **内容层**。深度主要靠色调与描边，阴影只负责「脱离」：el-1 0 2px 8px / el-2 0 12px 32px / el-3 0 24px 64px，均为黑色 25–50% 不透明度。橙色外发光只允许出现在主按钮与品牌标上。

### Shadow Vocabulary
- **卡片** (0 2px 8px rgba(0,0,0,0.25)): 静态卡片与列表行的轻微脱离。
- **浮层** (0 12px 32px rgba(0,0,0,0.35)): 抽屉、下拉、悬浮面板。
- **模态** (0 24px 64px rgba(0,0,0,0.5)): 结算弹窗、确认框。
- **行动光** (0 0 0 1px rgba(255,138,31,0.35), 0 8px 24px rgba(255,138,31,0.18)): 仅主按钮、品牌标、当前焦点。

### Named Rules
**The Glass-Only-For-Overlay Rule.** backdrop-filter 只用于浮层与常驻面板；普通内容卡片用不透明 #1a2130，避免半透明叠半透明导致发灰。

**The Flat-At-Rest Rule.** 卡片静止时不发光、不缩放；只有 hover / focus / 选中三态才改变描边或亮度。

## Shapes

圆角只四档：6px（徽章、窗口按钮）、10px（按钮、输入框）、16px（卡片、弹窗、抽屉分组）、999px（胶囊、导航项、状态 pill、模式筛选）。现状另有 7px（chip）与 8–9px（成员行、列表行）这类历史中间值，触碰时归并到 6 / 10。所有分隔与描边固定 1px 发丝线，绝不用 2px 以上的实线框。

主按钮像一个机台键帽：顶部 1px 白色内高光（rgba(255,255,255,.45)）+ 底部橙色外发光，按下时 `translateY(1px)`。图标统一 24×24 viewBox、stroke-width 1.7、圆头圆角、默认渲染 18px；图形语言是细线描边，不使用实心面图标（play / pause / dot 例外）。

## Components

### Buttons
- **Shape:** 10px 圆角、9px 15px 内边距、Label 13px/600、7px 图标间距（现存 12.5px 是遗留半像素，触碰时归并到 13）。
- **Primary:** 135° 渐变 #ffd18f → #ff9c33 → #ff6a1f，文字 #1c0f03，内高光 + `0 10px 24px rgba(255,110,20,.28)`；hover 上浮 1px 并加深外发光；active 下沉 1px。
- **Ghost:** 3.5% 白底 + 12% 白描边，文字 #dfe4ef；hover 白底升到 7.5%、描边 20%。
- **Focus:** `0 0 0 3px rgba(255,142,40,.28)`，无 outline。
- **Sizes:** sm 6px 11px、默认 9px 15px、lg 12px 22px；字号沿 Label 档（11.5 / 13.5 属遗留，逐步收口）。

### Chips & Pills
- **Chip:** 7px 圆角、4px 9px、11px 文字、透明底；选中态 rgba(255,138,31,.14) 底 + rgba(255,138,31,.35) 描边 + #ffd9b0 文字。
- **Pill:** 999px 胶囊、8px 13px，用于模式与状态（如「单挑」「WAITING」）；warn 态只用 #ffc861 文字 + 10% 底。

### Cards / Containers
- **Corner Style:** 16px。
- **Background:** rgba(18,23,34,.86) + 12–14px blur + 顶部 3.5%→1.2% 白色渐变（--surface）。
- **Border:** 1px var(--line) 发丝线；选中态换成 rgba(255,138,31,.34)。
- **Internal Padding:** 16px；紧凑列表卡 8px。

### Inputs / Fields
- **Style:** 10px 圆角、9px 12px、rgba(0,0,0,.28) 内嵌底、1px var(--line-strong) 描边、12.5px 文字。
- **Focus:** 描边升到 rgba(255,138,31,.55)，外加 3px rgba(255,138,31,.12) 光晕；占位符 #4f5468。
- **Error:** 红色 #ff5f6d 文案 + 同色 1px 描边，不加图标底色块。

### Navigation
- **Top bar:** 64px，标题栏可拖拽（-webkit-app-region: drag），渐变底 rgba(14,18,26,.92)→rgba(11,14,20,.86)、blur(20px)、底部 6% 白线、投影 0 1px 0 rgba(255,255,255,.03) + 0 10px 30px rgba(0,0,0,.35)。
- **Nav pill:** 999px 胶囊容器、5px 内边距、白色 5.5%→1.8% 渐变底 + 内高光；每项 8px 15px、999px 圆角、12.5px；选中项是**实心橙胶囊**（#ffb157 → #ff8a1f 62% → #ff7a1f），深色文字 #1c0e02 / 600，外加 0 6px 18px rgba(255,122,31,.3) 外发光与顶部内高光。
- **Left rail:** 58–72px 竖条，图标在上、文字在下，选中态同 nav-item。

### Member Row（signature）
常驻右栏的身份行：30px 圆形头像（#ffc46b→#ff5d1f 渐变底、12px/700 深色首字）、6px 状态圆点、名字 12px、状态与头衔 10.5px 弱信息（大厅 / 排队 / 比赛中 / 离线）；行高 6px 5px、8px 圆角，hover 3.5% 白底，本人行 7% 橙底；离线整行 50% 不透明度，不删除。分组头是 11px 大写眉标 + 计数，可折叠。

### Modal & Drawer
弹窗：16px 圆角、rgba(18,23,34,.96)、blur(20px)、el-3 阴影、遮罩 rgba(3,5,10,.35) + blur(2px)；头部标题 + 右上关闭，底部「取消 / 确认」右对齐。抽屉：右侧 520px、背景 --bg-1、左侧 1px 发丝线，分组标题可折叠。

### Switch
38×21px 胶囊轨道（999px），关闭态 10% 白底、圆钮 #e8edf7；开启态 #ffab4f→#ff8a1f 渐变 + rgba(255,160,90,.5) 描边、13px 圆钮内缩 3px。整行点击有效，标签在左、开关贴右。

## Do's and Don'ts

### Do:
- **Do** 用 token 取色：任何新样式引用 var(--accent) / var(--bg-1) / var(--fs-*) 等，不写新的十六进制。
- **Do** 让橙色只出现在主按钮、当前选中、关键数字上；其余信息用白与三级灰表达。
- **Do** 用 1px 发丝线与色调分层表达层级；浮层才用 blur 与阴影。
- **Do** 保持主按钮的机台手感：内高光 + 橙光 + 按下 1px 下沉，三件套缺一不可。
- **Do** 给「结果」类界面统一用一套 Modal：标题 + 可滚动内容 + 底部主次按钮。
- **Do** 尊重系统「减少动效」：所有动画在 .is-static-motion 或 prefers-reduced-motion 下归零。

### Don't:
- **Don't** 新增第四种背景黑或第二支强调色；语义色也不能当装饰。
- **Don't** 给卡片、列表行、标题加发光或渐变文字（hero 大标题的白色渐变是唯一例外）。
- **Don't** 用半透明面板叠加半透明面板；叠出来会发灰、字发虚。
- **Don't** 写半像素字号（12.5 / 11.5）或新的圆角值；一律归并到 8 档字号与 4 档圆角。
- **Don't** 引入第二套设计语言（Material 卡片、Tailwind 默认灰阶、商业组件库皮肤）。
- **Don't** 用纯白 #fff 做正文或边框；正文最高 #eef1f7，边框最高 14% 白。
