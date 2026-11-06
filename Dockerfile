# Israel TV without a browser (Kan VOD off; everything else works). Config, .env and data live in /data.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY --chown=node:node . .
RUN CI=true pnpm install --prod --frozen-lockfile && mkdir -p /data && chown -R node:node /data /app
USER node
ENV ISRAEL_TV_IN_CONTAINER=1 \
    ISRAEL_TV_HOME=/data
VOLUME /data
EXPOSE 7700 7701 7702
CMD ["node", "apps/ingest/src/cli.ts", "start"]
