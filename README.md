# NEye Backend API

NEye 后端服务，基于 NestJS + Prisma + PostgreSQL。

## 目录

```text
backend/api
  prisma/      数据模型、迁移、种子脚本
  src/         NestJS API 源码
  test/        接口测试
  Dockerfile   后端容器构建文件
```

## 本地开发

复制环境变量样例：

```powershell
Copy-Item .env.example .env
```

安装依赖并启动：

```powershell
pnpm install
pnpm prisma:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

默认接口：

```text
http://127.0.0.1:3100/api
http://127.0.0.1:3100/api/docs
```

如果本地端口要用 3100，请在 `.env` 中设置：

```text
PORT=3100
```

## Docker

Docker 部署请参考：

```text
.env.docker.example
```

构建镜像：

```powershell
docker build -t neye-api .
```

Dockerfile 默认使用国内源加速：

```text
APK_MIRROR=mirrors.aliyun.com
NPM_REGISTRY=https://registry.npmmirror.com
PNPM_VERSION=9.15.0
```

如果部署环境在海外，也可以切回官方源：

```powershell
docker build `
  --build-arg APK_MIRROR=dl-cdn.alpinelinux.org `
  --build-arg NPM_REGISTRY=https://registry.npmjs.org `
  -t neye-api .
```

运行容器时需要传入环境变量文件：

```powershell
docker run --env-file .env.docker -p 3100:3000 neye-api
```

`.env.docker` 使用 Docker env-file 格式，变量值不要加引号。例如：

```text
DATABASE_URL=postgresql://neye:你的密码@数据库地址:5432/neye?schema=public
```

不要提交真实 `.env` 或 `.env.docker`。