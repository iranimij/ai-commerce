# The production image: the server, the job worker and the admin under one supervisor.
# AICOMMERCE_ROLE picks the processes: all (default), web or worker. The admin takes PORT and
# proxies /api to the server on PORT + 1. Build: docker build -f docker/Dockerfile .
FROM node:24-bookworm-slim AS build
ENV CI=true TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# The admin: Next.js standalone output, laid out from the repository root with only the files
# it uses, so its server.js lands at apps/admin/server.js where the supervisor looks.
FROM scratch AS admin
COPY --from=build /app/apps/admin/.next/standalone /
COPY --from=build /app/apps/admin/.next/static /apps/admin/.next/static

# The server, worker and CLI with production dependencies only, from the store the first install
# filled. The admin brings its own from the stage above.
FROM build AS server
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod --offline --filter '!@aicommerce/admin' \
  && rm -rf .turbo apps/admin

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Owned by root, run as node: the shop cannot rewrite its own code.
COPY --from=server /app /app
COPY --from=admin / /app
# Uploaded files (AICOMMERCE_FILES_DIR): the one place the shop writes; mount a volume here.
RUN mkdir -p /var/lib/aicommerce/files && chown node:node /var/lib/aicommerce/files
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/supervisor.js"]
