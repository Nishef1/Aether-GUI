#!/usr/bin/env bash
set -euo pipefail

REPO="SagerNet/sing-box"
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
  Linux-x86_64)   PLATFORM="linux-amd64" ;;
  Linux-aarch64)  PLATFORM="linux-arm64" ;;
  Darwin-x86_64)  PLATFORM="darwin-amd64" ;;
  Darwin-arm64)   PLATFORM="darwin-arm64" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

HEADERS=(-H 'User-Agent: Aether-GUI-Core-Manager')
if [[ -n "$VERSION" ]]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
else
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
fi
RELEASE_JSON="$(curl -fsSL "${HEADERS[@]}" "$API_URL")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to parse sing-box release metadata" >&2
  exit 1
fi

META="$(printf '%s' "$RELEASE_JSON" | PLATFORM="$PLATFORM" EXPECTED_VERSION="$VERSION" node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const r=JSON.parse(s); const tag=r.tag_name||"";
  if(process.env.EXPECTED_VERSION && tag!==process.env.EXPECTED_VERSION) process.exit(2);
  const v=tag.replace(/^v/,""); const name=`sing-box-${v}-${process.env.PLATFORM}.tar.gz`;
  const a=(r.assets||[]).find(x=>x.name===name);
  if(!tag||!a||!a.browser_download_url||!a.digest) process.exit(2);
  process.stdout.write([tag,name,a.browser_download_url,a.digest].join("\t"));
});
')" || {
  echo "Could not resolve requested sing-box release for $PLATFORM" >&2
  exit 1
}

IFS=$'\t' read -r TAG ASSET URL DIGEST <<< "$META"
EXPECTED="${DIGEST#sha256:}"
if [[ "$DIGEST" == "$EXPECTED" || -z "$EXPECTED" ]]; then
  echo "GitHub did not provide a SHA-256 digest for $ASSET" >&2
  exit 1
fi
EXPECTED="$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')"
SAFE_VERSION="$(printf '%s' "$TAG" | tr -c 'A-Za-z0-9._-' '_')"
VERSIONED_TARGET="$DEST_DIR/sing-box-$SAFE_VERSION"
FALLBACK_TARGET="$DEST_DIR/sing-box"
VERSION_FILE="$DEST_DIR/sing-box-version.txt"
if [[ -x "$VERSIONED_TARGET" ]]; then
  echo "[core-installer] sing-box $TAG is already installed"
  exit 0
fi

TMP_DIR="$(mktemp -d "${DEST_DIR%/}/.singbox-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
ARCHIVE="$TMP_DIR/$ASSET"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"

curl -fL --retry 2 "${HEADERS[@]}" -o "$ARCHIVE" "$URL"
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
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name sing-box -print -quit)"
if [[ -z "$DOWNLOADED" ]]; then
  echo "sing-box binary not found inside $ASSET" >&2
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
printf '%s' "$TAG" > "$VERSION_FILE"

echo "[core-installer] sing-box $TAG installed and SHA-256 verified"
