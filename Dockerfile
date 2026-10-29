# syntax=docker/dockerfile:1

ARG NODE_VERSION=26
ARG PNPM_VERSION=12.15.0

# ---------- base: node + pnpm ----------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force
WORKDIR /app

# ---------- build ----------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# Build-time only. Leave empty behind an HTTPS reverse proxy (origin = https://<Host>).
# Set to the exact public origin when serving plain HTTP, e.g. --build-arg ORIGIN=http://1.2.3.4:3000
ARG ORIGIN=
# Kit validates env vars while analysing routes; the placeholder is not used or kept at runtime.
RUN ORIGIN=${ORIGIN} DATABASE_URL=postgres://build-placeholder@localhost/none pnpm build

# ---------- production dependencies only (postgres, aws4fetch) ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
# pg_dump for the nightly backup; its major version must match the server's
RUN apk add --no-cache postgresql18-client
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=100M \
    SHUTDOWN_TIMEOUT=10

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

# adapter-node handles SIGTERM/SIGINT itself and drains connections (SHUTDOWN_TIMEOUT)
CMD ["node", "build"]
