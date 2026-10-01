#!/usr/bin/env bash
set -euo pipefail
umask 077

root=/srv/lease-sys
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$root/backups/$stamp"
mkdir -p "$destination"

compose() {
  docker compose \
    --project-directory "$root" \
    --env-file "$root/config/stack.env" \
    --env-file "$root/config/versions.env" \
    -f "$root/lease-sys-be/deploy/compose.prod.yaml" "$@"
}

compose exec -T db pg_dump -U lease -d lease | gzip > "$destination/database.sql.gz"
tar -C "$root/data" -czf "$destination/uploads.tar.gz" uploads
printf 'Backup saved: %s\n' "$destination"
