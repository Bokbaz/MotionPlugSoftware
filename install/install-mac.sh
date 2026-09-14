#!/bin/bash
# Development installer for the Motion Plug CEP extension.

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESTINATION="$HOME/Library/Application Support/Adobe/CEP/extensions/MotionPlug"

cd "$SOURCE_DIR"
npm run build

for CSXS_VERSION in 9 10 11 12 13 14 15; do
  defaults write "com.adobe.CSXS.$CSXS_VERSION" PlayerDebugMode 1
done
killall cfprefsd 2>/dev/null || true

if [ -d "$DESTINATION" ]; then
  rm -rf "$DESTINATION"
fi
mkdir -p "$DESTINATION"
cp -R "$SOURCE_DIR/dist/." "$DESTINATION/"

echo "Motion Plug installed at: $DESTINATION"
echo "Fully quit Premiere Pro, reopen it, then choose Window > Extensions > Motion Plug."
