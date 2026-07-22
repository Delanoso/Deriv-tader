#!/usr/bin/env bash
# Deploy SpikeScope to the research VPS.
# Preserves server/data journals. Does not touch unrelated pm2 apps (e.g. clickbot).
set -euo pipefail

HOST="${SPIKESCOPE_HOST:-169.239.181.217}"
USER="${SPIKESCOPE_USER:-root}"
REMOTE_DIR="${SPIKESCOPE_DIR:-/opt/spikescope}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SSH_BASE=(ssh -o PreferredAuthentications=keyboard-interactive,password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new)
SCP_BASE=(scp -o PreferredAuthentications=keyboard-interactive,password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new)

if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
  SSH=(sshpass -e "${SSH_BASE[@]}")
  SCP=(sshpass -e "${SCP_BASE[@]}")
else
  SSH=("${SSH_BASE[@]}")
  SCP=("${SCP_BASE[@]}")
fi

echo "==> Building locally"
npm run build

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/tmp/spikescope-${STAMP}.tgz"

echo "==> Packing release ${ARCHIVE}"
tar -czf "$ARCHIVE" \
  --exclude='node_modules' \
  --exclude='server/node_modules' \
  --exclude='client/node_modules' \
  --exclude='server/data' \
  --exclude='.git' \
  package.json package-lock.json ecosystem.config.cjs .env.example README.md \
  server/package.json server/package-lock.json server/dist \
  client/dist \
  scripts/deploy-vps.sh

echo "==> Uploading to ${USER}@${HOST}:${REMOTE_DIR}"
"${SSH[@]}" "${USER}@${HOST}" "mkdir -p '${REMOTE_DIR}' '${REMOTE_DIR}/server/data'"
"${SCP[@]}" "$ARCHIVE" "${USER}@${HOST}:/tmp/spikescope-release.tgz"

"${SSH[@]}" "${USER}@${HOST}" bash -s <<EOF
set -euo pipefail
cd '${REMOTE_DIR}'
# Preserve journals
tar -xzf /tmp/spikescope-release.tgz
npm install --omit=dev
npm install --omit=dev --prefix server
if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload '${REMOTE_DIR}/ecosystem.config.cjs' --only spikescope
  pm2 save
else
  echo "pm2 not found — start server manually on PORT 8788"
fi
rm -f /tmp/spikescope-release.tgz
sleep 2
curl -sS -m 8 http://127.0.0.1:8788/api/health || true
echo
curl -sS -m 8 http://127.0.0.1:8788/api/learning | head -c 200 || true
echo
EOF

rm -f "$ARCHIVE"
echo "==> Deploy done. Public URL usually http://${HOST}:8791"
