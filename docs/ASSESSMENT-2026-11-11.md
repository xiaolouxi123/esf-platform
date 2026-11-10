# ESF Platform 项目整体完成度评估

- 评估日期：2026-11-11
- 评估范围：`C:/Users/Administrator/Desktop/esf-launcher` 全仓库（启动器 / 后端 / AMXX 插件 / 部署 / 官网 / CI / 文档）
- 评估基准：以 `docs/kb/current-state.md`（2026-11-10，版本 0.6.1 / 插件包 0.52）为线上现状的权威来源；`PROJECT_REPORT.md`（2026-11-05，0.4.2）视为历史文档
- 评估方法：静态代码与配置审计 + 文档/知识库交叉核对 + 本地实测（lint、两套测试）。**未**启动应用、**未**连接生产/本地数据库、**未**联网探测线上服务、**未**运行打包与迁移

> 本报告只记录凭据的**存放位置**，不复现任何口令、密钥的具体值。

---

## 1. 总体结论

| 项 | 结论 |
|---|---|
| **总体完成度** | **6.4 / 10（约 64%）** |
| **评级** | **B−：功能闭环、已在运行，但未通过生产级交付验收** |
| 一句话判定 | 这不是脚手架或原型——四端（客户端 / API / 游戏插件 / 分发运维）功能真实闭环且相当完整；但工程质量、安全基线、验收证据与交付一致性存在系统性欠账，现状是「能跑、能更新、能用」，不是「可放心公开运营」。 |
| 分层完成度 | 产品功能层 ≈ **83%** ｜ 工程质量层 ≈ **58%** ｜ 交付运维层 ≈ **50%** |
| 最大阻断项 | ① 公开仓库文档内存在明文服务器管理员口令；② 官网/部署包/更新元数据版本严重滞后且互相矛盾；③ 核心排位链路「开局不自动分边」未修复、真人验收未完成；④ `npm test` 在 Node 22 直接失败。 |

**与项目自评的差异**：`PROJECT_REPORT.md:24` 自评「功能已可用，生产化只剩入口/HTTPS/监控等收口项」，KB 记录 HTTPS 反代与迁移已完成。本次审计认为收口项远不止于此：**安全（明文凭据、无签名、自报赛果）、测试可运行性、部署包时效性、验收证据**四项均未被项目自评覆盖。

---

## 2. 各维度评分与判断依据

| # | 维度 | 权重 | 评分 | 核心判断依据（摘要，详见第 3 节） |
|---|---|---|---|---|
| 1 | 需求实现 | 15% | **8.5** | README 宣称的功能绝大多数能在代码中找到真实实现，跨四端闭环；扣分因为全仓无 PRD/需求清单/追踪矩阵，无法严格判定「需求」边界，且 KB 自列 10 项待办含 4 项真人验收 |
| 2 | 功能完整性 | 15% | **8.0** | 99 个 API 端点、约 36 张表 + 2 个结算存储过程、4 个 AMXX 插件、差量更新、备份恢复演练脚本齐备；扣分因为开局自动分边缺失、维护/公告/最低版本/强制改密「只下发不强制」、匹配仅入队触发、无代码签名、监控有探测无告警 |
| 3 | 代码结构与可维护性 | 10% | **6.0** | 分层是刻意设计且清晰（纯逻辑层 / HTTP 客户端 / 主进程 IPC / preload 白名单 / React）；但 `main.cjs` 1920 行、`App.css` 12397 行、`Lobby.jsx` 1665 行、TypeScript 0%、手写 node_modules 打包白名单、ESLint 对 `.cjs` 未启用 recommended |
| 4 | 测试覆盖 | 12% | **5.0** | 启动器 66 个检查点、后端 81 个用例，覆盖 IPC 集成与 HTTP 集成；但均为手写断言/脚本式、零 e2e、零覆盖率、后端 63 例硬依赖真实 MySQL。**实测 `npm test` 在 Node 22 下两个包均直接失败** |
| 5 | 错误处理 | 10% | **7.0** | 后端统一 `{ok:false,code,message}` + 98/99 处理器异常转发 + 事务回滚；IPC 统一错误信封 + 8s 超时 + 401 统一登出；但客户端无 ErrorBoundary / 全局异常钩子 / 渲染进程崩溃监听，后端无 DB 断连重连，部分 DB 故障被降级成 400 |
| 6 | 安全性 | 12% | **4.5** | **明文管理员口令入库**是最严重问题；AMXX 旧账号系统明文密码 + SQL 拼接 + 控制台打印密码；`/ranked/settle` 参赛者自报赛果；`resolveOptionalUser` 弱化鉴权；更新源可后端下发且无代码签名；敏感端点无限流。Node 侧防护（全参数化、bcrypt、JWT 双撤销、contextIsolation、safeStorage、路径穿越防护）确实扎实，故未低于 4.5 |
| 7 | 性能 | 8% | **6.0** | 差量更新（0.6.0→0.6.1 仅下载 7.4 MB）设计良好；但主进程每 2.5s 同步 `spawnSync('tasklist')` 阻塞、大量同步 fs、渲染层 10+ 路常驻轮询且无 `React.memo`、后端 N+1 / 连接池 10 且 `queueLimit:0` / 两处索引缺失 / 122MB 单机分发 |
| 8 | 文档完备性 | 8% | **6.0** | KB（22 页，索引 + 权威现状 + 决定 + 环境 + 手册 + 排障 + 变更日志）与 CHANGELOG 是亮点，`PROJECT_STATUS.md` 改指针处理得当；但无 PRD/验收主文档、API 文档仅约 26 条（实际 99）、验收清单几乎全未勾、8+ 处版本/IP/构建方式矛盾、旧报告未标作废、图片断链与截图缺失、无回滚与故障预案 |
| 9 | 交付准备 | 10% | **5.0** | 5 个 CI 工作流、完整备份脚本、发布手册、tag `v0.6.1` 俱在；但官网永久显示 0.4.7 且下载链指向 v0.4.7、`deploy/esf-server-bundle.zip` 内是 0.1.0 旧后端（仅 7 个 SQL、无结算存储过程）、`release/latest.yml` 停在 0.5.21、AMXX 无可复现编译脚本、无代码签名、发布检查 6 项全未勾、`release.yml` 存在 workflow_dispatch 缺陷 |

