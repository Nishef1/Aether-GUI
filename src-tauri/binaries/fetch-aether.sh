#!/usr/bin/env bash
set -euo pipefail

REPO="CluvexStudio/Aether"
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

mkdir -p "$DEST_DIR"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)   ASSET="aether-linux-x86_64.tar.gz" ;;
  Linux-aarch64)  ASSET="aether-linux-arm64.tar.gz" ;;
  Darwin-x86_64)  ASSET="aether-macos-x86_64.tar.gz" ;;
  Darwin-arm64)   ASSET="aether-macos-arm64.tar.gz" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

ASSET="${AETHER_ASSET:-$ASSET}"
HEADERS=(-H 'User-Agent: Aether-GUI-Core-Manager')
if [[ -n "$VERSION" ]]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
else
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
fi

RELEASE_JSON="$(curl -fsSL "${HEADERS[@]}" "$API_URL")"
RESOLVED_VERSION="$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
if [[ -z "$RESOLVED_VERSION" ]]; then
  echo "Could not determine Aether release tag" >&2
  exit 1
fi
if [[ -n "$VERSION" && "$RESOLVED_VERSION" != "$VERSION" ]]; then
  echo "Expected Aether release $VERSION but GitHub returned $RESOLVED_VERSION" >&2
  exit 1
fi

SAFE_VERSION="$(printf '%s' "$RESOLVED_VERSION" | tr -c 'A-Za-z0-9._-' '_')"
VERSIONED_TARGET="$DEST_DIR/aether-$SAFE_VERSION"
FALLBACK_TARGET="$DEST_DIR/aether"
VERSION_FILE="$DEST_DIR/aether-version.txt"
if [[ -x "$VERSIONED_TARGET" ]]; then
  cp "$VERSIONED_TARGET" "$FALLBACK_TARGET"
  chmod +x "$FALLBACK_TARGET"
  printf '%s' "$RESOLVED_VERSION" > "$VERSION_FILE"
  echo "[core-installer] Aether $RESOLVED_VERSION is already installed and packaging outputs were refreshed"
  exit 0
fi

URL="https://github.com/${REPO}/releases/download/${RESOLVED_VERSION}/${ASSET}"
SUMS_URL="https://github.com/${REPO}/releases/download/${RESOLVED_VERSION}/SHA256SUMS.txt"
TMP_DIR="$(mktemp -d "${DEST_DIR%/}/.aether-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
ARCHIVE="$TMP_DIR/$ASSET"
SUMS="$TMP_DIR/SHA256SUMS.txt"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"

curl -fL --retry 2 "${HEADERS[@]}" -o "$ARCHIVE" "$URL"
curl -fL --retry 2 "${HEADERS[@]}" -o "$SUMS" "$SUMS_URL"

EXPECTED="$(awk -v asset="$ASSET" '$2 == asset { print tolower($1); exit }' "$SUMS")"
if [[ -z "$EXPECTED" ]]; then
  echo "No checksum entry found for $ASSET" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print tolower($1)}')"
else
  echo "Neither sha256sum nor shasum is available" >&2
  exit 1
fi

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "Checksum mismatch for $ASSET" >&2
  exit 1
fi

tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name aether -print -quit)"
if [[ -z "$DOWNLOADED" ]]; then
  echo "aether binary not found inside $ASSET" >&2
  exit 1
fi
chmod +x "$DOWNLOADED"

TEMP_TARGET="$VERSIONED_TARGET.new"
rm -f "$TEMP_TARGET"
cp "$DOWNLOADED" "$TEMP_TARGET"
chmod +x "$TEMP_TARGET"
mv "$TEMP_TARGET" "$VERSIONED_TARGET"
cp "$VERSIONED_TARGET" "$FALLBACK_TARGET"
chmod +x "$FALLBACK_TARGET"
printf '%s' "$RESOLVED_VERSION" > "$VERSION_FILE"

echo "[core-installer] Aether $RESOLVED_VERSION installed and SHA-256 verified"
