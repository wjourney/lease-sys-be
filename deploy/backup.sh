#!/usr/bin/env bash
set -euo pipefail
umask 077

root=/srv/lease-sys
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$root/backups/$stamp"
mkdir -p "$destination"
trap 'rm -rf -- "$destination"' ERR

/usr/local/mysql/bin/mysqldump \
  --defaults-extra-file="$root/config/mysql-backup.cnf" \
  --single-transaction --quick --routines --triggers --events --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 \
  lease_sys | gzip > "$destination/database.sql.gz"
tar -C "$root/data" -czf "$destination/uploads.tar.gz" uploads
printf 'Backup saved: %s\n' "$destination"