加权计算：`8.5×.15 + 8.0×.15 + 6.0×.10 + 5.0×.12 + 7.0×.10 + 4.5×.12 + 6.0×.08 + 6.0×.08 + 5.0×.10 = 6.375 ≈ 6.4`

---

## 3. 各维度详细依据

### 3.1 需求实现 / 功能完整性（8.5 / 8.0）

**真实实现、非占位**（已确认）：
- 启动器：`esf-launcher/main.cjs` 约 100 个 IPC handler、`api.cjs` 约 90 个端点封装、`preload.js` 白名单约 120 个通道；25 个 React 组件中 150+ 处 `electronAPI` 调用全部经 IPC → HTTP 驱动。全量检索 `src/`，**无 TODO/FIXME/stub/假数据兜底**。
- 关键链路闭合：一键连服 = `launch:join`（`stopGameForSwitch` → launch token → `prepareLaunch` → spawn → 收托盘）；结算 = AMXX `CALL settle_ranked_match` / `settle_challenge_match` → `server/scripts/migrate.js` 中确实定义并授权给 `esf_amxx`；0.6.1 新增结算失败落盘 + 启动器按 30s/2min/10min 补交。
- 后端：`server/src/routes/` 19 个文件、99 个端点；`src/services/` 10 个业务服务；五级角色 JWT + token_version/jti 双撤销 + TOTP 2FA + 会话设备撤销 + 登录锁定；排位/约战/竞猜/钱包/资源审核/审计日志/更新 feed（自实现 multipart Range）均为真实实现。
- AMXX：`esf_platform_auth.sma` 真实写 `used_at/authorized_until` 消费 token 并记 `play_sessions`；`esf_ranked_lock.sma` 锁服；`test_ranked.sma`（2659 行）真实回写战绩与结算。
- 运维：备份脚本含 04:00 计划任务说明、14 天保留、SHA-256、存储过程完整性校验、临时库恢复演练；5 个 GitHub Actions 工作流（CI / Pages / Release / blockmap 修复 / 15 分钟 uptime 探针）。

**明确的功能缺口**：
| 缺口 | 位置 | 影响 |
|---|---|---|
| 开局不自动分边 | `docs/kb/current-state.md:58`、`docs/kb/debugging/known-issues.md:55-64` | 排位/约战玩家进服后需手动 `jointeam`，核心玩法链路体验断裂，KB 列为待办 9 |
| 维护模式/公告/最低版本/强制改密只下发不强制 | `server/src/routes/config.js`；全仓 `maintenance` 无中间件拦截；`must_change_password` 仅作字段返回 | 运营开关形同虚设 |
| 快速匹配仅在入队时触发 `tryMatch` | `server/src/services/ranked.js:272-354`（唯一调用点 `:375`） | 已在队列中的玩家若当时无服/无人，不会被后续扫描撮合 |
| `settle_challenge_match` 与挑战战绩写入 Node 侧完全缺失 | `server/src/services/challenges.js` 仅 SELECT；由 AMXX 直写 | 跨端强耦合，Node 侧无法独立验证/补偿 |
| 单端登录未实现 | `PROJECT_REPORT.md:147`；`server/src/services/sessions.js` 每次登录新建 jti | 属路线图 P1，README 未宣称 |
| 代码签名缺失 | `esf-launcher/package.json` build 段、`release.yml`、`website/README.md:54` | SmartScreen 警告，且更新包无供应链签名校验 |
| 监控有探测无告警 | `.github/workflows/uptime.yml` 失败仅 `::error` annotation；`docs/MONITORING.md:37-39` 自承「不是实时告警」 | 故障发现延迟可达数十分钟 |

### 3.2 代码结构与可维护性（6.0）

**优点**：`launcher-core.cjs` 刻意不依赖 Electron（纯逻辑可单测）；`api.cjs` 把 HTTP 放主进程以免渲染层接触 JWT；`store.cjs` 用 `safeStorage` 加密登录态；`main.cjs:812-822` 统一 IPC 错误信封；生产代码几乎无裸 `console.log`（渲染层 0 处，日志走文件）。`npm run lint` **实测通过**。

**问题**：
- 巨型文件：`main.cjs` 1920 行、`src/App.css` 12397 行、`Lobby.jsx` 1665 行（40+ `useState`、5 个常驻定时器）、`AdminPanel.jsx` 1138 行、`SettingsDrawer.jsx` 954 行。
- 零静态类型：无 `.ts/.tsx`、无 `tsconfig`、无 `typescript` 依赖、无 JSDoc 类型标注。
- `eslint.config.js` 第二块对 `.cjs`/`preload.js` 只设 globals 与 sourceType，未启用 `js.configs.recommended`；7 处 `eslint-disable-next-line`。
- `package.json:48-83` 手工逐条列出 node_modules 子包作为打包白名单，漏列即打包不全；`build.files` 排除 `!src/**` 等靠人工维护。
- 未使用依赖 `goldsrc-query`（启动器侧）；`esf-launcher/README.md` 仍是未修改的 Vite 官方英文模板。

