FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config python3 \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ src/

EXPOSE 3000

CMD ["node", "--max-old-space-size=512", "src/index.js"]
