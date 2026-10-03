# The example app in nginx, configured when the container starts.
#
# This example builds the library from this repository, so build from the repository root:
#   docker build -f examples/vite/Dockerfile -t runtime-config-example .
#   docker run --rm -p 8080:80 \
#     -e EXAMPLE_API_BASE_URL=https://api.example.com \
#     -e EXAMPLE_GREETING="Hello from the container" \
#     runtime-config-example
#
# In your own app the build stage is just `npm ci && npm run build` -
# the library comes from npm like any other dependency.

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY docker ./docker
RUN npm ci --no-audit --no-fund && npm run build
COPY examples/vite ./examples/vite
WORKDIR /repo/examples/vite
RUN npm install --no-audit --no-fund && npm run build

FROM nginx:1.29-alpine
COPY examples/vite/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/examples/vite/dist /usr/share/nginx/html
COPY --from=build /repo/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
