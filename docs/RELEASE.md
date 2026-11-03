# 发布流程

每次发新版本按这个顺序做，避免客户端、feed、公告不一致。

1. 确认 `server` 已部署并迁移
2. 修改 `esf-launcher/package.json` 版本号
3. 更新 `CHANGELOG.md` 和 `docs/release-<version>.md`
4. 跑测试：

   ```bash
   cd esf-launcher
   npm run lint && npm test && npm run build
   cd ../server
   npm test
   ```

5. 打包：

   ```bash
   cd esf-launcher
   npm run dist
   ```

6. 上传到更新源：

   - `latest.yml`
   - `ESF-Platform-Setup-<version>.exe.blockmap`
   - `ESF-Platform-Setup-<version>.exe`

7. 修改服务器 `.env`：

   ```env
   LATEST_VERSION=<version>
   DOWNLOAD_URL=http://<host>/updates/ESF-Platform-Setup-<version>.exe
   RELEASE_NOTES=<简短说明>
   ```

8. 重启 API，让 `/api/config` 返回新版本。

9. 发布公告：

   ```powershell
   $env:ESF_API_BASE="http://<host>:3000"
   $env:ESF_ADMIN_USER="yun"
   $env:ESF_ADMIN_PASS="<password>"
   $env:ESF_NOTICE="<version> 已发布：<更新内容>"
   node scripts/announce-release.cjs
   ```

10. Git 提交 / tag：

    ```bash
    git add -A
    git commit -m "release: <version>"
    git tag -a v<version> -m "<version>"
    git push origin main
    git push origin v<version>
    ```

## 发布检查

- [ ] 安装包大小与 latest.yml 一致
- [ ] `latest.yml` 的 sha512 与安装包一致
- [ ] `/api/config` 返回新版本
- [ ] 平台公告已更新
- [ ] GitHub tag 已推送
- [ ] 旧版本可自动更新或手动安装
