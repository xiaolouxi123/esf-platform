# 官网部署

## 当前地址

```text
http://119.91.99.176:3000/
```

官网与 API、更新源同源：

- 官网：`/`
- API：`/api/*`
- 更新：`/updates/*`

## 域名接入

1. 购买/准备域名，添加 DNS `A` 记录指向 `119.91.99.176`
2. 建议用 Caddy / Nginx / Cloudflare 做 80/443 反代到 `127.0.0.1:3000`
3. 修改服务器 `.env`：

   ```env
   UPDATE_FEED_URL=https://你的域名/updates/
   DOWNLOAD_URL=https://你的域名/updates/ESF-Platform-Setup-0.4.2.exe
   ```

4. 重启 API
5. 启动器设置里的 `updateFeedUrl` 留空，会自动从 `/api/config` 获取
6. 平台公告中同步官网地址

## 直接使用 IP:3000

当前官网已经可直接访问：

```text
http://119.91.99.176:3000/
```

下载按钮会自动读取 `/api/config` 的 `latestVersion` 与 `downloadUrl`。

## 文件

- `website/index.html`：官网单页
- `website/assets/`：图标与客户端截图
- `server/src/app.js`：Express 静态托管官网

## 注意

- 安装包未签名，SmartScreen 会提示
- 正式域名建议配置 HTTPS
- 大流量下载建议把 `/updates` 放 CDN / 对象存储
