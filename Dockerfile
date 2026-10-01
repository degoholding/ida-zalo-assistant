FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Giao diện quản trị (khung ERP v2) — build tĩnh, máy chủ Node phục vụ dưới /app
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data WEB_DIST_DIR=/app/web/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /web/dist ./web/dist
COPY package.json ./
COPY migrations ./migrations
VOLUME /data
CMD ["node", "dist/main.js"]
