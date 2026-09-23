# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
RUN pnpm prisma generate
RUN pnpm build

# Stage 3: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bind both IPv4 and IPv6 for Coolify health check reliability
ENV HOSTNAME="::"
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static assets and standalone server
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Install Prisma CLI in runner stage for migrate deploy
RUN npm install --no-save --omit=dev prisma@6.19.3 \
    && chown -R nextjs:nodejs /app/node_modules /app/prisma

USER nextjs
EXPOSE 3000

CMD ["sh", "-c", "npx --no-install prisma migrate deploy && node server.js"]
