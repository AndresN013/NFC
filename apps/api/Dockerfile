# API de Marathon Escudo Vivo.
#
# Se construye desde la RAIZ del monorepo, no desde esta carpeta:
#   docker build -f apps/api/Dockerfile -t escudo-vivo-api .
#
# El contexto tiene que ser la raiz porque la API consume `packages/domain` y
# `packages/nfc-contracts` como workspaces locales.

# --- Etapa 1: dependencias y compilacion ------------------------------------
FROM node:22-slim AS build

# `openssl` lo necesita el cliente de Prisma; `python3`, `make` y `g++` compilan
# el modulo nativo de argon2.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Primero solo los manifiestos: si no cambian, Docker reutiliza la capa de
# dependencias y la reconstruccion es mucho mas rapida.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/nfc-contracts/package.json packages/nfc-contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/fan-web/package.json apps/fan-web/
COPY apps/admin-web/package.json apps/admin-web/

RUN npm ci --ignore-scripts

# Los scripts de instalacion se ejecutan aparte: argon2 necesita compilarse.
RUN npm rebuild argon2

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN npm run build -w @mev/domain \
  && npm run build -w @mev/nfc-contracts \
  && npm run build -w @mev/api

# --- Etapa 2: imagen de ejecucion -------------------------------------------
FROM node:22-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Se copia el arbol ya construido. `node_modules` incluye el cliente de Prisma
# generado durante el build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api

# Usuario sin privilegios: si alguien logra ejecutar codigo, no es root.
USER node

EXPOSE 4000

# Las migraciones se aplican al arrancar. Es seguro: `migrate deploy` solo
# ejecuta las pendientes y no toca datos existentes.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/server.js"]
