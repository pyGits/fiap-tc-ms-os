# ---- Estagio 1: build ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Estagio 2: runtime ----
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Apenas dependencias de producao (inclui o agente APM do New Relic).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY newrelic.js ./newrelic.js

# Usuario nao-root.
USER node

EXPOSE 3000

# O agente e carregado por NODE_OPTIONS="-r newrelic" definido no Deployment,
# para que o mesmo artefato rode sem o agente em ambiente local.
CMD ["node", "dist/src/index.js"]
