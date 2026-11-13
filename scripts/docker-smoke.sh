#!/usr/bin/env bash
# Start an already-built image, exercise /api/health through 127.0.0.1, write a
# diagram, restart, and check the process user. Removes only the containers,
# named volume, and temp directories this script creates.
set -euo pipefail

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "usage: scripts/docker-smoke.sh <image>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="nerdgram-smoke-$$"
ROOT_NAME="${NAME}-root"
BIND_NAME="${NAME}-bind"
VOLUME="nerdgram-smoke-$$"
PORT=8787
BIND_DIR=""
ROOT_DIR=""

cleanup() {
  docker rm -f "$NAME" "$ROOT_NAME" "$BIND_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  if [ -n "$BIND_DIR" ] || [ -n "$ROOT_DIR" ]; then
    sudo rm -rf "$BIND_DIR" "$ROOT_DIR"
  fi
}
trap cleanup EXIT

run_app() {
  local name="$1"
  shift
  docker run -d \
    --name "$name" \
    --read-only \
    --tmpfs /tmp \
    --security-opt no-new-privileges \
    -p "127.0.0.1:${PORT}:8787" \
    -e NERDGRAM_DATA_DIR=/data \
    -e NERDGRAM_INSTALL=docker \
    -e NERDGRAM_ALLOWED_HOSTS=lan.example \
    -e NERDGRAM_CORS_ORIGINS="http://lan.example:${PORT}" \
    "$@" \
    "$IMAGE" >/dev/null
}

wait_http() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "health check did not pass on 127.0.0.1:${PORT}" >&2
  return 1
}

wait_docker_health() {
  local name="$1"
  local i status=""
  for i in $(seq 1 40); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name")"
    if [ "$status" = "healthy" ]; then
      return 0
    fi
    sleep 1
  done
  echo "container ${name} health is ${status:-missing}" >&2
  docker logs "$name" >&2 || true
  return 1
}

code_of() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

unset NERDGRAM_GITHUB_TOKEN NERDGRAM_GITHUB_CLIENT_ID || true
docker compose config --quiet
echo "compose config ok"

run_app "$NAME" -v "${VOLUME}:/data"
if ! wait_http; then
  docker logs "$NAME" >&2 || true
  exit 1
fi
wait_docker_health "$NAME"

HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}")"
export HEALTH
node --input-type=module -e '
const health = JSON.parse(process.env.HEALTH);
if (health.ok !== true) throw new Error("health ok");
if (health.installKind !== "docker") throw new Error("installKind " + health.installKind);
if (health.dataDir !== "/data") throw new Error("dataDir " + health.dataDir);
if (health.name !== "NerdGram1337") throw new Error("name");
const expected = process.env.NERDGRAM_EXPECT_COMMIT || "";
if (expected && health.commit !== expected) throw new Error("commit " + health.commit);
'

curl -fsS "http://127.0.0.1:${PORT}/api/health" -H "Host: localhost:${PORT}" >/dev/null
curl -fsS "http://localhost:${PORT}/api/health" >/dev/null
test "$(code_of "http://127.0.0.1:${PORT}/api/health" -H "Host: evil.example")" = "403"
test "$(code_of "http://127.0.0.1:${PORT}/api/health" -H "Host: lan.example:${PORT}")" = "200"

REF="$(curl -fsS "http://127.0.0.1:${PORT}/api/reference" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (!Array.isArray(b.pages) || b.pages.length < 1) process.exit(1)' "$REF"
TPL="$(curl -fsS "http://127.0.0.1:${PORT}/api/templates" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (!Array.isArray(b.templates) || b.templates.length < 1) process.exit(1)' "$TPL"
WELCOME="$(curl -fsS "http://127.0.0.1:${PORT}/api/file?path=Welcome.mmd" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (typeof b.content !== "string" || b.content.length < 1) process.exit(1)' "$WELCOME"

CREATE="$(curl -fsS -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Smoke.mmd","content":"flowchart LR\n  Smoke[Persist me]\n"}')"
node -e 'const b=JSON.parse(process.argv[1]); if (b.path !== "Smoke.mmd") process.exit(1)' "$CREATE"

curl -fsS -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: localhost:${PORT}" \
  -H "Origin: http://localhost:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Localhost.mmd","content":"flowchart LR\n  L[localhost]\n"}' >/dev/null

