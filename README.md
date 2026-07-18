# NEye Backend API

基于 NestJS、Prisma 和 PostgreSQL 的多租户 API。

## 本地开发

```powershell
Copy-Item .env.example .env
pnpm install
pnpm prisma:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

`db:push` 仅用于本地或明确的一次性旧库同步，不应作为生产 API 进程的默认启动动作。

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接地址 |
| `JWT_SECRET` | JWT 签名密钥，生产环境必须使用强随机值 |
| `JWT_EXPIRES_IN` | Token 有效期，默认 `12h` |
| `CORS_ORIGINS` | 允许访问 API 的 Web Origin，多个值使用逗号分隔 |
| WECHAT_API_TIMEOUT_MS | 微信 API 超时，默认 8000，限制为 1000-30000 毫秒 |
| TRUST_PROXY_HOPS | API 前可信反向代理跳数，直连为 0；用于取得真实客户端 IP 做限流 |
| `PORT` | API 监听端口 |

生产环境没有配置 `CORS_ORIGINS` 时，API 会拒绝启动。

## 账号、权限与租户

- 账号通过 `user_tenants` 成员关系分配到零个、一个或多个租户。
- `admin` 拥有全系统权限；`staff` 只能访问已分配且启用的租户。
- 多租户账号通过 `X-Tenant-Id` 选择当前租户，后端逐次验证成员关系。
- 未分配租户的普通账号可以登录个人中心，但不能访问租户业务数据。
- 商品字典按当前产品决策全局共享。

历史数据回填必须作为独立、可观察的发布任务显式执行：

```powershell
pnpm db:backfill-user-tenants
pnpm db:backfill-customer-pinyin
```

## Docker

```powershell
docker build -t neye-api .
docker run --env-file .env.docker -p 3100:3000 neye-api
```

所有数据库变更默认关闭：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RUN_DB_MIGRATIONS` | `false` | 显式运行 `prisma migrate deploy` |
| `RUN_DB_PUSH` | `false` | 显式运行旧库结构同步 |
| `ALLOW_UNSAFE_DB_PUSH` | `false` | `RUN_DB_PUSH=true` 时必须同时确认 |
| `RUN_DB_PUSH_ACCEPT_DATA_LOSS` | `false` | 仅在备份、评审 Prisma 警告后临时开启 |
| `RUN_DB_SEED` | `false` | 显式执行种子数据 |
| `RUN_CUSTOMER_PINYIN_BACKFILL` | `false` | 显式回填姓名拼音 |
| `RUN_USER_TENANT_BACKFILL` | `false` | 显式回填账号租户关系 |

生产发布、旧库 baseline、备份恢复和回滚流程见 [容器部署说明](docs/container-deployment.md)。

## 管理后台治理

- 管理总览提供租户、账号、客户、验光单、配镜单和导入任务聚合指标。
- 系统状态页展示 API 运行时、内存和数据库 readiness，不返回环境变量或密钥。
- 租户、账号和导入任务的危险操作保留精确名称二次确认；审计日志模块、`/api/audit-logs` 接口和 `audit_logs` 表已移除，不再要求填写无落库用途的操作理由。
- 管理接口继续由 JWT、`admin` 角色和租户权限校验保护。

## 健康检查

- `GET /api/health/live`：进程存活，不访问数据库。
- `GET /api/health/ready`：执行轻量 PostgreSQL 查询；数据库不可用时返回 503。
- `GET /api/health`：兼容旧探针，语义等同 liveness。

应用启用了 Nest 优雅停机钩子。容器健康检查使用 readiness，流量入口也应使用 readiness；编排器存活检查使用 liveness。

## 微信登录与扫码登录

微信登录默认关闭，由管理员在系统设置中配置 AppID、AppSecret 和小程序码环境。

- 微信 `fetch` 请求统一设置超时，并区分无效登录 code、上游超时、网络错误和无效响应。
- access token 按 AppID 与 AppSecret 指纹缓存；配置轮换后不会复用旧凭据 token。
- Web 扫码登录不会在扫描后自动授权。小程序必须显示账号并由用户明确确认或拒绝。
- 确认令牌绑定会话、账号和微信身份；确认、拒绝和 Web 消费均为带状态条件的一次性更新。
- 绑定二维码仍只执行当前登录账号的微信绑定，不授予新的 Web 登录会话。
- AppSecret 仍按当前产品决策明文保存并由管理员设置接口回显，数据库与备份必须按敏感数据保护。

密码登录、扫码会话、轮询、绑定和确认入口带轻量进程内限流。它只保护单个 API 实例；水平扩容时各实例计数不共享，应在网关增加全局限流，或迁移到 Redis 等共享存储。

## 验证

```powershell
pnpm prisma validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm test` 会连接测试 PostgreSQL，确认数据库地址后再运行。`.github/workflows/ci.yml` 会启动隔离的 PostgreSQL 服务并执行完整门禁。

## 大批量导入

客户验光单上传会先持久化源文件并立即返回任务，后台使用 SheetJS 做受容量限制的异步解析。上传文件名会安全恢复 multipart 中被 Latin-1 误解码的 UTF-8 中文名称，模板下载同时提供 ASCII fallback 与 RFC 5987 `filename*`。XLSX 不是逐行流式格式，因此仍保留文件大小、行列数和工作表数量上限；默认支持 50 MB、50,000 行、80 列和 10 个工作表。解析结果写入暂存行，业务数据每 750 行使用短事务写入且在发布前保持隐藏；失败或取消会清理本任务未发布的数据，全部成功后才原子发布。

可通过 `IMPORT_MAX_FILE_BYTES`、`IMPORT_MAX_ROWS`、`IMPORT_MAX_COLUMNS`、`IMPORT_MAX_SHEETS` 和 `IMPORT_BATCH_SIZE` 调整边界，服务端会对异常值做安全回退和钳制。`IMPORT_WORKER_CONCURRENCY` 当前固定钳制为 1，避免单实例并行解析多个 XLSX 导致内存峰值叠加。管理端从 `/api/import-tasks/capabilities` 读取实际能力，不再硬编码 5,000 行。
容量基准：对 30,469 行 × 59 列、约 6.47 MB 的实际 XLSX，`dense: true` 解析约 3.06 秒，进程 RSS 增量约 419 MiB。50 MB 是上传文件上限，不代表解析内存只占 50 MB。处理该规模文件时建议 API/worker 可用内存至少 1 GiB；若要使用默认 50,000 行 × 80 列的最大容量，建议预留至少 2 GiB 并先用生产数据副本压测。worker 并发保持为 1。