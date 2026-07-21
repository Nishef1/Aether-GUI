#!/usr/bin/env bash
# Downloads the validated sing-box release used by this GUI's TUN integration.
# Unlike the independently updateable Aether core, this implementation
# dependency is upgraded deliberately after config/migration testing.
set -euo pipefail

REPO="SagerNet/sing-box"
SINGBOX_VERSION="1.13.12"
TAG="v${SINGBOX_VERSION}"
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
  Linux-x86_64)   PLATFORM="linux-amd64" ;;
  Linux-aarch64)  PLATFORM="linux-arm64" ;;
  Darwin-x86_64)  PLATFORM="darwin-amd64" ;;
  Darwin-arm64)   PLATFORM="darwin-arm64" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m). On native Windows use fetch-singbox.ps1." >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to parse GitHub release metadata" >&2
  exit 1
fi

API_URL="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
RELEASE_JSON="$(curl -fsSL -H 'User-Agent: Aether-GUI-TUN-Fetcher' "$API_URL")"
META="$(printf '%s' "$RELEASE_JSON" | PLATFORM="$PLATFORM" EXPECTED_TAG="$TAG" node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const r=JSON.parse(s); const tag=r.tag_name||"";
  if(tag!==process.env.EXPECTED_TAG){process.exit(2)}
  const v=tag.replace(/^v/,"");
  const name=`sing-box-${v}-${process.env.PLATFORM}.tar.gz`;
  const a=(r.assets||[]).find(x=>x.name===name);
  if(!a||!a.browser_download_url||!a.digest){process.exit(2)}
  process.stdout.write([tag,name,a.browser_download_url,a.digest].join("\t"));
});
')" || {
  echo "Could not resolve validated sing-box $TAG asset for $PLATFORM" >&2
  exit 1
}

IFS=$'\t' read -r RESOLVED_TAG ASSET URL DIGEST <<< "$META"
EXPECTED="${DIGEST#sha256:}"
if [[ "$DIGEST" == "$EXPECTED" || -z "$EXPECTED" ]]; then
  echo "GitHub did not provide a SHA-256 digest for $ASSET; refusing an unverified download" >&2
  exit 1
fi
EXPECTED="$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')"

TARGET="$DEST_DIR/sing-box"
VERSION_FILE="$DEST_DIR/sing-box-version.txt"
if [[ -x "$TARGET" && -f "$VERSION_FILE" && "$(tr -d '\r\n' < "$VERSION_FILE")" == "$RESOLVED_TAG" ]]; then
  echo "[tun-fetcher] sing-box $RESOLVED_TAG is already installed"
  exit 0
fi

TMP_DIR="$(mktemp -d "${DEST_DIR%/}/.singbox-update.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
ARCHIVE="$TMP_DIR/$ASSET"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"

echo "[tun-fetcher] Downloading sing-box $RESOLVED_TAG..."
curl -fL --retry 2 -H 'User-Agent: Aether-GUI-TUN-Fetcher' -o "$ARCHIVE" "$URL"

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
echo "[tun-fetcher] SHA-256 verified"

tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name sing-box -print -quit)"
if [[ -z "$DOWNLOADED" ]]; then
  echo "sing-box binary not found inside $ASSET" >&2
  exit 1
fi
chmod +x "$DOWNLOADED"

NEW_TARGET="$TARGET.new"
BACKUP_TARGET="$TARGET.old"
rm -f "$NEW_TARGET" "$BACKUP_TARGET"
cp "$DOWNLOADED" "$NEW_TARGET"
chmod +x "$NEW_TARGET"
[[ -e "$TARGET" ]] && mv "$TARGET" "$BACKUP_TARGET"
if mv "$NEW_TARGET" "$TARGET"; then
  printf '%s' "$RESOLVED_TAG" > "$VERSION_FILE"
  rm -f "$BACKUP_TARGET"
else
  rm -f "$TARGET"
  [[ -e "$BACKUP_TARGET" ]] && mv "$BACKUP_TARGET" "$TARGET"
  exit 1
fi

echo "[tun-fetcher] sing-box $RESOLVED_TAG is ready"
