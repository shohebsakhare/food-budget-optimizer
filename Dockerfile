# Production Multi-Stage Dockerfile for Food Budget Optimizer
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root manifest and workspaces
COPY package*.json tsconfig.base.json ./
COPY packages/core-ledger/package*.json ./packages/core-ledger/
COPY packages/ai-orchestrator/package*.json ./packages/ai-orchestrator/
COPY packages/client-web/package*.json ./packages/client-web/

RUN npm install

# Copy source files
COPY packages/ ./packages/

# Build TypeScript packages
RUN npm run build

# Production runtime image
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/core-ledger/dist ./packages/core-ledger/dist
COPY --from=builder /app/packages/core-ledger/package*.json ./packages/core-ledger/
COPY --from=builder /app/packages/ai-orchestrator/dist ./packages/ai-orchestrator/dist
COPY --from=builder /app/packages/ai-orchestrator/package*.json ./packages/ai-orchestrator/
COPY --from=builder /app/packages/client-web ./packages/client-web

EXPOSE 3000

CMD ["node", "packages/client-web/serve.js"]
