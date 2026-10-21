# 1) Build do site (React/Vite) + modelos do reconhecimento facial
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# 2) Servidor: so dependencias de producao (express, pg, sharp, multer, fflate)
FROM node:22-alpine
WORKDIR /app
# Fonte para a marca d'agua (o sharp desenha o texto via SVG).
RUN apk add --no-cache fontconfig ttf-dejavu
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
# O Easypanel injeta PORT=80. As fotos ficam em /data (monte um volume aqui!).
ENV NODE_ENV=production PORT=80 DATA_DIR=/data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/_health || exit 1
CMD ["node", "server/index.js"]