### 3.3 测试覆盖（5.0）—— 含本次实测结果

| 实测命令 | 结果 |
|---|---|
| `node -v` | **v22.22.2**（README 声明 Node 20+） |
| `npm --prefix esf-launcher run lint` | **通过**（无输出，exit 0） |
| `npm --prefix esf-launcher test`（脚本 `node --test tests/`） | **失败**：`Cannot find module ...\tests`，TAP `pass 0 / fail 1` |
| `node --test tests/*.test.cjs`（显式通配符） | **通过**：3 个测试文件全部 ok，66 个手写检查点全过，耗时约 15.5s |
| `npm --prefix server test`（脚本 `node --test test/`） | **失败**：`Cannot find module ...\test` |
| `node --test test/*.test.js` | **22 通过 / 63 失败**（85 个用例），63 个失败原因统一为 `数据库不可用：请先 npm run db:start 并 npm run migrate`，即本地 MySQL 未启动，**不是代码缺陷** |

**结论**：
1. 两个 `package.json` 的 `test` 脚本依赖 Node 20 的「目录参数自动扫描测试文件」行为，在 Node 22 下把目录当作模块加载而失败。CI 固定 `node-version: 20`（`.github/workflows/ci.yml:18,62`），而 `release.yml:22` 用 Node 22、`README.md:51` 声明 20+ —— **CI 与本地、CI 与发布环境的 Node 版本不一致，`npm test` 在本地即不可用**。这类失败会被误判为「测试通过」（管道到 `tail` 时 shell 退出码为 0）。
2. 测试形态：启动器 3 个文件各自定义手写 `check()`，不使用 `node:test` 的 `test()/describe()`，因此 Node test runner 把每个文件当作 1 个用例，`66` 是检查点数不是用例数；`challenge-flow.test.cjs` 用正则读源码文本做防回归静态检查，不验证运行时行为。
3. 后端 7/10 测试文件显式 `assert.ok(await ping())` 依赖真实 MySQL，无 mock、无独立测试库、无事务隔离，用例间共享状态且会污染开发库；`amxx-*.test.js`（16 例）读取仓库根 `amxx/*.sma`，只签出 `server/` 时必然失败。
4. **零 e2e / 零 React 组件测试 / 零覆盖率工具 / 无覆盖率阈值**；真实网络、游戏进程、打包产物、Electron 更新行为均未测。

### 3.4 错误处理（7.0）

**到位**：后端 `src/middleware/errorHandler.js` 统一分类（ApiError / ZodError / JSON 解析 / ER_DUP_ENTRY / 500）；99 个处理器中 98 个有 `try/catch → next(err)`；`src/server.js` 有 `uncaughtException`/`unhandledRejection`/`EADDRINUSE`/SIGTERM 优雅关闭；事务 `try/catch + rollback + release` 齐全；`api.cjs` 8s AbortController 超时并把错误分为 TIMEOUT/UNREACHABLE/NETWORK/HTTP_*；登录 401 统一清会话；多处降级（审计写失败不阻断、设置表异常回落 env、刷新失败保留旧列表）。

**缺失**：全仓零 `ErrorBoundary`/`componentDidCatch`、零 `window.onerror`/`unhandledrejection`、零主进程 `uncaughtException`（客户端侧）、零 `render-process-gone` 监听 → 渲染层异常白屏且无兜底；`src/db.js` 无 `pool.on('error')`、无 `connectTimeout`/`acquireTimeout`、无重连，启动时 DB 为 DOWN 仍照常 listen；`routes/ranked.js`/`challenges.js` 的 `fail()` 把普通 Error 一律转 400，数据库故障被伪装成参数错误；`settle_ranked_match` 存储过程无 `START TRANSACTION`/EXIT HANDLER、不检查 `ROW_COUNT()`，有半结算/重复结算风险；迁移脚本无 `schema_migrations` 版本表、无事务包裹、无回滚脚本，且 `sql/` 存在两个 `013_*`、7 个文件缺 `USE esf_platform;`。

### 3.5 安全性（4.5）

**P0 事件（已亲自核实）**：`docs/ESF_MP_ARCHIVE.md:18-19` 明文写有两台服务器（游戏服 114、新机 119.29）的 Windows `administrator` 口令，**且两台复用同一口令**。该文件位于公开仓库，并被 `README.md:124` 作为「跨会话总档案」推荐给新接手者。这直接违反 `README.md:131`、`SECURITY.md:15`、`AGENTS.md:27`、`docs/kb/index.md:50` 的书面约定。**必须立即轮换凭据并清理 git 历史**，本报告不复现其值。

