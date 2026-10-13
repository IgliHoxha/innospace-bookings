# syntax=docker/dockerfile:1

# ---- Dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# A fallback only: better-sqlite3 downloads a prebuilt binary for musl/alpine,
# and these compile it from source should that download ever be unavailable.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# npm's download cache outlives the layer, so a lockfile change fetches only
# the packages that changed.
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- Build ----
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next's compiler cache outlives the layer too, so a build recompiles only the
# modules that changed since the last one.
RUN --mount=type=cache,target=/app/.next/cache npm run build

# ---- Runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
# su-exec lets the entrypoint drop from root to "node" after fixing volume perms.
RUN apk add --no-cache su-exec
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000
ENV HOSTNAME=0.0.0.0
# SQLite DB file: mount a volume at /app/data to persist it.
ENV DATA_FILE=/app/data/bookings.db

RUN mkdir -p /app/data && chown -R node:node /app

# The standalone output is the whole server: Next traces better-sqlite3 into it
# (its JS, the compiled .node binary and the two modules that locate it), so
# nothing more is copied from node_modules.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh

# Starts as root so the entrypoint can chown a freshly mounted volume, then it
# drops to the unprivileged "node" user before running the server.
VOLUME ["/app/data"]
EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
