FROM node:22-slim

WORKDIR /app

# Install dependencies and build production Vite bundle
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["./node_modules/.bin/tsx", "server.ts"]
