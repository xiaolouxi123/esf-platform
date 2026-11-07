---
title: 知识库自身的规则（为什么在这里、怎么维护）
category: decision
tags: [kb, process]
updated: 2026-11-08T04:35:00+08:00
---

# 知识库规则

## 位置决定

- 放在**仓库内的 `docs/kb/`**，随 git 走；不用 `.omd/wiki/`（后者被 gitignore，换机器/换人就不见了）。
- 目录沿用 wiki 约定：`index.md` + `log.md` + 分类子目录 + YAML frontmatter + `[[slug]]` 互链。
- 缺点：会进公开仓库（若仓库是 public），所以**任何密码/密钥/令牌都不写进来**，只写"在哪台机哪个文件"。

## 维护规则

1. 回答任何"背景 / 历史决定 / 为什么这么干 / 现在是什么版本"之前，先读 [[index]]，再读对应页。
2. 新决定：改已有页面；确实新主题才新建页面，并在 [[index]] 目录表里登记。
3. 数字变了（版本、端口、大小、超时）**直接改**，不留旧值；作废页面直接删。
4. 每次有实质变更，在 [[log]] 追加一行：日期 + 改了什么 + 依据（提交/会话/实测）。
5. 页面保持短：只写"决定 + 理由 + 数字 + 坑"，过程细节留在 git 历史与提交信息里。
6. 内容与代码/线上冲突时以现场为准，并把 KB 改对。

## 单页模板

```markdown
---
title: 页面标题
category: decision | environment | pattern | debugging | state
tags: [tag1, tag2]
updated: YYYY-MM-DDTHH:MM:SS+08:00
---

# 标题

## 背景 / 结论 / 数字 / 坑
```

## 与其他文档的关系

- `docs/*.md`（如 `AMXX_CHALLENGE.md`、`RELEASE.md`）是**具体文档/手册**，KB 只做索引与决策记录，不复制全文。
- 根目录 `PROJECT_STATUS.md` 已并入 [[current-state]]，原文件改为指针，避免两处数字打架。
