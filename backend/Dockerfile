# Contexto de build: raiz do repositório (precisa de shared/)

# Etapa de build: imagem Node completa, com Python 3, pip e compilador C++. O instalador do mediasoup
# baixa um worker pré-compilado e o testa; se ele não rodar no host (acontece em alguns kernels/
# ambientes Docker), compila o worker do zero, o que exige essas ferramentas e leva alguns minutos.
FROM node:24-bookworm AS build
ENV PYTHON=python3 \
    PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root=false
COPY shared shared
COPY backend backend
RUN npm run build -w backend

# Etapa final: imagem enxuta. Instala só dependências de produção sem rodar scripts de instalação
# (evita baixar/compilar o worker de novo) e recebe o binário do worker pronto da etapa de build.
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --omit=dev --include-workspace-root=false --ignore-scripts \
    && npm cache clean --force
COPY --from=build /app/node_modules/mediasoup/worker/out/Release/mediasoup-worker node_modules/mediasoup/worker/out/Release/mediasoup-worker
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 3005
# Porta única de mídia do mediasoup (UDP e TCP), alinhada com MEDIASOUP_RTC_PORT
EXPOSE 40000/udp 40000/tcp
CMD ["node", "backend/dist/backend/src/server.js"]
