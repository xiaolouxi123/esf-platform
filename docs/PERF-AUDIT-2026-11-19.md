# ESF 平台运行性能审计（2026-11-19）

> 范围：平台机 217、游戏服 EVM 27015/27016、FCX 27017、平台 API 与轮询。
> 触发：社区反馈服务器 ping 偏高；EVM 两人对局时 ping 可到 1000ms。
> 方法：主机与进程取证、A2S/RCON 实测、MySQL 慢查询、API 基准、配置对比、持续采样。
> 结论口径：已消除最可疑的 choke 配置，**2 人对局仍需社区实测确认**，不能提前宣称修复完成。

## 健康分

| # | 维度 | 分数 | 关键发现 |
|---|---|---|---|
| 1 | 网络与游戏服 | 1 | EVM 客户端 rate/updaterate 与 30 次/秒快照不匹配；旧 HLDS 两次 0xc0000005 崩溃 |
| 2 | 主机资源 | 2 | 4GB 跑 MySQL + 3 台游戏服 + Defender，优化前可用内存仅 465MB |
| 3 | API 延迟与体积 | 3 | 无 gzip，成员列表 12.5KB；加 gzip 后 6.8KB，p50 11ms |
| 4 | 后台轮询 | 3 | 轮询可叠加、串行；已改并行 + 防重入 |
| 5 | 可观测性 | 3 | 原无采样；已上 perf-watch，但无告警 |
| **合计** |  | **12/20** | **Acceptable（仍有容量与引擎风险）** |

## 根因排序

### P0：EVM 网络参数与快照频率不匹配（最可疑）

- 优化前 EVM 服务端：`sv_maxrate 0`、`sv_minrate 0`、`sv_maxupdaterate 30`。
- 优化前 EVM 客户端 `esf/autoexec.cfg`：`rate 25000`、`cl_rate 20000`、`cl_cmdbackup 40`、`cl_cmdrate 100`、`cl_updaterate 100`、`ex_interp 0.1`。
- 含义：服务器每秒 30 次快照，客户端却按 100 次/秒上报并保留 40 个备份命令，且下行只给 25KB/s。两人对局时上行命令、下行快照与 12Mbps 出口叠加，容易出现 choke/backlog，表现为 ping 瞬间飙高。
- 已改：
  - 服务端 `esf/server.cfg`：`sv_minrate 40000`、`sv_maxrate 80000`、`sv_minupdaterate 20`、`sv_maxupdaterate 30`。
  - 客户端 `esf/autoexec.cfg`：`rate 60000`、`cl_rate 60000`、`cl_cmdbackup 8`、`cl_cmdrate 30`、`cl_updaterate 30`、`ex_interp 0.05`。
  - 已通过 RCON 在 27015/27016 运行时生效，并写回配置，换图/重启后保留。
- 容量核算：80KB/s × 2 人 ≈ 1.28Mbps；8 人 ≈ 5.1Mbps；217 出口按元数据为 12Mbps，余量约 7Mbps 给 API、更新与突发。

### P1：4GB 主机内存余量过小

- 优化前：Available 465MB；Committed 4483MB / 5962MB；pagefile 峰值 1677MB（约 90%）。
- 同机：MySQL 8（private 723MB）、2 台 2006 HLDS、1 台 ReHLDS、HLSM、Caddy、Node API、Defender、腾讯云 agent、桌面与微信云盘。
- 已做：
  - Defender 排除游戏目录/MySQL/Node/更新目录与进程，空闲扫描 CPU 2.19% → 0.3%。
  - 停止并禁用 SysMain。
  - 停止 WeiyunApp / wylogin（未卸载，重启后可能回来）。
- 结果：Available 465 → **665–751MB**；Committed 4483 → **4036–4112MB**。
- 仍未解决：4GB 对 3 台游戏服 + MySQL 偏紧；若 2 人局仍卡，优先升 8GB 或把 EVM 迁到 114。

### P1：EVM 是 2006 年旧 HLDS，且已两次崩溃

