# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

# Install dependencies first (layer cache friendly)
COPY client/package*.json ./
RUN npm ci

# Copy source and build
COPY client/ ./
RUN npm run build
# Output: /app/client/dist


# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Install server production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/client/dist ./client/dist

# Copy shared utilities (if any)
COPY shared/ ./shared/

# Expose the API/app port
EXPOSE 3001

# NODE_ENV=production enables static file serving in server/app.js
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
