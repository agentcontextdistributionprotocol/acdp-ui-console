# syntax=docker/dockerfile:1
# Multi-stage build for the ACDP UI console (Next.js 15 / React 19).
# Produces a lean runtime image from Next's standalone output.

# ── deps: install node_modules from the lockfile ────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: compile the Next.js app ────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined at build time, so demo mode must be chosen
# here, not at runtime. Default true (mock data, no backend); compose passes
# "false" to bake a build that proxies to the real playground / CP / registries.
ARG NEXT_PUBLIC_ACDP_UI_DEMO_MODE=true
ARG NEXT_PUBLIC_APP_VERSION=0.1.0
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_ACDP_UI_DEMO_MODE=$NEXT_PUBLIC_ACDP_UI_DEMO_MODE \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
RUN npm run build

# ── runner: minimal image with just the standalone server ───────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone output bundles server.js + the node_modules it needs; the
# static assets and public/ dir are copied alongside it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Lightweight liveness probe (node http GET / -> 200/3xx).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
