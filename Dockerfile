# Build from repo root: docker build -f ennui-agents-core/Dockerfile .
# Config at runtime: mount volume or ConfigMap at /app/config with agents/<agentId>/config.json

FROM node:20-alpine

WORKDIR /app

COPY ennui-agents-core/package.json /app/package.json
COPY ennui-agents-core/src /app/src
COPY ennui-agents-core/agents /app/config/agents
RUN npm install --omit=dev

ENV CONFIG_DIR=/app/config
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/api/server.js"]
