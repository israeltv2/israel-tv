# Israel TV without a browser (Kan VOD off; everything else works). Config, .env and data live in /data.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN CI=true pnpm install --prod --frozen-lockfile && mkdir -p /data && chown node:node /data
USER node
ENV ISRAEL_TV_CONFIG=/data/israel-tv.config.json
EXPOSE 7700 7701 7702
CMD ["node", "apps/ingest/src/cli.ts", "start"]
