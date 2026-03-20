FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY shared/ ./shared/
COPY packages/scheduler/ ./packages/scheduler/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter shared build
RUN pnpm --filter scheduler build

FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apt-get update && apt-get install -y --no-install-recommends cron && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/shared/ ./shared/
COPY --from=builder /app/packages/scheduler/package.json ./packages/scheduler/
COPY --from=builder /app/packages/scheduler/dist/ ./packages/scheduler/dist/

RUN pnpm install --frozen-lockfile --prod

# Setup cron job
RUN echo '0 * * * * cd /app && /usr/local/bin/node packages/scheduler/dist/index.js >> /var/log/task-scheduler.log 2>&1' > /etc/cron.d/task-scheduler && \
    chmod 0644 /etc/cron.d/task-scheduler && \
    crontab /etc/cron.d/task-scheduler && \
    touch /var/log/task-scheduler.log

# Pass environment variables to cron
COPY packages/scheduler/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
