# Multi-stage build so the runtime image ships only production deps + compiled JS.
# Exists mainly as a migration hedge (see docs/07-infrastructure-cost-and-migration.md) —
# Railway currently builds this app automatically via Nixpacks without needing this file,
# but AWS Fargate / GCP Cloud Run / any other container platform needs one.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
