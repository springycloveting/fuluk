#!/usr/bin/env bash
# Build a standalone .deb release of Fuluk Gateway.
# Production node_modules are bundled, so installation needs no network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/deb"

VERSION="$(node -pe "require('${REPO_DIR}/package.json').version")"
OUT_DIR="${REPO_DIR}/dist"
DEB_NAME="fuluk-gateway_${VERSION}_all.deb"

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

APP_DIR="${STAGE}/opt/fuluk-gateway"
mkdir -p "${APP_DIR}" "${STAGE}/etc/fuluk-gateway" \
  "${STAGE}/lib/systemd/system" "${STAGE}/usr/share/doc/fuluk-gateway"

echo "== Staging application runtime (version ${VERSION})"
cp -a "${REPO_DIR}/src" "${REPO_DIR}/public" \
  "${REPO_DIR}/package.json" "${REPO_DIR}/package-lock.json" "${APP_DIR}/"

if [[ ! -d "${REPO_DIR}/node_modules" ]]; then
  echo "node_modules missing; run 'npm ci' first" >&2
  exit 1
fi
cp -a "${REPO_DIR}/node_modules" "${APP_DIR}/"

echo "== Staging Debian metadata"
cp -a "${TEMPLATE_DIR}/etc/." "${STAGE}/etc/"
cp -a "${TEMPLATE_DIR}/lib/." "${STAGE}/lib/"
cp -a "${TEMPLATE_DIR}/usr/." "${STAGE}/usr/"
mkdir -p "${STAGE}/DEBIAN"
cp -a "${TEMPLATE_DIR}/DEBIAN/." "${STAGE}/DEBIAN/"
chmod 0755 "${STAGE}/DEBIAN/postinst" "${STAGE}/DEBIAN/prerm" "${STAGE}/DEBIAN/postrm"
chmod 0644 "${STAGE}/DEBIAN/control" "${STAGE}/DEBIAN/conffiles"

gzip -9n -c "${STAGE}/usr/share/doc/fuluk-gateway/changelog" \
  > "${STAGE}/usr/share/doc/fuluk-gateway/changelog.gz"
rm "${STAGE}/usr/share/doc/fuluk-gateway/changelog"

INSTALLED_SIZE="$(du -sk --exclude=DEBIAN "${STAGE}" | awk '{print $1}')"
sed -i \
  -e "s/@VERSION@/${VERSION}/g" \
  -e "s/@INSTALLED_SIZE@/${INSTALLED_SIZE}/g" \
  "${STAGE}/DEBIAN/control"

find "${STAGE}" -type d -exec chmod 0755 {} +

echo "== Building ${DEB_NAME}"
mkdir -p "${OUT_DIR}"
dpkg-deb --root-owner-group -b "${STAGE}" "${OUT_DIR}/${DEB_NAME}"

echo "== Package info"
dpkg-deb -I "${OUT_DIR}/${DEB_NAME}"
echo "Built: ${OUT_DIR}/${DEB_NAME}"
