FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY shared/ ./shared/
COPY packages/web/ ./packages/web/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter shared build
RUN pnpm --filter web build

FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/shared/ ./shared/
COPY --from=builder /app/packages/web/package.json ./packages/web/
COPY --from=builder /app/packages/web/dist/ ./packages/web/dist/

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3100
ENV PORT=3100
CMD ["node", "packages/web/dist/server/index.js"]
