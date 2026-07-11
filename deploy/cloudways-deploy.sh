#!/usr/bin/env bash
# CopyForge — Cloudways (phpstack) server deployment. Idempotent: safe to
# re-run for every update. Runs as the Cloudways MASTER user, no root needed.
#
# Required env: DB_PASSWORD, APP_URL
# Optional env: APP_FOLDER, DB_NAME, DB_USER, DB_HOST, WEB_PORT, SRC_DIR
#
# What it does:
#   1. Node 20 via nvm (user-local), pnpm + pm2 globals
#   2. .env from the Cloudways DB credentials (MASTER_KEY generated once,
#      preserved across deploys)
#   3. pnpm install + build, DB migrate + seed
#   4. PM2 web+worker with @reboot resurrection via cron
#   5. .htaccess reverse proxy from the app's public_html to the Node port
set -euo pipefail

APP_FOLDER="${APP_FOLDER:-ujhpasrsep}"
DB_NAME="${DB_NAME:-$APP_FOLDER}"
DB_USER="${DB_USER:-$APP_FOLDER}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PASSWORD="${DB_PASSWORD:?set DB_PASSWORD}"
APP_URL="${APP_URL:?set APP_URL (e.g. https://phpstack-xxx.cloudwaysapps.com)}"
WEB_PORT="${WEB_PORT:-3000}"
SRC_DIR="${SRC_DIR:-$HOME/copyforge}"

log() { echo "[deploy] $(date -u +%H:%M:%S) $*"; }

# --- 1. Locate the Cloudways application webroot -----------------------------------
APP_BASE=""
for candidate in "$HOME/applications/$APP_FOLDER" /home/*/applications/"$APP_FOLDER"; do
  if [ -d "$candidate/public_html" ]; then APP_BASE="$candidate"; break; fi
done
if [ -z "$APP_BASE" ]; then
  echo "[deploy] FATAL: cannot find application folder '$APP_FOLDER' (looked under ~/applications and /home/*/applications)" >&2
  exit 1
fi
log "application webroot: $APP_BASE/public_html"

# --- 2. Node 20 (nvm, user-local) ---------------------------------------------------
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "installing nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 20 >/dev/null 2>&1
nvm alias default 20 >/dev/null
nvm use 20 >/dev/null
log "node $(node -v), npm $(npm -v)"

command -v pnpm >/dev/null 2>&1 || { log "installing pnpm"; npm i -g pnpm@10 >/dev/null; }
command -v pm2 >/dev/null 2>&1 || { log "installing pm2"; npm i -g pm2 >/dev/null; }

cd "$SRC_DIR"

# --- 3. Environment ------------------------------------------------------------------
if [ -f .env ] && grep -q '^MASTER_KEY=' .env; then
  MASTER_KEY="$(grep '^MASTER_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\"')"
  log "reusing existing MASTER_KEY (API keys stay decryptable)"
else
  MASTER_KEY="$(openssl rand -hex 32)"
  log "generated new MASTER_KEY"
fi
umask 077
cat > .env <<ENV
DATABASE_URL="mysql://$DB_USER:$DB_PASSWORD@$DB_HOST:3306/$DB_NAME"
MASTER_KEY="$MASTER_KEY"
APP_URL="$APP_URL"
NODE_ENV="production"
ENV
umask 022
log ".env written"

# --- 4. Install, build, migrate, seed ------------------------------------------------
export NODE_OPTIONS="--max-old-space-size=2048"
export NEXT_TELEMETRY_DISABLED=1
log "pnpm install (a few minutes on first run)"
pnpm install --frozen-lockfile 2>&1 | tail -1
log "pnpm build"
pnpm build 2>&1 | tail -2
# Pre-flight: prove the DB credentials work and show the server version
# (MariaDB 10.2+/MySQL 8.0.13+ needed for the migrations' DEFAULT (now())).
log "database connectivity check"
if command -v mysql >/dev/null 2>&1; then
  mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SELECT VERSION() AS version" \
    || { echo "[deploy] FATAL: cannot connect to MySQL as $DB_USER@127.0.0.1/$DB_NAME" >&2; exit 1; }
fi
# Cloudways provisions databases as latin1; the app stores UTF-8 (arrows,
# typographic dashes) everywhere. Convert the database default AND any
# already-created tables to utf8mb4 — idempotent, a no-op once converted.
log "database charset → utf8mb4"
mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" -e \
  "ALTER DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -N -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" -e \
  "SELECT CONCAT('ALTER TABLE \`', table_name, '\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;') \
     FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE'" \
  | mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"

log "database migrate + seed"
(cd packages/db && pnpm db:migrate && pnpm db:seed)

# --- 5. PM2 --------------------------------------------------------------------------
pm2 delete copyforge-web copyforge-worker >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save >/dev/null
# Survive server reboots without root: resurrect from cron.
( crontab -l 2>/dev/null | grep -v 'pm2 resurrect' || true
  echo "@reboot . $NVM_DIR/nvm.sh && $NVM_DIR/versions/node/$(node -v)/bin/pm2 resurrect" ) | crontab -
log "pm2 online + @reboot resurrection installed"

# --- 6. Reverse proxy: PHP webroot → Node --------------------------------------------
cat > "$APP_BASE/public_html/.htaccess" <<HT
# CopyForge: proxy everything to the Node.js app (deploy/cloudways-deploy.sh).
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^(.*)\$ http://127.0.0.1:$WEB_PORT/\$1 [P,L]
</IfModule>
HT
log ".htaccess proxy → 127.0.0.1:$WEB_PORT installed"

# --- 7. Verify -----------------------------------------------------------------------
sleep 8
if curl -fsS -m 10 "http://127.0.0.1:$WEB_PORT/api/health"; then
  echo
  log "LOCAL HEALTH OK — deployment complete"
else
  echo
  log "WARNING: local health check failed; inspect with: pm2 logs copyforge-web"
  exit 1
fi
