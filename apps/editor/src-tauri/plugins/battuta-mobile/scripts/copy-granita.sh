#!/bin/sh
# Copy granita's released model into this plugin (phase 11, M2): the Core ML
# package for the iPad, the LiteRT model for Android, the sidecar and the
# anchors for both, and the fixtures the debug shell checks itself with. Tracked here on
# purpose, so a build needs nothing outside the repo; this script and
# granita/VERSION say which release they are.
#
#   sh plugins/battuta-mobile/scripts/copy-granita.sh ../path/to/granita
set -e
src="${1:?usage: copy-granita.sh <granita checkout>}"
# granita's battuta variant (models/battuta since granita v8, 2026-11-02; models/granitanet before).
models="$src/models/battuta"
[ -d "$models/granitanet.mlpackage" ] || { echo "no models/battuta in $src" >&2; exit 1; }
here="$(cd "$(dirname "$0")/.." && pwd)"

rm -rf "$here/ios/Resources/granitanet.mlpackage"
mkdir -p "$here/ios/Resources" "$here/android/src/main/assets" "$here/granita"
cp -R "$models/granitanet.mlpackage" "$here/ios/Resources/"
cp "$models/granitanet.json" "$here/ios/Resources/granitanet.json"
cp "$models/granitanet.json" "$here/android/src/main/assets/granitanet.json"
cp "$models/granitanet.tflite" "$here/android/src/main/assets/granitanet.tflite"
# The anchors (granita v8's personal layer, 2026-11-02): what the training on the device holds the layer to.
cp "$models/anchors.json" "$here/ios/Resources/anchors.json"
cp "$models/anchors.json" "$here/android/src/main/assets/anchors.json"
cp "$models/fixtures.json" "$here/granita/fixtures.json"

commit="$(git -C "$src" rev-parse HEAD 2>/dev/null || echo unknown)"
run="$(grep -o 'training run `battuta[^`]*`' "$src/models/README.md" | head -1 | sed 's/training run //; s/`//g')"
dirty=""
if [ -n "$(git -C "$src" status --porcelain 2>/dev/null)" ]; then dirty=" (working tree not clean at the copy)"; fi
cat > "$here/granita/VERSION" <<EOF
granita $commit$dirty
model granitanet (${run:-unknown run}), models/battuta in that commit
copied $(date -u +%Y-%m-%d) by scripts/copy-granita.sh
EOF
echo "copied granitanet from $src at $commit"
