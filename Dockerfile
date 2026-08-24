FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY domain-mapping.yaml ./
COPY ts-api/ ./ts-api/
COPY scripts/ ./scripts/
COPY src/ ./src/

RUN npm run codegen
RUN npm run build

FROM node:24-alpine

# Remove npm/yarn/corepack — not needed at runtime, eliminates their
# transitive vulnerabilities (minimatch, cookie, etc.) from the image
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /usr/local/bin/corepack

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/ ./dist/

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js"]
