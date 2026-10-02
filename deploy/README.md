# Production deployment

The two source repositories are cloned at `/srv/lease-sys/lease-sys-be` and
`/srv/lease-sys/lease-sys-fe`. Compose runs `api` and `web`; the API connects to
the host's existing MySQL 5.7 service through `host.docker.internal`. Only `web`
publishes a port, bound to `127.0.0.1:18080` for the existing
host Nginx installation to proxy a dedicated HTTPS hostname to it. The web
container uses Caddy for static assets and `/api/` routing within Compose.

Runtime configuration stays outside Git:

- `/srv/lease-sys/config/api.env`: `DATABASE_URL`, `JWT_SECRET`, `APP_ORIGIN`,
  `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3001`, and
  `UPLOAD_DIR=/data/uploads`; SMTP settings are optional
- `/srv/lease-sys/config/mysql-backup.cnf`: restricted credentials for the
  dedicated `lease_backup` MySQL user
- `/srv/lease-sys/config/versions.env`: deployed `API_IMAGE` and `WEB_IMAGE`
- `/srv/lease-sys/config/bootstrap.secret`: optional one-time initial admin
  password (12+ characters); removed after the first successful initialization

The `lease_sys` MySQL database, private OSS objects, and any remaining `data/uploads` must persist. Back up the database and local files,
and keep a copy off the host. The API image includes the Prisma CLI and
Chromium. `deploy.sh` backs up the database and uploads, then applies
`prisma migrate deploy` before replacing the API container. It intentionally
never runs the development seed in production. The database uses a dedicated
`lease_app` account, scoped to `lease_sys` and Docker bridge clients.

The MySQL 5.7 migration preserves foreign keys and uses generated columns to
enforce one active invoice per receipt and one current material per group.
MySQL 5.7 does not enforce `CHECK` constraints or support PostgreSQL exclusion
constraints; validation and unit occupancy locking remain in the API. Avoid
direct writes to the lease tables.

GitHub Actions builds each image on pushes to `master`, stores it in GHCR under
the commit SHA, and streams a compressed release archive containing a Git bundle
and the image over SSH to the root-owned `/usr/local/sbin/lease-sys-deploy`
wrapper. GitHub credentials stay inside the Actions runner; the host does not
need outbound access to GitHub or GHCR. The wrapper
uses a host-wide lock so the two repository workflows cannot deploy at once.
For manual rollback, restore a previous image reference in `versions.env` and
recreate the affected service; database migrations require separate review.

The existing host Nginx must route the production hostname to
`http://127.0.0.1:18080`. Its HTTPS certificate is managed on the host, where
port 80 is already in use. Configure `APP_ORIGIN` to that exact HTTPS origin.
Production login cookies are secure and require HTTPS.


## OSS storage

Production uses a private OSS bucket through the Shanghai internal HTTPS endpoint.
Append the following runtime-only configuration to `/srv/lease-sys/config/api.env`
(mode 600). Never include credentials in images, frontend variables, Git, or logs:

```dotenv
STORAGE_PROVIDER=OSS
OSS_REGION=oss-cn-shanghai
OSS_ENDPOINT=https://oss-cn-shanghai-internal.aliyuncs.com
OSS_PUBLIC_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com
OSS_BUCKET=hkrentt
OSS_PREFIX=lease-sys/prod/
OSS_ACCESS_KEY_ID=<dedicated RAM access key ID>
OSS_ACCESS_KEY_SECRET=<dedicated RAM access key secret>
```

Use the public endpoint for local development if OSS testing is explicitly needed;
normal development and automated tests use `STORAGE_PROVIDER=LOCAL`.
The bucket and prefix form part of persisted file identities: do not change them
without a migration. Every new object has a random immutable key and an explicit
private ACL. Grant GetObject, PutObject, and DeleteObject only under the selected
prefix; no bucket-wide ACL, CORS, lifecycle or public-access change is needed.
The runtime supports an optional OSS_SECURITY_TOKEN for explicitly supplied STS
credentials; it does not auto-renew STS, so use a managed role credential provider
before relying on expiring credentials in a long-running deployment.

Existing API paths remain authenticated. List and detail responses include one-hour
signed public OSS preview URLs for authorized materials and cover images. The
bucket and objects remain private; clients cannot use an unsigned permanent URL.
The public endpoint is derived from OSS_ENDPOINT when OSS_PUBLIC_ENDPOINT is
omitted. Download endpoints still stream file bytes through the API, including
Range/206/416 and HEAD. Images, videos and PDF files retain the current
MIME allowlist; materials are limited to 30 MiB, avatars to 2 MiB. Configure host
Nginx `client_max_body_size 32m` and Caddy `max_size 32MiB` to allow multipart
metadata overhead while the API enforces exact per-file limits. Browser previews
use OSS bandwidth; downloads and uploads still use the application server.

The additive migration records `storageProvider` on materials and
`avatarStorageProvider` on users, defaulting legacy records to LOCAL. Reads follow
that value exactly, never falling back to local files after an OSS error. Contract
and invoice generation, avatar replacement, and invoice email attachments use the
same storage service. Soft-deleted materials and all history keep their objects.

`storage_cleanup` is a durable compensation queue. Every attempted new upload is
registered before the write, eligible after 24 hours. Referenced objects are kept
and only the queue entry is removed. Failed attachments and replaced avatars are
eligible after 5 minutes; avatar replacement queues its previous file in the same
DB transaction. Cleanup runs every 5 minutes and retries failures with backoff.
It checks both material and user references (including deleted/history rows), so a
metadata-only version cannot cause the shared object to be removed.

### Existing local files

After the new image and schema are healthy, run the CLI inside the API container:

```sh
docker exec lease-sys-api-1 node dist/cli/migrate-storage.js
docker exec lease-sys-api-1 node dist/cli/migrate-storage.js --apply
```

The default is dry-run, including source checksum verification. Apply uploads each
unique LOCAL file, reads it back and checks SHA-256 and length, then atomically
switches all matching material and avatar references. It includes history and
soft-deleted rows and can be repeated after interruption. Concurrent replacement
uploads are not overwritten. Run dry-run again to ensure no LOCAL references
remain. Original local files are retained for backup and manual rollback.

Do not roll back to a pre-OSS image after OSS objects have been attached: it cannot
read them. If writes need to revert to disk, keep an OSS-capable image and set
STORAGE_PROVIDER=LOCAL while retaining OSS credentials so old OSS objects remain
readable. Once records have migrated, backup.sh's uploads archive does not contain
OSS data. The SQL backup retains file pointers only: an independent OSS object
backup/version-retention policy must be configured separately before deleting
local copies. This release does not change shared-bucket retention settings.
