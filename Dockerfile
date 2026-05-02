# Multi-stage build — works on Fly.io, Render, Railway, any Docker host
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy production deps + source
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY db ./db
COPY lib ./lib
COPY routes ./routes
COPY jobs ./jobs
COPY public ./public

# Drop privileges
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