- 27015/27016 均为 `hlds.exe` 4.1.1.1（2006 构建），无 `-pingboost`；FCX 27017 是 `rehlds.exe -pingboost 2`。
- 事件日志：27015 在 2026-11-17 13:08:20、2026-11-18 11:47:44 两次 `0xc0000005`；HLSM 检测进程丢失后重启。
- 影响：崩溃前可能出现整服卡死，用户感知同样是「ping 1000ms / 掉线」。
- 未做：ReHLDS 迁移、sys_ticrate 调整、`1v1.amxx` 行为分析。ReHLDS 迁移是下一步最高价值的稳定性改造。

### P2：API 与轮询（已修）

- 原 `/api/members` 12504B、无 gzip；`/api/members/presence` 2217B，前端 800ms 轮询。
- 原 `serverPoller.js` 串行查询且 `setInterval` 无防重入，慢服务器会让轮询叠加。
- 已改：
  - `gzipJson` 中间件：>1024B 才压，设置 `Content-Encoding` / `Vary` / `Content-Length`。
  - 轮询并行 `Promise.allSettled`，加 `inFlight`，改递归 `setTimeout`。
- 实测：members 12504→6855B；presence 2217→249B；servers 1613→425B；ranked state 1238→504B。
- 217 本机 20 次：members p50 11.0 / p95 28.0 / max 91.6ms；presence 7.3/8.6/10.9ms；ranked state 11.6/14.0/17.4ms。
- 轮询验证：4 台 `server_status.updated_at` 同为 04:42:19，age 11s，ping 3–5ms，说明并行生效。

### P2：出口带宽 12Mbps 是硬上限

- 腾讯云元数据 `instance/bandwidth-limit-egress` = 1572864 B/s（12Mbps），ingress 同。
- 本机 HTTPS 单流/4 并发只测到 2.77–2.93Mbps，未跑满；可能是 Caddy/TLS/路由限制，需另查。
- 对游戏服而言 8 人 × 80KB/s 仍在 12Mbps 内，但平台更新、语音/资源下载与游戏同抢出口时会抖动。

## 已排除

- 成员 presence 查询本身：EXPLAIN ANALYZE 0.58ms、15 行。
- 217 空闲网络：A2S 12 次，p50 12–16ms，无丢包。
- 网卡错误：0 discarded / 0 error。
- MySQL 慢查询：Slow_queries=0，Threads_running 2，Max_used 26。
- 当前 EVM 空闲 FPS 正常：直连 RCON 206.03 / 175.54 / 244.14；监控曾采到 82/95/92 的瞬时低值（CPU 41%），随后恢复，保留采样抓 2 人局。

## 监控与复现

- 脚本：`server/scripts/perf-watch.cjs`；217 上 `C:\esf\tools\perf-watch.cjs`。
- 计划任务：`ESFPerfWatch`（ONSTART，SYSTEM，Highest）。
- 日志：`C:\esf\logs\perf-watch.csv`。
- FPS 取 3 次 `stats` 的中位数（间隔 300ms），避免换图/进人时的瞬时低值被误记为故障；当前空闲中位数为 174 / 211 / 246。
- 表头：`time,total_players,evm27015_players,evm27016_players,fcx27017_players,evm27015_fps,evm27016_fps,fcx27017_fps,cpu_pct,free_mb,tx_kbps,rx_kbps`。
- 2 人对局时抓 `players>0` 的行；若 FPS < 100 或 CPU > 80% 连续 3 个采样，基本可判定主机/引擎瓶颈而非纯网络。

## 下一步

1. 社区在 EVM 打一场 2 人局，记录游戏内 scoreboard ping 与发生时间；对照 `perf-watch.csv`。
2. 若仍飙高：把 EVM 迁到 ReHLDS（复用 FCX 的 `rehlds.exe` + booster 配置），或把 217 升到 8GB；同时可临时注释 `1v1.amxx` 做 A/B。
3. 若空闲也高：查客户端到 217 的线路与本地网络，而不是服务器 FPS。
4. 平台侧继续：0.6.57 收录 gzip/轮询/监控改动；之后再回 UI 模块与发版。

## 备注

- 平台页面显示的 ping 是 **217 服务端 A2S 往返**，不是玩家到服务器的 RTT；判断玩家体验应看游戏内 scoreboard。
- 所有主机改动可逆：Defender 排除可移除，SysMain 可恢复 Automatic，Weiyun 可重启；EVM 配置均有 `.bak-<时间戳>` 备份。
