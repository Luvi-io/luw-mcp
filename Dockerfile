# Hosted Luw.ai MCP endpoint (Streamable HTTP at /mcp). Callers authenticate per request
# with "Authorization: Bearer <LUW_API_KEY>"; the container holds no secrets.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
# The bundle is a single self-contained ES module.
COPY --from=build /app/dist/cli.js ./server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "server.mjs", "--http"]
