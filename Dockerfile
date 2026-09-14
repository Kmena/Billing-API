# ─── Stage 1: deps ────────────────────────────────────────────────────────────
# Install ALL dependencies (including dev) for building
FROM node:20-alpine AS deps
WORKDIR /app

# Install build dependencies for native modules (argon2, etc.)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --ignore-scripts

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
# Build the TypeScript project and generate Prisma client
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 py3-pip

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN python3 -m pip install --break-system-packages --target /app/python-packages -r src/modules/fiscal-documents/infrastructure/xml/xsd11/requirements.txt

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
# Minimal production image — non-root user
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

ENV PYTHONPATH=/app/python-packages

# Create non-root user — NFR security
RUN apk add --no-cache python3 && \
    addgroup --system --gid 1001 billing && \
    adduser --system --uid 1001 --ingroup billing billing

# Copy only production artifacts
COPY --from=builder --chown=billing:billing /app/dist ./dist
COPY --from=builder --chown=billing:billing /app/node_modules ./node_modules
COPY --from=builder --chown=billing:billing /app/python-packages ./python-packages
COPY --from=builder --chown=billing:billing /app/prisma ./prisma
COPY --from=builder --chown=billing:billing /app/resources ./resources
COPY --from=builder --chown=billing:billing /app/package.json ./package.json

USER billing

EXPOSE 3000

# Liveness check — TASK-016
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/bootstrap/api.main.js"]
