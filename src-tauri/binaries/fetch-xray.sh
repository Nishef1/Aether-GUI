#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir)
      DEST_DIR="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

REPO="XTLS/Xray-core"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
if [[ -n "$VERSION" ]]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
fi

mkdir -p "$DEST_DIR"
TMP_DIR="$(mktemp -d "${DEST_DIR}/_xray_install_XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ASSET_NAME="Xray-linux-64.zip" ;;
  Linux-aarch64|Linux-arm64) ASSET_NAME="Xray-linux-arm64-v8a.zip" ;;
  Darwin-x86_64) ASSET_NAME="Xray-macos-64.zip" ;;
  Darwin-arm64) ASSET_NAME="Xray-macos-arm64-v8a.zip" ;;
  *)
    echo "Unsupported platform for Xray installer: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

RELEASE_JSON="$TMP_DIR/release.json"
curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 45 \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: Aether-GUI-Core-Manager' \
  "$API_URL" -o "$RELEASE_JSON"

# Emit one tab-separated record instead of using Bash 4-only `readarray`.
# macOS still ships Bash 3.2, so keep this installer portable across the
# GitHub-hosted Linux and macOS runners.
META="$(python3 - "$RELEASE_JSON" "$ASSET_NAME" <<'PY'
import json, sys
path, name = sys.argv[1:]
with open(path, encoding='utf-8') as f:
    release = json.load(f)
asset = next((item for item in release.get('assets', []) if item.get('name') == name), None)
if not asset:
    raise SystemExit(f"release {release.get('tag_name')} does not contain {name}")
digest = asset.get('digest') or ''
if not digest.startswith('sha256:'):
    raise SystemExit(f"GitHub did not provide a SHA-256 digest for {name}")
tag = release.get('tag_name') or ''
url = asset.get('browser_download_url') or ''
sha = digest.split(':', 1)[1].lower()
if not tag or not url or not sha:
    raise SystemExit("Incomplete Xray release metadata")
print("\t".join((tag, url, sha)))
PY
)"
IFS=$'\t' read -r TAG DOWNLOAD_URL EXPECTED_SHA <<EOF
$META
EOF

if [[ -z "$TAG" || -z "$DOWNLOAD_URL" || -z "$EXPECTED_SHA" ]]; then
  echo "Incomplete Xray release metadata" >&2
  exit 1
fi
if [[ -n "$VERSION" && "$TAG" != "$VERSION" ]]; then
  echo "Expected Xray release $VERSION but GitHub returned $TAG" >&2
  exit 1
fi

ARCHIVE="$TMP_DIR/$ASSET_NAME"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"
curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 120 \
  -H 'User-Agent: Aether-GUI-Core-Manager' \
  "$DOWNLOAD_URL" -o "$ARCHIVE"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print tolower($1)}')"
else
  echo "Neither sha256sum nor shasum is available" >&2
  exit 1
fi
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Checksum mismatch for $ASSET_NAME" >&2
  exit 1
fi

unzip -q "$ARCHIVE" -d "$EXTRACT_DIR"
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name xray -print -quit)"
if [[ -z "$DOWNLOADED" || ! -s "$DOWNLOADED" ]]; then
  echo "xray was not found or is empty inside $ASSET_NAME" >&2
  exit 1
fi

SAFE_VERSION="$(printf '%s' "$TAG" | tr -c 'A-Za-z0-9._-' '_')"
VERSIONED_TARGET="$DEST_DIR/xray-$SAFE_VERSION"
FALLBACK_TARGET="$DEST_DIR/xray"
VERSION_FILE="$DEST_DIR/xray-version.txt"

install -m 0755 "$DOWNLOADED" "$VERSIONED_TARGET.new"
mv -f "$VERSIONED_TARGET.new" "$VERSIONED_TARGET"
cp -f "$VERSIONED_TARGET" "$FALLBACK_TARGET"
chmod 0755 "$FALLBACK_TARGET"
printf '%s' "$TAG" > "$VERSION_FILE"

test -s "$VERSIONED_TARGET"
test -s "$FALLBACK_TARGET"
test "$(cat "$VERSION_FILE")" = "$TAG"
echo "[core-installer] Xray $TAG installed and SHA-256 verified"