**其他高风险项**：
| 风险 | 证据 | 影响 |
|---|---|---|
| AMXX 旧 `tb_user` 账号系统：密码明文入库、玩家名/密码/IP 直接拼 SQL、`equal()` 明文比对 | `amxx/test_ranked.sma:1266,1276,1355,1404`；`SQL_QuoteString(Empty_Handle,...)` 于 `:679` | 与 `CONTRIBUTING.md:37`「SQL 全部参数化」矛盾；平台模式下 `SQL_Init` 被跳过但 `login/register` 命令仍无条件注册，残留可触发面 |
| 数据库密码打印到服务器控制台 | `amxx/test_ranked.sma:286` `server_print(... pass ...)` | 违反 `CONTRIBUTING.md:38`，日志泄露凭据 |
| 参赛者自报赛果 | `server/src/services/ranked.js:622-678` `settleFromClient` 允许任意参赛玩家传 `winner` 调结算过程 | 刷分/刷币面，未见服务端独立赛果校验 |
| 弱化鉴权 | `server/src/routes/assets.js:443-459` `resolveOptionalUser()` 不校验 `scope`/`revoked_at`/`status` | 已撤销会话、被封禁账号、2FA 中间票据可能读待审资源 |
| 更新源供应链 | `main.cjs:82,187` 从 `/api/config` 取 `updateFeedUrl` 后 `setFeedURL`；`package.json:98` 发布源为 `https://updates.example.com/esf/` 占位；全仓无代码签名 | 若明文 HTTP 链路被劫持可指向恶意更新包 |
| 客户端默认明文 HTTP + 硬编码公网 IP | `store.cjs:26` 默认 `http://119.29.82.217:3000`；`store.cjs:16` 旧 `119.91.99.176`；KB 记录线上已走 `https://119.29.82.217` Caddy 反代 | 代码默认值与线上现状不一致，JWT 与个人信息在默认配置下走明文 |
| 敏感端点无限流 / 上传无体积上限 | `rateLimit.js` 5 个 limiter 仅落地 9 个端点；`admin.js:39-60` 更新包上传 `pipeline(req, createWriteStream)` 无大小限制、令牌用 `!==` 非常量时间比较 | 滥用与磁盘撑爆面 |
| 任意命令下发通道 | `deploy/ops-agent/ops-agent.ps1` + `server/src/routes/ops.js:128-148`（cmd 最长 4000 字符），`x-ops-key` 等价目标机 root，且该写操作**不写审计日志** | 设计如此，但需严格密钥管理与审计 |
| 裸 `x-forwarded-for` 取首段 | `auth.js:72-75`、`audit.js:14-17`、`sessions.js:10-13`，`trust proxy` 仅 loopback | 直连客户端可伪造 IP 污染登录/审计日志 |
| `index.html` 无 CSP meta、渲染层暴露全部 admin 通道 | `preload.js:161-181` | 缓解靠主进程逐 handler 鉴权，但 XSS 一旦发生攻击面较宽 |

**做得好的部分（确认）**：Node 侧唯一 DB 入口 `src/db.js` 全参数化、无用户输入拼接进 SQL；bcrypt cost 10 + 密码强度策略/弱密码黑名单；JWT 固定 HS256、验签后校验 scope / 会话撤销 / token_version / 账号状态；`esf_amxx` 账号 13 条最小授权 + 不含密码哈希的视图；Electron `contextIsolation:true` / `nodeIntegration:false` / `safeStorage` / contextBridge 白名单 / `spawn` 参数数组 / `shell.openExternal` 协议白名单 / 资源落地路径穿越双重校验（且有测试覆盖）；`.env`、`server/updates/`、`deploy/amxx/` 均未被 git 跟踪。

### 3.6 性能（6.0）

- **主进程阻塞**：`main.cjs:453-498` 每 2.5s 一次 `gameWatcher`，每轮同步 `spawnSync('tasklist')`（timeout 5s）；另有 `spawnSync('powershell')` 8s、`taskkill` 5s。窗口隐藏时 `backgroundThrottling:false`，渲染层定时器不降频。
- **同步 IO**：`main.cjs` 32 处、`launcher-core.cjs` 16 处、`store.cjs` 12 处同步 fs；封面/资源/插件 sha256 均整文件 `readFileSync`（上限 64MB）。
- **轮询密度**：RankedPage 2.5s/12s/30s、ChallengePage 3s、ChatPanel 6s、Lobby 5s/10s/12s/15s/60s、ServerRoomList 1s 等 10+ 路常驻；全 `src` 无 `React.memo`，`Lobby.jsx` 单组件任一 state 变化重渲染整棵子树。
- **后端**：连接池 `connectionLimit:10`、`queueLimit:0`（无限排队）、无 acquire 超时；`servers.js:46-83` 每台服最多 3N 条附加查询、`ranked.js:712-741`/`:174-208` N+1；`serverPoller.js` 15s 间隔串行轮询且 `setInterval` 不等待上一轮；`challenge_rooms.server_key`、`presence.updated_at` 缺索引；多段 Range 无整体 `Content-Length`；122MB 安装包单机 `express.static` 分发（靠 blockmap 差量缓解）。
- **正面**：差量更新实测 0.6.0→0.6.1 仅下载 7.4MB（KB `:32`）；`getState()` 用 `Promise.all` 并行；SQL 中有 87 处索引/键定义。

### 3.7 文档完备性（6.0）

**亮点**：`docs/kb/` 22 页成体系（索引规则 + 权威现状 + 12 篇决定 + 3 篇环境 + 3 篇手册 + 排障 + 变更日志），YAML frontmatter + `[[slug]]` 交叉引用；`AGENTS.md`/`README.md`/`kb/index.md` 三处强制「先查 KB」；`CHANGELOG.md` 从 0.2.7 记到 0.6.1、条目详实；`deploy/backup/README.md` 与 `docs/MONITORING.md` 自承局限（同机同盘、非实时告警），态度诚实。

