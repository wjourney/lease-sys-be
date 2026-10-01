#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root=/srv/lease-sys
service=${1:-}
revision=${2:-}
if [[ "$service" != api && "$service" != web ]] || [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: deploy.sh {api|web} <40-character commit SHA>" >&2
  exit 2
fi
if [[ "$(id -u)" != 0 ]]; then
  echo "Run through the root-owned deployment wrapper." >&2
  exit 2
fi

exec 9>/var/lock/lease-sys-deploy.lock
flock -x 9

if [[ "$service" == api ]]; then
  repo="$root/lease-sys-be"
  image="ghcr.io/wjourney/lease-sys-be:$revision"
else
  repo="$root/lease-sys-fe"
  image="ghcr.io/wjourney/lease-sys-fe:$revision"
fi

# GitHub Actions sends the built image over the SSH stream. Registry credentials
# stay on the runner; the production host receives only the image archive.
gzip -dc | docker load >/dev/null
docker image inspect "$image" >/dev/null

git -C "$repo" fetch --quiet origin master
if [[ "$(git -C "$repo" rev-parse origin/master)" != "$revision" ]]; then
  echo "Skipping obsolete deployment: $service $revision" >&2
  exit 0
fi
git -C "$repo" checkout --quiet --detach --force "$revision"

versions="$root/config/versions.env"
old_api=$(sed -n 's/^API_IMAGE=//p' "$versions")
old_web=$(sed -n 's/^WEB_IMAGE=//p' "$versions")
if [[ "$service" == api ]]; then
  new_api="$image"
  new_web="$old_web"
else
  new_api="$old_api"
  new_web="$image"
fi

compose() {
  docker compose \
    --project-directory "$root" \
    --env-file "$root/config/stack.env" \
    --env-file "$versions" \
    -f "$root/lease-sys-be/deploy/compose.prod.yaml" "$@"
}

activated=0
rollback() {
  status=$?
  trap - ERR
  printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$old_api" "$old_web" > "$versions.tmp"
  mv -f "$versions.tmp" "$versions"
  if [[ "$activated" == 1 ]]; then
    previous="$old_api"
    if [[ "$service" == web ]]; then previous="$old_web"; fi
    if [[ "$previous" != *:pending ]]; then
      compose up -d --no-deps "$service" || true
    fi
  fi
  echo "Deployment failed; previous image selection restored." >&2
  exit "$status"
}
trap rollback ERR

compose up -d --wait db
if [[ "$service" == api ]]; then
  bash "$root/lease-sys-be/deploy/backup.sh"
fi

printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$new_api" "$new_web" > "$versions.tmp"
mv -f "$versions.tmp" "$versions"

if [[ "$service" == api ]]; then
  compose run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy
  if [[ -f "$root/config/bootstrap.secret" ]]; then
    export INITIAL_ADMIN_PASSWORD
    INITIAL_ADMIN_PASSWORD=$(cat "$root/config/bootstrap.secret")
    compose run --rm --no-deps -e INITIAL_ADMIN_PASSWORD api node dist/cli/init-admin.js
    unset INITIAL_ADMIN_PASSWORD
    rm -f "$root/config/bootstrap.secret"
  fi
fi

compose up -d --no-deps "$service"
activated=1
if [[ "$service" == api ]]; then
  for attempt in {1..30}; do
    if compose exec -T api node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
      echo "API deployment healthy: $revision"
      exit 0
    fi
    sleep 2
  done
else
  for attempt in {1..30}; do
    if curl -fsS -o /dev/null http://127.0.0.1:18080/; then
      echo "Web deployment healthy: $revision"
      exit 0
    fi
    sleep 2
  done
fi
echo "Health check failed: $service $revision" >&2
false
