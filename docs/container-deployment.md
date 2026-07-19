# NEye 容器部署与验证手册

本文用于生产和预发布环境，目标是把数据库变更、数据回填和 API 进程发布分离，保证每一步可观察、可停止、可回滚。

## 1. 部署边界

- Web：静态资源托管，API 地址由构建变量注入。
- API：NestJS 容器，默认只启动服务，不修改数据库结构、不回填、不 seed。
- 数据库：PostgreSQL 持久化或托管实例。
- 微信小程序：API HTTPS 域名必须加入微信 request 合法域名。

生产环境至少准备：`DATABASE_URL`、强随机 `JWT_SECRET`、`CORS_ORIGINS`、`PORT`。API 位于反向代理后时，应按实际且固定的代理层数设置 `TRUST_PROXY_HOPS`，否则保持 `0`。微信凭据保存在系统设置中，不写入镜像或部署日志。

## 2. Docker Hub 镜像发布

GitHub Actions 在 `main` 推送通过门禁后自动构建并推送镜像。仓库需要配置两个 Actions Secrets：`DOCKERHUB_USERNAME` 和 Docker Hub access token `DOCKERHUB_TOKEN`。镜像名称固定为 `${DOCKERHUB_USERNAME}/neye-api`，包含以下标签：

- `latest`：`main` 最新成功构建；
- `sha-<完整提交哈希>`：每次推送的不可变回滚版本；
- `1.2.3`、`1.2`：推送 `v1.2.3` Git 标签时生成。

本地手动构建示例：

```bash
IMAGE="$DOCKERHUB_USERNAME/neye-api"
docker build -t "$IMAGE:$RELEASE_TAG" .
docker push "$IMAGE:$RELEASE_TAG"
```

镜像内置 readiness 健康检查。不要用 `latest` 作为唯一可回滚标识。

## 3. 发布前门禁

```bash
pnpm install --frozen-lockfile
pnpm prisma validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

CI 使用隔离 PostgreSQL 和 `prisma db push` 创建临时测试结构；验证全部通过后才会构建并推送 Docker Hub 镜像。

## 4. 数据库发布策略

### 4.1 默认安全行为

数据库结构操作收敛为单一变量 `DB_SETUP_MODE`：

| 值 | 用途 | 行为 |
| --- | --- | --- |
| `none` | 日常启动（默认） | 不修改数据库 |
| `init` | 首次部署空库 | `prisma db push` 后执行幂等 seed |
| `update` | baseline 前的结构升级 | 执行不接受数据丢失的 `prisma db push` |
| `migrate` | baseline 完成后的结构升级 | 执行 `prisma migrate deploy` |

非法值会拒绝启动。任何非 `none` 模式都应作为一次性发布任务运行，成功后立即改回 `none`，避免 API 多副本重复执行。`RUN_DB_BACKFILLS` 默认 `false`，仅在发布说明要求时临时开启。

### 4.2 当前 baseline 限制

现有迁移目录不包含最初建库基线，不能假设 `prisma migrate deploy` 可直接用于历史生产库或全新空库。切换到 migration 前必须：

1. 从生产备份恢复一份隔离数据库。
2. 由开发和 DBA 共同整理、评审初始 baseline 与后续迁移顺序。
3. 在空库验证完整建库，在生产副本验证 baseline 标记不会重放已有 DDL。
4. 执行业务 E2E、约束校验和回滚演练。
5. 记录已批准的 migration 名称、校验结果和负责人。

完成上述步骤前，`pnpm db:migrate:status` 仅用于诊断，不得据此直接对历史生产库执行 deploy。

### 4.3 首次部署空库

复制 `.env.docker.example` 并填写必填项，文件中的 `DB_SETUP_MODE` 始终保持 `none`。首次部署只在一次性容器中覆盖为 `init`。该模式创建当前 schema 并初始化管理员；已有同名管理员时会幂等跳过，若同名账号不是管理员则拒绝自动提权。

```bash
docker run --rm --env-file .env.docker \
  -e DB_SETUP_MODE=init \
  "$DOCKERHUB_USERNAME/neye-api:$RELEASE_TAG" true
