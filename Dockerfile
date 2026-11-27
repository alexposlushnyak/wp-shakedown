# The image has PHP, Composer, Node and every tool, so a run gives the same result anywhere.
# Mount the folder to test, for example: docker run --rm -v "$PWD:/work/theme:ro" wp-shakedown run /work/theme

FROM node:22-bookworm-slim AS build
WORKDIR /src
# The manifests come first so the install layers stay cached until a lock file changes.
COPY package.json package-lock.json ./
COPY ui/package.json ui/package-lock.json ./ui/
RUN npm ci && npm ci --prefix ui
COPY . .
RUN npm run build
# The image needs the runtime dependencies only.
RUN npm prune --omit=dev

FROM php:8.3-cli-bookworm
LABEL org.opencontainers.image.source="https://github.com/alexposlushnyak/wp-shakedown" \
      org.opencontainers.image.description="Runs the usual WordPress checks on a theme, a plugin or a whole WordPress folder and writes one report." \
      org.opencontainers.image.licenses="GPL-2.0-or-later"

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Node comes from the official image. npm and npx are links to scripts inside lib/node_modules.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# The tool reads package.json for its version. The tool folders (php-tools, js-tools, php-wasm, ai-tools)
# hold the pinned manifests and scripts it installs from at run time.
WORKDIR /opt/wp-shakedown
COPY --from=build /src/package.json /src/LICENSE /src/README.md ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/ui/dist ./ui/dist
COPY --from=build /src/php-tools ./php-tools
COPY --from=build /src/js-tools ./js-tools
COPY --from=build /src/php-wasm ./php-wasm
COPY --from=build /src/ai-tools ./ai-tools
RUN printf '#!/bin/sh\nexec node /opt/wp-shakedown/dist/cli.js "$@"\n' > /usr/local/bin/wp-shakedown \
    && chmod +x /usr/local/bin/wp-shakedown

# Install the PHP tools and the JavaScript and CSS tools now, so a run does not download them.
RUN wp-shakedown install-tools

WORKDIR /work
ENTRYPOINT ["wp-shakedown"]
CMD ["--help"]
