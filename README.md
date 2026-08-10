# battuta

A local-first MEI score editor that treats notation the way a text editor
treats text: the MEI document is the single source of truth, everything on
screen is a projection of it, and every edit is a reversible command against
it. Verovio does all notation rendering — battuta never draws notation.

- [DESIGN.md](DESIGN.md) — architecture and editing model
- [PLANNING.md](PLANNING.md) — phased plan with exit criteria (remaining phases)
- [CHANGELOG.md](CHANGELOG.md) — the full phase-by-phase record of what landed
- [BENCHMARKS.md](BENCHMARKS.md) — Phase 0 spike results and the render-runner decision

## Status

**0.0.1 released (2026-08-08).** The v1 editor is feature-complete —
tiled Verovio rendering, text-editor caret and selection, reversible
commands with byte-identical undo, note entry (keyboard + MIDI),
copy/paste with the duration validator, context editing, articulations
and ornaments, voices, voltas, tuplets, harmony lanes, a rebindable
keymap — and packaged for Linux (deb + AppImage, app icon, `.mei` file
association).

Phases 0–5 are done; the full record, phase by phase, lives in
[CHANGELOG.md](CHANGELOG.md). Next up: reference layers for
transcription and OMR correction mode — see [PLANNING.md](PLANNING.md).

## Layout

```
packages/core/   @battuta/core — document tree, context resolver, commands.
                 Pure logic; no DOM (enforced: tsconfig lib=[ES2022], types=[]).
apps/editor/     Vite + React shell. Verovio in a worker, tile flow layout,
                 id-based hit-testing. Runs in any browser; Tauri shell later.
spikes/          Phase 0 spikes + runner benchmarks. Throwaway by design.
fixtures/        MEI corpus (music-encoding/sample-encodings). Grows every
                 time a real-world file breaks something.
```

## Quickstart

```sh
npm install
npm run dev --workspace @battuta/editor   # open the printed URL
```

Spikes and benchmarks: see the reproduce block at the top of
[BENCHMARKS.md](BENCHMARKS.md).

## Native/Tauri notes

The Tauri shell lives in `apps/editor/src-tauri` (Tauri 2; needs
`libwebkit2gtk-4.1-dev` and Rust). Two modes — the binary prints which one
it is running at startup:

```sh
# Self-contained (embedded assets, no server — what users will run):
npm run build -w @battuta/editor
cd apps/editor/src-tauri && cargo app     # alias: run --release --features custom-protocol

# Against the dev server (hot reload while hacking):
npm run dev -w @battuta/editor            # serves on :5173
cd apps/editor/src-tauri && cargo run --release   # loads localhost:5173 — BLANK without the dev server
```

The old WebKitGTK 2.52 blank-webview issue no longer reproduces;
`sh spikes/verify-tauri.sh` smoke-tests the self-contained build
(including launching with a `.mei` argument — the file-association path).

### Packaging (0.0.1)

```sh
npm install                     # @tauri-apps/cli is a root devDependency
cd apps/editor && npx tauri build
```

Artifacts land in `apps/editor/src-tauri/target/release/bundle/`:
`deb/battuta_0.0.1_amd64.deb` and `appimage/battuta_0.0.1_amd64.AppImage`.
Bundling needs `libasound2-dev` (MIDI) and, for the AppImage,
`librsvg2-dev`; in sandboxes without FUSE set `APPIMAGE_EXTRACT_AND_RUN=1`.

The deb installs the app icon, a desktop entry with `Exec=battuta-editor
%F`, and a shared-mime-info package mapping `*.mei` →
`application/x-mei+xml` — after `sudo apt install ./battuta_0.0.1_amd64.deb`,
double-clicking a `.mei` file opens it in battuta (the shell passes the
launch argument to the frontend via a pull-based `initial_score` command;
production builds no longer embed the fixtures corpus, ~13 MB lighter).

### macOS and Windows

Tauri does not cross-compile — each OS builds its own bundle (the
webview is the native one: WKWebView on macOS, WebView2 on Windows).
Two options:

- **CI (recommended)**: push a `v*` tag (or run the *release* workflow
  manually) — `.github/workflows/release.yml` builds a universal macOS
  `.dmg`, a Windows NSIS `-setup.exe`, and the Linux deb/AppImage, and
  attaches all of them to a draft GitHub release.
- **Locally on a Mac**: install Xcode command-line tools, rustup, and
  Node, then `npm ci && npm run build -w @battuta/core` and
  `cd apps/editor && npx tauri build --bundles app,dmg` (add
  `--target universal-apple-darwin` after
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin` for one
  binary covering both CPU families).
- **Locally on Windows**: install Visual Studio Build Tools (C++
  workload), rustup (MSVC toolchain), and Node, then the same two npm
  commands and `npx tauri build --bundles nsis`.

Platform notes: `--bundles` on the command line overrides the
Linux-only `deb,appimage` list in tauri.conf.json. MIDI needs no extra
work — `midir` uses CoreMIDI/WinMM natively (on macOS the poll thread
pumps a CFRunLoop: CoreMIDI only reports hot-plug through it). The
`.mei` association comes from `fileAssociations` (Info.plist on macOS,
installer registry on Windows); on macOS the opened file arrives as an
`Opened` run-loop event rather than argv, which the shell also handles.
Unsigned builds trip Gatekeeper — the dmg shows a warning before the
drag-to-Applications window opens (right-click → Open the first time,
or pay for a Developer ID + notarization; `tauri-action` picks up the
`APPLE_CERTIFICATE`/`APPLE_ID` secrets when you add them) — and Windows
SmartScreen ("More info → Run anyway", or a code-signing certificate).

macOS icon: `icons/icon.icns` is hand-assembled on Linux in iconutil's
exact layout. If the dock icon ever renders as the generic grey tile,
rebuild it natively on a Mac —
`iconutil -c icns icons/battuta.iconset -o apps/editor/src-tauri/icons/icon.icns`
— and note macOS caches app icons aggressively: after replacing an app,
`rm -rf /Library/Caches/com.apple.iconservices.store; killall Dock`
(or a re-login) is often needed before the new icon shows.

The native Verovio benchmark needs a
[verovio](https://github.com/rism-digital/verovio) checkout built with
`cmake -B build -S cmake -DBUILD_AS_LIBRARY=ON -DCMAKE_BUILD_TYPE=Release`.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
Verovio, which does all notation rendering, is LGPL-3.0 — compatible
with this licensing.
