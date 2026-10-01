FROM node:20-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_FILE=/data/db.json FRONTEND_DIR=/app/public
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public/ ./public/
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