**问题**：
- 无 PRD / 需求清单 / 验收标准主文档 / 需求追踪矩阵。`docs/design/` 119 个文件多为 P0–P9 UI 重设计过程资产（58 张截图、18 个 HTML 原型、14 个标注 JSON）。
- **验收证据几乎全空**：全仓 `- [x]` 仅 2 处（`PROJECT_REPORT.md:274-275`）；`docs/RELEASE.md:60-67` 发布检查 6 项全未勾；`PROJECT_REPORT.md:265-276` 上线清单 10 项 8 项未勾；`docs/SERVER_MYSQL_LOGIN.md:316-323` 8 项全未勾；P1–P9 设计稿约 60 项验收清单全未勾。KB `current-state.md:65-76` 自列 10 项待办（含 4 项真人验收、`0.6.1` 全站 UI/2FA/忘记密码复测）。
- **验收证据文件缺失**：`docs/design/REPORT-0.6.1.md:22` 等引用的 `rank-no-server.png`、`member-panel-*.png`、`admin-occupancy.png` 全库无匹配；P6–P9 图片引用 macOS 绝对路径 `/Users/...`，在 Windows 仓库必然断链。
- **API 文档滞后**：`server/README.md:38-65` 仅约 26 条接口（实际 99），无 schema / 错误码表 / 鉴权矩阵 / 限流说明；`FILES.md` 大量漏项（漏 4 个工作流、根级 `scripts/`、多个组件、多个 deploy 文件）；`esf-launcher/README.md` 是未改的 Vite 模板。
- **版本/IP/环境矛盾（≥8 处）**：权威 0.6.1 vs `website/index.html` 0.4.7 / `release/latest.yml` 0.5.21 / `server/updates/latest.yml` 0.2.4 / `deploy/deploy-esf-server.ps1:27` 0.2.4 / `deploy/amxx/README.txt` 0.4.6（KB 称线上 0.52）/ `docs/kb/environment/servers.md:46` 0.4.10；IP 与协议在 `PROJECT_REPORT.md`（老 IP + 无 HTTPS）、KB 与 `uptime.yml`（新 IP 但 `:3000`）、`docs/MONITORING.md` 之间三套说法；Node 18/20/22、MySQL 3306/3307、表数 21/29/39、测试数 21+39/55/74/81 各有多个口径。
- **旧文档未标作废**：`PROJECT_REPORT.md`（0.4.2）结论「不迁移 / 无 HTTPS / 备案未通过」与 KB「已迁移 / Caddy HTTPS」完全相反，却自带完整上线清单与决策记录且被 README 引用；`docs/ESF_MP_ARCHIVE.md`（0.4.7）自称「新接手的人只看这一份」且含明文口令。相较之下 `PROJECT_STATUS.md` 改为纯指针是正确做法。
- **缺失**：故障预案 / 启动器与 server 版本回滚手册、隐私政策与用户协议、`docs/release-<version>.md` 逐版本公告（仅有 0.4.0 一份）、`SECURITY.md` 无具体邮箱 / 响应 SLA / 支持版本范围。

### 3.8 交付准备（5.0）

**已具备**：CI 真实跑 `npm ci / lint / test / build`（launcher）与 MySQL 8 service + `migrate / test`（server）；Release 工作流打 NSIS + blockmap + latest.yml 并带上一版 blockmap；Pages 自动发布；uptime 15 分钟 4 探针（API / 备份心跳 / Pages / feed）；备份四要素脚本齐全；tag `v0.6.1` 存在。

**未达标**：
- **官网对外版本错误**：`website/index.html:183,190,301,307,322,386` 硬编码 0.4.7，下载按钮指向 `v0.4.7`；`:380-394` 在 `github.io` 静态托管下跳过 `/api/config`，因此 GitHub Pages **永久显示并分发 0.4.7**，落后 14 个版本。`website/README.md` 又写 0.4.2。
- **部署包过期到危险程度**：`deploy/esf-server-bundle.zip` 内后端 `package.json` 为 0.1.0、`sql/` 仅 001~007、`migrate.js` 不含任何 `CREATE PROCEDURE`。用 `deploy/deploy-esf-server.ps1` 部署会得到一个缺排位/约战/结算/ops 能力的后端。
- **发布配置缺陷**：`package.json:98` 发布源 `updates.example.com` 占位；`release.yml:30` 在 `workflow_dispatch` 下 `TrimStart('v')` 拿到分支名会导致 `npm version main` 失败；`:54` `fail_on_unmatched_files:false` 让「没构建出 exe」也静默成功；`:63` carry-blockmap 失败也 `continue-on-error`；`repair-blockmaps.yml` 是一次性硬编码脚本但 push 本文件即触发。
- **无可复现的 AMXX 构建链**：仓库只有 README 里手工 `amxxpc.exe` 命令片段；`amxx/README.md:24-35`（须转 GBK）与 KB `current-state.md:57`（UTF-8 无 BOM 直编）互相矛盾；`test_ranked.sma:2597` 疑似缺分号；`deploy/amxx/*.amxx` 未被 git 跟踪且版本标注 0.4.6 ≠ 线上 0.52，无法证明二进制与当前源码对应。
- **无代码签名**（三处一致：`package.json` build 段、`release.yml`、`website/README.md:54`）。
- **发布检查 6 项全未勾**；`esf-launcher/release/` 仅有 0.4.7 / 0.5.21 安装包，无 0.6.1 产物（KB 称线上已有 128,768,372 B 安装包，但不在仓库，需外部确认）。
- `.gitignore` 未覆盖 `*.zip`（3 个 zip 已入库）、`CREDENTIALS.txt`、`*.cnf`、`*.pwd`、`ops-key.txt`、`*.pem/*.pfx`；`deploy/deploy-esf-server.ps1:381-393` 会把 MySQL root 口令明文写入 `C:\esf\CREDENTIALS.txt`。
- 部署脚本硬编码本机绝对路径（`start-local-server.ps1:6`、`tunnel-watch.ps1:3`）、公网 IP 与外网镜像 URL（无 hash 校验），换机不可复现。

---

## 4. 已达标项（可直接确认）

