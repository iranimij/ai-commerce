# The production image: the server and the job worker under one supervisor. AICOMMERCE_ROLE picks
# the processes: all (default), web or worker. Build: docker build -f docker/Dockerfile .
FROM node:24-bookworm-slim AS build
ENV CI=true TURBO_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
# Reinstall with production dependencies only, from the store the first install filled.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod --offline \
  && rm -rf .turbo

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
# Owned by root, run as node: the shop cannot rewrite its own code.
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/supervisor.js"]
