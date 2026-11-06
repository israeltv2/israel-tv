# Israel TV without a browser (Kan VOD off; everything else works). Config, .env and data live in /data.

# The owner's dashboard is a static page built once (the same files for every architecture), so it is built on the
# build machine's own platform and copied in.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS dashboard
WORKDIR /app
RUN corepack enable
COPY . .
RUN CI=true pnpm install --frozen-lockfile --filter "@israel-tv/dashboard..." && pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY --chown=node:node . .
COPY --from=dashboard --chown=node:node /app/apps/dashboard/dist apps/dashboard/dist
RUN CI=true pnpm install --prod --frozen-lockfile && mkdir -p /data && chown -R node:node /data /app
USER node
ENV ISRAEL_TV_IN_CONTAINER=1 \
    ISRAEL_TV_BROWSER=none \
    ISRAEL_TV_HOME=/data
VOLUME /data
EXPOSE 7700 7701 7702
CMD ["node", "apps/ingest/src/cli.ts", "start"]
