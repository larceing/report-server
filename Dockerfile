# El diseñador de la pantalla (pdfme) se empaqueta aparte: en la imagen final
# solo quedan el servidor y lo que necesita para generar los PDF.
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN mkdir -p public/js && npm run web

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Madrid RS_DATOS=/datos

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
COPY --from=web /app/public/js/disenador.js /app/public/js/pdfium.esm.wasm ./public/js/
COPY ejemplos ./ejemplos

# El servidor DEV/PRO monta su volumen en /datos; sin él, la carpeta existe igual.
RUN mkdir -p /datos && chown node:node /datos

# Versión de la imagen (la pone GitHub Actions: sha-1a2b3c4, v1.2.0). La devuelve
# /version/, que es lo que mira el servidor DEV/PRO.
ARG APP_VERSION=local
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.version=$APP_VERSION

USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