test "$(code_of -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: lan.example:${PORT}" \
  -H "Origin: http://lan.example:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Lan.mmd","content":"flowchart LR\n  N[lan]\n"}')" = "200"

test "$(code_of -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: text/plain" \
  -d nope)" = "415"

docker exec "$NAME" node --input-type=module -e 'import { writeToken } from "./server/dist/sync/secrets.js"; await writeToken("smoke-token-not-a-real-github-token");'
test "$(docker exec "$NAME" stat -c %a /data/.meta/github-token)" = "600"
docker exec "$NAME" mkdir -p /data/.nerdgram-git
docker exec "$NAME" sh -c 'printf mirror > /data/.nerdgram-git/SMOKE'

test "$(docker exec "$NAME" id -u)" = "1001"
test "$(docker exec "$NAME" awk '/^Uid:/ {print $2; exit}' /proc/1/status)" = "1001"
if docker exec "$NAME" sh -c 'command -v git >/dev/null 2>&1'; then
  echo "git binary is present in the runtime image" >&2
  exit 1
fi
if docker exec "$NAME" sh -c 'test -e /app/server/node_modules/typescript -o -e /app/server/src -o -e /usr/bin/git'; then
  echo "dev tools or server source are in the runtime image" >&2
  exit 1
fi
if docker exec "$NAME" sh -c 'touch /app/reference/manifest.json' >/dev/null 2>&1; then
  echo "reference tree is writable" >&2
  exit 1
fi
docker exec "$NAME" sh -c 'test -d /app/templates && test -d /app/reference && test -d /app/client/dist && test -f /app/server/dist/index.js'

echo "stopping container to check SIGTERM and persistence"
docker stop "$NAME" >/dev/null
test "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0"
docker start "$NAME" >/dev/null
if ! wait_http; then
  docker logs "$NAME" >&2 || true
  exit 1
fi
AFTER="$(curl -fsS "http://127.0.0.1:${PORT}/api/file?path=Smoke.mmd" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (!String(b.content).includes("Persist me")) process.exit(1)' "$AFTER"
test "$(docker exec "$NAME" stat -c %a /data/.meta/github-token)" = "600"
docker exec "$NAME" cat /data/.nerdgram-git/SMOKE | grep -q mirror

echo "root-owned bind mount must fail to start"
docker stop "$NAME" >/dev/null
ROOT_DIR="$(mktemp -d)"
# GitHub-hosted runners are uid 1001, the same as the image user. A fresh
# mktemp directory would be writable. Force a directory the process cannot write.
sudo chown root:root "$ROOT_DIR"
sudo chmod 755 "$ROOT_DIR"
docker run -d \
  --name "$ROOT_NAME" \
  --read-only \
  --tmpfs /tmp \
  -p "127.0.0.1:${PORT}:8787" \
  -v "${ROOT_DIR}:/data" \
  "$IMAGE" >/dev/null
ROOT_FAILED=0
for _ in $(seq 1 25); do
  RUNNING="$(docker inspect -f '{{.State.Running}}' "$ROOT_NAME")"
  if [ "$RUNNING" != "true" ]; then
    ROOT_FAILED=1
    break
  fi
  sleep 1
done
if [ "$ROOT_FAILED" != "1" ]; then
  echo "a root-owned bind mount stayed up; the process should have exited" >&2
  docker logs "$ROOT_NAME" >&2 || true
  exit 1
fi
docker rm -f "$ROOT_NAME" >/dev/null

echo "bind mount owned by uid 1001 is writable"
BIND_DIR="$(mktemp -d)"
sudo chown 1001:1001 "$BIND_DIR"
sudo chmod 755 "$BIND_DIR"
run_app "$BIND_NAME" -v "${BIND_DIR}:/data"
if ! wait_http; then
  docker logs "$BIND_NAME" >&2 || true
  exit 1
fi
curl -fsS -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Bind.mmd","content":"flowchart LR\n  B[bind]\n"}' >/dev/null
grep -q bind "${BIND_DIR}/Bind.mmd"
test "$(stat -c %u "${BIND_DIR}/Bind.mmd")" = "1001"

echo "smoke ok (${IMAGE})"
