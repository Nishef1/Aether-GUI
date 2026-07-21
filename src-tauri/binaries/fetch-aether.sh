#!/usr/bin/env bash
# Downloads the latest stable Aether release for the current platform and
# verifies it against the release's SHA256SUMS.txt. The destination can be
# overridden for the GUI's runtime-managed core directory.
set -euo pipefail

REPO="CluvexStudio/Aether"
DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir)
      DEST_DIR="$2"
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
    echo "Unsupported platform: $(uname -s)-$(uname -m). On native Windows use fetch-aether.ps1." >&2
    exit 1
    ;;
esac

# Cross-build override: the bundled core must match the target, not host.
ASSET="${AETHER_ASSET:-$ASSET}"

API_URL="https://api.github.com/repos/${REPO}/releases/latest"
LATEST_JSON="$(curl -fsSL -H 'User-Agent: Aether-GUI-Core-Updater' "$API_URL")"
AETHER_VERSION="$(printf '%s' "$LATEST_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
if [[ -z "$AETHER_VERSION" ]]; then
  echo "Could not determine latest Aether release tag" >&2
  exit 1
fi
SAFE_VERSION="$(printf '%s' "$AETHER_VERSION" | tr -c 'A-Za-z0-9._-' '_')"

FALLBACK_TARGET="$DEST_DIR/aether"
VERSIONED_TARGET="$DEST_DIR/aether-$SAFE_VERSION"
VERSION_FILE="$DEST_DIR/aether-version.txt"
if [[ -x "$VERSIONED_TARGET" && -f "$VERSION_FILE" && "$(tr -d '\r\n' < "$VERSION_FILE")" == "$AETHER_VERSION" ]]; then
  echo "[core-updater] Aether $AETHER_VERSION is already installed"
  if [[ ! -e "$FALLBACK_TARGET" ]]; then
    cp "$VERSIONED_TARGET" "$FALLBACK_TARGET"
    chmod +x "$FALLBACK_TARGET"
  fi
  exit 0
fi

URL="https://github.com/${REPO}/releases/download/${AETHER_VERSION}/${ASSET}"
SUMS_URL="https://github.com/${REPO}/releases/download/${AETHER_VERSION}/SHA256SUMS.txt"
TMP_DIR="$(mktemp -d "${DEST_DIR%/}/.aether-update.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="$TMP_DIR/$ASSET"
SUMS="$TMP_DIR/SHA256SUMS.txt"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"

echo "[core-updater] Downloading Aether $AETHER_VERSION..."
curl -fL --retry 2 -H 'User-Agent: Aether-GUI-Core-Updater' -o "$ARCHIVE" "$URL"
curl -fL --retry 2 -H 'User-Agent: Aether-GUI-Core-Updater' -o "$SUMS" "$SUMS_URL"

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
  echo "Checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)" >&2
  exit 1
fi
echo "[core-updater] SHA-256 verified"

tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name aether -print -quit)"
if [[ -z "$DOWNLOADED" ]]; then
  echo "aether binary not found inside $ASSET" >&2
  exit 1
fi
chmod +x "$DOWNLOADED"

# Immutable versioned installation: an existing process may continue executing
# its old file while the version pointer switches future connections to this one.
VERSIONED_NEW="$VERSIONED_TARGET.new"
rm -f "$VERSIONED_NEW"
cp "$DOWNLOADED" "$VERSIONED_NEW"
chmod +x "$VERSIONED_NEW"
mv "$VERSIONED_NEW" "$VERSIONED_TARGET"

VERSION_FILE_NEW="$VERSION_FILE.new"
printf '%s' "$AETHER_VERSION" > "$VERSION_FILE_NEW"
mv "$VERSION_FILE_NEW" "$VERSION_FILE"

# Conventional fallback alias for build/manual use. It is not the runtime
# pointer once a valid versioned managed core exists.
if ! cp "$VERSIONED_TARGET" "$FALLBACK_TARGET" 2>/dev/null; then
  echo "[core-updater] warning: could not refresh fallback alias $FALLBACK_TARGET" >&2
else
  chmod +x "$FALLBACK_TARGET"
fi

echo "[core-updater] Aether core updated to $AETHER_VERSION"
