# Debian (glibc): o ONNX Runtime nativo do reconhecimento facial nao roda no Alpine.
# Os binarios de GPU do ONNX Runtime nao sao baixados (ONNXRUNTIME_NODE_INSTALL=skip).

# 1) Build do site (React/Vite)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# 2) Modelos buffalo_l do InsightFace (deteccao SCRFD + reconhecimento ArcFace). O pacote oficial tem 288 MB e
# nao cabe no GitHub: e baixado no build (esta camada fica em cache) e conferido pelo SHA-256.
FROM node:22-bookworm-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /m
RUN wget -q -O b.zip https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip \
 && unzip -j b.zip det_10g.onnx w600k_r50.onnx && rm b.zip \
 && printf '%s  %s\n' 5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91 det_10g.onnx 4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43 w600k_r50.onnx | sha256sum -c -

# 3) Servidor: so dependencias de producao (express, pg, sharp, multer, fflate, onnxruntime-node)
FROM node:22-bookworm-slim
WORKDIR /app
# Fonte para a marca d'agua (o sharp desenha o texto via SVG).
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package*.json ./
# O pacote do ONNX Runtime traz binarios de todos os sistemas; fica so o Linux x64.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 && find node_modules/onnxruntime-node/bin -mindepth 2 -maxdepth 2 -type d ! -name linux -exec rm -rf {} + \
 && rm -rf node_modules/onnxruntime-node/bin/*/linux/arm64
COPY --from=models /m ./server/models/buffalo_l
COPY server ./server
COPY --from=build /app/dist ./dist
# O Easypanel injeta PORT=80. As fotos ficam em /data (monte um volume aqui!).
ENV NODE_ENV=production PORT=80 DATA_DIR=/data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/_health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.js"]
