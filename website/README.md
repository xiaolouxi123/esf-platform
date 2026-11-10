# 官网

## 当前入口

正式入口是 GitHub Pages 静态站：

```text
https://xiaolouxi123.github.io/esf-platform/
```

`esfcn.cn` 未完成备案，本站**不再使用该域名**（canonical、og:url、sitemap、robots 都已指向 Pages）。
Express 侧仍保留一份官网静态托管，但不作为对外入口；API 与更新源在新平台机由 Caddy 反代，
权威地址见 `docs/kb/environment/servers.md`。

## 版本怎么来的

**唯一来源是 `esf-launcher/package.json` 的 `version`**，不要手改官网里的版本号：

```bash
node scripts/sync-versions.cjs     # 发版时由 scripts/release.ps1 自动调用
node scripts/check-versions.cjs    # CI 与发版前校验，不一致即失败
```

同步器会生成 `website/version.json`（版本 + 下载地址），并更新 `index.html` 的
3 处版本展示、JS 兜底值、下载按钮链接、更新记录（`src/data/releases.json` 的**全部历史版本 + 当前版本**），
以及 `sitemap.xml` / `robots.txt`。

> 为什么需要 `version.json`：GitHub Pages 是纯静态托管，请求不到 `/api/config`。
> 早期官网把 0.4.7 硬编码进 HTML，静态分支又不拉配置，导致线上永久显示并分发旧包。
> 现在静态托管下 JS 会读取同目录 `version.json`；HTML 里的硬编码值只是无 JS/请求失败时的兜底。

下载地址走 GitHub Releases（`v<version>/ESF-Platform-Setup-<version>.exe`），
由 `version.json` 提供；Express 托管时则优先用 `/api/config` 的 `downloadUrl`。

## 部署

- push 到 `main` 且 `website/**` 变更 → `.github/workflows/pages.yml` 自动发布整个 `website/` 目录
- `version.json` 必须与页面一起提交，否则静态站会回退到 HTML 兜底版本
- 发布新版本时先跑 `sync-versions.cjs`，再提交，让 Pages 与安装包同版本

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 单页官网（样式与脚本内联） |
| `version.json` | 版本与下载地址，由同步器生成 |
| `privacy.html` | 隐私说明（收集范围、留存、删除方式） |
| `assets/` | 图标与客户端截图 |
| `sitemap.xml` / `robots.txt` | 由同步器生成，指向 Pages |

## 注意

- 安装包**未做代码签名**，Windows SmartScreen 会提示；小范围分发可接受
- 更新源 `https://119.29.82.217/updates/` 由 Caddy 提供 HTTPS（IP 证书），见 KB `environment/toolchain`
- 平台定位为**小范围邀请制**：公开仓库不等于公开运营，注册需 `INVITE_CODE`（生产 `.env` 必须配置）
- 大流量下载建议后续接 COS/CDN，目前仍以 GitHub Releases 为主
