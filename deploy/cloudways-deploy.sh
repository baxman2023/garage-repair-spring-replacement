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
WEB_PORT="${WEB_PORT:-3457}"
WORKER_HEALTH_PORT="${WORKER_HEALTH_PORT:-8961}"
SRC_DIR="${SRC_DIR:-$HOME/copyforge}"

log() { echo "[deploy] $(date -u +%H:%M:%S) $*"; }

# Shared servers run many Node apps — never assume a port is ours.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1; }
pick_free_port() {
  local p="$1"
  while port_busy "$p"; do p=$((p + 1)); done
  echo "$p"
}

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
# Free OUR old ports first, then pick free ports (other tenants keep theirs).
pm2 delete copyforge-web copyforge-worker >/dev/null 2>&1 || true
sleep 2
WEB_PORT="$(pick_free_port "$WEB_PORT")"
WORKER_HEALTH_PORT="$(pick_free_port "$WORKER_HEALTH_PORT")"
log "ports: web=$WEB_PORT worker-health=$WORKER_HEALTH_PORT"
export WEB_PORT WORKER_HEALTH_PORT
pm2 start ecosystem.config.cjs
pm2 save >/dev/null
# Survive server reboots without root: resurrect from cron.
( crontab -l 2>/dev/null | grep -v 'pm2 resurrect' || true
  echo "@reboot . $NVM_DIR/nvm.sh && $NVM_DIR/versions/node/$(node -v)/bin/pm2 resurrect" ) | crontab -
log "pm2 online + @reboot resurrection installed"

# --- 6. Local verify ------------------------------------------------------------------
sleep 8
HEALTH="$(curl -fsS -m 10 "http://127.0.0.1:$WEB_PORT/api/health" || true)"
echo "$HEALTH"
if echo "$HEALTH" | grep -q '"app":"CopyForge"'; then
  log "local health OK"
else
  log "health did not answer as CopyForge; recent web log:"
  pm2 logs copyforge-web --lines 25 --nostream || true
  exit 1
fi

# --- 7. Route the public URL to the app -----------------------------------------------
# Cloudways' nginx serves files in public_html directly, so the placeholder
# page shadows the app. Move the defaults aside once (kept in a backup dir),
# leaving only our routing files + .well-known (Let's Encrypt).
WEBROOT="$APP_BASE/public_html"
# The master user can only write INSIDE public_html on Cloudways — the backup
# lives there as a dot-directory (shadowed by the proxy rewrite anyway).
BACKUP="$WEBROOT/.copyforge-default-backup"
mkdir -p "$BACKUP" || true
find "$WEBROOT" -mindepth 1 -maxdepth 1 \
  ! -name '.well-known' ! -name '.htaccess' ! -name 'index.php' \
  ! -name '.copyforge-default-backup' \
  -exec mv -t "$BACKUP" {} + 2>/dev/null || true

APP_HOST="${APP_URL#https://}"; APP_HOST="${APP_HOST%%/*}"

# Cache-busted probe: Varnish hashes the query string, so a unique parameter
# forces a miss — earlier runs poisoned /api/health with the placeholder page.
public_probe() {
  curl -fsS -m 20 "$APP_URL/api/health?cb=$(date +%s%N)" 2>&1 || true
}
public_ok() { public_probe | grep -q '"app":"CopyForge"'; }

purge_cache() {
  for path in / /api/health /login; do
    curl -sX PURGE -H "Host: $APP_HOST" "http://127.0.0.1:8080$path" >/dev/null 2>&1 || true
  done
}

diagnose() {
  log "DIAGNOSTICS — what each layer serves for /api/health:"
  echo "== public (cache-busted): $(public_probe | head -c 300)"
  for port in 8080 8081 8082 8083; do
    echo "== 127.0.0.1:$port (Host: $APP_HOST): $(curl -fsS -m 8 -H "Host: $APP_HOST" "http://127.0.0.1:$port/api/health" 2>&1 | head -c 200)"
  done
  echo "== app direct :$WEB_PORT: $(curl -fsS -m 8 "http://127.0.0.1:$WEB_PORT/api/health" 2>&1 | head -c 200)"
  echo "== webroot listing:"; ls -la "$WEBROOT" | head -15
}

