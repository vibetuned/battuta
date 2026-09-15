#!/bin/sh
# Tauri shell smoke: embedded-asset build renders the app, the native
# save path works, and the MIDI bridge delivers devices + notes. NEEDS A
# DISPLAY (Wayland/X11) and libasound2-dev (sudo apt install
# libasound2-dev) — run from a desktop session, not CI. From the repo
# root:  sh spikes/verify-tauri.sh
set -e
cd "$(dirname "$0")/.."
# GNU `timeout` is not on macOS; fall back to a background run + kill.
if command -v timeout >/dev/null 2>&1; then
  run_for() { timeout "$@"; }
else
  run_for() { secs="$1"; shift; "$@" & pid=$!; ( sleep "$secs"; kill "$pid" 2>/dev/null ) & killer=$!; wait "$pid" 2>/dev/null; kill "$killer" 2>/dev/null; true; }
fi
npm run build -w @battuta/editor >/dev/null
( cd apps/editor/src-tauri && cargo build --features custom-protocol )
OUT=$(mktemp -d)/selftest.mei
# The workspace probe: a folder with two scores, picked without a dialog
# (BATTUTA_WORKSPACE_TEST_DIR), listed and watched; the change below lands
# while the watch is up (probe4 places it at ~5 s).
WSDIR=$(mktemp -d)
cp fixtures/Bach-JS_Ein_feste_Burg.mei "$WSDIR/one.mei"
cp fixtures/synthetic-context-changes.mei "$WSDIR/two.mei"
( sleep 10; echo "<!-- touched by verify-tauri.sh -->" >> "$WSDIR/two.mei" ) &
LOG=$(BATTUTA_SHELL_TEST_FILE="$OUT" BATTUTA_MIDI_TEST=1 BATTUTA_WORKSPACE_TEST_DIR="$WSDIR" run_for 18 ./apps/editor/src-tauri/target/debug/battuta-editor 2>&1 || true)
echo "$LOG" | grep -q "page loaded: tauri://localhost" && echo "PASS  embedded assets load over tauri://" || { echo "FAIL  page never loaded"; exit 1; }
echo "$LOG" | grep -qE "probe: __TAURI__=present tiles=[1-9]" && echo "PASS  the score renders (tiles > 0)" || { echo "FAIL  no tiles rendered"; exit 1; }
echo "$LOG" | grep -q "selftest: saved" && grep -q "<mei" "$OUT" && echo "PASS  save_score writes real MEI to disk" || { echo "FAIL  save self-test"; exit 1; }
echo "$LOG" | grep -q "probe2: midi=MIDI <>" && echo "PASS  native MIDI bridge reaches the status bar" || { echo "FAIL  MIDI bridge (device list)"; exit 1; }
echo "$LOG" | grep -q "MIDI note received" && echo "PASS  bridged note events reach the editor" || { echo "FAIL  MIDI bridge (notes)"; exit 1; }
# probe3 drives the real player: page view wakes the playback plugin (its
# chunk and Tone's over tauri://), play decodes the mp3 piano, a note lights.
echo "$LOG" | grep -q "probe3: playback ok" && echo "PASS  the playback plugin plays in the shell (lazy chunks over tauri://, mp3 piano decoded)" || { echo "FAIL  playback in the shell: $(echo "$LOG" | grep -o 'probe3: .*' | head -1)"; exit 1; }
# probe4: the workspace service — pick (test dir), list, a read outside the
# roots refused, a watch placed, and the change this script made observed.
echo "$LOG" | grep -q "probe4: workspace ok (2 entries, scoped, change modified two.mei)" && echo "PASS  the workspace service lists, scopes and watches the picked folder" || { echo "FAIL  workspace: $(echo "$LOG" | grep -o 'probe4: .*' | head -2 | tr '\n' ' ')"; exit 1; }

# Launch with a .mei argument (what a file-manager double-click does once
# the association is installed): the file must open as the active tab.
ARG=$(mktemp -d)/assoc-check.mei
cp fixtures/Bach-JS_Ein_feste_Burg.mei "$ARG"
LOG2=$(run_for 15 ./apps/editor/src-tauri/target/debug/battuta-editor "$ARG" 2>&1 || true)
echo "$LOG2" | grep -q "probe2: .*tab=assoc-check" && echo "PASS  launch argument opens the score" || { echo "FAIL  launch-with-file"; exit 1; }
echo "ALL SHELL CHECKS PASSED"
