# syntax=docker/dockerfile:1

# Node.js 22 LTS (Jod), exact 22.23.5, pinned by the multi-arch index digest
# so linux/amd64 and linux/arm64 resolve from the same line.
# Digest checked 2026-11-13 against node:22.23.5-bookworm-slim.
ARG NODE_IMAGE=node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# Production dependencies only. The runtime image copies this tree, not the
# build stage's devDependencies.
FROM ${NODE_IMAGE} AS server-deps
WORKDIR /src
# chrome-headless-shell only (see server/.puppeteerrc.cjs). Full Chrome is not
# downloaded. The cache has to live somewhere the runtime stage can copy.
COPY server/package.json server/package-lock.json server/.puppeteerrc.cjs server/
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
# cosmiconfig (via Puppeteer) depends on the TypeScript compiler so it can
# load a .ts config. This image uses server/.puppeteerrc.cjs at install time
# and PUPPETEER_CACHE_DIR at runtime, so the compiler is not needed. The
# runtime image is not a development environment.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefix server \
 && rm -rf server/node_modules/typescript

# Client and server builds. The client bundle is static files. The server
# compile needs TypeScript, which stays in this stage.
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json client/
COPY server/package.json server/package-lock.json server/
COPY scripts/check-version.mjs scripts/codenames.mjs scripts/changelog-notes.mjs scripts/
# The server compile does not render diagrams. Skip the browser download here.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefix client && npm ci --prefix server
COPY client client
COPY server server
COPY cli cli
COPY templates templates
COPY reference reference
COPY diagrams diagrams
COPY Dockerfile compose.yaml compose.build.yaml README.md CHANGELOG.md LICENSE ./
ARG NERDGRAM_VERSION=1.1.0
ARG NERDGRAM_CODENAME=Atlas
ENV NERDGRAM_VERSION=${NERDGRAM_VERSION} \
    NERDGRAM_CODENAME=${NERDGRAM_CODENAME}
RUN node scripts/check-version.mjs \
 && node -e "const v=require('./package.json').version; if (v !== process.env.NERDGRAM_VERSION) { console.error('NERDGRAM_VERSION '+process.env.NERDGRAM_VERSION+' does not match package.json '+v); process.exit(1); }" \
 && node -e "const p=require('./package.json'); const major=String(p.version).split('.')[0]; const name=p.codenames&&p.codenames[major]; if (name !== process.env.NERDGRAM_CODENAME) { console.error('NERDGRAM_CODENAME '+process.env.NERDGRAM_CODENAME+' does not match package.json '+(name||'(missing)')); process.exit(1); }" \
 && npm run build --prefix client \
 && npm run build --prefix server

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# chrome-headless-shell needs these libraries. fonts-liberation is what the
# renderer falls back to when a diagram names a font the image does not have.
# The shell itself is about 260 MB unpacked. That is the cost of SVG and PNG
# that match the editor. A DOM emulator laid nodes on top of each other.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      tini \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libdrm2 \
      libgbm1 \
      libnss3 \
      libx11-6 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1

RUN groupadd --gid 1001 nerdgram \
 && useradd --uid 1001 --gid 1001 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin nerdgram \
 && mkdir -p /data \
 && chown 1001:1001 /data \
 && chmod 755 /data

# Layout matches REPO_ROOT (server/dist -> /app): client/dist, templates/,
# reference/, and the sample diagrams used to seed an empty /data.
COPY --link --from=server-deps /src/server/node_modules /app/server/node_modules
COPY --link --from=server-deps /opt/puppeteer /opt/puppeteer
COPY --link --from=build /src/server/package.json /app/server/package.json
COPY --link --from=build /src/server/dist /app/server/dist
COPY --link --from=build /src/package.json /app/package.json
COPY --link --from=build /src/client/dist /app/client/dist
COPY --link --from=build /src/templates /app/templates
COPY --link --from=build /src/reference /app/reference
COPY --link --from=build /src/diagrams /app/diagrams

# The process can read these. It cannot change the bundled templates,
# reference, or sample files. Synced reference pages go to /data.
RUN chmod -R a-w /app/templates /app/reference /app/diagrams /app/server/dist /app/package.json /app/server/package.json \
 && chmod -R a+rX /app/templates /app/reference /app/diagrams /app/server /app/client /app/package.json \
 && chmod -R a+rX /opt/puppeteer \
 && chmod -R a+x /opt/puppeteer \
 && printf '%s\n' '#!/bin/sh' 'exec node /app/server/dist/cli.js "$@"' > /usr/local/bin/nerdgram \
 && chmod 755 /usr/local/bin/nerdgram

ARG NERDGRAM_VERSION=1.1.0
ARG NERDGRAM_CODENAME=Atlas
ARG NERDGRAM_COMMIT=
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    NERDGRAM_DATA_DIR=/data \
    NERDGRAM_INSTALL=docker \
    NERDGRAM_COMMIT=${NERDGRAM_COMMIT} \
    NERDGRAM_CODENAME=${NERDGRAM_CODENAME} \
    PUPPETEER_CACHE_DIR=/opt/puppeteer \
    HOME=/tmp \
    TMPDIR=/tmp

LABEL org.opencontainers.image.title="NerdGram1337" \
      org.opencontainers.image.description="Local-first Mermaid diagramming app" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.url="https://github.com/NetworkNerd1337/NerdGram1337" \
      org.opencontainers.image.source="https://github.com/NetworkNerd1337/NerdGram1337" \
      org.opencontainers.image.version="${NERDGRAM_VERSION}" \
      org.opencontainers.image.codename="${NERDGRAM_CODENAME}" \
      org.opencontainers.image.revision="${NERDGRAM_COMMIT}"

USER nerdgram
EXPOSE 8787
STOPSIGNAL SIGTERM

# Hit loopback so the Host guard sees 127.0.0.1. The server listens on
# 0.0.0.0 inside the container; the host publish stays on 127.0.0.1.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PORT||'8787'; fetch('http://127.0.0.1:'+p+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["tini", "--", "node", "server/dist/index.js"]