# Mode A: Apache mod_proxy via .htaccess.
rm -f "$WEBROOT/index.php"
cat > "$WEBROOT/.htaccess" <<HT
# CopyForge: proxy everything to the Node.js app (deploy/cloudways-deploy.sh).
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !^/\.well-known/
  RewriteRule ^(.*)\$ http://127.0.0.1:$WEB_PORT/\$1 [P,L]
</IfModule>
HT
purge_cache
sleep 2
if public_ok; then
  log "public URL OK via mod_proxy — deployment complete"
  exit 0
fi
log "mod_proxy route not serving the app; installing PHP proxy fallback"

# Mode B: PHP reverse proxy (works on every Cloudways PHP stack).
cat > "$WEBROOT/index.php" <<PHP
<?php
// CopyForge reverse proxy (fallback when Apache mod_proxy is unavailable).
\$port = $WEB_PORT;
\$url = 'http://127.0.0.1:' . \$port . \$_SERVER['REQUEST_URI'];
\$ch = curl_init(\$url);
\$headers = [];
foreach (function_exists('getallheaders') ? getallheaders() : [] as \$k => \$v) {
  \$lk = strtolower(\$k);
  if (in_array(\$lk, ['content-length', 'connection', 'accept-encoding'], true)) continue;
  \$headers[] = \$k . ': ' . \$v;
}
\$headers[] = 'X-Forwarded-Proto: https';
\$headers[] = 'X-Forwarded-For: ' . (\$_SERVER['REMOTE_ADDR'] ?? '');
curl_setopt_array(\$ch, [
  CURLOPT_CUSTOMREQUEST => \$_SERVER['REQUEST_METHOD'],
  CURLOPT_HTTPHEADER => \$headers,
  CURLOPT_POSTFIELDS => file_get_contents('php://input'),
  CURLOPT_RETURNTRANSFER => false,
  CURLOPT_FOLLOWLOCATION => false,
  CURLOPT_TIMEOUT => 120,
  CURLOPT_HEADERFUNCTION => function (\$ch, \$line) {
    \$t = trim(\$line);
    if (\$t !== '' && stripos(\$t, 'transfer-encoding:') !== 0 && stripos(\$t, 'connection:') !== 0
        && stripos(\$t, 'HTTP/') !== 0) {
      header(\$line, false);
    }
    if (stripos(\$t, 'HTTP/') === 0) {
      \$parts = explode(' ', \$t);
      if (isset(\$parts[1])) http_response_code((int) \$parts[1]);
    }
    return strlen(\$line);
  },
  CURLOPT_WRITEFUNCTION => function (\$ch, \$data) { echo \$data; flush(); return strlen(\$data); },
]);
curl_exec(\$ch);
if (curl_errno(\$ch)) { http_response_code(502); echo 'CopyForge upstream unavailable'; }
curl_close(\$ch);
PHP
cat > "$WEBROOT/.htaccess" <<HT
# CopyForge: route every request through the PHP reverse proxy.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !^/\.well-known/
  RewriteCond %{REQUEST_URI} !^/index\.php\$
  RewriteRule ^ index.php [L]
</IfModule>
HT
purge_cache
sleep 3
if public_ok; then
  log "public URL OK via PHP proxy — deployment complete"
  exit 0
fi
diagnose
log "FATAL: public URL still not serving CopyForge after both proxy modes"
log "if the diagnostics above show CopyForge on a local port but not publicly:"
log "Cloudways panel → this application → Application Settings → Varnish → Disable (or Purge), then re-run"
exit 1
