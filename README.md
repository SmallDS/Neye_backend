# NEye Backend API

基于 NestJS、Prisma 和 PostgreSQL 的多租户 API。

## 本地开发

    Copy-Item .env.example .env
    pnpm install
    pnpm prisma:generate
    pnpm db:push
    pnpm db:seed
    pnpm dev

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| DATABASE_URL | PostgreSQL 连接地址 |
| JWT_SECRET | JWT 签名密钥，生产环境必须使用强随机值 |
| JWT_EXPIRES_IN | Token 有效期，默认 12h |
| CORS_ORIGINS | 允许访问 API 的 Web Origin，多个值使用逗号分隔 |
| PORT | API 监听端口 |

生产环境没有配置 CORS_ORIGINS 时，API 会拒绝启动，避免意外允许任意网站跨域访问。

## 账号、权限与租户

- 账号独立存储，通过 user_tenants 成员关系分配到零个、一个或多个租户。
- admin 拥有全系统权限，不需要租户分配；staff 只能访问已分配且启用的租户。
- 多租户账号通过 X-Tenant-Id 请求头选择当前租户，后端会逐次验证成员关系。
- 未分配租户的普通账号可以登录个人中心，但不能访问客户、验光单和配镜单。
- 删除租户会删除其业务数据与账号分配关系，不会删除独立账号。
- 客户、验光单和配镜单使用复合租户外键，防止跨租户错误关联。
- 商品字典全局共享：所有登录用户可查询，只有 admin 可以手工新增、编辑和删除。
- staff 保存配镜单时仍可自动沉淀新的商品字典项。

旧版 users.tenant_id 暂时作为迁移字段保留，历史账号可执行以下命令回填成员关系：

    pnpm db:backfill-user-tenants

## 客户拼音查询

客户姓名会在新建、改名和导入时自动生成完整拼音与首字母，客户列表的 `keyword` 同时支持姓名、完整拼音、拼音首字母、手机号和客户编号。

历史客户可手动回填：

    pnpm db:backfill-customer-pinyin

容器在数据库结构同步后默认自动执行增量回填；已经生成拼音的客户不会重复更新。
## 客户与验光单导入

导入模板包含可选的“客户创建时间”列，用于保留历史客户档案时间。建议格式为 `YYYY-MM-DD HH:mm:ss`；同一客户有多张验光单时，系统取该客户编号第一次出现的非空创建时间。字段为空或无法识别不会中断导入，客户创建时间自动使用实际导入时间。
## Docker

    docker build -t neye-api .
    docker run --env-file .env.docker -p 3100:3000 neye-api

启动开关：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| RUN_DB_MIGRATIONS | false | 执行 prisma migrate deploy |
| RUN_DB_PUSH | true | 执行 prisma db push |
| RUN_DB_PUSH_ACCEPT_DATA_LOSS | false | 已审查 Prisma 警告后，临时允许 db push 继续；升级成功后关闭 |
| RUN_DB_SEED | false | 执行管理员种子数据 |
| RUN_CUSTOMER_PINYIN_BACKFILL | true | 自动补齐历史客户的姓名拼音和首字母 |
| RUN_USER_TENANT_BACKFILL | true | 自动把旧版账号租户关系回填到成员表 |

当前已有数据库由 db push 创建，迁移目录缺少原始建表基线。在完成生产数据库 baseline 前，保持 RUN_DB_MIGRATIONS=false。新部署默认不会重复执行 seed。

## 验证

    pnpm prisma validate
    pnpm prisma:generate
    pnpm typecheck
    pnpm test
    pnpm build

pnpm test 会连接测试配置中的 PostgreSQL 并创建临时 E2E 数据，确认数据库地址后再执行。
## 微信登录与扫码登录

微信登录默认关闭。管理员可以在 Web 的“系统管理 > 微信小程序设置”中填写 AppID 和 AppSecret，并启用微信登录。

- AppID、AppSecret 和小程序码版本环境由 Web 系统设置并保存到 system_settings。
- AppSecret 以明文保存，admin 设置接口和页面可以回显，公开登录配置接口不返回。
- 必须严格限制数据库、备份文件和管理员账号权限。
- 微信凭据不再从环境变量读取。
- Web 设置中的版本环境可取 release、trial 或 develop，用于决定扫码打开正式版、体验版或开发版小程序。
- manifest.json、Web 设置和微信公众平台中的 AppID 必须一致。
- API 的 HTTPS 域名必须加入微信小程序 request 合法域名。

系统仅保存 openid 与系统账号的绑定关系，不保存微信昵称、头像、手机号等资料。扫码会话两分钟过期，登录结果只能消费一次。