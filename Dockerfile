# Build from this module: docker build -f Dockerfile .
# Runtime modules are bundled from /agents; agent configs come from switchboard DB.

FROM node:20-alpine

WORKDIR /app

COPY package.json /app/package.json
COPY src /app/src
COPY agents /app/config/agents
COPY .core-config /app/config/.core-config
RUN npm install --omit=dev

ENV CONFIG_DIR=/app/config
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/api/server.js"]
