FROM node:22-bookworm-slim

# LibreOffice (sin interfaz) para pasar las plantillas a PDF, y fuentes que
# sustituyen a las de Office con las mismas medidas (Arial, Times, Calibri,
# Cambria) para que el PDF no se descuadre.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui libreoffice-calc-nogui python3-uno \
        fonts-dejavu-core fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Carbone busca soffice.bin en el PATH.
ENV NODE_ENV=production TZ=Europe/Madrid RS_DATOS=/datos HOME=/home/node \
    PATH=$PATH:/usr/lib/libreoffice/program

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
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