```

任务成功后直接以 `DB_SETUP_MODE=none` 启动 API。生产环境未设置 `SEED_ADMIN_PASSWORD`，或仍使用示例占位密码时，初始化会拒绝执行。

### 4.4 baseline 完成前的结构升级

只有在隔离副本验证、完成备份并人工审查 Prisma 输出后，才可运行：

```bash
docker run --rm --env-file .env.docker \
  -e DB_SETUP_MODE=update \
  "$DOCKERHUB_USERNAME/neye-api:$RELEASE_TAG" true
```

`update` 不传递 `--accept-data-loss`。如果 Prisma 报告需要接受数据丢失或无法执行，应立即停止，由 DBA 核对实际 schema diff、受影响数据和恢复点后制定迁移方案。禁止通过修改容器开关绕过保护。

操作结束立即恢复 `DB_SETUP_MODE=none`。禁止把 `init`、`update` 或 `migrate` 长期写入 API Deployment。

#### 4.4.1 P2022 / `import_tasks.phase` 缺列恢复

新镜像中的 Prisma Client 和导入任务恢复逻辑会查询 `import_tasks.phase`。如果 API 镜像先于数据库 schema 发布，且 `DB_SETUP_MODE=none`，entrypoint 会跳过数据库变更，新代码随后会因旧库缺列而返回 Prisma P2022。这是发布顺序不一致，不应通过删除表、重建数据库或接受数据丢失来处理。

恢复步骤：

1. 停止全部 API 副本和导入 worker，避免旧、新 worker 并行处理任务。
2. 使用 `pg_dump` 完成生产库备份，并确认备份文件可读、存储空间充足；有条件时先在隔离恢复库演练。
3. 使用本节上方的 `DB_SETUP_MODE=update` 一次性任务同步旧库。
4. 如果 Prisma 要求接受数据丢失或无法安全完成，立即停止并交由 DBA 审查，不得追加危险参数重试。
5. 同步成功后验证 `phase` 列可查询，再只启动一个 API 实例并验证 readiness：

```bash
psql "${DATABASE_URL%%\?*}" -v ON_ERROR_STOP=1 \
  -c 'SELECT "phase", COUNT(*) FROM "import_tasks" GROUP BY "phase" ORDER BY "phase";'
curl --fail https://api.example.com/api/health/ready
```

结构查询和 readiness 均成功后，再检查管理端导入任务列表并用一份小文件验证导入；确认无误后恢复其他 API 副本。`DB_SETUP_MODE` 继续保持 `none`。

### 4.5 推荐 release job（baseline 完成后）

先备份并检查状态：

```bash
pg_dump "$DATABASE_URL" --format=custom --file="neye-$RELEASE_TAG.dump"
docker run --rm --env-file .env.docker --entrypoint pnpm \
  "$DOCKERHUB_USERNAME/neye-api:$RELEASE_TAG" db:migrate:status
docker run --rm --env-file .env.docker \
  -e DB_SETUP_MODE=migrate \
  "$DOCKERHUB_USERNAME/neye-api:$RELEASE_TAG" true
```

迁移成功后再启动 API 容器。不要让每个副本同时执行迁移。

### 4.6 数据回填

回填与 DDL 分开执行，并观察耗时、错误和数据库负载：

```bash
docker run --rm --env-file .env.docker \
  -e RUN_DB_BACKFILLS=true \
  "$DOCKERHUB_USERNAME/neye-api:$RELEASE_TAG" true
```

## 5. 启动与探针

```bash
docker run -d --name neye-api \
  --restart unless-stopped \
  --env-file .env.docker \
  -p 3100:3000 \
  "$DOCKERHUB_USERNAME/neye-api:$RELEASE_TAG"
