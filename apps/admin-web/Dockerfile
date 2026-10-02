# Panel administrativo.
#
# Se construye desde la RAIZ del monorepo:
#   docker build -f apps/admin-web/Dockerfile -t escudo-vivo-admin .
#
# IMPORTANTE: este panel NO deberia exponerse al publico sin una capa de
# proteccion delante (VPN, lista de IP permitidas o autenticacion del proveedor).
# Da acceso a datos personales de aficionados y al UID de los chips.

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
COPY apps/admin-web/ apps/admin-web/

RUN npm run build -w @mev/domain \
  && npm run build -w @mev/admin-web

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/admin-web ./apps/admin-web

USER node

EXPOSE 3001

CMD ["npm", "run", "start", "-w", "@mev/admin-web"]
