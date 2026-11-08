# syntax=docker/dockerfile:1

# 1. Install dependencies from the lockfile.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2. Build the standalone server. The /api rewrite target is fixed at build time,
#    so API_URL is a build argument as well as a runtime variable.
FROM node:22-alpine AS build
WORKDIR /app
ARG API_URL=http://api:8000
ENV API_URL=${API_URL} NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. Run only the traced output.
FROM node:22-alpine AS run
WORKDIR /app
ARG API_URL=http://api:8000
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 API_URL=${API_URL}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