```

验证：

```bash
curl --fail https://api.example.com/api/health/live
curl --fail https://api.example.com/api/health/ready
```

- liveness 失败：进程或 HTTP 服务异常，可重启容器。
- readiness 失败：数据库连接异常，不应接收新流量；先检查数据库、连接数、防火墙和 `DATABASE_URL`。
- `/api/health` 仅为旧探针兼容路径。

发布时先等待新实例 readiness 成功，再切流量和停止旧实例。Nest 已启用优雅停机钩子，编排器仍应提供足够的 termination grace period。

## 6. 认证与微信验证

1. 连续错误密码达到阈值后应返回 429，窗口结束后恢复。
2. 水平扩容环境必须在 API 网关配置全局登录/扫码限流；应用内计数只覆盖单实例。
3. 微信 API 网络中断应返回 502，超时应返回 504，无效或重复 code 返回 401。
4. 扫描 Web 登录二维码后，小程序必须显示明确的确认和拒绝按钮。
5. 未确认前 Web 不得获得 Token；确认后只能消费一次；拒绝后二维码立即失效。
6. AppID/AppSecret 轮换后重新生成二维码，确认不会复用旧配置的 access token。

## 7. Web 与小程序部署

Web 构建必须设置实际 API HTTPS 地址，并为前端路由配置 SPA 回退到 `/index.html`；不得把 `/api` 重写成静态页面。

小程序要求：

1. `manifest.json` AppID 与系统设置一致。
2. API HTTPS 域名加入微信 request 合法域名。
3. 小程序码环境与发布阶段一致：`release`、`trial` 或 `develop`。
4. 使用 HBuilderX、微信开发者工具和真机完整验证登录、绑定、扫码确认与拒绝。

## 8. 备份、恢复与回滚

备份示例：

```bash
pg_dump "$DATABASE_URL" --format=custom --file=neye.dump
```

恢复必须先在隔离库演练：

```bash
pg_restore --clean --if-exists --dbname="$RESTORE_DATABASE_URL" neye.dump
```

应用回滚优先切回上一个不可变镜像。数据库迁移原则上采用向前修复；只有确认数据破坏、具备维护窗口且恢复点有效时，才执行整库恢复。恢复后必须验证 readiness、管理员登录、租户隔离、客户/验光/配镜主流程和导入任务状态。

数据库备份包含明文 AppSecret，备份介质、访问账号和下载记录必须按敏感数据管理。

## 9. 常见故障

| 现象 | 排查 |
| --- | --- |
| Prisma P1001 | 数据库地址、端口、防火墙或服务状态 |
| readiness 503 | 数据库连通性、连接池、凭据和数据库负载 |
| entrypoint 拒绝数据库操作 | 检查 `DB_SETUP_MODE` 是否为 `none`、`init`、`update` 或 `migrate` |
| `init` seed 拒绝执行 | 设置非默认、非占位的 `SEED_ADMIN_PASSWORD` |
| 微信请求 504 | 后端到 `api.weixin.qq.com` 的网络、DNS 或超时设置 |
| 微信请求 502 | 微信上游错误、响应格式或凭据配置 |
| Web 扫码一直等待 | 检查小程序是否显示确认页、会话是否过期、手机是否明确确认 |
| CORS 报错 | `CORS_ORIGINS` 必须包含实际 Web Origin |
| Web 路由刷新 404 | 静态托管缺少 SPA 回退规则 |

## 大批量导入迁移发布

该版本新增导入源文件、阶段游标和业务记录归属字段。发布前先停止所有旧版本 API/导入 worker，确认没有旧 worker 仍在处理任务，再备份数据库并执行评审过的 migration；迁移成功后只启动一个新版本实例验证 readiness 和导入恢复，最后再恢复其他 API 副本。不要让旧 worker 与新 schema 并行运行。

XLSX 解析受 50 MB/50,000 行默认边界保护，并非无限导入。单实例 worker 并发固定为 1，业务处理默认每 750 行提交短事务。需要提高上限时应先在生产副本压测内存、数据库连接和清理/发布耗时，再调整环境变量。
内存容量不是上传大小的等值映射：30,469 行 × 59 列、约 6.47 MB 的实际 XLSX 使用 `dense: true` 解析时，实测约 3.06 秒、RSS 增量约 419 MiB。该规模容器建议至少提供 1 GiB 可用内存；若要承诺默认 50,000 行 × 80 列容量，建议预留至少 2 GiB 并先完成生产副本压测。保持 `IMPORT_WORKER_CONCURRENCY=1`，50 MB 仅是上传上限。

上传链路会恢复 multipart 中被 Latin-1 误解码的 UTF-8 中文文件名；发布验证应至少包含一个中文文件名和中文 Sheet/表头的真实 HTTP 上传，并在完成后回滚测试数据。审计日志功能已移除，最新迁移会删除 `audit_logs` 表；危险操作仍依赖管理员权限与精确名称二次确认。
