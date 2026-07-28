FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=4318 \
    HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node public ./public
COPY --chown=node:node lib ./lib
COPY --chown=node:node fixtures ./fixtures
COPY --chown=node:node server.mjs ./

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 4318
VOLUME ["/app/data"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4318/api/config').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.mjs"]
