FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/testing/package.json packages/testing/package.json
RUN npm ci

FROM dependencies AS build
ARG VITE_API_URL=http://localhost:3000/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN npm run build -w @ai-content-os/contracts && npm run build -w @ai-content-os/web

FROM nginx:1.29-alpine AS runtime
COPY infrastructure/docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /run
USER nginx
EXPOSE 8080
