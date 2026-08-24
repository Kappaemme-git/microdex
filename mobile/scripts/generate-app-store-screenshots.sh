#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOBILE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUTPUT_DIR="$MOBILE_DIR/store/screenshots/en-US/APP_IPHONE_67"
TEMPLATE_FILE="$MOBILE_DIR/store/screenshots/template.html"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

mkdir -p "$OUTPUT_DIR"

render_screenshot() {
  scene=$1
  output_file=$2
  chrome_profile=$(mktemp -d /tmp/microdex-screenshot-chrome.XXXXXX)
  output_path="$OUTPUT_DIR/$output_file"
  rm -f "$output_path"

  "$CHROME_BIN" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --run-all-compositor-stages-before-draw \
    --virtual-time-budget=1500 \
    --user-data-dir="$chrome_profile" \
    --force-device-scale-factor=1 \
    --window-size=1320,2868 \
    --screenshot="$output_path" \
    "file://$TEMPLATE_FILE?scene=$scene" >/dev/null 2>&1 &
  chrome_pid=$!

  attempts=0
  while [ ! -s "$output_path" ] && [ "$attempts" -lt 100 ]; do
    sleep 0.1
    attempts=$((attempts + 1))
  done

  if [ ! -s "$output_path" ]; then
    kill "$chrome_pid" 2>/dev/null || true
    wait "$chrome_pid" 2>/dev/null || true
    echo "Screenshot rendering timed out: $output_file" >&2
    exit 1
  fi

  # Current Chrome can leave its headless parent alive after writing the PNG.
  # Stop only that isolated temporary-profile process once the complete file exists.
  kill "$chrome_pid" 2>/dev/null || true
  wait "$chrome_pid" 2>/dev/null || true
  rm -rf "$chrome_profile"
}

render_screenshot controller 01-control-codex.png
render_screenshot workflow 02-workflow-anywhere.png
render_screenshot voice 03-voice-chat.png
render_screenshot controls 04-control-deck.png
render_screenshot onboarding 05-encrypted-pairing.png
