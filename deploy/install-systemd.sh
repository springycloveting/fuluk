#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fuluk-gateway}"
ENV_DIR="${ENV_DIR:-/etc/fuluk-gateway}"
DATA_DIR="${DATA_DIR:-/var/lib/fuluk-gateway}"
SERVICE_NAME="${SERVICE_NAME:-fuluk-gateway}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn)}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

mkdir -p "${APP_DIR}" "${ENV_DIR}" "${DATA_DIR}"
tar \
  --exclude='./node_modules' \
  --exclude='./data' \
  --exclude='./.git' \
  --exclude='./*.log' \
  -C "${REPO_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -

if [[ ! -f "${ENV_DIR}/fuluk-gateway.env" ]]; then
  cp "${APP_DIR}/.env.example" "${ENV_DIR}/fuluk-gateway.env"
  chmod 600 "${ENV_DIR}/fuluk-gateway.env"
  echo "Created ${ENV_DIR}/fuluk-gateway.env. Edit SESSION_GATEWAY_TOKEN before starting."
fi

chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${APP_DIR}" "${DATA_DIR}"

sed \
  -e "s|WorkingDirectory=/opt/fuluk-gateway|WorkingDirectory=${APP_DIR}|g" \
  -e "s|EnvironmentFile=/etc/fuluk-gateway/fuluk-gateway.env|EnvironmentFile=${ENV_DIR}/fuluk-gateway.env|g" \
  -e "s|User=fuluk-gateway|User=${SERVICE_USER}|g" \
  -e "s|Group=fuluk-gateway|Group=${SERVICE_GROUP}|g" \
  "${APP_DIR}/deploy/fuluk-gateway.service.example" > "/etc/systemd/system/${SERVICE_NAME}.service"

cd "${APP_DIR}"
npm ci --omit=dev

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

cat <<EOF
Installed ${SERVICE_NAME}.service.

Next steps:
1. Edit ${ENV_DIR}/fuluk-gateway.env and set SESSION_GATEWAY_TOKEN.
2. Start the service:
   sudo systemctl start ${SERVICE_NAME}
3. Check status:
   sudo systemctl status ${SERVICE_NAME}
4. Check health:
   curl http://127.0.0.1:8787/health
EOF
