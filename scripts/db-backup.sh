#!/usr/bin/env bash
# MariaDB backup job (WO-056). Dumps the CopyForge database to a timestamped,
# gzipped file and prunes old backups. Schedule via cron, e.g.:
#   17 3 * * * /path/to/repo/scripts/db-backup.sh >> /var/log/copyforge-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/copyforge}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-copyforge}"
# Credentials come from ~/.my.cnf or MYSQL_PWD/--defaults-extra-file — never argv.

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/copyforge-${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# --single-transaction: consistent InnoDB snapshot without locking writers.
mysqldump --single-transaction --quick --routines --triggers "${DB_NAME}" | gzip > "${OUT}"

# Integrity check: a dump that gunzips clean and ends with the completion
# marker is a valid backup; anything else fails the job loudly.
if ! gunzip -t "${OUT}"; then
  echo "BACKUP FAILED: ${OUT} is not a valid gzip" >&2
  exit 1
fi
if ! gunzip -c "${OUT}" | tail -1 | grep -q "Dump completed"; then
  echo "BACKUP FAILED: ${OUT} missing mysqldump completion marker" >&2
  exit 1
fi

echo "backup ok: ${OUT} ($(du -h "${OUT}" | cut -f1))"

# Prune beyond retention.
find "${BACKUP_DIR}" -name 'copyforge-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