1. **四端功能闭环**：Electron 启动器（大厅/地图/服务器/资源/管理台/频道/排位/托盘/连服/自动更新）、Express 后端（99 端点 / 36 表 / 2 个结算存储过程）、4 个 AMXX 插件、官网 + 更新 feed + 备份 + 监控探针均有真实代码，无空壳或 mock 运行时数据。
2. **核心业务链路可追踪到代码**：JWT 五级权限与双撤销、2FA/设备会话/找回密码、launch token 签发与 AMXX 侧消费、锁服、金币/竞猜、资源审核、审计日志、差量更新与 blockmap 一致性修复、结算失败补交。
3. **Node 侧安全基线**：全参数化 SQL、bcrypt、JWT 固定算法 + 会话校验、最小权限 DB 账号、Electron contextIsolation/safeStorage/contextBridge 白名单、路径穿越与 setinfo 注入防护、协议白名单。
4. **统一错误处理与事务回滚**（后端与 IPC 两侧）。
5. **备份与可观测性脚本**：每日备份 / 14 天保留 / SHA-256 / 存储过程完整性校验 / 临时库恢复演练 / 15 分钟 CI 探针。
6. **知识库与变更日志体系**：KB 22 页 + 明确的「先查 KB / 数字变了直接改 / 不写密钥」规则；CHANGELOG 覆盖到 0.6.1。
7. **CI 与发布管线存在且真实执行命令**（Node 20 下），tag `v0.6.1` 已打。
8. **本次实测**：`npm run lint` 通过；启动器 3 个测试文件 / 66 检查点全部通过；后端 22 个不依赖 DB 的用例通过。

---

## 5. 未完成 / 缺失项清单

| 类别 | 项 | 状态 |
|---|---|---|
| 安全 | 明文管理员口令清理与轮换、git 历史清除 | **未做（P0）** |
| 安全 | 代码签名、更新源签名校验、HTTPS 默认地址统一 | 未做 |
| 安全 | AMXX 旧账号系统明文密码 / SQL 拼接 / 打印密码整改 | 未做 |
| 安全 | 服务端权威赛果校验、统一 `resolveOptionalUser`、敏感端点限流、上传体积上限 | 未做 |
| 功能 | 开局自动分边（`jointeam` 下发） | KB 待办 9，未做 |
| 功能 | 维护模式/公告/最低版本/强制改密的服务端强制拦截 | 未做 |
| 功能 | 队列定时撮合、单端登录、告警通知 | 未做 |
| 验收 | 真人 1v1/2v2、观战 4 人、AFK 180/300s、赛后 10s 退出与结算补交 | KB 待办 1，未做 |
| 验收 | 发布检查 6 项、上线清单 8 项、设计稿约 60 项 | 全部未勾 |
| 测试 | e2e / 组件测试 / 覆盖率 / 独立测试库 / Node 20+ 全版本可运行 | 未做 |
| 工程 | 客户端 ErrorBoundary、全局异常钩子、崩溃监听、DB 重连与 fail-fast | 未做 |
| 工程 | 巨型文件拆分、静态类型、ESLint 覆盖 `.cjs`、异步化同步阻塞 | 未做 |
| 交付 | 官网版本/下载链、部署包后端、更新元数据、8+ 处版本号统一 | 未做 |
| 交付 | AMXX 可复现编译链、二进制与源码对应证明、0.6.1 产物归档 | 未做 |
| 文档 | PRD / 验收主文档 / 全量 API 文档 / 回滚与故障预案 / 隐私政策 / 逐版本发布公告 | 缺失 |
| 文档 | 旧报告标作废、FILES.md 重审、断链修复、验收截图归档 | 未做 |
| 合规 | 平台定位（小范围 vs 公开运营）、备案/版号结论、玩家个人信息处理机制 | 仅旧报告识别，无结论 |

---

## 6. 主要风险与影响

| 优先级 | 风险 | 可能影响 | 证据 |
|---|---|---|---|
| **P0** | 公开仓库泄露两台服务器 administrator 明文口令且复用 | 服务器被直接接管、数据库与玩家数据泄露、被植入挖矿/勒索；因仓库公开，应视为**已泄露** | `docs/ESF_MP_ARCHIVE.md:18-19` |
| **P0** | 官网分发 0.4.7 旧包、部署包是 0.1.0 旧后端 | 新用户装到 14 个版本前的客户端；从部署包重建的服务器缺排位/结算，直接业务事故 | `website/index.html:307`、`deploy/esf-server-bundle.zip` |
| **P0** | 版本/更新 feed/发布源不一致 + 无签名 | 自动更新可能拉到错误版本或全量回退；明文链路被劫持可分发恶意包 | `package.json:98`、`release/latest.yml`、`main.cjs:82,187` |
| **P1** | 核心排位链路开局不自动分边 + 真人验收未做 | 排位/约战主玩法在真实对局中可能不可用，而文档宣称「已交付」 | KB `:58`、`:67` |
| **P1** | `/ranked/settle` 参赛者自报赛果 | 刷分/刷币破坏排位与竞猜经济，进而影响玩家信任 | `ranked.js:622-678` |
| **P1** | `npm test` 在本地 Node 22 静默失败 + CI/发布 Node 版本不一致 | 开发者与贡献者实际跑不了测试；CI 绿灯无法代表本地可复现 | 本次实测 + `ci.yml:18,62` / `release.yml:22` |
| **P1** | 无 ErrorBoundary / 全局异常钩子 / DB 重连 / 迁移回滚 | 前端异常白屏无提示；DB 抖动后服务不恢复或迁移留半状态且无法回退 | 全仓检索零命中；`db.js`、`migrate.js` |
| **P1** | 无实时告警、备份同机同盘 | 故障发现延迟数十分钟；整机/磁盘故障无法恢复 | `docs/MONITORING.md:37-39`、`deploy/backup/README.md:149-157` |
| **P2** | 主进程同步阻塞 + 高频轮询 + 后端 N+1/索引缺失 | 游戏运行时界面卡顿、后台 CPU/网络开销、数据量大后接口变慢 | `main.cjs:453-498`、`ranked.js:712-741` |
| **P2** | 文档体系自相矛盾、旧报告未作废、验收证据缺失 | 新成员按 README 指引读到错误结论；无法证明任何验收已通过；交接成本高 | `PROJECT_REPORT.md`、`README.md:124` |
| **P2** | 合规未闭环（私服定位、备案、版号、隐私政策、素材授权） | 公开运营下的法律与下架风险 | `PROJECT_REPORT.md:294-296`、`website/sitemap.xml:4` |

