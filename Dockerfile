# NearBuy production image.
#
# Build:  docker build -t nearbuy .
# Run:    docker run -p 3000:3000 -v nearbuy-data:/app/data \
#           -e APP_URL=https://your-domain -e ENABLE_DEMO_ACCOUNTS=true nearbuy
#
# The SQLite database and seller uploads live under /app/data, so a volume (or a
# mounted disk on your host) is what makes orders survive a redeploy.

# --- build stage: full dependencies + SPA bundle -----------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY server ./server
COPY server.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

# --- runtime stage: production dependencies only -----------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_FILE=/app/data/nearbuy.db \
    UPLOADS_DIR=/app/data/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY tsconfig.json server.ts ./
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "start"]
