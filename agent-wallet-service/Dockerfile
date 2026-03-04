# ===========================================
# Agent Wallet Service - Dockerfile
# ===========================================
# Multi-stage build for production deployment
# Supports both development and production modes
#
# Build: docker build -t agent-wallet-service .
# Run:   docker run -p 3000:3000 --env-file .env agent-wallet-service
# ===========================================

# -----------------------------------------------------------------------------
# Stage 1: Base - Node.js runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

# Install only essential packages
RUN apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# -----------------------------------------------------------------------------
# Stage 2: Dependencies
# -----------------------------------------------------------------------------
FROM base AS deps

# Install all dependencies (including dev)
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 3: Production build (minimal dependencies)
# -----------------------------------------------------------------------------
FROM base AS production-deps

# Install only production dependencies
ENV NODE_ENV=production
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# Stage 4: Application
# -----------------------------------------------------------------------------
FROM base AS runner

# Copy production dependencies from previous stage
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/package*.json ./

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create directories for runtime data
RUN mkdir -p /app/data /app/logs && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command (can be overridden)
CMD ["node", "src/index.js"]

# -----------------------------------------------------------------------------
# Development stage (optional)
# -----------------------------------------------------------------------------
# To build development image:
#   docker build --target base -t agent-wallet-service:dev .
#   docker run -it -p 3000:3000 -v $(pwd):/app agent-wallet-service:dev
# -----------------------------------------------------------------------------
FROM base AS development

# Copy all dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Use nodemon for hot reload
RUN npm install -g nodemon

USER nodejs

EXPOSE 3000

CMD ["nodemon", "--watch", "src", "--env-file", ".env", "src/index.js"]