---

## 7. 改进建议（按优先级，含验收标准）

### P0 — 立即处理（安全 / 阻断交付）

1. **凭据事件响应**
   - 轮换两台服务器 administrator 口令（不再复用）；审计登录日志是否有异常；轮换 `JWT_SECRET`、`UPDATE_UPLOAD_TOKEN`、`OPS_AGENT_KEY`、DB/AMXX 账号口令。
   - 从 `docs/ESF_MP_ARCHIVE.md` 移除凭据并**清理 git 历史**（filter-repo / BFG），同时把该文件与 `PROJECT_REPORT.md` 标注「历史/作废」或改为指针（参照 `PROJECT_STATUS.md`）。
   - 补 `.gitignore`：`CREDENTIALS.txt`、`*.cnf`、`*.pwd`、`ops-key.txt`、`*.pem/*.pfx`、`*.zip`；加 pre-commit 密钥扫描。
   - *验收*：全仓 `git grep` 无口令命中；历史重写后所有 clone 无凭据；轮换记录归档（只记位置与时间，不记值）。
2. **修好测试命令与运行环境**
   - 两个 `package.json` 的 `test` 改成显式 glob（如 `node --test "tests/*.test.cjs"`、`node --test "test/*.test.js"`）或改用 `node --test` 自动发现；把 CI / release / README 的 Node 版本统一到同一 LTS 并在 `engines` 与 `.nvmrc` 固定。
   - 后端测试改用独立测试库（testcontainers 或 CI MySQL service），去掉对开发库的污染与顺序依赖。
   - *验收*：在 Node 20 与 22 下 `npm test` 均 exit 0；CI 与本地同一 Node 版本；后端测试无需预先手工 `db:start`。
3. **统一版本单一来源**
   - 以 `esf-launcher/package.json` 版本为准，用发布脚本自动同步 `website/index.html`（静态托管改为读取 `latest.yml` 或构建期注入）、`release/latest.yml`、`deploy/deploy-esf-server.ps1`、`deploy/amxx/README.txt`、`src/data/releases.json`、`server/updates/latest.yml`。
   - 修 `package.json:98` 占位发布源；统一 uptime 探针 / MONITORING / 备份文档 / 部署脚本的 API 地址到 KB 记录的 HTTPS 入口；把 `PROJECT_REPORT.md`、`ESF_MP_ARCHIVE.md` 标为历史。
   - *验收*：一次 `npm version` + 发布脚本后，全仓检索只剩一个当前版本号；官网下载按钮指向当前版本。
4. **重建部署包**
   - 用当前 `server/` 重新生成 `deploy/esf-server-bundle.zip`（含 16 个 SQL、2 个存储过程），并在 CI 加校验「bundle 内 migrate.js 必须含 `settle_ranked_match`」。
   - *验收*：从零按 `deploy/README` 部署后 `/api/health` 返回 db up 且排位接口可用。

### P1 — 上线前收口

5. **健壮性**：加 React ErrorBoundary + 主进程 `uncaughtException`/`unhandledRejection` + `render-process-gone` + 渲染层 `window.onerror`；`db.js` 加 `pool.on('error')`/超时/重连与启动 fail-fast；`fail()` 不再把 DB 错误转 400；给 `settle_ranked_match` 加事务与幂等保护；迁移加版本表与回滚脚本、修 `013` 重复编号与缺失 `USE`。
6. **安全加固**：`/ranked/settle` 改为服务端权威判定或要求 AMXX 签名/服务端 token；统一 `resolveOptionalUser` 到完整鉴权；给 launch-token/上传/ops/下注/结算/lookup 加限流、更新包上传加体积上限与常量时间比较；下线或修复 AMXX `tb_user` 明文密码路径、删除 `server_print` 中的密码；客户端默认 API 改 HTTPS 并去掉硬编码 IP；`x-forwarded-for` 只在可信反代下采信。
7. **完成核心玩法与验收**：修开局自动分边（`engclient_cmd jointeam` + 8 秒冷却重试方案，见 `known-issues.md` 第 8 条）；组织真人 1v1/2v2 实战，逐项验收观战 4 人、锁服排队、AFK 180/300s、赛后 10s 退出与结算补交，把截图/结果回写 KB 并关掉待办；勾选发布检查 6 项与上线清单。
8. **接入代码签名与告警**：CI 接入签名证书（secrets）+ `signtool`/electron-builder 签名配置；uptime 失败接实时通知渠道并定义阈值与值班人。
9. **性能**：`tasklist`/`powershell` 改异步 spawn 或把 `gameWatcher` 降到 5–10s；合并渲染层轮询、拆 `Lobby.jsx`、对大子树加 `React.memo`；后端补 `challenge_rooms.server_key` 与 `presence.updated_at` 索引、消除 N+1、连接池加 acquire 超时、给队列加定时撮合。

