#!/usr/bin/env bash
#
# Download the fonts the meme generator needs on AWS Lambda.
#
# Lambda's Node runtime has no fonts installed, so sharp draws the meme
# backgrounds and then no text at all, silently. We bundle two DejaVu faces
# into the deployment package and point fontconfig at them.
#
# The .ttf files are gitignored, so run this once before your first deploy.
# deploy.sh calls it automatically when the files are missing.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FONT_DIR="$ROOT/assets/fonts"

# DejaVu is under a Bitstream Vera derived licence that allows redistribution.
# https://dejavu-fonts.github.io/License.html
VERSION="2.37"
ARCHIVE_URL="https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_${VERSION//./_}/dejavu-fonts-ttf-${VERSION}.tar.bz2"

WANTED=(DejaVuSans.ttf DejaVuSans-Bold.ttf DejaVuSansMono.ttf DejaVuSansMono-Bold.ttf)

# Nothing to do if they are all already here.
missing=false
for font in "${WANTED[@]}"; do
  [[ -f "$FONT_DIR/$font" ]] || missing=true
done

if [[ "$missing" == false ]]; then
  echo "Fonts already present in $FONT_DIR"
  exit 0
fi

echo "Downloading DejaVu $VERSION..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$ARCHIVE_URL" -o "$TMP/dejavu.tar.bz2"
tar -xjf "$TMP/dejavu.tar.bz2" -C "$TMP"

mkdir -p "$FONT_DIR"

for font in "${WANTED[@]}"; do
  found="$(find "$TMP" -name "$font" -type f | head -1)"

  if [[ -z "$found" ]]; then
    echo "Could not find $font in the archive" >&2
    exit 1
  fi

  cp "$found" "$FONT_DIR/$font"
  echo "  $font"
done

echo "Done. Fonts are in $FONT_DIR (gitignored)."
