#!/usr/bin/env bash
# MariaDB restore (WO-056). Restores a backup produced by db-backup.sh into a
# TARGET database (defaults to a verification database, NOT production —
# restoring over production requires typing the name explicitly).
#
#   scripts/db-restore.sh /var/backups/copyforge/copyforge-<stamp>.sql.gz [target_db]
set -euo pipefail

BACKUP_FILE="${1:?usage: db-restore.sh <backup.sql.gz> [target_db]}"
TARGET_DB="${2:-copyforge_restore_check}"

if ! gunzip -t "${BACKUP_FILE}"; then
  echo "RESTORE ABORTED: ${BACKUP_FILE} is not a valid gzip" >&2
  exit 1
fi

echo "restoring ${BACKUP_FILE} into database '${TARGET_DB}'…"
mysql -e "CREATE DATABASE IF NOT EXISTS \`${TARGET_DB}\`"
gunzip -c "${BACKUP_FILE}" | mysql "${TARGET_DB}"

# Verification: core tables exist and answer.
TABLES=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET_DB}'")
USERS=$(mysql -N -e "SELECT COUNT(*) FROM \`${TARGET_DB}\`.users" 2>/dev/null || echo "MISSING")
JOBS=$(mysql -N -e "SELECT COUNT(*) FROM \`${TARGET_DB}\`.jobs" 2>/dev/null || echo "MISSING")

echo "restore verification: ${TABLES} tables, users=${USERS}, jobs=${JOBS}"
if [ "${USERS}" = "MISSING" ] || [ "${JOBS}" = "MISSING" ]; then
  echo "RESTORE FAILED verification" >&2
  exit 1
fi
echo "restore ok into '${TARGET_DB}'"