### P2 — 可维护性与合规

10. **文档治理**：新增 PRD/功能清单 + 当前有效验收主文档；补 99 端点的 API 文档（schema/错误码/鉴权矩阵）；`SECURITY.md` 补具体邮箱、响应 SLA、支持版本；重审 `FILES.md`；补故障预案与启动器/server 回滚手册；统一 ADR 模板；修 P6–P9 断链、归档缺失截图；补齐 `docs/release-<version>.md` 或修订 `RELEASE.md` 要求。
11. **代码质量**：拆分 `main.cjs`/`App.css`/巨型组件，渐进引入 TypeScript 或 JSDoc 类型；ESLint 对 `.cjs` 启用 recommended；删除未使用依赖；把 AMXX 编译、版本同步、发布脚本化并纳入 CI（含 `.sma` → `.amxx` 哈希对照）。
12. **合规**：正式决策平台定位（小范围邀请制 vs 公开运营）并据此处理公开下载与竞猜；明确 `esfcn.cn` 备案/HTTPS/自定义域名结论；补隐私政策、用户协议、数据留存/删除/导出机制；评估游戏衍生素材授权；`CONTRIBUTING.md` 的「SQL 全部参数化」要么落实到 AMXX，要么写明适用范围。

---

## 8. 信息不足 / 无法确认的部分（需补充资料）

本次为离线静态审计 + 本地测试，以下结论**无法从仓库确认**，需用户提供资料或授权联网/线上探测后才能定论：

| # | 待确认事项 | 需要补充的资料 |
|---|---|---|
| 1 | **线上真实状态**：0.6.1 安装包与插件包 0.52 是否真在两台机运行、Caddy HTTPS 与证书是否有效、`ESFAPI`/`ESFCaddy`/`ESFDBBackup`/`ESFAmxxUpdate` 计划任务是否在跑 | 脱敏的线上快照：`/api/health` 与 `/api/config` 响应、计划任务导出、Caddy 配置、`backup.json` 样例、`amxx_builds` 查询结果 |
| 2 | **生产凭据现状**：`.env` 键名与轮换记录、ops key、`CREDENTIALS.txt` 是否仍存在 | 键名清单（不含值）+ ACL 说明 + 轮换记录 |
| 3 | **验收结果**：4 项真人验收、全站 UI/2FA/设备会话/忘记密码复测、备份恢复演练 | 验收记录（时间/参与人/环境/截图或录屏）；仓库内引用的 `rank-no-server.png`、`admin-occupancy.png`、`member-panel-*.png` 原件 |
| 4 | **AMXX 构建可复现性**：`deploy/amxx/*.amxx` 是否由当前 `.sma` 编译、GBK vs UTF-8 决策、线上 0.52 包与 4 个二进制的对应 | `amxxpc.exe` 版本与 `include/` 目录、编译脚本、线上 0.52 包 `manifest.json` + 各 `.amxx` SHA256 对照 |
| 5 | **CI 与测试真实通过率**：`PROJECT_REPORT.md:240` 提到的 CI run 41916304147、21/39/55/74/81 各口径 | Actions 运行记录导出 / 测试报告归档 |
| 6 | **发布产物**：0.6.1 exe / blockmap / latest.yml 的 sha512 与 size、GitHub Release assets、Pages 部署状态 | Release 页面导出或 `gh release view v0.6.1` 输出 |
| 7 | **域名与合规**：`esfcn.cn` ICP 备案/DNS/证书状态、是否人工做过代码签名、私服授权与版号结论 | 域名与证书台账、签名证书信息、正式的平台定位决策记录 |
| 8 | **部署包内可疑字符串**：`deploy/esf-server-bundle.zip` 内 `.env.example` 的密码样式值（变量名已损坏）是历史真实凭据还是脱敏事故 | 该 bundle 的生成来源与时间；若是真实口令，需纳入 P0 轮换范围 |
| 9 | **运行时性能**：重复渲染、同步阻塞的实感影响、electron-updater 对多段 Range 的兼容性、更新包签名校验行为 | React DevTools profiler 记录、真机更新日志、updater 调试日志 |
| 10 | **设计稿验收清单语义**：`docs/design/P1~P9` 约 60 项未勾选是「未做」还是「做了没回写」 | 维护者确认；建议之后统一改为带证据链接的验收记录 |

> 说明：`.github/workflows/ci.yml` 与 `server/.env.example` 的部分逐行内容在本次读取时被环境的敏感内容审批拦截，未重试、未绕过；相关结论由 `Grep` 定向结果（Node 20、MySQL service、`npm ci/migrate/test`）与 `src/env.js` 的 44 个变量解析交叉佐证，逐行细节仍建议人工复核。

---

## 附录：本次实测命令与输出摘要

```
node -v                                   → v22.22.2；npm 10.9.7
git status --short                        → 仅 ?? .agents/（工作区干净）
npm --prefix esf-launcher run lint       → exit 0，无告警
npm --prefix esf-launcher test           → 失败：Cannot find module '...\tests'（TAP pass 0 / fail 1）
node --test tests/*.test.cjs             → 3/3 文件通过，66 检查点全过，约 15.5s
npm --prefix server test                 → 失败：Cannot find module '...\test'
node --test test/*.test.js               → 85 用例：22 pass / 63 fail
                                          63 个失败均为「数据库不可用：请先 npm run db:start 并 npm run migrate」
ci.yml:18,62                             → node-version: 20
release.yml:22                           → node-version: 22
```
