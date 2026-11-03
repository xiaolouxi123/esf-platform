# 贡献指南

感谢愿意一起完善 ESF Platform。

## 开始之前

- 先开 Issue 描述要解决的问题，避免重复劳动。
- 不要提交任何真实账号、密码、Token、服务器 IP 之外的密钥。
- 涉及数据库结构变更时，请同时更新 `server/scripts/migrate.js` 和测试。

## 分支与提交

- 分支：`feat/<topic>`、`fix/<topic>`、`docs/<topic>`
- 提交信息用祈使句，例如：
  - `feat(ranked): add 2v2 ready countdown`
  - `fix(launcher): kill stale hl.exe before relaunch`
- 一个 PR 只做一件事，附上截图或录屏（UI 改动）。

## 本地检查

```bash
cd esf-launcher
npm run lint
npm test
npm run build

cd ../server
npm test
```

AMXX 改动请附上编译结果，并说明测试的服务器环境。

## 代码风格

- 前端：React 函数组件 + hooks，避免在渲染中做副作用。
- 后端：路由只做参数校验与编排，业务放 `src/services`。
- SQL：全部参数化，禁止拼接用户输入。
- 日志：不要输出密码、Token、完整连接串。
- 新接口：需要鉴权的必须加 `requireAuth`，管理接口加角色校验。

## 安全

发现漏洞请按 [SECURITY.md](SECURITY.md) 私下联系，不要直接公开 Issue。
