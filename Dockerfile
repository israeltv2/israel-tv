# Israel TV without a browser (Kan VOD off; everything else works). Config and data live in /data.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN CI=true pnpm install --prod --frozen-lockfile
ENV ISRAEL_TV_CONFIG=/data/israel-tv.config.json
EXPOSE 7000 7001 7002
CMD ["node", "apps/ingest/src/cli.ts", "start"]
