# ─── Stage 1: deps ────────────────────────────────────────────────────────────
# Install ALL dependencies (including dev) for building
FROM node:24-alpine AS deps
WORKDIR /app

# Install build dependencies for native modules (argon2, etc.)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --ignore-scripts

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
# Build the TypeScript project and generate Prisma client
FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 py3-pip openssl

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
FROM node:24-alpine AS runner
WORKDIR /app

ARG OCI_IMAGE_REVISION=unknown
ARG OCI_IMAGE_SOURCE=unknown
ARG OCI_IMAGE_CREATED=unknown
ARG OCI_IMAGE_VERSION=unknown
ARG OCI_SOURCE_CONTENT_SHA256=unknown
ARG OCI_SOURCE_STATE=unknown

LABEL org.opencontainers.image.revision=$OCI_IMAGE_REVISION \
      org.opencontainers.image.source=$OCI_IMAGE_SOURCE \
      org.opencontainers.image.created=$OCI_IMAGE_CREATED \
      org.opencontainers.image.version=$OCI_IMAGE_VERSION \
      io.inventori.billing.source-content-sha256=$OCI_SOURCE_CONTENT_SHA256 \
      io.inventori.billing.source-state=$OCI_SOURCE_STATE

ENV NODE_ENV=production
ENV PORT=3000

ENV PYTHONPATH=/app/python-packages

# Create non-root user — NFR security
RUN apk add --no-cache python3 openssl && \
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

CMD ["node", "dist/src/bootstrap/api.main.js"]
