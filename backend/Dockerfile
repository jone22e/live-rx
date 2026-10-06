# Contexto de build: raiz do repositório (precisa de shared/)
# Debian em vez de Alpine: o worker do mediasoup usa binário pré-compilado para glibc.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root=false
COPY shared shared
COPY backend backend
RUN npm run build -w backend

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --omit=dev --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 3005
# Porta única de mídia do mediasoup (UDP e TCP), alinhada com MEDIASOUP_RTC_PORT
EXPOSE 40000/udp 40000/tcp
CMD ["node", "backend/dist/backend/src/server.js"]
