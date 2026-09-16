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
# Every launch below runs with an in-memory WebView data store: the shell's
# BATTUTA_EPHEMERAL_STORAGE=1 (incognito). Without it each run restored the
# user's recovered session, added its test scores to it and saved it back —
# a session full of smoke files to erase by hand (2026-09-16). The user's
# stored session is fingerprinted before and after and must not change.
export BATTUTA_EPHEMERAL_STORAGE=1
storage_fingerprint() {
  # macOS: WebKit keeps per-origin data (localStorage, IndexedDB) under
  # WebsiteData/Default/<origin hash>/ — the process name for a plain binary,
  # the bundle identifier for the .app. Linux: the app's local data dir.
  for d in "$HOME/Library/WebKit/battuta-editor/WebsiteData/Default" "$HOME/Library/WebKit/dev.battuta.editor/WebsiteData/Default" \
           "$HOME/.local/share/battuta-editor" "$HOME/.local/share/dev.battuta.editor"; do
    if [ -d "$d" ]; then find "$d" -type f -exec cat {} + 2>/dev/null | cksum; fi
  done
  true # a missing directory is not a failure (set -e)
}
STORAGE_BEFORE=$(storage_fingerprint)
OUT=$(mktemp -d)/selftest.mei
# The workspace probe: a folder with two scores, picked without a dialog
# (BATTUTA_WORKSPACE_TEST_DIR), listed and watched; the change below lands
# while probe4's watch is up (placed at ~5 s) AND after probe5 has opened
# two.mei from the folder view (~10 s), so the live guard has an open tab
# to match — before that it has nothing to compare against.
WSDIR=$(mktemp -d)
cp fixtures/Bach-JS_Ein_feste_Burg.mei "$WSDIR/one.mei"
cp fixtures/synthetic-context-changes.mei "$WSDIR/two.mei"
( sleep 13; echo "<!-- touched by verify-tauri.sh -->" >> "$WSDIR/two.mei" ) &
# On an empty store the app starts with a blank untitled score (rests only),
# so the launch gets a real score as its argument for the playback probe.
SCORE=$(mktemp -d)/score.mei
cp fixtures/Bach-JS_Ein_feste_Burg.mei "$SCORE"
LOG=$(BATTUTA_SHELL_TEST_FILE="$OUT" BATTUTA_MIDI_TEST=1 BATTUTA_WORKSPACE_TEST_DIR="$WSDIR" run_for 22 ./apps/editor/src-tauri/target/debug/battuta-editor "$SCORE" 2>&1 || true)
echo "$LOG" | grep -q "page loaded: tauri://localhost" && echo "PASS  embedded assets load over tauri://" || { echo "FAIL  page never loaded"; exit 1; }
echo "$LOG" | grep -q "storage: ephemeral" && echo "PASS  the shell runs on an in-memory data store" || { echo "FAIL  the shell ignored BATTUTA_EPHEMERAL_STORAGE"; exit 1; }
echo "$LOG" | grep -qE "probe: __TAURI__=present tiles=[1-9]" && echo "PASS  the score renders (tiles > 0)" || { echo "FAIL  no tiles rendered"; exit 1; }
echo "$LOG" | grep -q "selftest: saved" && grep -q "<mei" "$OUT" && echo "PASS  save_score writes real MEI to disk" || { echo "FAIL  save self-test"; exit 1; }
echo "$LOG" | grep -q "probe2: midi=MIDI <>" && echo "PASS  native MIDI bridge reaches the status bar" || { echo "FAIL  MIDI bridge (device list)"; exit 1; }
echo "$LOG" | grep -q "MIDI note received" && echo "PASS  bridged note events reach the editor" || { echo "FAIL  MIDI bridge (notes)"; exit 1; }
# probe3 drives the real player: page view wakes the playback plugin (its
# chunk and Tone's over tauri://), play decodes the mp3 piano, a note lights.
echo "$LOG" | grep -q "probe3: playback ok" && echo "PASS  the playback plugin plays in the shell (lazy chunks over tauri://, mp3 piano decoded)" || { echo "FAIL  playback in the shell: $(echo "$LOG" | grep -o 'probe3: .*' | head -1)"; exit 1; }
# probe4: the workspace service — pick (test dir), list, a read outside the
# roots refused, a watch placed, and the change this script made observed.
# (macOS FSEvents reports an append to a file created seconds earlier as "created"; Linux says "modified" — either is the change.)
echo "$LOG" | grep -qE "probe4: workspace ok \(2 entries, scoped, change (modified|created) two.mei\)" && echo "PASS  the workspace service lists, scopes and watches the picked folder" || { echo "FAIL  workspace: $(echo "$LOG" | grep -o 'probe4: .*' | head -2 | tr '\n' ' ')"; exit 1; }
# probe5 drives the folder-view plugin's real UI: the declared 📁, the side
# panel, the folder picked without a dialog, a score opened by clicking its
# row, and the row marked open from ctx.documents. The browser half is
# spikes/verify-folder-view.mjs. The live external-change guard is REPORTED
# in the message ("guard yes" / "guard no") but not asserted here: it is
# 9a's, and whether it fires depends on the platform's event kind — see the
# note on probe4 below.
echo "$LOG" | grep -q "probe5: folder view ok" && echo "PASS  the folder view lists, opens a score and sees it change ($(echo "$LOG" | grep -o 'probe5: folder view ok (.*)' | head -1 | sed 's/probe5: folder view ok //'))" || { echo "FAIL  folder view: $(echo "$LOG" | grep -o 'probe5: .*' | head -2 | tr '\n' ' ')"; exit 1; }

# A NORMAL launch — no probe flags (the storage flag stays on) — must run none of the probes that drive
# the UI (page view + play, a folder pick, the folder view): on 2026-09-16
# they ran on every start and the app switched views, sounded a note and
# opened a folder by itself. Only the passive probes (tiles, MIDI list) may log.
LOG0=$(run_for 8 ./apps/editor/src-tauri/target/debug/battuta-editor 2>&1 || true)
echo "$LOG0" | grep -qE "probe[345]:" && { echo "FAIL  a UI-driving probe ran on a normal launch: $(echo "$LOG0" | grep -oE 'probe[345]: [^ ]+' | head -1)"; exit 1; } || echo "PASS  a normal launch runs no UI-driving probe"

# Launch with a .mei argument (what a file-manager double-click does once
# the association is installed): the file must open as the active tab.
ARG=$(mktemp -d)/assoc-check.mei
cp fixtures/Bach-JS_Ein_feste_Burg.mei "$ARG"
LOG2=$(run_for 15 ./apps/editor/src-tauri/target/debug/battuta-editor "$ARG" 2>&1 || true)
echo "$LOG2" | grep -q "probe2: .*tab=assoc-check" && echo "PASS  launch argument opens the score" || { echo "FAIL  launch-with-file"; exit 1; }
# Three launches opened scores; none may have reached the user's stored session.
[ "$(storage_fingerprint)" = "$STORAGE_BEFORE" ] && echo "PASS  the user's stored session is untouched" || { echo "FAIL  the smoke wrote to the user's WebView storage"; exit 1; }
echo "ALL SHELL CHECKS PASSED"
