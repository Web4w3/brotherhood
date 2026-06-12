# Builds and runs the brotherhood relay only.
# The MCP server is run locally on each Claude machine, not in this container.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build:relay

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/relay.js ./dist/relay.js
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
CMD ["node", "dist/relay.js"]
