# ── Build stage ───────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────
# node:22-slim is Debian-based (glibc), which DuckDB's prebuilt
# native binary requires. Alpine (musl) is not compatible.
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/build ./build
COPY package*.json ./

# Install production deps only.
# npm downloads the correct native @duckdb/node-bindings binary
# for the target architecture at install time.
RUN npm ci --omit=dev

USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
# Mount the DuckDB file and point DISCORD_DB_PATH at it:
#   docker run -v /path/to/discord.duckdb:/data/discord.duckdb \
#              -e DISCORD_DB_PATH=/data/discord.duckdb ...
ENV DISCORD_DB_PATH=/data/discord.duckdb

EXPOSE 3000

CMD ["node", "build"]
