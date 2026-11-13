# syntax=docker/dockerfile:1

# Node.js 22 LTS (Jod), exact 22.23.5, pinned by the multi-arch index digest
# so linux/amd64 and linux/arm64 resolve from the same line.
# Digest checked 2026-11-13 against node:22.23.5-bookworm-slim.
ARG NODE_IMAGE=node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# Production dependencies only. The runtime image copies this tree, not the
# build stage's devDependencies.
FROM ${NODE_IMAGE} AS server-deps
WORKDIR /src
COPY server/package.json server/package-lock.json server/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefix server

# Client and server builds. The client bundle is static files. The server
# compile needs TypeScript, which stays in this stage.
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json client/
COPY server/package.json server/package-lock.json server/
COPY scripts/check-version.mjs scripts/check-version.mjs
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefix client && npm ci --prefix server
COPY client client
COPY server server
COPY templates templates
COPY reference reference
COPY diagrams diagrams
COPY Dockerfile compose.yaml ./
ARG NERDGRAM_VERSION=1.0.0
ENV NERDGRAM_VERSION=${NERDGRAM_VERSION}
RUN node scripts/check-version.mjs \
 && node -e "const v=require('./package.json').version; if (v !== process.env.NERDGRAM_VERSION) { console.error('NERDGRAM_VERSION '+process.env.NERDGRAM_VERSION+' does not match package.json '+v); process.exit(1); }" \
 && npm run build --prefix client \
 && npm run build --prefix server

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends tini

RUN groupadd --gid 1001 nerdgram \
 && useradd --uid 1001 --gid 1001 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin nerdgram \
 && mkdir -p /data \
 && chown 1001:1001 /data \
 && chmod 755 /data

# Layout matches REPO_ROOT (server/dist -> /app): client/dist, templates/,
# reference/, and the sample diagrams used to seed an empty /data.
COPY --link --from=server-deps /src/server/node_modules /app/server/node_modules
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
 && chmod -R a+rX /app/templates /app/reference /app/diagrams /app/server /app/client /app/package.json

ARG NERDGRAM_VERSION=1.0.0
ARG NERDGRAM_COMMIT=
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    NERDGRAM_DATA_DIR=/data \
    NERDGRAM_INSTALL=docker \
    NERDGRAM_COMMIT=${NERDGRAM_COMMIT} \
    HOME=/tmp \
    TMPDIR=/tmp

LABEL org.opencontainers.image.title="NerdGram1337" \
      org.opencontainers.image.description="Local-first Mermaid diagramming app" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.url="https://github.com/NetworkNerd1337/NerdGram1337" \
      org.opencontainers.image.source="https://github.com/NetworkNerd1337/NerdGram1337" \
      org.opencontainers.image.version="${NERDGRAM_VERSION}" \
      org.opencontainers.image.revision="${NERDGRAM_COMMIT}"

USER nerdgram
EXPOSE 8787
STOPSIGNAL SIGTERM

# Hit loopback so the Host guard sees 127.0.0.1. The server listens on
# 0.0.0.0 inside the container; the host publish stays on 127.0.0.1.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PORT||'8787'; fetch('http://127.0.0.1:'+p+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["tini", "--", "node", "server/dist/index.js"]
