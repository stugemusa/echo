# Echo · Repaso espaciado para oposiciones
# Imagen multi-arquitectura (amd64 / arm64) pensada para Raspberry Pi y HA OS.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/echo.db \
    TZ=Europe/Madrid

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js schema.sql ./
COPY src ./src
COPY public ./public
COPY run.sh /run.sh
RUN chmod +x /run.sh && mkdir -p /data

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/run.sh"]
