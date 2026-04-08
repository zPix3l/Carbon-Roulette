FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native addon
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_DATE=$BUILD_DATE

# Data volume will be mounted at /data by Railway
ENV DB_PATH=/data/carbon-roulette.db

CMD ["node", "dist/index.js"]
