FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate

COPY package.json ./
RUN pnpm install --no-frozen-lockfile

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