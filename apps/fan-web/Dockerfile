# Web del aficionado.
#
# Se construye desde la RAIZ del monorepo:
#   docker build -f apps/fan-web/Dockerfile -t escudo-vivo-fan .
#
# Durante el build NO hace falta que la API este accesible: todas las paginas
# del escaneo se renderizan bajo demanda (`force-dynamic`).

FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/nfc-contracts/package.json packages/nfc-contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/fan-web/package.json apps/fan-web/
COPY apps/admin-web/package.json apps/admin-web/

RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/fan-web/ apps/fan-web/

# `@mev/domain` se consume compilado; `@mev/ui` lo transpila Next.
RUN npm run build -w @mev/domain \
  && npm run build -w @mev/fan-web

# --- Ejecucion ---------------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/fan-web ./apps/fan-web

USER node

EXPOSE 3000

# `-H 0.0.0.0` es imprescindible dentro de un contenedor: escuchando solo en
# localhost, el servidor seria inalcanzable desde fuera.
CMD ["npm", "run", "start", "-w", "@mev/fan-web"]
