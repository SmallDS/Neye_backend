FROM node:22-alpine

ARG APK_MIRROR=mirrors.aliyun.com
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PNPM_VERSION=9.15.0

WORKDIR /app

RUN sed -i "s/dl-cdn.alpinelinux.org/${APK_MIRROR}/g" /etc/apk/repositories \
  && apk add --no-cache openssl \
  && npm config set registry ${NPM_REGISTRY} \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm config set registry ${NPM_REGISTRY}

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma:generate

COPY nest-cli.json tsconfig.json ./
COPY src ./src
RUN pnpm build

COPY docker-entrypoint.sh /usr/local/bin/neye-api-entrypoint
RUN chmod +x /usr/local/bin/neye-api-entrypoint

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["neye-api-entrypoint"]
CMD ["node", "dist/src/main.js"]