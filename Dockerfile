# HTTP (Streamable HTTP) entry point of mcp-banjul. The stdio entry (index.js) needs no container.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js http.js ./
COPY src ./src

ENV HOST=127.0.0.1 \
    PORT=8015

EXPOSE 8015
CMD ["node", "http.js"]
