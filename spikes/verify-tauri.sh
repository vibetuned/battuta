#!/bin/sh
# Tauri shell smoke: embedded-asset build renders the app, the native
# save path works, and the MIDI bridge delivers devices + notes. NEEDS A
# DISPLAY (Wayland/X11) and libasound2-dev (sudo apt install
# libasound2-dev) — run from a desktop session, not CI. From the repo
# root:  sh spikes/verify-tauri.sh
set -e
cd "$(dirname "$0")/.."
npm run build -w @battuta/editor >/dev/null
( cd apps/editor/src-tauri && cargo build --features custom-protocol )
OUT=$(mktemp -d)/selftest.mei
LOG=$(BATTUTA_SHELL_TEST_FILE="$OUT" BATTUTA_MIDI_TEST=1 timeout 15 ./apps/editor/src-tauri/target/debug/battuta-editor 2>&1 || true)
echo "$LOG" | grep -q "page loaded: tauri://localhost" && echo "PASS  embedded assets load over tauri://" || { echo "FAIL  page never loaded"; exit 1; }
echo "$LOG" | grep -qE "probe: __TAURI__=present tiles=[1-9]" && echo "PASS  the score renders (tiles > 0)" || { echo "FAIL  no tiles rendered"; exit 1; }
echo "$LOG" | grep -q "selftest: saved" && grep -q "<mei" "$OUT" && echo "PASS  save_score writes real MEI to disk" || { echo "FAIL  save self-test"; exit 1; }
echo "$LOG" | grep -q "probe2: midi=MIDI <>" && echo "PASS  native MIDI bridge reaches the status bar" || { echo "FAIL  MIDI bridge (device list)"; exit 1; }
echo "$LOG" | grep -q "MIDI note received" && echo "PASS  bridged note events reach the editor" || { echo "FAIL  MIDI bridge (notes)"; exit 1; }

# Launch with a .mei argument (what a file-manager double-click does once
# the association is installed): the file must open as the active tab.
ARG=$(mktemp -d)/assoc-check.mei
cp fixtures/Bach-JS_Ein_feste_Burg.mei "$ARG"
LOG2=$(timeout 15 ./apps/editor/src-tauri/target/debug/battuta-editor "$ARG" 2>&1 || true)
echo "$LOG2" | grep -q "probe2: .*tab=assoc-check" && echo "PASS  launch argument opens the score" || { echo "FAIL  launch-with-file"; exit 1; }
echo "ALL SHELL CHECKS PASSED"
