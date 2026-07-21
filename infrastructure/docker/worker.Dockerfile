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
COPY . .
RUN npm run db:generate && npm run build:packages && npm run build -w @ai-content-os/worker

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/packages ./packages
RUN rm -rf node_modules/@ai-content-os \
  && mkdir -p node_modules/@ai-content-os \
  && ln -s ../../packages/config node_modules/@ai-content-os/config \
  && ln -s ../../packages/contracts node_modules/@ai-content-os/contracts \
  && ln -s ../../packages/database node_modules/@ai-content-os/database \
  && ln -s ../../packages/shared node_modules/@ai-content-os/shared \
  && ln -s ../../packages/testing node_modules/@ai-content-os/testing
USER node
CMD ["node", "apps/worker/dist/src/main.js"]
