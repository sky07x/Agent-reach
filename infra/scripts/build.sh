#!/usr/bin/env bash
#
# Build the Lambda deployment package (a plain zip, no Docker).
#
# Two things make this more than a `cp -R`:
#
#   1. sharp ships a different native binary per platform. Installing on a Mac
#      gets you the macOS one, and Lambda answers with "invalid ELF header".
#      The --os/--cpu/--libc flags below fetch the Linux arm64 build instead.
#
#   2. Lambda has no fonts installed, so sharp draws the meme backgrounds and
#      no text at all, silently. We bundle DejaVu and point fontconfig at it.
#
# Output: infra/build/, which template.yaml uploads as its CodeUri.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$ROOT/infra/build"

echo "Cleaning $BUILD"
rm -rf "$BUILD"
mkdir -p "$BUILD"

# Fonts first, so the assets copy below picks them up.
"$ROOT/infra/scripts/fetch-fonts.sh"

# --- the code ---------------------------------------------------------------
cp -R "$ROOT/src" "$BUILD/src"
cp -R "$ROOT/assets" "$BUILD/assets"
cp "$ROOT/package.json" "$BUILD/package.json"

# Docs are for people reading the repo, not for the runtime.
find "$BUILD/assets" -name 'README.md' -delete

# --- dependencies, built for Lambda's platform rather than this machine's ---
echo "Installing dependencies for linux/arm64..."
npm install \
  --prefix "$BUILD" \
  --omit=dev \
  --os=linux \
  --cpu=arm64 \
  --libc=glibc \
  --no-audit \
  --no-fund

# CLI shims are symlinks and useless inside Lambda.
rm -rf "$BUILD/node_modules/.bin"

# --- sanity checks ----------------------------------------------------------
if ! ls "$BUILD"/node_modules/@img/sharp-linux-arm64* >/dev/null 2>&1; then
  echo "ERROR: no linux-arm64 sharp binary. Meme rendering would fail on" >&2
  echo "       Lambda. Check that your npm supports --os/--cpu (npm 10+)." >&2
  exit 1
fi

if ! ls "$BUILD"/assets/fonts/*.ttf >/dev/null 2>&1; then
  echo "ERROR: no fonts bundled. Memes would render with no text on them." >&2
  exit 1
fi

echo
echo "Built $BUILD ($(du -sh "$BUILD" | cut -f1))"
