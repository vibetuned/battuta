# Changelog

The phase-by-phase record of battuta, newest first: what each phase set
out to do (plan + exit criteria, moved here from
[PLANNING.md](PLANNING.md)) and what actually landed (moved here from the
README's old Status section). The open phase — extension architecture,
with reference layers and OMR folded into it — stays in
[PLANNING.md](PLANNING.md); its running record — one bullet per
decision, one per slice as it closes — is each release's section
below, and changes since the last tag gather under *Unreleased*.

## Unreleased

- **Tenuto (2026-10-22).** The user: "a small thing we forgot, the tenuto
  keyboard shortcut". battuta read tenuto (`@artic="ten"`) and played it
  full length since the playback work, but nothing wrote one. Now `=`
  toggles it on the target — a line, and the same key on
  QWERTY and AZERTY (`-` is AZERTY's unshifted digit-6 key, the duration
  row in input mode, and numpad − deletes a measure) — in or out of input
  mode, like marcato and staccatissimo, beside whatever articulations the
  note already has. The on-screen keyboard shows it as *ten –* in its marks
  group (generated from the keymap; its caption added). The keymap
  snapshot gained the row in both layouts and nothing else; the marks
  guide, its key table and its figure have it. Tests: editor 156, the
  keyboard's 48, phase 5's e2e 224 (= adds a tenuto beside marcato and
  staccatissimo, Verovio draws SMuFL's tenuto, = again takes it off), the
  keyboard's e2e 34.
- **Phase 10, M4 — midi-stroke's Xcode and Android Studio fixes, applied
  (2026-10-22).** The user: "in my last commit in midi-stroke I fix some
  issues with android studio and xcode can you check if we have the same
  issues here". All of them were here (midi-stroke 5b43383, read, not
  touched). **Xcode** (`gen/apple/project.yml`, the project regenerated
  with `Externals/` emptied for the run, the Tauri-merged `Info.plist`
  kept): the *Build Rust Code* step puts `/opt/homebrew/bin` first on its
  PATH — Xcode opened from the Dock has macOS's default one, and `npm` is
  not on it; `Externals/` is `buildPhase: none` — linked, never copied into
  the app (Tauri's template made the Rust library a resource whenever
  XcodeGen ran after a build: yesterday's manifest was added by working
  around it by hand); the scheme is declared for its archive name,
  *battuta* in the Organizer, keeping the target's name the Tauri CLI
  builds by. Release builds need rustup's `llvm-tools` — swift-rs makes the
  plugin's Swift entry point visible again with it, or an Archive fails on
  *Undefined symbols: _init_plugin_battuta_mobile* — already installed on
  this Mac by the midi-stroke fix, now in the README's requirements.
  **Android** (`gen/android`): the Android Gradle Plugin 8.11.0 → 8.13.2
  (and in `buildSrc`), Gradle 8.14.3 → 8.14.5 by the wrapper's own task,
  the Gradle daemon pinned to JDK 21 (`updateDaemonJvm`, Adoptium, fetched
  through the foojay resolver in `settings.gradle`) — Android Studio's own
  Java 25 is too new for Gradle 8.14; the *universal* flavour the default,
  so Android Studio opens on all four ABIs, not 32-bit *arm*. The wrapper
  files and the daemon's JVM file came out byte-identical to
  midi-stroke's. One more, found in that commit: Android Studio's signed
  bundle lands in `app/universal/release/`, which git did not ignore there
  (a 43 MB `.aab` went into midi-stroke's commit); here `app/.gitignore`
  covers the flavour folders, `*.aab` and `*.apk`. **The store drafts**
  took that commit's corrections too: *What's New* is not asked for a first
  version, and Play's release notes go between language tags — both in
  `listing.md`'s new *Release notes*. Verified: the Gradle project
  configures from Android Studio's Java 25; Android debug and release
  APKs; an iOS release build links and runs on the iPad (no `libapp.a`
  inside, 13 MB), and the debug build put back after renders there. The
  Galaxy Tab was not connected, so the Android device suite did not run;
  Xcode started from the Dock is the user's to try.
- **Phase 10, M4 — one octave on a phone (2026-10-21).** The user, after
  the screenshots: "the virtual keyboard will only show 1 octave in phones
  as the keys are to thin". The piano's octaves are blocks of their own
  now, and the keyboard's CSS hides the upper one on a touch screen whose
  shorter side is under 600 px (the host's phone width) — upright and
  sideways alike, never on a tablet: a white key goes from 16 to 33 px on
  an iPhone upright and from 20 to 41 px sideways; tablets and the desktop
  keep 14 keys. A plugin reads no window, so the switch is a media query,
  as the portrait layout is; its first cut lost to the block's inline
  `display` (the layout moved into the stylesheet). The rail's top went
  from 6 to 7, so a phone still reaches C7–B7. Tests: the keyboard's 48
  and its e2e 34, the plugin rules 18; the store screenshots made again.
- **Phase 10, M4 — the store screenshots; the PDF reference's floor
  (2026-10-21).** The user: "yes please write the script", publishing from
  Xcode and Android Studio themselves once main is pushed and tagged; for
  the PDF reference before the system it needs, a message rather than a
  fix; the notes' touch hit-testing later, as a plugin; the phones' edit
  view to be decided from the screenshots; Android's missing 🌣 glyph
  stays. **`npm run store:screenshots`** (`apps/editor/scripts/
  store-screenshots.mjs`, after the docs' shots): the editor's dev server
  driven by Playwright, each set seen as its device sees the app — the
  shell's marker, a touch screen (the on-screen keyboard up by itself),
  its width — at the stores' sizes: iPhone 6.9″ upright 1320 × 2868, iPad
  13″ sideways 2752 × 2064, an Android phone upright 1080 × 1920, an
  Android tablet sideways 2560 × 1440; five scenes each (writing at the
  caret in input mode, page view playing, a block selected, the Chopin
  PDF's scans over the empty measures to transcribe, the folder view on
  battuta's folder — its list staged through the shell's own commands, as
  in the docs), then Google Play's feature graphic (1024 × 500, the logo,
  the line the site leads with and a page-view system) and icon
  (512 × 512); no image has an alpha channel. Into
  `apps/editor/store/screenshots/`, git-ignored. **The PDF reference's
  floor was not 17.4:** read through, pdf.js 6.4 calls with no fallback
  `Promise.try` (every worker message), `URL.parse`,
  `Uint8Array.fromBase64` and `Math.sumPrecise` as well as
  `Promise.withResolvers` — Safari has them all from 26.2 (MDN, caniuse).
  So `pdfMissing()` checks the five before pdf.js loads; where one is
  missing the panel says, once, "Reading a PDF needs iOS / iPadOS 26.2 or
  later on an iPhone or iPad (a current browser elsewhere); the PDF's
  pages as images work on this one", and a PDF loaded anyway stops with
  that sentence instead of failing half-way. Checked: the e2e's Chromium
  (151) and the Galaxy Tab's WebView (155) have all five; a page with
  `Promise.try` deleted shows the message and refuses the PDF. Tests:
  editor 156, plugins 320 (the check's own, and the refusal in the
  lifecycle suite), the PDF reference e2e 41.
- **Phase 10, M4 begins — the iPhone, the store listings and the stores'
  questions (2026-10-20).** "yes let's also build Iphone and don't forget
  the store listing (metadata description) and the store questions" —
  which settles M4's open question: **universal**. **The iPhone:** the
  Xcode project already held it (XcodeGen's default device family, `1,2`
  in the built app); Tauri builds for the simulator only with the runtime
  of Xcode's own SDK, so iOS 27.1's was installed, and the app ran on an
  iPhone 18 Pro — in portrait, and in landscape through a landscape-only
  copy of the app (Xcode 27 has no Simulator window to rotate). What a
  phone needed: **the side insets** — held sideways, a phone has its
  camera housing on one side; the page, header, context bar, bottom and
  side areas and the zoom column keep clear of `safe-area-inset-left` /
  `-right` (`SAFE_LEFT`, `SAFE_RIGHT`, 0 everywhere else); **the side
  panel over the score** under 600 px (`useNarrowScreen`, host/slots) —
  pushed, a portrait phone kept about 100 px of music beside the folder
  view and the row overflowed the screen; tablets, and a phone held
  sideways, keep the push; **the page view's narrow page**, M2's third
  item to the user's spec — under 768 px Verovio lays out a page the
  view's width at the desktop's staff size (`pageWidth` from the measured
  width, side margins 50, `adjustPageHeight`): two measures a system on an
  iPhone instead of an A4 page shrunk to a third; the SVG export keeps A4.
  **The stores**, after midi-stroke's pair: `apps/editor/store/listing.md`
  (names, the description with Verovio's credit, the URLs, the privacy
  answers, the screenshot sizes) and `questions.md` (every form of App
  Store Connect and the Play Console answered from what the app does —
  no account, no data, no network; Bluetooth only for a MIDI instrument —
  with the keywords and tags). The privacy page covers the phone and
  tablet apps, and says what the files guide now says too: deleting the
  app deletes battuta's own folder. `ITSAppUsesNonExemptEncryption =
  false` in `Info.ios.plist`; Apple's privacy manifest
  (`PrivacyInfo.xcprivacy`): no tracking, nothing collected, and reasons
  for the two required-reason APIs the binary imports (`nm -u`: the user
  defaults, CA92.1; the stat family, C617.1 and 3B52.1) — added to the
  Xcode project by XcodeGen run with `Externals/` emptied, or it lists the
  Rust library as a resource. **The licence notice:** battuta menu →
  *about battuta — credits and licences*: Verovio's credit with the LGPL
  v3 and the GPL v3 it builds on (the npm package ships no licence file;
  both texts from gnu.org, `apps/editor/licences/`), the piano samples
  (the Salamander Grand Piano V3, Alexander Holm, CC BY 3.0 — credited
  nowhere until now), Noto Music, and all 368 components the app ships —
  12 npm packages read from a real build's module graph, workers
  included, and 354 crates the shell links on its six targets (normal
  dependencies only) — each with its own licence texts. `npm run licences
  -w @battuta/editor` writes `src/licences.json`, loaded only when the box
  opens (771 kB, 106 kB gzipped); a test fails when a shipped dependency
  is missing from it. **Android release signing** from
  `gen/android/keystore.properties` (git-ignored), as in midi-stroke; a
  release build — R8-minified — signed with the debug key ran on the
  Galaxy Tab: it started with its data kept, saw both MIDI devices, and
  its share sheet reached the native plugin; the debug build went back
  after. Verified: editor 156, core 246, api 20, plugins 318; the 13
  browser suites (580 checks); the desktop smoke 15/15; Android 15/15;
  the iPad build carries the key and the manifest and renders. Initial
  chunk 386.9 kB of 390.6. Seen and left: on a phone every tile row keeps
  the tiles' top margin (100 units, which aligns staves under fermatas
  and ottavas), so a one-staff score shows about two rows a screen; and
  Android has no glyph for the menu's 🌣.
- **Phase 10, M3 verified (2026-10-20).** The user tested Bluetooth MIDI
  pairing on both tablets ("both working") — the ROLI Piano 49 shows in
  Android's MIDI service as a Bluetooth device battuta holds open — and
  stopped midi-stroke, which settled Android's output: with it gone,
  battuta is the MIDI service's only client, and a C5 battuta played from
  the tablet reached the Mac (note-on, note-off and the closing CC 123
  all-notes-off, heard on `SAMSUNG_Android`). The cause was as suspected:
  Android lets one app at a time hold a device's sending port, and Web
  MIDI's refusal is silent. The troubleshooting page says so (and how to
  pair a Bluetooth instrument from battuta).
- **Phase 10, M3 — battuta's MIDI source on the iPad; Bluetooth MIDI on
  both tablets (2026-10-20).** The user: yes to the iPad's virtual
  source, and for Bluetooth pairing "we already add a working version of
  that to the midi-stroke project". **Virtual source:** iPadOS creates a
  virtual MIDI endpoint only for an app with the audio background mode, so
  `Info.ios.plist` declares `UIBackgroundModes: audio` (it also keeps
  playback going when the iPad locks); a temporary probe then showed the
  shell's outputs as `["battuta (virtual source)"]`, as on the desktop.
  **Bluetooth MIDI**, after midi-stroke's working version (read, not
  touched): battuta needs only its PAIRING half — midi-stroke carries a
  whole native MIDI layer because it does not use Web MIDI on mobile,
  while here a paired instrument is just another MIDI device of the system,
  heard by the CoreMIDI bridge on the iPad and by Web MIDI on Android. In
  the battuta-mobile plugin: on iPadOS Apple's `CABTMIDICentralViewController`
  as a form sheet with a Done button (`CoreAudioKit` linked from
  `Package.swift`, `NSBluetoothAlwaysUsageDescription` in
  `Info.ios.plist`); on Android a BLE scan filtered on the MIDI service
  (`03B80E5A-…`), the answers listed live in a native dialog, the tapped
  one opened with `MidiManager.openBluetoothDevice` and held for the app's
  life — "nearby devices" asked first on Android 12+, the location below
  (the plugin's manifest declares both, `neverForLocation`). The shell's
  `midi_bluetooth` command on both tablets; **Bluetooth MIDI…** in the
  status bar's MIDI list, on tablets. Verified: on the Galaxy Tab the
  command raises Android's "nearby devices" prompt, and dismissing it
  rejects cleanly ("Bluetooth permission denied") with the permission
  left ungranted for the user; the iPad builds with the view and the
  usage text and starts clean. Pairing a real instrument is the user's
  to try. Desktop untouched (the additions are tablet-only); initial
  chunk 385.3 kB of 390.6.
- **Phase 10, M3 begins — MIDI on the tablets (2026-10-20).** "you can
  start m3". **iPad:** its WebKit has no Web MIDI, so the shell's MIDI
  bridge — the desktop's `midir` input thread (hot-plug poll, note
  events) and its output commands — now builds for iOS too: `midir` is a
  dependency everywhere but Android, the MIDI code is
  `#[cfg(not(target_os = "android"))]`, the run-loop pump that keeps
  CoreMIDI's hot-plug alive runs on iOS as on macOS
  (`core-foundation` for both), the iOS shell registers
  `midi_open_outputs`/`midi_close_outputs`/`midi_send` (the handler list
  is split per tablet), and the page takes the shell's MIDI wherever the
  WebView has none (`shellPlatform().platform !== "android"`). On the
  iPad, a temporary probe showed the bridge answering (`midi_open_outputs`
  → `[]`, no error: CoreMIDI up, no device plugged in) — and no
  "battuta" virtual source: iPadOS creates one only for apps with the
  audio background mode, a store decision left open. **Android:** Web
  MIDI, as M0 found; **input proven end to end** with the Mac as the
  instrument — the tablet in USB MIDI mode shows the Mac as
  `SAMSUNG_Android`; a throwaway `midir` tool there played G4 into
  battuta on the tablet, which entered a G4 (undone after). **Output not
  yet**: the tablet opens its USB port ("Port du périphérique USB") and
  sends without error, but nothing reaches the Mac (whose listener was
  checked on a virtual loop) — `dumpsys midi` shows another app,
  `com.vibetuned.midi_stroke`, frozen in the background with connections
  to the same devices, and Android lets one client hold a device's input
  port; left to the user. Desktop: shell smoke 15 (the native MIDI
  bridge still reaches the status bar), phase 4 75 (the MIDI e2e).
- **Phase 10, M2 — the context bar folds when it would not fit
  (2026-10-20).** User-reported: in portrait the status bar "gets too fat
  and hides part of the keyboard". Its controls did not fit one line at a
  tablet's upright width, so the flex items shrank and their text wrapped
  — the bar grew, while the bottom panel was still placed as if it were
  24 px. Now: the bar never wraps (`white-space: nowrap`), and when its
  contents overflow one line it **folds its context controls** — the
  plugin items, the lanes, staves, voices, clef, key, meter — **behind
  ⋯**, a popover above the bar; the input box, the caret readout, zoom
  and MIDI stay. **Measured, not a breakpoint**: the bar folds when its
  `scrollWidth` exceeds its width and unfolds when the width it needed
  returns, so plugin items count. The controls are one element
  (`contextControls`), placed inline or in the popover. And the bar
  **publishes its height** (`--battuta-bar-h`, as the header and the
  bottom panel already did) — the bottom and side panels, the notices and
  the page's foot stand on the bar as it is, not on an assumed 24 px.
  F6 opens a folded bar's ⋯ and focuses its first control. Tests:
  `verify-onscreen-keyboard.mjs` 34 (+5: at 820 px the bar folds and
  stays one line, 28 px; the keyboard's bottom edge meets the bar's top
  (1152/1152); ⋯ opens the six controls above the bar and on screen; F6
  on a folded bar; at 1500 px it unfolds, its selects inline); app 18,
  phase 3 21, phase 5 221, lyrics 25, PDF reference 41, folder view 40
  unchanged; initial chunk 385.0 kB of 390.6.
- **Phase 10, M2 begins — the on-screen keyboard on a tablet; the budget
  raised (2026-10-20).** The user: "ok for adding the bytes, and you can
  start the m2", with two things for the keyboard. **⌫:** the panel had
  no backspace though a hardware keyboard's erased backward all along
  (the App's `edit.backspace`: the previous note becomes a rest, the
  caret steps onto it); it is now a key of its own (`BACKSPACE` in
  `keys.ts`, an EXTRA_ID like `del` and `esc`), **pinned under the ×** in
  a column outside the scrolling groups, where the user asked for it.
  **Two lines in portrait:** octaves, piano, latches, × and ⌫ on the
  first, the scrolling groups on the second, the piano taking the line's
  width (660 px at an upright iPad Air's 820, 460 beside the groups in
  landscape). By CSS alone — a media query in the panel's own `<style>`,
  scoped to its data attributes, rearranging the same elements — because
  a plugin never reads the window (`matchMedia` was the first draft; the
  boundary test's "no DOM" rule says why not), and because the same
  elements keep the octave rail and the latches when the tablet turns.
  **Budget:** raised to 400,000 bytes (measured 392,517) by the user's
  decision — the tablets' startup-time branches (safe-area insets, the
  shell marker, the tablet confirm, **save a copy…** and **share…**, the
  first save) while the tablet code proper stays lazy; recorded in
  `budget.json`. **Notices** name an Android tree file by its name, not
  its `content://` address (`shownPath`). Tests: keyboard 48 (+1: ⌫'s
  action, an EXTRA_ID, in no group); `verify-onscreen-keyboard.mjs` 29
  (+5: ⌫ under the × in its column; a tap erases backward onto a rest;
  one line in landscape; two in portrait with the piano wider; turning
  keeps the octave rail — no remount); plugin boundaries 18; both
  tablets rebuilt, the Android device check 15.
- **Phase 10, M1 continued — any folder and a share sheet on the tablets;
  the black iPad; the Android icon (2026-10-20).** User-reported: the iPad
  showed the app black, the Android icon looked "horrible", and once
  battuta's folder was open there was no way to choose another; the user
  approved a native addition for a share sheet and new plugin api, and
  chose **any folder on both tablets** over battuta's folder alone.
  **Black iPad:** the iPad was in dark mode and every layer of the page
  was transparent (`html`, `body`, `#root` all `rgba(0,0,0,0)` in a
  temporary probe) — WKWebView showed its own black behind black
  notation; the page now says `color-scheme: light` and paints `html` and
  `body` white (`index.html`). **Android icon:** the adaptive icon's
  foreground was the whole logo edge to edge, so launchers cut it to
  their circle; the foreground is now `src-tauri/icons/mobile/
  android-foreground.svg`, the glyph alone at half size inside the 66/108
  safe zone (the `android_fg_scale` manifest option did nothing),
  generated through `icons/mobile/icons.json` (iOS unchanged,
  byte-identical). **battuta's native plugin** —
  `src-tauri/plugins/battuta-mobile`, a local Tauri plugin crate with a
  Swift package and a Kotlin module, called only by the shell's Rust (no
  commands for the page): the **share sheet** (UIActivityViewController,
  anchored as a popover on iPad; Android's chooser through its own
  FileProvider subclass, so it never collides with the app's); the
  **system folder picker** — iPadOS keeps a security-scoped bookmark per
  path and holds the scope for the app's life, so the shell reads and
  writes there by path as anywhere; Android persists the tree permission,
  and since a document tree has no path the shell gives it one — the
  tree's URI, then names, `/`-separated (`content://…/tree/<id>/scores/
  aria.mei`) — so the folder view's and the App's path logic (parent,
  base name, rename moves, the tab's name) works unchanged, and the
  plugin lists, reads, writes, creates and renames by walking the tree
  name by name (any provider, not only the device's storage, whose ids
  happen to look like paths). The shell's workspace commands route tree
  paths there (scoped to the picked trees; same refusal wording), became
  async (a native call never waits on the UI thread), and the tablets
  gain `workspace_home` and `share_file`. **Plugin api:**
  `WorkspaceService.home()` — the platform's own folder (a tablet's
  battuta folder) or null — kept at 1.2.0 by the user's decision (never
  bump a never-tagged version; the regenerated snapshot shows the
  change). **Folder view:** opens the saved folder, else battuta's; **…**
  is the system folder picker on a tablet, **⌂** goes back to battuta's
  folder, a picked folder that has gone falls back to it with a notice,
  battuta's folder is shown as "battuta" and an Android tree by its
  folder's name. **App:** a first save asks the shell for battuta's
  folder (the picker is the user's gesture now); **save a copy…** and
  **share…** join the battuta menu on tablets. **Budget:** the initial
  chunk is 383.2 kB against 382.8 kB (392,000 bytes) — the two menu items
  render at startup and cannot be lazy; raising the ceiling is the
  user's call, pending. Tests: folder view 54 (+4: battuta's folder with
  nothing to choose; … then ⌂, each remembered; a gone folder falls back
  home with a notice; Android tree names); `verify-android.mjs` 15
  (battuta's folder asked through `home()` — `pickFolder` is the
  system picker now); on the Galaxy Tab, driven once through Android's
  own screens with UI Automator: a folder picked in Downloads (tree path
  returned, reopened as after a relaunch), listed, a folder and a score
  created in it, a duplicate refused in the shell's words, a score
  renamed, opened as a tab under its tree path, saved with ctrl+s (54 →
  61 kB, its 60 `accid.ges` written), its mtime read; the share sheet
  offering Quick Share, Gmail, Drive, Bluetooth…; everything the run put
  on the tablet removed after. iPad: builds with the Swift plugin and
  starts clean (the picker, the bookmark reopen and the share sheet await
  the user's hands). Desktop: shell smoke 15, folder-view 40 and app 18
  e2e, shell tests.
- **Phase 10, M1 — files on the tablets; the battuta icon (2026-10-20).**
  The user: "the app logo… and you can start M1" — the tablets showed
  Tauri's placeholder icon. **Icon:** the iOS and Android icon sets are
  generated from the logo (`docs/src/assets/logo.svg` — vector, so the
  1024-px App Store size is sharp; black on white, as iOS icons cannot be
  transparent) into a scratch folder and only the mobile sets copied into
  `gen/` — `tauri icon` would otherwise regenerate the desktop icons too
  (README says how). **Files**, as the user set out — drafts in the app's
  storage, the OS picker and save sheet for everything else — on
  `BaseDirectory.Document`, the one a user can see: the iPad's Documents
  (the Files app's "On My iPad › battuta", by `UIFileSharingEnabled` and
  `LSSupportsOpeningDocumentsInPlace` in a new `Info.ios.plist` the CLI
  merges), Android's `Android/data/…/files/Documents`. It is **battuta's
  folder**: the tablets' `workspace_pick_folder` answers it without a
  dialog, so the folder view — listing, ✎ rename, + score, + folder — is
  the tablet's file browser unchanged (no live watch there; no api
  change). A new or imported score's **first save** goes into it under
  the tab's name (`name.mei`, else `name 2.mei` — never over a score);
  saves after that are by path, as on desktop. **Open file…** is the OS
  document picker — unfiltered: Android's maps extensions to MIME types
  and silently dropped `.mei`, showing only `.xml` files; the extension is
  checked after the pick instead. **Save as** sends a copy out through the
  OS save sheet (the tab keeps its file), as do all **exports**; the
  confirm dialog goes through the OS too (WKWebView answers
  `window.confirm` with false without asking). `tauri-plugin-dialog` and
  `tauri-plugin-fs` (2.x, MIT/Apache) are tablet-only dependencies with a
  tablet-only capability (`capabilities/mobile.json`: pick, save sheet,
  confirm, and reading/writing what those hand back); their JavaScript and
  the App's tablet code (`src/tabletFiles.ts`) load on first use. M0's
  "no shell bridge on a tablet" was too coarse — it blocked reading and
  saving by path — so the bridge is back on every shell and only what
  opens a dialog branches for tablets. Not a new host module: the
  host-boundaries test makes one an architecture decision for the user,
  and the tablet confirm belongs in `shell.ts`, whose job is the shell's
  dialogs. **The startup bundle is at its ceiling**: 382.8 kB of 382.8 kB
  (moving the tablet code behind a dynamic import brought it back from
  383.9); the next startup-time feature needs a budget decision. Tests:
  `verify-android.mjs` 15 (+5: the folder is battuta's Documents with no
  dialog; a new score's first save lands there; renamed, the tab follows;
  the file on the tablet is the score; its tab closes clean — and the
  run's file is removed over adb, Android having no throwaway storage);
  the picker and the save sheet driven through Android's own UI with UI
  Automator once — a chorale pushed to Downloads imported as a tab (14
  measures, unsaved), saved back out as a copy (61 kB, its 60
  `accid.ges` in it), the test files removed after; on the iPad the
  build carries both Files keys and starts clean. Desktop: shell smoke 15,
  the app, folder-view and formats e2e unchanged.
- **Phase 10 opens: battuta on tablets — M0, it runs on both (2026-10-20).**
  The user, after the Verovio team's licensing page: launch iPadOS and
  Android, tablets first, published by Vibetuned (a nonprofit for music
  and arts education) as `com.vibetuned.battuta`, everything open source;
  Verovio stays an unmodified WASM module in the WebView and is credited
  in the stores and the app; outside contributions come under a CLA —
  the Apache ICLA V2.2 with Vibetuned in the Foundation's place, its
  eight sections otherwise verbatim (`CLA.md`), signed by a comment on
  the first pull request (`CONTRIBUTING.md`; the README's licence section
  points there).
  The plan is in PLANNING.md (M0–M4). **M0:** the Rust shell is now a
  library — `src/lib.rs` is the former `main.rs` with `run()` as the entry
  (`#[tauri::mobile_entry_point]` on mobile), `main.rs` a three-line
  desktop launcher, `[lib] battuta_lib` built as staticlib/cdylib/rlib.
  Native dialogs (`rfd`), MIDI (`midir`) and folder watching (`notify`)
  are desktop-only dependencies and `#[cfg(desktop)]` code; mobile
  registers only the portable commands. The page learns which shell it
  is in before its first script (`window.__BATTUTA_SHELL__`, an
  initialization script), and on mobile the desktop bridge reads as
  absent, so the app takes the browser's paths there (file input, no
  folder view, Web MIDI) until M1–M3. One identifier on every platform,
  `com.vibetuned.battuta` — the desktop's `dev.battuta.editor` aligned
  at the user's request, knowing its settings and recovered session
  start fresh under the new one (scores on disk untouched; the shell
  smoke fingerprints both names, the Homebrew cask zaps both);
  `tauri.ios.conf.json` carries the signing team (47D2CT68R2) and an
  iPadOS 15.0 floor; `npm run android -- …` /
  `npm run ios -- …` run the CLI through `scripts/mobile.sh` (SDK, NDK and
  a JDK 21 found for those commands only). Found on the way: **a crash on
  Android** — the page-load handler logged `webview.url()`, which on
  Android runs on the UI thread and waits on that same thread; wry gave up
  after 10 s and then aborted on the late answer; it logs the payload's
  URL now. **Xcode 27** builds no iOS target below 15.0 (the generated
  14.0 failed), and its SwiftPM appends the host SDK after swift-rs's
  overrides — `swift-rs` 1.0.9 (lockfile) fixes it. **The iPad hid the
  context bar** (user-reported): the shell gave every platform its desktop
  window size, and on iPadOS that sized the WebView 1280×860 on an
  1180×820 screen — the bar ran off its bottom edge (found with a
  temporary layout probe in `shell.log`: the viewport was exactly the
  window size); title and size are desktop-only now. That alone left a
  white strip under the bar (user-reported: WebKit kept the page out of
  the home indicator's area), so the page now covers the whole screen
  (`viewport-fit=cover`) and pads itself by the safe-area insets
  (`SAFE_TOP`/`SAFE_BOTTOM` in the host, `env(safe-area-inset-*)`, 0 on
  desktop and in browsers): the header's white runs under the status bar,
  the bar's dark to the screen's edge with its controls above the home
  indicator, and what stands on the bar — the bottom and side panels, the
  toasts, the page's foot, the caret-follow margins (now measured from the
  header and the bar, not fixed 70/45 px) — moves up with it. Measured:
  the iPad 1180×820 with insets 32/25, the bar 771–820 padded 27; the
  Galaxy Tab, edge to edge, insets 30/15 — its gesture handle no longer
  crosses the bar's controls. **Android Studio's
  Java 25** is too new for the generated Gradle 8.14. Android's WebView
  offers Web MIDI: the tablet's USB port and a networked device came up
  with no plugin. Verified on the reference tablets: the Galaxy Tab S8
  Ultra by `spikes/verify-android.mjs` (new, 10 checks over the WebView's
  DevTools socket — the shell's marker, every tile rendered by Verovio,
  folders off, MIDI through Web MIDI, a tap + `i` + `e` entering an E4
  that the timemap sounds as MIDI 64, undone, the app alive, no Rust
  panic); the iPad Air 11" (M4) by the shell's probe in `shell.log` (debug
  iOS builds append probe lines there, fetched with `xcrun devicectl`):
  `tiles=4 rendered=8 shell={"platform":"ios","mobile":true}` (new fields
  after `tiles=`, which the desktop shell smoke matches). The desktop shell
  smoke still passes (15).
- **Sounding accidentals in the file: `@accid.ges`, and `<accid>`
  children read and written (2026-10-19).** The user, on the entry below:
  patching the accidentals in for playback only "hides the issue" — the
  MEI has to say what it sounds, with `@accid`, `@accid.ges` and even
  `<accid/>`, or only battuta reads it right and every other application
  reads a natural. Verovio sounds only what a note itself carries (probed
  with 6.2.0: a B under one flat sounds B♮, a C after a written C♯ sounds
  C♮, under `keysig` and `<keySig>` alike), so every note typed or
  entered without an accidental under a key signature has been PLAYING
  wrong since playback began, and saved that way; imported files carried
  `accid.ges` and were right (the playback guide and the worker's comment
  claimed Verovio resolves keys; both corrected). Now the document carries
  them: core's `accidentals.ts` derives each note's `@accid.ges` — key
  signature, the measure's earlier written accidentals (same staff, letter
  and octave, layers merged in time order), ties carried over the barline
  by `@tie` chains and `<tie>` control elements — for every note without a
  written accidental, and writes it where it sounds altered, none where it
  sounds natural: the convention of Verovio's own imports, checked against
  the Brandenburg fixture's 971 encoded ones (all re-derived, none added).
  It runs on OPEN, silently as `ensureIds` does (a file saved without them
  gets them with its next save; a file battuta saved reopens unchanged, so
  serialisation stays a fixpoint), and after EVERY edit, inside the edit's
  undo step: the session wraps each command in `WithGesturalAccidentals`
  (inner command, then the sync; reverted sync first). Notes with a
  written accidental are left as they are. **`<accid>` children**: a note
  that keeps its accidentals in the element form keeps them there — the
  sync, the accidental toggles (single notes and the chord picker), step
  transposition and `SetPitchesCommand` write into the child, never a
  second `@accid` beside it (which the toggles did before: an `s` on a
  note with `<accid accid="n"/>` left both), and every reader (merge, tie
  pairing, the chord picker, pitch collection) reads it; snapshots cover
  the child, so reverts stay exact. The playback serialization no longer
  patches anything — the document is what Verovio sounds — and the
  formats plugin's written-score exports (MIDI, Humdrum, PAE), which
  convert the document, sound right with it. New core exports
  `writtenAccid`, `gesturalAccid`, `syncGesturalAccidentals`,
  `WithGesturalAccidentals` (`gesturalAccidentals` and
  `withGesturalAccidentals` from the entry below are gone); no api change.
  Tests: core 246 (`accidentals.test.ts` 17: the sync — key, measure
  accidentals across layers, `@tie` and `<tie>` carries, key changes,
  chords, tuplets, a wrong one taken away, the `<accid>` child written and
  a second pass changing nothing; the wrapper — a written natural lifting
  the flat from the notes after it and reverting byte-identically, an
  entry getting its flat, a step transposition into the key's flat inside
  the child, a toggle inside the child; the Brandenburg's 971); the phase
  4 e2e 75 (+1, and its document check reversed: the saved file has
  `accid.ges="f"` on the plain B and none on the B♮, and the fixture,
  which has none of its own, opens with its key's sharps written out).
- **MIDI spelled by the key, playback sounding the key; the bottom panel
  beside the folder view, the zoom popover over it (2026-10-19).** Three
  user-reported bugs. **MIDI under a key signature** (the big one): every
  black key entered as a sharp with `accid="s"` written and the key never
  read — under one flat, B♭ came in as A♯ and B as a plain B (which the
  page reads as B♭). Now a key is spelled where it lands, by a new core
  `accidentals.ts`: a spelling that needs no accidental there wins (B♭
  under one flat is a plain B; after a written B♮ in the measure, B is
  plain and B♭ gets its flat back); otherwise a white key is its own
  letter with ♮ written (under four sharps C is C♮, never B♯), and a black
  key the spelling nearest the key on the line of fifths (in C: C♯ E♭ F♯
  G♯ B♭; under one flat, C♯ — D minor's leading tone). Chord notes from
  held keys are spelled the same way. A B♭ written as the key spells it
  only sounds B♭ to a reader that knows the key — see the next entry, which
  is what makes it sound so outside battuta too. **The folder view over
  the bottom panel**: the bottom area was fixed from the window's left
  edge, under the side area, its first 280 px hidden; it now starts where
  a side panel ends, as the score does. **The zoom popover behind the
  bottom panel**: the status bar sat at z-index 30 under the panels' 32,
  its upward popovers (zoom, MIDI devices) with it; it is at 34 now, under
  the header's 35. Core only for the spelling (`keyFifths`,
  `alterationsBefore`, `spellMidi`); no api change. Tests: the PDF
  reference e2e 41 (+4: the bottom panel from the folder view's edge to
  the window's, full width back when it closes, the zoom popover over the
  panel and hit-testable, + zooming); the phase 4 e2e's F♯4 check now
  expects the plain F the fixture's four sharps give.
- **Ties between chords (2026-10-12).** User-reported: `t` could
  not tie chords — both tie commands refused anything but two single notes
  ("ties connect single notes"), and the caret's rule only tied back to a
  predecessor that was a note. A chord now ties **pitch by pitch**: each
  of its notes to the note of the same written pitch (pname + oct, as
  playback reads a tie; the same accidental preferred when a chord holds
  both) in the neighbouring chord or note, the unpaired notes left alone;
  refused only when the two share no pitch. One toggle for the pair (all
  linked → untie, else tie), still chain-aware per note (a chord between
  two tied chords gets `m` on the pitches held through), and a selected
  run of chords is a chain the same way — one undo step either way, the
  revert restoring each note's attributes exactly. `ToggleTieCommand` and
  `ChainTieCommand` share one link toggle now; core only, no api change.
  Tests: core 229 (+4 in `entry.test.ts`: chord → chord and back
  byte-identically, chord → note across the barline chaining with the tie
  before it, no shared pitch refused, a chord chain over three measures;
  +1 in `playback.test.ts`: tied chord notes link pitch by pitch); the
  phase 4 e2e 70 (+3: two e-f-g chords entered, `t` ties all
  three pitches back, three curves drawn, the round undone).
- **Zoom, staves, and pages as images (2026-10-11).** Three more for the
  PDF reference's drawing, at the user's request. **Zoom**: − and + in the
  drawing bar, from the panel's width to four times, the spot in the
  middle kept in the middle and the page scrolling both ways. **Staves**:
  a third tool, ≡ staves — a click between two staves splits the system
  there, a click on a split takes it away, staves numbered down the
  system's left; staves export as the OMR files' own classes (a
  `system-staff` per staff, a `staff` per measure and staff), are read
  from files that carry `system-staff` boxes, and let the strip highlight
  the caret's STAFF inside its measure. **Images**: PNG, JPEG, WebP… in
  place of a PDF, one image a page, ordered by a `_pageN` in their names
  else by name, at their own resolution — the OMR files' own coordinate
  space; their drawing is kept by their names and sizes, their export
  named after them, and a PDF chosen with images is the PDF (said). No
  api growth. Old drawings without staff splits still read. Tests: plugin
  43 (+10: `images.test.ts`, staves in `drawing` and `annotations`, the
  lifecycle); the e2e 37 (+7: zoomed to 200%, a split clicked exactly
  between the example's two staves, the caret's staff highlighted, the
  example's pages as PNGs with its annotation files).
- **Systems and measures drawn by hand on any PDF; the example becomes a
  fixture (2026-10-11).** The user's next request, before the source MEIs:
  create the systems and the measures in any random PDF. Load a PDF
  without annotation files and **draw systems and measures**: the page
  opens in the panel with two tools — a box dragged across a system, then
  a click at each barline (two gestures a line rather than a box a
  measure; the measures come out as the stretches between barlines at the
  system's full height, which is what an OMR measure box is) — a × per
  system, ◀ ▶ through the pages, and the scans following the pen. A
  drawing is kept per PDF (`drawing:<name>:<bytes>` in the plugin's
  storage — it belongs to the PDF, not to the score) and comes back when
  the same file is loaded; **export PDF annotations**, a declared export
  that wakes the plugin without opening its panel, writes it — or
  annotations read from files — as the OMR page files. No api growth.
  Tests: plugin 33 (+11: `drawing.test.ts`, the lifecycle), the e2e 30
  (+9: a system drawn with a real mouse on the example's own boxes, three
  barlines, one taken away, the system removed by its ×, the export, the
  drawing back on reload). The Chopin example (PDF and its two page files,
  650 kB) moved to `fixtures/pdf-reference/`, un-ignored with a `!` line
  in `.gitignore`; the e2e and the shell probe read it there.

Everything below is to ship as **1.2.0**: every package — application,
shell, core, docs, `@battuta/api` and the nine plugins — was aligned at
1.2.0 on 2026-10-11 (the user: "don't hesitate to make a new version"),
each plugin's `engines` range staying at the api it needs.

- **The PDF reference — the start of the facsimile (2026-10-11).**
  `packages/plugins/pdf-reference`: load a score's PDF with the OMR
  pipeline's annotation files — one JSON per page, a box per element keyed
  by its MEI id, in the pixels of the page at 254 dpi (the user's three
  examples in `examples/`: a Handel aria, a violin nocturne, a Chopin
  polonaise, Verovio engravings without their source MEI) — and each
  measure's SCAN stands above its tile in edit view, scan on top,
  rendering below; a bottom panel shows the caret's system, every measure
  outlined and the caret's highlighted, following it, with ◀ ▶ through
  the systems. Measures are matched BY ID when the score carries the
  annotated ids (an OMR output) and IN READING ORDER otherwise — page,
  system top to bottom, left to right — the panel saying which and both
  counts when they differ. Every page is rasterized once by pdf.js into a
  PNG at 254 dpi (2100 × 2970 for A4) that the scans and the strip crop.
  What it needed, all decided the same day: **a band on the overlays
  point** — room ABOVE every tile, the plugin asking per tile at the tile's
  width and the host reserving each row's tallest (and an empty band over
  the row's header cell), rehearsed in `verify-overlays.mjs` §8 from a
  plugin holding only `ctx`; **`ctx.query.measureIds()`**; `@battuta/api`
  1.1.0 → **1.2.0** (both additive; `OverlaySpec.render` became optional so
  a spec may be a band only). **A rule change, under the user's go-ahead:**
  `pdfjs-dist` and its worker module joined the plugin allowlist — no host
  service rasterizes a PDF, and like Tone and the Humdrum Verovio it is
  reached only from the plugin's lazy chunk (pdf.js 472 kB, its worker
  1.2 MB, fetched on the first PDF, never at startup). The worker is the
  plugin's own file, and both pdf.js entries are in Vite's
  `optimizeDeps.include` — found by the e2e: discovered on first use, they
  made the dev server reload the page and lose the panel, as `tauri dev`
  would have. **The budget raised deliberately** to 392,000 bytes for the
  band and the query in the host (measured 385,744). Dead ends, in the
  plugin's BUILDING §7: an SVG view box does not clip (the first
  screenshot showed the title over the first measures); `Math.ceil` made
  the raster 2101 px; the measure ids read on the document's own event
  were empty on a tab switch. Tests: plugin 22 (annotations, matching,
  geometry, the lifecycle with the renderer mocked), editor 152 (+3),
  `verify-overlays.mjs` 21 (+7, the band), `verify-pdf-reference.mjs` 21
  with the REAL pdf.js (a score carrying the Chopin example's ids, 38
  matched by id, each tile's scan its own measure, the strip following a
  click, the dev fixture matched in order), `verify-tauri.sh` probe8 (the
  PDF rendered in the shell's WebKit, scans above the tiles, 15 checks).
  The guide gained *PDF reference*; DESIGN's facsimile section names the
  first step. Not done, and said so: no zones written to the MEI, no
  click from a scan to the caret, and the shots for the guide wait on the
  examples becoming a committed fixture — `examples/` is untracked, and
  the e2e and the shell probe read it (the probe skips without it).
- **The target folder is marked, and `npm run tauri dev` works from the
  root (2026-10-11).** Two requests together. The folder "+ score" and
  "+ folder" create in now shows: a 3 px blue bar at the left of its row
  and a faint tint (`#eef4fb`), never the active score's `#cfe2f5`; when
  the target is the top folder, the bar sits beside the folder's name in
  the header. `verify-folder-view.mjs` pins it (+4, 40 checks), and the
  guide's folder view screenshot was regenerated — the other 17 shots came
  out byte-identical. And a root script, `"tauri": "cd apps/editor &&
  tauri"`, so `npm run tauri dev` (and `npm run tauri build`) run the
  Tauri CLI where packaging always ran it; `tauri.conf.json` gained
  `beforeDevCommand`, which starts Vite with `--port 5173 --strictPort`:
  Vite does not pin its port, and on a busy 5173 it would have served on
  5174 while the shell loaded 5173. Verified by launching it from the root
  on an in-memory data store: DEV SERVER mode, the page loaded from
  localhost:5173, ten tiles rendered.
- **The folder view makes new scores and folders (2026-10-11).** The
  user's second request the same day. **+ score** and **+ folder** in the
  panel's header create in the target folder — the last folder clicked,
  or the folder of the last score opened, the root until then; the
  buttons' titles name it — through a field that appears first inside
  that folder. A new score is the editor's blank (a treble staff, 4/4,
  four empty measures) titled after its name, saved as `.mei` and opened
  at once; a new folder appears open and empty and becomes the target.
  Create-only by construction: the shell's `workspace_create_folder` and
  `workspace_create_file` refuse an existing name and open the file
  `create_new`, so nothing is overwritten even in a race; the name rules
  are rename's, now one `valid_name` shared by both. The api grew
  `createFolder` and `createFile` INTO the untagged 1.1.0 — no second
  bump for a number nobody has consumed; the surface report was
  regenerated from the committed 1.0.0 baseline. Tests: Rust 4 (+2),
  editor 149 (+1), folder view 50 (+8, a new `blank.test.ts` holding the
  template to the editor's), `verify-folder-view.mjs` +11 (the written
  blank opened in the real editor as four measures), `verify-tauri.sh`
  probe7 (a folder and a score on disk, the score opened as a tab). The
  guide gained *New scores and folders*. Found on the way: the folder
  view's BUILDING §4 still said the plugin never writes to disk — stale
  since the rename, corrected.
- **The folder view renames files and folders in place (2026-10-11).**
  The user's first request after 1.0.0. Point at a row and click its ✎,
  or select it and press F2: the name becomes a field, Enter or clicking
  away renames, Esc cancels. A score is edited without its extension and
  keeps `.mei`; a renamed open folder stays open. It is the workspace's
  first WRITE, so it was built in the three places a write has to be
  right: the shell's `workspace_rename` renames in the same parent and
  refuses a separator, an empty or dot-led name, an existing name (but
  allows a case-only rename on a case-insensitive disk), the picked root
  and anything outside the roots; the host's service follows — the App
  moves an open tab's path and name and the recorded mtime, so the next
  save lands on the renamed file and the guard compares the same file;
  the plugin moves only what it keys by path. `@battuta/api` 1.0.0 →
  **1.1.0** (`WorkspaceService.rename`, additive) and the folder view
  1.0.0 → **1.1.0** asking for `^1.1.0`; the application, core and docs
  stay at 1.0.0 until the next release is numbered. Tests: Rust 2 (new),
  editor 148 (+2), folder view 42 (+6), `verify-folder-view.mjs` +10 (the
  UI with a real pointer and keyboard against a fake bridge),
  `verify-tauri.sh` probe6 (the file moved on disk, the tab and the list
  followed). The guide's folder view page gained a *Renaming* section.

## 1.0.0 — 2026-09-18 (Phase 9 — Extension architecture)

The plan — extension points, host API, the ten slices, exit criteria —
is in [PLANNING.md](PLANNING.md). What lands here: each decision as it
is taken, and each slice as it closes, with the `App.tsx` line count
(baseline 2026-09-12: 3,330).

- **Decision: the status bar anchors its own controls and lets
  contributions grow into the free space; slice 6's host half
  (2026-09-14, in-house; api 0.1.5 → 0.1.6).** Two questions asked before
  handing slice 6 out. *What is left of the "harmony" select once every
  lane is a plugin?* An empty control named after a former tenant — so
  the lanes select now exists only while some lane is on offer, is named
  for the point ("lanes", its title listing the lanes it has, a
  `data-lanes` hook for the scripts, which `verify-phase5.mjs` now uses
  in place of the word "harmony"), and hides without moving anything.
  *How does a plugin put a control in the context bar without everything
  jumping?* It always could — a declared `statusBar` slot item, or
  `ctx.slots.add("statusBar", { render })` — but the slot sat after the
  six host selects in a right-packed bar, so an item appearing pushed
  them all left. The rule now: **host controls are anchored,
  contributions grow into the free space to their left.** The slot mounts
  right after the bar's spacer; the lanes select is the boundary, first
  of the host group; the DOM and the picture are identical while nothing
  contributes. And the bar's control look left an App-only style object
  for the `.sbsel` class, so a plugin's `<select className="sbsel">`
  matches the host's and joins F6 roving focus (and ↑/↓ cycling with
  `data-cycle`) — the chevron the class always carried now actually
  shows, since the inline `background` shorthand no longer paints over
  it. Not built: a declared select kind in the manifest, left/right
  alignment — no consumer. **The api half for slice 6:** `HarmKind`, the
  `core.setHarm` message (`{ eventId, kind, text }`, refused at the door
  for an unknown kind or a non-string, at apply for text the grammar
  rejects), `ctx.query.harmAt(eventId, kind)` and
  `ctx.query.harmValid(kind, text)`. The last one settles where the
  harmony grammar goes: VALIDITY stays in core, because `SetHarmCommand`
  refuses what its regexes reject and core must own what it refuses; the
  plugin asks `harmValid` for `complete` and owns the editor affordances
  (charsets, the `o` → `°` mapping, the suggestion lists) — no second
  copy of a regex anywhere. The internal `chord` / `rna` specs commit
  through `core.setHarm` already, so the message runs end to end before
  its plugin exists (the `refuse` helper and the session write left
  `App.tsx` with it). Tests: `host.test.ts` +1 (the mapping and its two
  refusals) and the query test extended; editor 122, api 18, plugins 105;
  `verify-phase5` 222 (its two harmony hooks now read `select[data-lanes]`; one flaky voice-navigation check in a back-to-back run passed on its own), `verify-lyrics` 26, `verify-app` 18, the keyboard 25, all green.
  `App.tsx` **3,117 → 3,109**; initial chunk **599.0 kB** (ceiling 605.5).
- **Screenshots of the folder view and the pitch reference in the guide
  (2026-09-18).** `docs/scripts/build-shots.mjs` grew three shots at the
  end of its run, generated like every other: the pitch reference panel and
  a row of tiles under its trace, from a take synthesized from the score's
  own timemap and sung a little human (a slow vibrato, notes a few cents
  off and a few ms late) so the trace reads as a take; and the folder view
  listing a folder, which the browser cannot have — so the shot gives the
  workspace service a bridge-shaped fake answering the shell's own
  commands, and only the folder is invented. Embedded with `<Shot>` in the
  two guide pages; every shot regenerated at the released UI. The two
  pages were reachable only from What's new: they joined the sidebar's
  *Working with scores* group (beside playback and files), the landing
  page's cards, and the tour's header table (the 📁 and the 🎙).
- **Released 1.0.0 (2026-09-18).** The first stable version, tagged by the
  user, and ONE number for everything: the application (from 0.0.3), core
  (from 0.0.0), the docs site (from 0.0.1), `@battuta/api` (from 0.1.18 —
  the contract the phase set out to make, promoted as its exit criterion
  says, every plugin's manifest asking for `^1.0.0`) and the eight plugins
  (from the 0.1.0 they were born at and never moved from — the user
  noticed). The plan had named the application's release 0.1.0; the user
  chose to align it with the contract, so the phase's heading here carries
  the number that shipped. The surface report is rewritten at 1.0.0.
  DESIGN.md's *Host and plugins* section is written from the notes
  accumulated slice by slice, which closes the phase's documents.
- **"▶ score" beside "▶ song" (2026-09-18).** The user's one missing piece
  on trying it: the written notes, plainly, through MIDI, from the same
  playhead. `src/scorePlayer.ts` hands every note from the playhead on to
  the host's MIDI sink at once as an on/off pair — channel 1, velocity
  100, the off 10 ms early so a repeated pitch re-attacks — at the
  recording's pace through the alignment, so the two transports sound
  together; the sink's queue keeps the order and its panic is the pause.
  No ties, no articulations, no instrument: the reference pitch, and the
  playback plugin stays the performer. It sounds in the take's register:
  the pitches are moved by the inverse of the trace's "st" (the user's
  last fix — the trace is shifted to meet the notes, the notes are played
  to meet the voice), and a change while it plays restarts it where it
  is. The outputs are opened once on the
  first press and kept, closed on deactivate; without any the button says
  so. The plugin declares the `midi` capability. Tests: `scorePlayer.test.ts`
  (3), the lifecycle against a fake MIDI backend reading the bytes (+2);
  plugin suite 34; e2e 37.
- **The pitch reference plays its recording (2026-09-18).** ▶ / ⏸ in the
  panel plays the take from the white playhead through the host's context
  (one buffer source per stretch, `src/player.ts`), the line moves while it
  plays, and it is dragged anywhere on the strip (pointer capture). It
  FOLLOWS THE CARET: a move of the caret puts the line at that event's
  moment in the recording through the alignment, so hearing how a passage
  was taken is a click on its first note and play. For that the api grew
  one question, `ctx.query.eventIdAt(caret)` — the host answered it
  internally since Phase 2 — 0.1.17 → 0.1.18; the plugin pairs it with the
  onsets of every timemap id, rests included. The strip's click no longer
  sets bar 1 (the number does); the playhead starts where bar 1 begins.
  Closing the panel, clearing, another take and deactivation pause. Tests:
  `player.test.ts` (3) and the lifecycle (+1), plugin suite 29; e2e 36.
- **A transposition for the pitch reference, and a held note chased
  (2026-09-18).** The panel gained a transposition, **st**: semitones added
  to the detected pitch before it is compared and drawn (a voice an octave
  under the written part, a transposing instrument); the detected trace is
  kept as `raw`, the compared one derived, and the number is stored with
  the alignment (`align:<name>` now carries `transpose`). Two of the
  user's trims the same day: the octave buttons and the "trace" label went
  (a number and "st" are enough), and the analysis summary — length,
  voiced frames, cents — became a notice when the analysis lands rather
  than panel text seen all the time. Plugin suite 25, e2e 31. **The held note:** the user heard one note of
  `test.mei` sustain to the end of the piece, around the eighth attack.
  A new tool, `spikes/diag-playback-stream.mjs`, opens a score in the real
  editor, takes the host's timemap and facts, builds the player's own
  performance and replays the MIDI stream in delivery order: the score is
  clean — 137 attacks, 137 releases, no pitch attacked while sounding,
  no off and on of one pitch within two ms, nothing sounding at the end
  (the eighth attack, A4 for 112 ms, is followed by a rest); a dangling
  `<tie>` whose notes no longer exist is harmless. The one mechanism
  battuta itself could offer was found in the sink: every message rode its
  own `setTimeout`, so two messages a few ms apart could leave in either
  order under a coarse or throttled timer, and a same-pitch on before the
  previous off holds a voice on a synth until the panic. The sink now
  keeps ONE queue in delivery order behind one timer — by time, note-offs
  before note-ons at the same instant, then scheduling order — so the
  order is a property of the data (`midiOut.test.ts` +2, editor 146). Not
  claimed as the cause: the piano the user heard was a FluidSynth left
  running, whose channel-1 program is a piano, and every connected output
  receives the same notes, so a second, slower route (a network session)
  or a lost packet on it would hold a note the same way. An output choice
  in the player row is the feature if that is what it is.
- **The bottom panel area no longer covers the score (2026-09-18).** The
  pitch reference panel sat over the last row of measures and made them
  impossible to edit — the same flaw the side area had until 9b, and one
  the on-screen keyboard had carried since slice 4b unnoticed. The bottom
  area now publishes its measured height as `--battuta-bottom-h`; `<main>`
  pads the score by it, so the last measures scroll clear, and the caret
  follow counts the panel as part of the fold rather than scrolling the
  caret to a place behind it. Pinned in `verify-pitch-reference.mjs` (the
  padding equals the area's height, the last tile scrolls clear, the
  padding goes back to nothing when the panel closes; 28 checks);
  `verify-onscreen-keyboard.mjs` unchanged at 24. **And a MIDI report
  rather than a fix:** the user hears a piano from the DAW whatever
  instrument the track has. Battuta sends note-on and note-off on channel
  1 at one velocity and "all notes off" at stop — no program change, no
  controller, no system message, now or in any commit — to EVERY connected
  output plus the `battuta` virtual source in the shell. What names the
  instrument is therefore on the receiving side (a channel-1 part, a
  default-instrument track, or a second route hearing the same notes);
  the playback README now says exactly what the wire carries. A channel
  or an output choice would be the feature if the receiver cannot be
  told; not built unasked.
- **Slice 10b — the pitch reference plugin (2026-09-18). CLOSED; Phase 9's
  last plugin.** `packages/plugins/pitch-reference`, built in-house in the
  five checkpoints the brief named, each verified before the next: a
  recording decoded by the host's AudioContext (mono, 16 kHz); its pitch
  by plain YIN, hand-rolled (window 1024, hop 160, threshold 0.15,
  parabolic interpolation, unvoiced frames as gaps, a five-frame median),
  in yielded chunks with a progress figure; alignment by two numbers, an
  offset found at the first voiced run and a "recorded at ♩=" rate over
  the score's tempo — taken from the timemap, never estimated — kept per
  document name in `ctx.storage`, with the median deviation from the
  written pitch shown in cents; the trace over every measure tile on the
  overlays point, on the staff nearest its pitch, the axis fitted through
  the measure's own noteheads (the clef alone for a measure of rests),
  time along the notes' onsets, the written notes as faint bars; and the
  panel's controls (load, clear, the strip that sets bar 1 on a click, the
  tempo, on/off on the score). Decisions: no tempo detection, no polyphony,
  a repeated measure shows its first pass, the recording is never stored
  and never becomes a tab. `App.tsx` 3,017 → 3,017 and core untouched —
  the phase's central claim, on a signal-processing feature. One host
  refinement, closed in-house the same hour: a note's box on the overlays
  point is its HEAD, not its group (the stem put the centre a fifth off);
  `@battuta/api` 0.1.16 → 0.1.17 for that contract detail. Tests: the
  plugin's five suites (25); editor 144; `spikes/verify-pitch-reference.mjs`
  synthesizes a take from the score's own timemap with 300 ms of silence
  first and reads the results off the page — offset found, median
  deviation 0 cents, the trace starting 0.1 px from the first notehead
  (25 checks); `verify-overlays.mjs` unchanged. What remains for the phase
  exit is documents, not code: DESIGN.md's *Host and plugins* section
  written from the notes, `@battuta/api` promoted to 1.0, the 0.1.0 release.
- **Slice 10a — the overlays point (2026-09-18).** The last extension
  point the phase names, built in-house against 10b as its consumer:
  `ctx.overlays.add({ id, render })` mounts a layer over every measure
  tile in edit view, and `render` gets the tile MEASURED — its box, a box
  per engraved event, each staff's five lines with the context in force
  (clef, key, meter), in the tile's own CSS pixels. Decisions: the layer
  is draw-only (no pointer events; the host's hit-testing under it is
  untouched) and sits above the SVG, below the caret; it re-measures when
  the tile's ink moves (render, zoom, row reflow) and costs nothing while
  no overlay is registered — nothing mounted, no layout read; time is not
  in the props, because the timemap already names each measure by the
  same engraved id and carries the pitches; a header cell gets no layer.
  `@battuta/api` 0.1.15 → 0.1.16 (`OverlaysService`, `OverlaySpec`,
  `TileOverlayProps`, `OverlayBox`, `OverlayStaff`; core's `StaffContext`,
  `ClefContext`, `MeterContext` re-exported). Host module `overlays.tsx`,
  allowlisted. `App.tsx` 2,991 → 3,017: the mount inside each tile's
  aligned box and two session-stable lookups. Rehearsed from outside as
  the convention asks: `spikes/verify-overlays.mjs` registers a plugin at
  runtime that holds only `ctx` and reads its props off the page (14
  checks). Tests: editor 143 (+5), api 20, the plugin suites unchanged.
- **The first overlay plugin changes (decided 2026-09-18).** Slice 10's
  plugin is a wav pitch reference, not the MIDI piano-roll ghost layer:
  load a performance, detect its pitch (plain YIN, hand-rolled, on a
  16 kHz mono downmix), trace it over every measure and over the whole
  file in a bottom panel, with the written pitch on the same axis. Three
  choices with it: the score's tempo is taken, never estimated from the
  audio — alignment is an offset and a rate, with dynamic time warping as
  the next version; web and desktop alike, since decoding is a method on
  the host's AudioContext and a sidecar wav through the workspace is a
  later step; built in-house in five usable checkpoints, stopping at any
  if the api would have to grow. The piano-roll layer and OMR stay later
  consumers of the same point.
- **The shell smoke leaves the user's session alone (2026-09-16).** Every
  run of `verify-tauri.sh` restored the recovered session from the WebView's
  localStorage, opened its test scores into it and saved it back — a session
  full of smoke files to erase by hand before the next start. The shell now
  builds its window in code (tauri.conf.json's `windows` is empty) and takes
  `BATTUTA_EPHEMERAL_STORAGE=1`: an incognito WebView whose localStorage,
  IndexedDB and caches live in memory and vanish with the process. The smoke
  sets it on all three launches, asserts the shell acknowledged it, and
  fingerprints WebKit's per-origin storage before and after — it must not
  change. Nothing the smoke does can reach what the user had open. Two
  things the polluted session had been hiding: an empty store starts on a
  blank untitled score (rests only), so the playback probe had nothing to
  light — the first launch now gets a fixture score as its argument; and
  `on_page_load` fires at Started and at Finished, so every probe ran
  twice and probe3's second copy logged a FAILED line each run — the probes
  are scheduled once now, on Finished. 12 checks.
- **Slice 9b's gaps closed, and the side panel placed (2026-09-16,
  in-house).** The plugin slice wrote up three host gaps and the user
  asked for four changes to how the panel looks and sits; all in one
  pass. **The side area** (host/slots.tsx) now starts BELOW the header —
  the App measures the header and publishes its height as
  `--battuta-header-h`, the area's `top` reads it (folder-view §7.1: the
  area had been "mounted since slice 1" and wrong for five slices because
  nothing had ever been put in it) — sits on the LEFT, as most
  applications place a file view, and PUSHES the score right (`<main>`
  takes a matching left margin while a side panel is up) instead of
  covering it, which had made editing beside it impossible; the plugin's
  92 px clearance hack is gone. **The live guard** ignores only `removed`:
  macOS FSEvents keeps a recently created file's "created" flag on every
  later event (§7.6), so an open file reporting created or modified has
  changed under us either way; the shell smoke's probe4 accepts both
  kinds. And the watcher's event paths are now canonical, like every path
  the service hands out — macOS reports `/var/folders/…` for a root
  admitted as `/private/var/…`, so the guard's lookup by path missed
  until they matched. **The extension question** the 9b brief left open is decided:
  `.mei` only stays — the folder view is a view of MEI scores, and a
  MusicXML or ABC file in the folder is opened through the dialog and
  becomes an MEI tab the view then shows; no `ctx.formats.extensions`.
  **The panel's rows**: no dot and no bold for open scores; the score in
  the active tab is highlighted (`#cfe2f5`, `data-folder-active`), and an
  unsaved one keeps its `*` — the panel now takes `ctx.document` beside
  `ctx.documents`. **A convention** from §7.2: a declared entry point has
  two hooks over its life, the host's before the plugin loads and the
  plugin's own once it is active; anything addressing it from outside
  matches both. **And a bug the user caught by launching the app:** the
  shell's probes 3, 4 and 5 — page view and play, a folder pick, the
  folder view — ran on EVERY launch, not only under the smoke, so a
  normal start switched views, sounded a note and opened a folder by
  itself; they are gated behind the smoke's flags now (`BATTUTA_SHELL_TEST_FILE`
  for playback, `BATTUTA_WORKSPACE_TEST_DIR` for the two workspace probes),
  and the smoke now launches the shell once with no flag and fails if
  any of the three logs a line. Probe5 is also hermetic:
  the folder view remembers its folder across runs, so the previous
  smoke's temp folder came back at startup and the probe opened a
  `two.mei` there while the script appended to the new one — "guard no"
  for the wrong reason; it now picks (the pick command returns the test
  folder without a dialog) and clicks only a row whose path carries the
  test folder's name. Tests: editor 138, plugins 222; the folder-view e2e and
  the shell smoke with the layout and the kinds.
- **Slice 9b — the folder view (2026-09-16). CLOSED, and it is the
  measurement.** `packages/plugins/folder-view` is the first plugin that
  is **not an extraction** — nothing of it ever lived in the editor — so
  the number the phase has been working towards is the one that did not
  move: **`App.tsx` 2,991 → 2,991**, with the host's entire diff being the
  two lines in `plugins.ts` that every plugin costs and a `package.json`
  dependency. A whole feature, and the host did not grow for it.
  What it does: a side panel over a folder the user picked — sub-folders
  opening in place, open tabs marked and unsaved ones starred from
  `ctx.documents` (never off the DOM), a click opening through the host's
  ONE open path, and a recursive watch keeping the list level with the
  disk. Entry point a declared 📁 (`dimUntilActive`), activation on that
  command and on `onSettings:folder`, `capabilities: ["workspace"]`, and
  in a browser the panel opens and says the desktop app is required.
  **`@battuta/api` 0.1.15, unchanged** — 9a built every call against this
  panel as its named consumer, which is why this ran without a stop; the
  one question 9a left open on purpose is answered the way it allowed:
  the panel lists `.mei` only, because the extensions that are currently
  openable are the host's `openExtensions` and are not on the api. Copying
  that list into the plugin is the tempting third option and would be
  wrong the first time a user turned the formats plugin off — the addition
  to propose is `ctx.formats.extensions: Store<readonly string[]>`, a
  store rather than a getter for exactly that reason, with a test already
  written that will change when it lands. **Four things the e2e found that
  no unit test could**, all in BUILDING.md §7: the **side panel area
  starts underneath the app header** (`top: 0`, z-index 32, against a
  sticky 75 px header at 35 — the area has existed since slice 1 and this
  is its first consumer, so it had been wrong for five slices; the plugin
  clears it and both scripts click through the cleared strip so a header
  that grows fails a test); **a declared entry point has two hooks over
  its life** (`data-slot-command` asleep, the plugin's own once a runtime
  item replaces the face — and the shell probe only found out on its
  SECOND run, because the first had persisted a folder that woke the
  plugin at startup); **an error state has to carry its way out** (a
  remembered folder that had been deleted showed the reason and no button
  to pick another); and **"no shell" and "no folder" are the same
  `false`** from `openFolder`, so opening the browser build once would
  have wiped the desktop app's remembered folder — `available` is the
  discriminator, pinned by two tests that differ only in whether the
  bridge exists. Tests: `tree.test.ts` (15, the list model as a table),
  `folder-view.test.ts` (21, against a real host and a fake shell bridge);
  editor 138, core 224, api 20, plugins **222**. E2e: a new
  `verify-folder-view.mjs` (**15 checks**, the browser half — the entry
  point, the side area, the honest refusal) and `probe5` in the shell
  smoke driving the same UI end to end (folder picked without a dialog,
  two scores listed, one opened by clicking its row, that row marked open
  from `ctx.documents`); every other script unchanged. Union keymap
  snapshot byte-identical; initial chunk **368.7 kB** against the 375.0 kB
  ceiling 9a set. **One gate is not green and it is not this slice's:**
  9a's probe4 asserts the watcher reports `modified` for an append, and
  macOS FSEvents reports `created` for a file created moments earlier —
  it fails with this plugin absent, and the same mismatch stops 9a's live
  guard firing on macOS (`App.tsx` filters `kind !== "modified"`). probe5
  therefore reports the guard rather than asserting it, and was verified
  against the shell binary directly. Written up in §7.6, not resolved:
  the guard and probe4 are both 9a's.
- **Slice 8b — the format converters are a plugin (2026-09-16). CLOSED
  on the second attempt.** `packages/plugins/formats`: five imports
  (MusicXML plain and zipped, ABC, Plaine & Easie, Humdrum) and three
  exports (MIDI of the written score, Humdrum, PAE), all of them Verovio's
  Humdrum-enabled build inside the plugin's **own worker** — which is the
  slice's second claim after the dist one: *a worker is a plugin's to
  ship, not a host service to ask for*, so the manifest declares no
  capability at all. The **table moved into `src/manifest.ts`** (rule 3
  leaves nowhere else: the manifest must declare the formats and may
  import nothing but the api), each entry naming its Verovio call
  (`from` / `op`) beside its contribution, and it stays the single source
  of truth — `convert.test.ts` moved with it, assertions unchanged,
  holding it against the real toolkit. Ids are `battuta.formats.<format>`
  with **PAE and Humdrum sharing one**, so six activation events cover
  eight registrations: an activation event names a capability the user
  reached for, not a function signature. **SVG left the table entirely**
  rather than just staying unregistered — it is engraving from the render
  pool, not a conversion, and a table that is the single source of truth
  for X must contain exactly the things that are X; the App carries its
  one entry inline. **The number that matters is not the budget line**:
  the initial chunk moved 365.0 → **364.5 kB** (the worker was never in
  it), while the **13.45 MB `convertWorker` asset** is now referenced by
  `plugin-formats-*.js` and by nothing else, with the entry's static
  closure `battuta-shared` alone. **`@battuta/api` 0.1.14, unchanged** —
  the one addition this plugin needed (`ctx.query.mei()`) was made
  in-house first, after the first attempt stopped on it; the
  `vite.config.ts` edit the brief allowed was measured unnecessary (a
  worker is a separate Rollup sub-build, out of `manualChunks`' reach).
  Two things the second attempt found and wrote up: **"off" is measured in
  what is released, not in what leaves the UI** — the registrations
  disposed cleanly while a 12 MB worker kept running, so `Converter` gained
  a `dispose()` added to `ctx.subscriptions` last (disposed first, so
  nothing is mid-conversion when the worker goes) and the suite asserts
  the termination; and **when a plugin is hard to test because a platform
  global is missing, stand in the global, not a seam in your own code** —
  a `FakeWorker` on `globalThis`, which is also the only thing in the
  repository that checks the id → Verovio mapping on the wire. Tests:
  `convert.test.ts` (7, moved), `formats.test.ts` (17, new); editor 130,
  core 224, api 20, plugins **186**. E2e: `verify-formats` **14 checks,
  every assertion identical** — only the `.mxl` fixture's path (it lives
  with the pinning test) and the three export ids changed; app 18, phase 2
  20, phase 3 21, phase 4 67, phase 5 221, lyrics 25, keyboard 24, the
  shell smoke 7 of 7. Union keymap snapshot byte-identical.
  `App.tsx` **2,946 → 2,935**.
- **Slice 9a — the workspace service and the open documents
  (2026-09-16, in-house). CLOSED; slice 9 split into 9a and 9b.** Checked
  before the handoff: the `panels` side area existed and nothing else the
  folder view needs did. **`ctx.workspace`** (capability `workspace`,
  offered by every build; host module `workspace.ts`): `available` (false
  in a browser — the panel says the shell is required and stops),
  `pickFolder()` (the native folder dialog), `openFolder(path)` (re-admit
  a folder a plugin persisted), `readDir(path)` (folders first, hidden
  entries skipped), `openDocument(path)` (through the App's one open path:
  an already-open tab is focused, an import converts, the mtime is
  recorded) and `watch(path, listener)` (recursive, the bursts a save
  produces coalesced into one event per path). **Scoped to the folders
  the user picked**: the shell keeps the roots and refuses every list,
  read and watch outside them — no fs plugin, no broad permission; six
  Tauri commands (`workspace_pick_folder`, `_open_folder`, `_read_dir`,
  `_read_file`, `_watch`, `_unwatch`) and a `notify` watcher emitting
  `workspace-change`, behind the JS facade that is the contract. **The
  open documents as data**: `DocumentInfo` gained `path?` and `dirty`, and
  `ctx.documents` lists every open tab in order while `ctx.document` stays
  the active one — a folder view marks what is open and unsaved from
  this, never from the DOM. **The external-change guard is live**: the
  App subscribes to the service's change stream, and a file open in a tab
  that changes on disk under any watched folder is announced the moment
  it happens (the save-time mtime check stays as the last line) — live
  file watching, open since 0.0.2, closes with a folder picked. Tests:
  `workspace.test.ts` (6: the browser backend refuses politely; in the
  shell the commands and their arguments, routing by watch id, coalescing,
  dispose unwatching even before the shell answered, the bound opener),
  `host.test.ts` +2 (`ctx.documents` with dirty and paths, the capability,
  the opener), the shell smoke's eighth check (the pick without a dialog
  through `BATTUTA_WORKSPACE_TEST_DIR`, two entries listed, a read outside
  the roots refused, a watch placed and the script's append to a file
  observed as `modified`). `@battuta/api` 0.1.14 → **0.1.15**. **The budget, raised on purpose:**
  the workspace facade is host code by design — a platform capability
  with a shell backend and a browser fallback lives in the host, the way
  the MIDI service does — and it put the initial chunk at 367.9 kB
  against 7b's 368.2 kB ceiling, 0.3 kB from red with 9b's manifest still
  to join the shared chunk; `budget.json` goes to 384,000 bytes (measured
  376,730 + 2%), the first raise since the ceiling was set and the reason
  is this sentence. Not added,
  for want of a consumer: `onDocument:` firing, any write access, a
  browser backend over the File System Access API. One question left open
  for 9b on purpose: a folder view must know which extensions are scores,
  and the host's accept list is not on the api — the brief names the shape
  to propose.
- **Slice 8b stopped, and its one gap closed (2026-09-16, in-house; api
  0.1.13 → 0.1.14).** The formats plugin's first attempt delivered
  nothing and left `packages/plugins/formats/POSTMORTEM-2026-09-16.md`
  (its BUILDING.md, renamed as the earlier attempts' were) — the right
  outcome, and the reasons are the document's. **The gap:** an export
  producer takes no argument, and nothing on the api yields the
  document's MEI; 8a's three internal export registrations had it by
  closing over the App's session, which a plugin cannot do. So the export
  half was rehearsed against the registry — the menu row, the wake-up,
  the save path — and not against the contract. Closed: `ctx.query.mei()`
  returns the document as MEI text, score-based (what the pages are
  engraved from and a converter reads), null without a document; the
  App's own export registrations now read through it, so the rehearsal
  holds only what a plugin holds. **The lesson, now a convention:**
  rehearse a point from something that has only `ctx` in scope — an
  internal registration that closes over the session hides exactly what a
  plugin lacks, and this was the second sighting (7b's export file name
  was the first). Also established by the attempt and kept in its
  BUILDING.md for the next: a plugin can own a Vite worker with no host
  edit (a worker is a separate Rollup sub-build, out of `manualChunks`'
  reach — the opposite of 7b's preload helper); one id per FORMAT, not
  per direction (PAE and Humdrum go both ways: six ids, six wake-ups);
  the table lives in the manifest (rule 3 forbids a third module) and
  SVG is not in it (engraving, the host's); a plugin's `verovio.d.ts`
  should declare only the converter calls, so rule 1b becomes a type
  error; and a half-moved worker would have shipped as two byte-identical
  copies Vite deduplicates by content hash — until the first edit. Tests:
  `host.test.ts` +1; editor 136, api 20, plugins 162.
- **Decision: Verovio's converter build may live in a plugin; engraving
  may not (2026-09-15, the user's).** The boundary test forbade `verovio`
  outright, to keep engraving out of plugins. The formats plugin's target
  is precise — take the Humdrum-enabled build out of the host — so the
  rule is relaxed to match the intent instead of the package name:
  `verovio/wasm-hum` and `verovio/esm` are allowed imports and `verovio`
  an allowed dependency; the render build (`verovio/wasm`, or the bare
  package) stays refused; and a new rule refuses any Verovio engraving or
  layout call in a plugin (`renderToSVG`, `renderToTimemap`,
  `getPageWithElement`, …) — rendering is a host service, a plugin's
  Verovio converts formats only. Tone in 7a, Verovio in 8a: each
  relaxation for one plugin's stated purpose, with the intent kept as a
  testable rule rather than dropped with the package name.
- **Slice 8a — the import half of `formats` (2026-09-15, in-house).
  CLOSED; slice 8 split into 8a and 8b the same day.** Written first:
  `spikes/verify-formats.mjs`, 14 checks through what a user touches — an
  `.mxl` through the file input opens as a new tab named after the file,
  an ABC file imports as text, a `.xml` holding MusicXML is told apart
  from MEI by its root, an unknown extension is refused with a notice,
  the accept list covers every format, and the four Verovio exports
  download real files (an SMF header, `**kern`, PAE, `<svg`) from menu
  rows in order. Green before, green after. **The registry grew its
  import half** (`host/formats.ts`, now `FormatStore`): a manifest's
  `contributes.imports: [{ id, label, exts, binary?, roots? }]` widens the
  open dialog's accept list — the browser input's and the shell's native
  filter, which now takes `exts` and `binaryExts` from the frontend
  instead of a Rust constant — before the plugin's code loads; opening
  such a file fires `onFormat:<id>`, waits for
  `ctx.formats.registerImport(id, convert)`, hands the converter the file
  as text or, for a `binary` import, as bytes, and opens the MEI that
  comes back as a NEW unsaved document (0.0.3's rule: a plain save must
  never overwrite the `.musicxml` source). **Detection is the host's:**
  `.mei` is native, an extension one import claims is that import, `.xml`
  is MEI unless an import claiming it declares `roots` and the content's
  root element is one of them (MusicXML's `score-partwise` /
  `score-timewise`), nothing claiming it is unsupported — a plugin
  declares extensions and roots, never a sniffer; `detectImport` and
  `OPEN_EXTENSIONS` left `formats.ts` with their tests, which now run
  against `host.formats.detect`. **Multi-file exports:** `ExportPayload`
  may be `{ files: [{ bytes, filename }] }`, which is what the SVG export
  is (a page per file) — and SVG stays the host's, since it is engraving
  from the render pool, not a converter. **The App's converters are
  internal registrations:** the five Verovio imports and the three Verovio
  exports through the lazy converter worker, SVG through the pool, so the
  open path (`openFile`, one function where there were two) and the menu
  run on the registry alone — `exportAs`, the `EXPORT_FORMATS` rows, the
  `.mxl` special case (now "whatever declares `binary`") and the two
  import functions' format knowledge left `App.tsx`; `IMPORT_FORMATS` /
  `EXPORT_FORMATS` stay the pinned table of what the bundled Verovio can
  do. `@battuta/api` 0.1.12 → **0.1.13** (`ImportContribution`,
  `ImportFile`, `ExportFile`, `registerImport`). Tests: `host.test.ts` +3
  (declared imports widen the accept list before the plugin loads and
  `importFile` wakes it with `onFormat:`; the detection table; ownership),
  the `files` payload through `produce`, the api's import validation;
  editor 135, api 20, plugins 162; e2e `verify-formats` 14, `verify-phase3`
  21, `verify-app` 18, and the shell smoke 7 of 7 with the new
  `open_score` signature — all green. Not moved yet, by design: the converter
  worker and the Humdrum-enabled Verovio build stay the App's until 8b,
  so the dist is unchanged; initial chunk **365.1 kB** (ceiling 368.2).
  `App.tsx` 2,945 → 2,942. 8b is next.
- **Slice 7b's gaps closed (2026-09-15, in-house; api 0.1.11 → 0.1.12).**
  The plugin slice stopped at two gaps and named a weakness, as its brief
  said to; each was the host's to take. **`DocumentInfo.name`**: the tab's
  name — the file's base name without its extension — beside the MEI
  `title`, which is often empty and never the file's name. The playback
  plugin's export returns `filename: <name>-playback.mid` again, as 0.0.3
  saved it, and no longer collides with the written-score MIDI export;
  slice 9's folder view is the second consumer. Every fake snapshot in the
  test suites gained the field. **The shell's playback probe** is alive
  again and asserted for the first time: `main.rs`'s probe3 no longer
  fetches a `window.__SAMPLE_URL__` a plugin may not set — it clicks page
  view (waking the playback plugin: its lazy chunk, then Tone's, over
  `tauri://`), presses ▶ once the pages render, and waits for a lit note,
  which the player only produces after `decodeAudioData` has accepted the
  Salamander mp3s — so one line proves the lazy chunks resolve in the
  shell AND WebKitGTK's mp3 support, the check the old hook made;
  `verify-tauri.sh` grew a seventh PASS and an 18 s window, and is green
  7 of 7. **The DOM-global rule** in `plugin-boundaries` was tightened
  from "`window` followed by `.`, `[` or `(`" to any use of the global as
  a value — `(window as T)`, `typeof window`, `window,` — still ignoring
  `ctx.document`, object keys and type members; the cast that slipped past
  in 7b's first draft is a test case now, and every shipped plugin passes
  the tighter rule unchanged. Left as written up: §7.4 (a dynamic import
  inside a plugin buys lazy execution, not a lazy chunk — the host's
  `manualChunks` is coarser than a plugin's imports, and a 2 kB saving is
  not worth an exception) and §7.8's few milliseconds of already-scheduled
  sound after an edit (a synchronous "an edit is about to happen" hook
  has no second consumer). Tests: editor 135, api 19, plugins 162.
- **Slice 7b — playback is a plugin (2026-09-15). CLOSED.**
  `packages/plugins/playback` — the last of the "move a whole feature
  out" slices, and the first where the bundle budget was the point.
  `player.ts`, `performance.ts`, `midiExport.ts`, the 30-file Salamander
  subset and the transport row left `apps/editor/src` as they stood after
  7a; `host.audio` / `host.view` / `host.query` became `ctx.*` and
  nothing else in them changed. The manifest declares
  `capabilities: ["midi", "audio"]`, wakes on `onView:pages` (page view
  is the gesture that means "I want to listen") and on
  `onFormat:battuta.playback.midi`, and contributes ONE export — no
  command, no keybinding, no declared slot item: the row is not an entry
  point that opens something, it IS the feature, and the view that would
  show it is the view that wakes the plugin. `activate` adds one
  `docHeader` item whose component subscribes to a view store and renders
  `null` outside page view, so the item is never added and removed and
  never remounts mid-play (4b's §7.6 again); every `data-player-*` /
  `data-midi-*` hook and every inline style is verbatim.
  **The budget, for real:** Tone.js (332.5 kB) is behind a dynamic
  `import()` and is its own lazy chunk, the piano is ~2 MB of assets
  fetched on the first attack, and the initial chunk fell **596.0 kB →
  360.8 kB**; `budget.json` lowered 620,000 → **377,000** bytes (measured
  369,473 + ~2%), with the entry importing neither the plugin chunk nor
  the Tone chunk. Getting there cost one host edit the brief did not list
  and this bullet therefore names: **Vite's `__vitePreload` helper** is
  emitted once and shared by everything with a dynamic import — until now
  only the host's plugin loader — so with the plugin's own dynamic
  imports it became shared, `manualChunks` had no opinion, and Rollup put
  the 700-byte helper inside `plugin-playback`, which the entry then had
  to import statically. One line in `vite.config.ts` names it
  `battuta-shared`, next to the two lines already there for core and
  React: third instance of one rule — anything the host and a plugin
  share must be named — and the slice's own gate cannot pass without it.
  Found with the `generateBundle` hook `packages/plugins/README.md`
  prescribes, not by grepping the bundle. **Settings:** `tempo`,
  `midiOut` and `midiTranspose` moved into the plugin's namespace through
  a second dated entry in `apps/editor/src/settings.ts` (the 4b
  precedent), with its seven cases. **`@battuta/api` 0.1.11, unchanged** —
  *API may grow: None* held, and the one place it shows is written up
  rather than taken: the export used to save as `<score>-playback.mid`
  and now saves as `<score>.mid`, colliding with the written-score MIDI
  export, because `DocumentInfo` carries the score's `title` and not the
  open file's NAME. The gap is BUILDING.md §7.2 with the addition it
  wants (`DocumentInfo.name`, consumers: this export and slice 9's folder
  view) — the user's to approve, not the slice's to take. Also honest:
  the shell's mp3-decode probe (probe3) is now inert, because
  `window.__SAMPLE_URL__` was a plugin-forbidden DOM global and the
  samples no longer exist at startup — §7.3, with the two ways back and
  neither taken; `verify-tauri.sh` never asserted it and stays 6 of 6.
  Tests: `performance.test.ts` (8) and `midiExport.test.ts` (6) moved
  with their assertions unchanged, `playback.test.ts` (16) new — the MIDI
  sink makes the whole transport runnable in node, so stop-on-edit,
  stop-on-leaving-page-view, the transpose, the no-output notice and the
  switch taking row and export away together are assertions rather than
  hopes; editor 135, core 224, api 19, plugins **162**. E2e all green and
  every hook untouched: phase 5 **222** (its playback section not edited),
  app 18, phase 2 20, phase 3 21, phase 4 67, lyrics 26, keyboard 25, and
  the shell smoke 6 of 6. Union keymap snapshot byte-identical (playback
  has no key). `App.tsx` **3,133 → 2,945** (−188).
- **Slice 7a — the audio context, the timemap and the facts (2026-09-15,
  in-house). CLOSED.** What a player needs from the host and cannot make
  itself, built and consumed by the in-App player first, so 7b finds
  every door open. **`ctx.audio`** (host module `audio.ts`): the app's one
  `AudioContext` — `unlock()` creates it synchronously on the first call
  and resumes it on every one (call it in the click, before any await;
  the autoplay policy binds the unlock to the gesture), `context()` hands
  it out for a plugin to connect its own instrument, `timeAt(ms)` converts
  the `performance.now()` clock to the context's seconds so a scheduler
  working from timers, as the MIDI sink does, still lands its attacks
  sample-accurately. Capability `audio` replaces the reserved, never-used
  `playback`; the api's tsconfig gained the DOM lib for the type. **The
  timemap, read-only**: `ctx.query.timemap()` — Verovio's timemap of the
  expanded form as data (`events`, `notes`, `idMap`), a render service;
  types on the api (`render.ts`), since the render pool produces them,
  not core; null without a document, rejecting with the render error; the
  adapter sets the `__PLAYBACK__` dev hook so phase 5's form and tie
  checks read what they read. **The facts**: `ctx.query.notation()` —
  core's `playbackShaping` became `notationFacts`, reporting which note
  ties INTO which and which MARKS a note carries (`slur`, `tenuto`,
  `staccato`, `staccatissimo`; a note under a slur with a staccato has
  both — a fact, not a verdict); the `GATE_*` constants and
  `mergeTiedSpans` left core for the editor's new `performance.ts`, with
  their tests, because what a tie or a staccato MEANS in sound is a
  performance decision and there can be several performers. **The
  highlight** as `ctx.view.highlight(cue)` / `clearHighlight()`, bound by
  the App as a view adapter (host module none: it is a binding, like the
  session's). **`onView:<mode>` fired** from the host's editor mirror on
  every change and once for the first view published — reserved since
  slice 1, fired now. **The export half of `formats`** (host module
  `formats.ts`): `contributes.exports: [{ id, label, ext, mime, title? }]`
  listed in the battuta menu before the plugin loads (`data-export=<id>`
  kept), `onFormat:<id>` fired when a declared export is produced with no
  producer yet, `ctx.formats.registerExport(id, produce)` demanding a
  declaration (two locks: the context reads the manifest, the store the
  ownership; two plugins on one id → the second fails), the App owning
  the one SAVE path and the registry who produces; the hard-coded "export
  playback MIDI" is the first INTERNAL registration. **The in-App player
  rewritten onto all of it**: `player.ts` is now a lookahead scheduler on
  the wall clock — it builds its performance from `timemap()` and
  `notation()` (`performance.ts`: tie chains merged, gates applied,
  clones mapped to the engraved ids they light), hands attacks to its
  Tone.Sampler on the host's context (`Tone.setContext`) or MIDI sends to
  the sink at the same `atMs`, fires cues to `host.view.highlight`, and
  keeps pause / seek / speed by releasing and rescheduling from a
  position; Tone's transport, `Part` and `Draw` are gone, and so is the
  second copy of the duration loop `midiExport.ts` carried — it encodes
  the same performance. Behaviour identical: phase 5's playback section
  green with every hook (`data-player-*`, `g.playing`, `__PLAYBACK__`)
  unchanged. Rule change, the user's: `tone` left the plugin boundary
  test's forbidden list (a plugin brings its own instrument since the
  host owns only the context; `verovio` stays forbidden). `@battuta/api`
  0.1.10 → **0.1.11**. Tests: `audio.test.ts` (4), `performance.test.ts`
  (8: the merge cases moved from core, the gate table, the performance),
  `midiExport.test.ts` on a built performance (6, assertions kept),
  `host.test.ts` +7 (the two queries, the view service, `onView:`, the
  audio capability, the export registry end to end, duplicate
  declaration), core's `playback.test.ts` reporting facts (5), the api's
  export validation; editor 141, core 224, api 19, plugins 132; e2e phase 5
  222 (its playback section untouched; one DEV hook elsewhere in the
  script followed the session method's rename, `playbackShaping()` →
  `notationFacts()`), lyrics 26, app 18, keyboard 25, and the shell smoke
  6 of 6 — all green. Not moved yet, by design: Tone.js
  and the samples stay the App's instrument until 7b, so the initial
  chunk is **596.0 kB** (ceiling 605.5) and the budget drops in 7b.
  `App.tsx` 3,091 → 3,133 (+42: the view adapter, the timemap adapter and
  the export registration replaced two smaller blocks; the row and the
  player leave in 7b). 7b is next.
- **Decision: slice 7 splits into 7a and 7b; the host owns the audio
  context, the plugin owns the instrument and the performance
  (2026-09-15).** The pattern since slice 5, applied to playback, after
  two corrections by the user. The first draft put the performance (ties
  merged, gates applied, clones mapped) into core as data the host
  renders — wrong owner: how a score is PERFORMED is an interpretation,
  there can be several players, and the playback plugin is the only
  consumer; core keeps what it reads from MEI (which note ties into
  which, which marks a note carries) and the player decides what that
  means in sound. The second draft gave the host a sampled piano as a
  "sound out" service — wrong again: the platform capability is the
  `AudioContext` (one per app, unlocked inside a user gesture, its clock),
  not an instrument. So the host's services are the MIDI ports (slice 3)
  and, new, **the audio context**: `ctx.audio.unlock()`, `context()` and
  `timeAt(ms)` — a plugin connects its own synth or sampler to it, and a
  metronome or a note preview can share it tomorrow without fighting for
  the unlock. Tone.js and the Salamander subset move into the playback
  plugin in 7b, behind a dynamic import, and the budget drops there; the
  boundary test's ban on `tone` in a plugin is lifted (verovio stays).
  7a also lands the read-only render service `ctx.query.timemap()`, the
  facts `ctx.query.notation()`, the highlight as `ctx.view`, `onView:`
  fired, and the export half of `formats` (`contributes.exports`,
  `ctx.formats.registerExport`, `onFormat:` fired, host module
  `formats.ts`), and rewrites the in-App player onto all of it first — a
  lookahead scheduler over its sampler and the MIDI sink, its own
  performance from timemap and facts — so 7b moves it with *API may
  grow: none*. `onPlay` stays reserved and unfired — a key would be a
  plugin binding. The briefs are in PLANNING.md.
- **Decision: validity lives in core and the api asks it — `harmValid` is
  back (2026-09-15, in-house; api 0.1.9 → 0.1.10).** Slice 6 moved the
  whole harmony grammar into the plugin and let `core.setHarm` write any
  text, on the argument that core only refused because core owned the
  regexes. The user reversed it with the reason the brief had lacked: **a
  second writer.** A generator plugin that reads a measure and writes its
  harmony is on the horizon, and every writer of a `<harm>` must be
  refused the same text — so the guard sits below all of them, in core,
  and the api exposes the same question rather than have each plugin carry
  a copy. And the rule behind it is consistency: **if the api validates,
  it validates every time** — a message with a grammar is refused by core,
  and the grammar is askable through a query. So `CHORD_RE` / `RNA_RE`,
  `isChordSymbol`, `isRomanNumeral` and `isHarmText` are core's again and
  `SetHarmCommand` refuses on them (its two validity tests and the
  refusal test came home); `ctx.query.harmValid(kind, text)` is on the api
  again, answered by the host straight from core — a question about text,
  it needs no document — and `core.setHarm`'s doc promises the refusal
  once more. The plugin keeps what is the editor's: the charsets
  (`accepts`), the numeral key mapping (`transform`) and the suggestion
  lists (`suggest`); its `complete` is `ctx.query.harmValid`, and
  `suggestions` takes the validity predicate as a parameter for its one
  rule that needs it, so the plugin holds no copy of a regex and its unit
  test injects a deliberately small fake (the real answer is exercised
  through the host in `harmony.test.ts`). `engines.battuta` ^0.1.10. The
  plugin's BUILDING.md §7.2 and §7.3 keep their reasoning with the
  reversal noted: the argument was right that "core refuses" alone does
  not hold the grammar in core; it missed that a second writer does.
- **Decision: core owns the document's data types; the api re-exports
  them (2026-09-15, in-house; api 0.1.8 → 0.1.9).** Slice 6 left
  `HarmKind` declared twice, once in core and once on the api, with a
  type-level assertion in `host/messages.ts` holding the two equal, and
  called the duplication forced by the standalone rule. Four more types
  had been declared twice since the api went standalone in slice 2
  (`CaretPosition`, `BlockSelection`, `Pitch`, `PitchEvent`) and
  `SylValue` since 5a. The user's call: the model owns what a caret, a
  block, a pitch, a syllable or a harmony kind IS, so core declares each
  once and `packages/api/src/document.ts` re-exports exactly those six —
  plain JSON, no class, nothing else of core — which refines the
  standalone rule rather than breaking it: the api imports nothing of
  the editor, and of core only the data types it hands to plugins,
  type-only, erased at runtime; a plugin still imports `@battuta/api`
  alone, and `plugin-boundaries` still fails the build on a core import.
  Two consequences, both handled. **The surface report could no longer
  see those shapes** — a re-export emits as a name — so `surface.mjs` now
  resolves every re-export the api makes and prints the declaration it
  points at in a closing section of `api-report.d.ts`; a field changing
  in core is a surface change here and needs the version bump like any
  other. **Build order**: the api's compile now needs core's
  declarations, and npm's workspace `prepare` order is not something to
  lean on (slice 1's CI failure was exactly that), so the two build
  tsconfigs are TypeScript project references — core's is `composite`,
  the api's references it and builds with `tsc -b`, which builds core
  first from any state; checked by deleting both `dist/` folders and
  running the api's prepare alone. The api declares `@battuta/core` as a
  dependency (`*`, the workspace) so the graph says what the imports do;
  lockfile updated; the pin in `host/messages.ts` is gone, because a type
  declared once cannot drift. (A first attempt ran the dependency the
  other way — core importing the api's declarations — and was reversed
  on review the same hour: it kept the api's snapshot self-contained but
  put the model's vocabulary in the plugin contract's package, which is
  backwards; the report change above is what makes the right direction
  cost nothing.) Harmony's BUILDING.md §7.4 keeps its reasoning with a
  note that the premise was one-sided.
- **Slice 6 — the harmony lanes plugin (2026-09-15). CLOSED, and the
  `lanes` point is frozen.** `packages/plugins/harmony` declares two lanes
  (`battuta.harmony.chord` above, `battuta.harmony.rna` below), activates
  on `onLane:` of either and registers both specs as one function of
  `kind`. **No api addition and no host change** — `@battuta/api` stays at
  **0.1.6**, `api-report.d.ts` unchanged — and, the point of the slice,
  **no change to the `lanes` point either**: not a field, not a query. The
  two lanes use `accepts`, `transform`, `complete` and `suggest`, the four
  `LaneSpec` fields lyrics leaves unset, so between 5b and 6 every field
  of the point has a consumer and none has a third state. Slice 5a shaped
  it against these two lanes before either left `App.tsx`, and that is why
  both extractions were boring.
  - **The whole grammar moved, and the api SHRANK.** The brief split it by
    validity — regexes stay in core because `SetHarmCommand` refuses on
    them, affordances go to the plugin, which asks back through
    `ctx.query.harmValid` — and the slice first shipped that way. On
    review the justification turned out to be circular: **the command
    refused because core owned the grammar**, and nothing else held the
    regexes there. What a chord symbol IS has no MEI knowledge (`CHORD_RE`
    is a regex over a string, and MEI puts no constraint on `<harm>`
    text), so the reflection plugin's rule applies without an exception —
    *parses a chord symbol → the plugin's, even if it sat in core before*.
    `CHORD_RE` / `RNA_RE` / `isChordSymbol` / `isRomanNumeral` /
    `isHarmText` joined `HARM_CHARS` (→ `accepts`), the `o` → `°` / `0` →
    `ø` mapping (→ `transform`) and `CHORD_QUALITIES` / `RNA_BASES` /
    `harmSuggestions` (→ `suggest`) in `src/grammar.ts`, with every core
    test case. **Core keeps the ELEMENT** — `harmTextAt` and
    `SetHarmCommand`, 55 lines and three exports lighter — and the command
    now writes the text it is given, exactly as `SetSylCommand` does.
    `HarmKind` stays in core with them: it is not grammar but the
    discriminator of an element (`isKind` reads `type="rna"`, the command
    writes `type` and `place`), and the api declares its own because
    neither package may import the other — the api is standalone by rule
    and core sits below it. That duplication was unpinned in one
    direction: `toCommand` fails to compile if the API grows a kind core
    lacks, but a kind added to CORE alone would have been silent. A
    type-level assertion in `host/messages.ts`, the one place both are in
    scope, now catches both; checked by adding a third kind to core and
    watching the editor's typecheck fail. The
    cost, stated plainly: a plugin sending `core.setHarm` directly can
    write junk into a `<harm>`, as `core.setSyl` already allows for a
    `<syl>`; nothing a USER can do reaches it, because the lane's
    `complete` stops an incomplete buffer before a message is built. The
    gain: turning the plugin off unloads the grammar with the feature, one
    opinion about what a symbol is instead of two modules agreeing, and
    `suggest` no longer calls a host query on every keystroke.
    **`ctx.query.harmValid` then had no consumer at all and left the api
    (0.1.7), and `core.setHarm`'s own promise changed with it — it no
    longer refuses, which the api report treats as the contract change it
    is (0.1.8). `@battuta/api` 0.1.6 → 0.1.8**, the report regenerated
    twice. Two leftovers
    the move exposed went with it: `session.setHarm`, dead since the
    internal specs left, and core's `isHarmText` import in `App.tsx`.
  - **`App.tsx` 3,109 → 3,091** (−18) and it now has **no lane code at
    all**: the mechanism went in 5a, lyrics in 5b, harmony here. What
    remains is the lane ADAPTER — the caret path and what sits on it —
    which is the document's view and would exist for any lane. The union
    keymap snapshot is **byte-identical**: harmony is picked from the lane
    box, so unlike 5b this extraction moves no binding.
  - Initial chunk 598.3 → **598.1 kB** (ceiling 605.5); the plugin a **1.6
    kB lazy chunk**. Tests: harmony 30 (13 grammar, 17 lifecycle), lyrics
    26, editor 123, api 18, core 223 (−3: every grammar case moved, and
    "rejects invalid text" became "writes the text it is given"), other
    plugins 79. **`verify-phase5.mjs` 221/221 with exactly its two named
    hooks changed** (the select's option VALUES become the lane ids; the
    select is found by `data-lanes`, which is the host's), `verify-lyrics`
    25/25 and every other script unchanged, the shell smoke 6/6.
  - Two dead ends worth the next author's time. Assertions in the moved
    suggestion test failed on arrival and **were the test being wrong, not
    the code** — a narrowed fake grammar accepted a buffer the case assumed
    it rejected, and the seven chord roots return through an early path
    that never meets the six-item cap; when a moved test fails on arrival,
    suspect the move. And the split itself: **a rule that explains the code
    you already have is not the same as a rule that would have produced
    it** — "validity versus affordances" is a real distinction and was
    still the wrong axis, because the module's subject is the element, not
    the vocabulary. `packages/plugins/harmony/BUILDING.md` §7 has both.
- **Slice 5b — the lyrics lane plugin (2026-09-14). CLOSED.**
  `packages/plugins/lyrics` is the first consumer of the `lanes` point from
  outside the host, and it needed **no api addition and no host change**:
  `@battuta/api` stays at **0.1.5**, `api-report.d.ts` unchanged. The
  manifest DECLARES the lane (`battuta.lyrics.verse1`, listed in the status
  bar before a byte of the plugin exists; picking it fires
  `onLane:` and the plugin registers the spec), one command
  (`battuta.lyrics.open`) and its `l` binding with 0.0.3's label verbatim.
  `activate` registers a spec with `attachesTo: "note"`, `advance: "note"`
  and `advanceOn: [" ", "Enter", "-"]` and leaves harmony's four grammar
  fields (`accepts`, `transform`, `complete`, `suggest`) unset — which is
  the evidence that 5a's point was not shaped around one lane. The
  wordpos/con table is `src/syllable.ts`, pure over four values, and
  `commit` RETURNS a `core.setSyl` message rather than calling
  `ctx.execute`: null when nothing changed, so crossing a syllable costs no
  undo step. **The plugin holds no state at all** — the buffer is the
  host's, the syllables are the document's.
  - **The union keymap snapshot changes by exactly one entry, deliberately
    and for the first time**: `lyrics` (core) leaves and
    `battuta.lyrics.open` (plugin, `l`) arrives, in both layouts, the key
    itself unchanged. Regenerated with `npm run keymap:snapshot -w
    @battuta/editor`:
    `-"lyrics": { "keys": ["l"] }` / `+"battuta.lyrics.open": { "keys":
    ["l"], "plugin": "battuta.lyrics" }`.
  - **The caption keyed by an id that moved, for the third slice running.**
    `onscreen-keyboard/src/keys.ts` had `SHORT.lyrics`, so the panel's
    button would have quietly read "l" instead of "lyrics" — no test asks
    whether a caption is the nice one. Re-keyed to the command id, as the
    reflection cycle was in slice 2. The generated keyboard reference
    followed on its own (the generator has read plugin manifests since
    slice 2) and the guide's `<KeymapTable ids={…} />` was pointed at the
    new id. **When a binding changes id, grep for the old id string.**
  - **What "leaves entry mode" belongs to.** `l` must do nothing in note
    entry while the status-bar lane box opens the lane *and* leaves entry
    mode. The second is the HOST's (`ctx.lanes.open` always leaves it), so
    the plugin's handler declines on `ctx.editor.get().entryMode` before
    calling it, rather than making `open` conditional. Two tests, one per
    path.
  - `App.tsx` **3,145 → 3,117** (−28) and the `lyrics` row left
    `keymap.ts`; initial chunk 593.0 → **598.3 kB** (ceiling 605.5 — the
    lane point itself landed in 5a; this plugin is a **0.9 kB lazy
    chunk**). Tests: plugin 26 (11 the syllable table, 15 lifecycle),
    editor 121, api 18, core 226, other plugins 79. **`verify-lyrics.mjs`
    25/25 with every assertion identical and NEITHER design hook moved** —
    the lane still renders into the host's `[data-harm-input]` box and the
    key is still `l`. A plugin test cannot see its own message (the lane
    store holds the host's executor, not `host.execute`), so the suite
    asserts the command's label at the session adapter and the message off
    the registered spec; the account is in
    `packages/plugins/lyrics/BUILDING.md` §7.2.
- **Slice 5a — the `lanes` point (2026-09-14, in-house). CLOSED.** The
  harm-lane mechanism left `App.tsx` for `host/lanes.tsx` (added to
  `HOST_MODULES`), and both lanes run on it as INTERNAL specs with their
  bodies still in the App — the 4a move, applied to lanes. Written first,
  against the App as it was: `spikes/verify-lyrics.mjs`, 26 checks, the
  lyrics e2e the plan said was missing — and it found a bug in 0.0.3
  before any extraction: leaving the lane (Escape, an arrow) over an
  unchanged hyphenated syllable rewrote it without its hyphen, because
  "unchanged" compared the hyphen state to the key just pressed. Fixed in
  the commit rule (`-` states a hyphen, new text states a word end, an
  unchanged syllable keeps what it has), then the script went green and
  the extraction kept it green. **The point, as built** — a `LaneSpec` on
  the api, each field owed to one of the two lanes: `attachesTo: "note" |
  "event"` (lyrics refuse a rest; harmony hangs on anything), `advance:
  "event" | "note"` (harmony steps one event; lyrics skip rests), `advanceOn`
  (`["Enter"]`; `[" ", "Enter", "-"]`), `accepts` / `transform` /
  `complete` / `suggest` (harmony's closed grammar, charset, `o` → `°`,
  Tab completion — the host calls them and knows nothing of what they
  say), `read(eventId)` and `commit({ eventId, buffer, key, prevEventId })`
  returning a `CommandMessage`, null for "nothing changed", or `{ refuse }`
  (a returned refusal, not a throw as the brief said — a plugin API should
  not ask for exceptions), plus the UI strings the two lanes carried in
  three places (`label` for the status-bar option, `name` and `glyph` for
  the open face and the floating editor, `hint` for the notice on open).
  The host: one modal step (`host.lanes.modalStep()`) replaces the two
  modals in the action table; the buffer is a store, so the key handler
  reads it live (the ref the App needed is gone) and it reloads from the
  document through the host's own editor and document mirrors (the App's
  reload effect is gone); the floating editor is `<LaneInput>` with the
  `data-harm-input` / `data-valid` hooks unchanged; the status-bar select
  renders `host.lanes.options` — internal lanes first, then every lane a
  manifest DECLARES (`contributes.lanes: [{ id, label, name, glyph?,
  place }]`), the slot-item lesson applied: the entry point renders before
  the plugin's code loads, and picking it fires `onLane:<id>` (reserved
  since slice 1, fired for the first time), waits for the plugin to
  register, then opens. `ctx.lanes.register(spec)` demands a declared id
  (two locks: the context checks the manifest, the store checks
  ownership; two plugins declaring one id → the second fails
  registration); `ctx.lanes.open(id)` is for a plugin's own key. Also
  built here, for 5b: the `core.setSyl` message (`{ eventId, value:
  SylValue }` → `SetSylCommand`, which labels itself, so no `label`) and
  `ctx.query.lyricAt(eventId)` — and the INTERNAL lyrics spec already
  commits through `core.setSyl`, so the message runs end to end before
  its plugin exists; harmony still writes through the session (its message
  is slice 6's). `@battuta/api` 0.1.4 → **0.1.5**. Behaviour differences
  accepted and recorded: the numeral lane's open face reads "RN numerals"
  (was "♩ numerals"), the incomplete-text notice says "incomplete numerals
  / chords" (was "numeral / chord symbol"), Enter on the last event of a
  harmony lane now says so (lyrics always did), and ctrl/alt chords no
  longer type into the harmony buffer. Tests: `test/lanes.test.ts` (14: the
  protocol key by key over a fake document, advance over rests, refusals,
  the grammar hooks, declared lanes waking their plugin, ownership),
  `host.test.ts` +4 (the `setSyl` mapping, `lyricAt`, a declared lane
  through `onLane:`, duplicate declaration), the api's lane validation;
  editor 120, api 18, plugins 79. All six e2e scripts green — `verify-
  lyrics` 26, `verify-phase5` 222 with its harmony section untouched, the
  keyboard 25, phase4 67, app 18 — the union keymap snapshot byte-identical
  (no binding moved). `App.tsx` **3,227 → 3,145** (−82); initial chunk
  **593.0 → 598.4 kB** (the mechanism moved, it did not leave; ceiling
  605.5). 5b is next.
- **Decision: slice 5 splits into 5a and 5b, the 4a/4b pattern
  (2026-09-14).** The host half of a plugin slice is in-house and lands
  first, with the api growth the plugin will need; the plugin half then
  runs with *API may grow: none*. 4b showed why: a plugin slice that
  finds a door missing must stop, every stop costs a day, and the
  decision behind the door was the host's anyway — so open the doors
  where the decisions belong. 5a: the harm-lane mechanism becomes the
  host's `lanes` point (module `lanes.ts`), both lanes run on it as
  internal specs with their bodies still in `App.tsx`, the status-bar
  select lists lanes declared in manifests before their code loads
  (`onLane:<id>`, reserved since slice 1, finally fires), plus
  `ctx.lanes.register` / `open`, the `core.setSyl` message and
  `ctx.query.lyricAt`; the lyrics e2e the plan said was missing is
  written first, against the App as it is. 5b: `packages/plugins/lyrics`,
  the wordpos/con table as a pure commit over two `lyricAt` answers and
  the key. Slice 6 gets `core.setHarm` and `harmAt` in-house before it
  runs. The briefs are in PLANNING.md.
- **Decision: UI slots belong to the host; a plugin's entry point is a
  manifest-declared slot item; the second header row gets a slot
  (2026-09-14).** The question slice 4b's brief left open is closed: the
  🎹 that opens the on-screen keyboard is `contributes.slotItems: [{ id,
  slot: "header", label: "🎹", command }]` — the host renders it from the
  manifest before the plugin's code loads, and the click runs the
  command, which activates the plugin (the alternative, a host-owned
  panels toggle, would have put a feature's button back in the host).
  Built in-house so the plugin slice's *API may grow* is **none**:
  `SlotItemContribution` and `SLOT_NAMES` on the api, validation (a
  declared item must name the plugin's own command and a real slot), the
  registry applying them at registration with the other declarative
  contributions (so they vanish with the plugin when it is turned off),
  `SlotStore.declare` keyed `<pluginId>:<id>`, and `<Slot>` rendering a
  declared item as a host-owned `<button data-slot-command>` whose click
  is `registry.runCommand`. The `SlotName` union gains **`docHeader`**,
  the second header row (title, tempo, the player in page view): that is
  where the playback plugin's controls go in slice 7, and the App mounts
  the slot there now, empty. `@battuta/api` 0.1.2. Five host tests
  (declared before any code loads; click loads and runs; off/on;
  validation; ordering beside runtime items); editor 112; the DOM is
  unchanged while no plugin declares an item, so the e2e scripts are
  untouched. Initial chunk 601.4 kB (ceiling 605.5).
- **Decision: `run(id)` means *this action*; the action list is a store;
  a plugin knows why it woke; `onSettings:<key>`; a runtime slot item
  overrides its declared face (2026-09-14, in-house; api 0.1.2 → 0.1.3).**
  Slice 4b stopped on three gaps, as its brief said to, and each was a
  host decision, so they were taken here. (1) `ctx.actions.run(id)` now
  reaches an enabled plugin's command when no core rule has the id —
  through the registry, AFTER the same gates and modals its key would
  meet, so a plugin's action is runnable by id exactly when its key would
  have been (`ActionTable` takes a `PluginFallback` with `key` and `run`;
  the App's `install` no longer passes the key fallback). The api's doc
  comment, which had claimed "every plugin command" since 4a, is true
  again. (2) `ctx.actions.ids` is a `Store<readonly string[]>` — core
  rules in dispatch order, then every enabled plugin's declared commands
  — republished when the App installs a table (a document opens or
  closes) and when a plugin is turned on or off; "if a plugin adds an
  action, everyone is told" (the panel's `useStore(ctx.document)` trick
  goes). (3) `ctx.activatedBy` names the activation event that woke the
  plugin — `onStartup`, `onPointer:coarse`, `onCommand:<id>` (a key or a
  declared slot item's click), `onSettings:<key>` — or null from the
  Plugins tab, because activation runs BEFORE the handler that caused it
  and a toggle must know not to open first. (4) `onSettings:<key>` is a
  new activation event: `host.fireStartupEvents` fires `onStartup`, then
  `onPointer:coarse` on a coarse pointer, then per plugin each declared
  `onSettings:<key>` whose key is truthy in the plugin's OWN settings —
  how a panel left open returns on a desktop without `onStartup`. (5)
  Slot items a plugin adds at runtime are keyed `<pluginId>:<id>` like
  declared ones, and a runtime item REPLACES the declared item of the same
  id while it lives — the 🎹 is static until the plugin is active, then a
  live button that can show pressed or dimmed, and the declared face
  returns on deactivate. Tests: `actions.test.ts` (gate stops a plugin id
  as it stops a key; a core rule that declines never falls through to the
  plugins; `ruleIds` republishes on install), `host.test.ts` +5 (the ids
  store follows on/off and install; `run` of a plugin id activates and
  runs; `activatedBy` per wake-up path incl. null; `onSettings` only for
  a truthy OWN setting; the declared-face override). 101 editor tests,
  plugin suites green, budget 593.0 of 605.5 kB. The keyboard plugin got
  the one-line edit the type change forced (`useStore(ctx.actions.ids)`);
  consuming the rest — the toggle, the restore, the live 🎹 — is the
  slice's, which reopens.
- **Slice 4b — the on-screen keyboard plugin (2026-09-14). CLOSED, after
  stopping once.** `packages/plugins/onscreen-keyboard`: the panel is a
  `panels` consumer in the bottom area, every button is
  `ctx.actions.run(id)` — no synthesized key events anywhere — latched
  modifiers select a VARIANT action rather than re-casing a character, the
  digit pad resolves to `duration.N` / `volta.N` / `finger.N` /
  `fingerChange.N` per latch, and the piano is the virtual MIDI input slice
  3 registered, moved here unchanged. The 🎹 is the manifest-declared slot
  item decided on 2026-09-14, replaced by a live item once the plugin is
  active so it dims while the panel is down, as it did in 0.0.3. The
  coverage suite moved into the plugin and runs against the UNION keymap in
  both layouts, so an unreachable binding from ANY plugin fails CI.
  **No host module added**; the host-side edits are the `vkeys` settings
  move (a dated line in `settings.ts`, with its own test — a plugin cannot
  do this, it sees only its own namespace) and naming React into
  `battuta-shared` in `vite.config.ts` (Rollup settles a shared dependency
  inside the first plugin chunk that imports it — the same failure as core
  in slice 2, predicted by the post-mortem and fixed before the first
  build). `App.tsx` **3,248 → 3,227** (−21), with 717 lines leaving
  `apps/editor/` altogether; initial chunk **601.4 → 593.0 kB** (ceiling
  605.5) and the panel an **11.1 kB lazy chunk** a desktop user who never
  opens it does not download. Tests: plugin 47 (27 key model, 20
  lifecycle), editor 101 (−23 the moved coverage suite, +6 the settings
  migration, +5 the host's new guarantees), api 17, core 226; the union
  keymap snapshot byte-identical (this extraction adds no binding); **all
  six browser scripts green — 347 regression checks plus the keyboard
  script's 24 — and the shell smoke 6/6.**
  - **The slice stopped first, and that is the result worth recording.**
    Built against api 0.1.2 it was 23 of 24: the panel projects the union
    keymap, which carries plugin bindings, and `ctx.actions.run()` did not
    — 4a had decided that deliberately — so the panel could caption a
    button it could not press. Measured in the browser: of the 91 action
    ids the panel names, exactly one was missing from the host's 108. It
    refused to advertise a dead key (the 2026-09-12 post-mortem's own
    example), left check 13 failing, and reported three gaps with the shape
    of the decision each needed. **Nothing was invented in the plugin**;
    the api stayed at 0.1.2 and no host module appeared. Compare the first
    attempt at this slice, which met the same wall and answered it with
    fourteen api exports and a host service.
  - **The three gaps, decided and built in-house (api 0.1.2 → 0.1.3), then
    consumed by the plugin.** `ctx.actions.run(id)` reaches an enabled
    plugin's command when no core rule has the id, past the same gates and
    modals its key would meet — so `run` means *this action*, and the api's
    own doc comment (which had claimed "every plugin command" since 4a and
    contradicted the host, uncaught, because prose is not executable)
    became true. `ctx.actions.ids` is a `Store<readonly string[]>` (core
    rules ∪ enabled plugins' commands, republished on every install and
    every on/off). `ctx.activatedBy` names the event that woke a plugin, so
    a UI plugin can tell "a touch device asked for me" from "the click
    about to run my toggle" — the trap the post-mortem recorded and the
    reason this plugin's command could go back to being a real toggle.
    `onSettings:<key>` is a new activation event the host fires at startup
    for a plugin whose own setting under that key is truthy, which brings a
    panel left open back on a desktop without `onStartup` costing every
    user the code at launch. And a runtime slot item with the same id as a
    declared one replaces its face while the plugin is active, the declared
    face returning on deactivate — a static entry point that becomes a
    stateful button. `@battuta/api` **0.1.3**; the report regenerated, the
    reflection plugin's `^0.1.0` still holds, the keyboard pins `^0.1.4`
    (the range it actually uses, including `dimUntilActive` below).
  - **Two behaviour reductions the id model forces**, recorded because they
    are a reviewer's to reject: the **ctrl latch is gone** (with ctrl
    latched, tapping any letter button used to synthesize a ctrl chord, so
    ctrl + the sharp button saved the file; every ctrl chord already has
    its own button, and `ctrl+shift+s` is a declared variant of save), and
    a latch with no declared variant now does nothing *visibly* — it did
    nothing before too, because the shifted character missed the binding,
    but it looked like an ordinary button.
  - **Two visual fixes after review.** A declared slot item may now ask to
    be drawn de-emphasised until its plugin is active —
    `SlotItemContribution.dimUntilActive`, **`@battuta/api` 0.1.4**. The 🎹
    was lit with no panel under it on a desktop, because the plugin's own
    live (dimming) face does not exist until it runs. Per item rather than
    a blanket rule for every declared face: for an entry point that OPENS
    something "not active" means "not showing", but a declared menu entry
    is not disabled while its plugin waits to be loaded. The rule is one
    exported function (`dimsDeclared`) so it has a test rather than living
    inside a component. And the panel's height is declared
    (`ROW_HEIGHT = 110` in `Panel.tsx`) instead of inherited from the
    tallest child: that child was the three-button modifier column, and
    dropping the ctrl latch shrank the row to the shortcut groups' 98px —
    shorter, and too tight for the horizontal scrollbar the groups scroll
    on, which pushed a vertical scrollbar into the panel. The groups
    scroller is `overflowY: "hidden"` as well. **Neither was visible to
    CI**: headless Chromium draws overlay scrollbars, which take no space.
  - Full account in `packages/plugins/onscreen-keyboard/BUILDING.md` §7,
    including what was tried and dropped: a `setTimeout`-deferred default
    for the activation race, deleted as a race dressed as a design; and
    testing a panel with no DOM by reading the element's props rather than
    reaching for a renderer.
- **Slice 4a — core actions by id (2026-09-14, in-house).** The App's
  key dispatcher is a table. `apps/editor/src/host/actions.ts` holds the
  mechanism — an ORDERED list of steps: *rules* (`id`, an event-only key
  predicate, a state-only `when`, a body returning handled / declined /
  fallthrough, a preventDefault flag), *gates* (no caret, the shortcut
  editor open: everything below is consumed) and *modals* (the accidental
  picker and the two text lanes own the keyboard and get the raw event) —
  and `App.tsx` installs the steps in the old if-chain's order, because
  that order is behaviour: plain `p` is a hairpin over a run and a
  dynamic on one note, `m` a grace cycle over two notes and a merge
  otherwise, `s` an accidental on the just-entered note in input mode and
  on the edit targets outside it. A physical press walks the table;
  `run(id)` walks the SAME table without the key — gates and active modals
  stop it where they stopped the key, and the first rule with that id
  whose condition holds runs — so an input surface reaches exactly what a
  key reaches, and never more. Every locked physical and system key now
  has an id (`undo`, `redo`, `zoom.*`, `file.save/saveAs/open`,
  `clipboard.copy/paste`, `measure.insert/delete/duplicate`,
  `entry.toggle`, `volta.1–9`, `finger.1–5`, `finger.add.1–5`,
  `fingerChange.1–5`, `duration.1–7`, `pitch.a–g`, `chord.a–g`,
  `dynamic.f/p`, `duration.shorter/longer`, `nav.*`, `select.left/right`,
  `transpose.*`, `edit.delete/backspace/escape`), listed in
  `packages/api/src/actions.ts`. Plugin bindings stay the last resort for a
  KEY and are never reached by `run(id)` — their commands run through the
  registry. **The api grew `ctx.keymap` (the union keymap as data) and
  `ctx.actions.run(id)` as the brief listed, plus `ctx.actions.ids()`** —
  one member beyond the brief's letter, added so a projection can check
  its buttons against the live id list instead of trusting a comment; the
  user was told. `@battuta/api` is 0.1.1 (the bump the new rule demands;
  the reflection plugin's `^0.1.0` still holds). `App.tsx` **3,274 →
  3,241** (−33): the handler went from 890 to 857 lines with the bodies
  kept verbatim and the matching moved into rules; the bodies leave with
  their slices. Initial chunk 597.4 → **600.0 kB** (ceiling 605.5 — 5.5 kB
  of headroom left; slices 7 and 8 are where it drops). Tests: 6 for the
  table (order, fall-through, declined vs handled, gates and modals for
  both paths, the plugin fallback, `ids()`), editor 107, api 17, plugins
  32, core 226; the union keymap snapshot byte-identical; **all six
  browser scripts green, 371 checks**, and the shell smoke 6/6. One
  e2e helper was hardened on the way: Phase 4's `clickEvent` retried a
  missed caret wait but not a click whose `<use>` a tile re-render had
  just detached, which killed a run under load — it now retries both;
  assertions unchanged. Slice 4b, the keyboard plugin, is the first
  consumer: its buttons run ids, its latched modifiers select the variant
  id, and it needs no service.
- **Slice 4 attempted and rolled back; the contract hardened a second
  time (2026-09-14).** A context-free agent extracted the on-screen
  keyboard. Every gate was green — typecheck, 73 editor + 44 plugin + 32
  reflection + 17 api tests, the budget at 591.6 kB, the five e2e
  scripts byte-unchanged, a new 24-check e2e written first — and the
  code was rolled back to `fb81f99`, because the slice **changed what
  the rules permit as it went**: a new host service (`KeyboardService`,
  `host/keyboard.ts`) whose `press()` forged `KeyboardEvent`s on
  `window` so a plugin could reach every branch of the key handler
  including ctrl+s and ctrl+o; `keyMatches` and `KeyBinding` moved out
  of the editor into the api; a new contribution kind
  (`contributes.slotItems`), a new activation-event kind
  (`onSettings:`), a new context field (`activatedBy`), a `keyboard`
  capability and a `registerSurface` nothing consumed — **fourteen api
  exports** regenerated with slice 3's `--unpublished` flag, in a slice
  whose brief named one; a new binding (`alt+k`) in an extraction; and
  `packages/plugins/README.md` widened to say a slice may add "a new
  host service module". The first attempt at slice 2 broke a rule and
  nothing objected; this one broke none. The real finding was misnamed
  at hour one — *the host cannot run a core action by id* became *the
  plugin needs to press keys* — and a missing host abstraction turned
  into a plugin requirement that api could satisfy. The account (the
  agent's own, written before the rollback) and the review are one file,
  `packages/plugins/onscreen-keyboard/POSTMORTEM-2026-09-14.md`.
  **Measures, all in place:** every slice brief carries *API may grow*
  (the exact exports; none means none) and *Stop when* (an open slice
  with a written gap is a success); host slices are in-house, plugin
  slices never add a host module; `apps/editor/test/host-boundaries.test.ts`
  fails any `dispatchEvent` / `new KeyboardEvent` / `MouseEvent` /
  `PointerEvent` in the host or a plugin, and holds the host's module
  list as an allowlist; `apps/editor/test/keymap-snapshot.test.ts` pins
  the union keymap (core ∪ plugins, both layouts) to a committed file so
  an extraction cannot add or move a binding (`npm run keymap:snapshot`
  is the deliberate way); `api-report.mjs` lost `--unpublished` — an
  approved surface change gets a patch bump even while unpublished, and
  the script says whose decision it is; the conventions gained a third
  "read this first" (the ceiling and the stop), the rule that the rule
  files are the user's during a slice (rewritten twice now), "name the
  consumer of every addition", and "ask what the feature needs the
  editor to DO, not what its code CALLS". **Kept from the attempt:**
  `spikes/verify-onscreen-keyboard.mjs` (24 checks, the panel driven by
  tapping — written first, as the brief demands; its two
  design-dependent hooks restored to the in-App panel, every assertion
  the same); the traps (activation runs before the command handler that
  caused it; a stateful panel subscribes rather than being refreshed; a
  moved component loses its own positioning; `i` enters, `Insert`
  toggles; Rollup settles a shared dependency — React this time — inside
  the first plugin chunk that imports it, found with a `generateBundle`
  hook, not grep); the `vkeys` settings-migration idea; and the
  manifest-declared entry point as a proposal the user decides. **The
  plan changed:** slice 4 is now **4a, core actions by id** (host,
  in-house: the dispatcher becomes a table, every locked key gets an id,
  the api grows exactly `ctx.keymap` and `ctx.actions.run(id)`) and
  **4b, the keyboard plugin** (buttons run ids, variants are ids, the
  piano is slice 3's virtual input; its brief's *API may grow* is the
  entry point alone, in the form the user picks first).
- **Slice 3 — MIDI is a host service (2026-09-14).** The first
  "platform capability with a browser backend and a shell backend,
  consumed by features" lives in the host: `MidiService` on the api
  (`packages/api/src/midi.ts`) — `inputs` (a store: hardware ports
  deduped by name and hot-plugged, then registered virtual inputs),
  `onNote` (one stream for every input), `registerInput(name)` (a
  virtual input the service routes like a device), `openOutputs()` (every
  output at once, or null so the caller falls back to audio) — implemented
  in `apps/editor/src/host/midi.ts` over two backends that are the old
  code moved, not rewritten: Web MIDI (inputs deduped with the duplicate
  port DETACHED, `onstatechange` re-attach, outputs deduped) and the
  shell bridge (`midi-devices` / `midi-note` events, `midi_open_outputs`
  / `midi_send` / `midi_close_outputs`). `midiOut.ts` became
  `host/midiSink.ts`: `MidiSink` implements the api's `MidiOutputs`
  (`schedule`, `send`, `panic`, `close` = panic then hand the ports back —
  the shell retracts its virtual "battuta" source). Consumers now: the
  entry path (subscribes to the note stream), the status-bar indicator
  (`inputs`, hardware only), the play sink (`openOutputs`). **The
  on-screen piano is a virtual input** named "on-screen piano" — the same
  door as a hardware controller, two slices before the panel itself moves
  — and so is the e2e hook: `__MIDI_NOTE__` feeds a virtual input "e2e",
  `__MIDI_DEVS__` the service's test seam (`injectDevices`), so
  `verify-phase4` now exercises the service's path. Decisions: virtual
  inputs are listed with `virtual: true` and the indicator counts
  hardware only, so opening the on-screen keyboard never reads as "a
  device connected" (behaviour-neutral); note events carry their
  `source` port name (the bridge, which has none, says "shell" with
  velocity 100); the host offers the `midi` capability
  (`OFFERED_CAPABILITIES`), so a manifest may require it; the api stays
  0.1.0 — never published — and `api-report.mjs` gained `--unpublished`
  to rewrite the report under an unchanged number, documented in the
  api's README and to be dropped once a version ships. `App.tsx`
  **3,321 → 3,274** (−47): Web MIDI access, the bridge listeners and the
  device-list state left; it no longer names `requestMIDIAccess`,
  `midi-devices` or `midi_close_outputs`. Initial chunk 595.1 →
  **597.4 kB** (ceiling 605.5): the backend seam costs ~2 kB the inline
  code did not. Tests: `midiOut.test.ts` grew from 7 to 16 (both
  backends, hot-plug, detached duplicates, parsing, virtual inputs, the
  seam), `host.test.ts` 21 (a plugin's virtual input reaches the host's
  stream and vanishes with the plugin), editor 95 total; api 17, core
  226, plugin 32. e2e: all five scripts green, 347 checks — phase 4 (the
  MIDI entry path, now through the virtual input) and phase 5 (the
  indicator) are the ones this slice touches. **The shell smoke ran on
  macOS for the first time**: `verify-tauri.sh` needed GNU `timeout`,
  which macOS lacks (recorded twice as an unfixable gap) — it now falls
  back to a background run + kill, and all six checks pass: embedded
  assets, native save, the bridged device list reaching the indicator,
  the bridged note reaching the editor, the launch argument.
- **Slice 2 — the reflection cycle is a plugin (2026-09-14).** The first
  real one. `shift+R` on a block — prime → inversion → retrograde →
  retrograde inversion → prime — left `App.tsx` for
  `packages/plugins/reflection`, and the serial-form maths left
  `@battuta/core` with it. `core/reflect.ts` split along the line between
  document and feature and became `core/pitches.ts`: core keeps
  `collectPitchEvents` and `SetPitchesCommand` (any pitch feature needs
  them), the plugin took `reflectionForm`, `REFLECTION_CYCLE`,
  `REFLECTION_LABELS` and `arityPalindromic` (no MEI knowledge, and they
  exist only because this feature does — core ships in the initial chunk,
  so leaving them there would have cost every user their weight at launch
  and "turn it off" would have unloaded nothing). `SetPitchesCommand`'s
  default label is now `"set pitches"`, not `"reflect"`; every caller
  passes its own, so nothing observable changed. **`@battuta/api` needed
  no change and stays at 0.1.0** — `api-report.d.ts` unchanged — which is
  the result this slice was run to get: the surface designed on 2026-09-14
  (a `DocumentInfo` snapshot with an `id`, `query.pitchEventsIn`,
  `query.blockOf`, `core.setPitches` as a message) was exactly enough to
  rebuild the feature with zero core imports, where the first attempt
  needed two API changes and three. The plugin keeps the cycle's base
  capture in memory keyed on `DocumentInfo.id`, writes no settings and no
  storage key, and puts nothing in the document but pitch attributes.
  Bundle: `plugin-reflection` is a **1.99 kB lazy chunk** and the budget
  check passed on the first build (slice 1's `manualChunks` fix held —
  the first attempt's two chunking failures did not recur). The initial
  chunk went the *other* way, 592.8 → **595.1 kB** (ceiling 605.5): with
  no plugin registered the host measures 593.2 kB, so **registering the
  first plugin costs ~1.9 kB** — its manifest is in the initial
  `battuta-shared` chunk by design, plus the dynamic-import glue — while
  the feature code it removed was about a kilobyte. Worth stating as a
  rule: the per-plugin cost to the host is fixed and the saving scales
  with the feature, so an extraction this small is a wash; slices 7 and 8
  (Tone.js, the 4.6 MB Humdrum build) are where the ceiling drops.
  Decisions: plugin packages need **no vitest config** (vitest's defaults
  already find `test/**`, and `vitest/config` is not an import a plugin
  may have — the file was deleted rather than the rule widened) and use
  **extensionless relative imports** (a plugin is consumed as raw
  TypeScript by Vite, which does not remap `.js` → `.ts`; `tsc --noEmit`
  accepts both, so the mistake would have failed only the production
  build). Dead ends, in `packages/plugins/reflection/BUILDING.md` §7: a
  test duplicating the host's rebind-survives-off/on guarantee (deleted —
  it is the host's, `host.test.ts` pins it, and making it run here needed
  a `localStorage` shim); asserting the plugin's pitch targets through the
  host (the command's targets are private and applying one needs core —
  the maths, the write and the mapping are each tested where they live,
  and an empty query pins the base's source negatively); content
  comparison instead of a version counter, still rejected as not
  behaviour-neutral. Two surfaces keyed by the moved id needed fixing, and
  only one had a test: `virtualKeys.ts`'s `MOD_VARIANTS`/`SHORT` entries
  became `battuta.reflection.cycle` and `displayLabel` now **skips a
  variant the live keymap does not carry** (with the plugin off, the
  shifted rest key went on captioning "reflect" for a key that does
  nothing — the exact bug the first attempt shipped); and
  `docs/scripts/build-keymap.mjs`, which reads `keymap.ts` alone, silently
  dropped `shift+r` from the generated keyboard reference — it now reads
  every plugin manifest too and marks contributed rows, since the plugin's
  README points readers at that reference. `virtualKeys.test.ts` resolves
  the variant rules against the **union** keymap (core ∪ contributions,
  merged by the host's own store); the full union *coverage* test is still
  slice 4's. The `--no-plugins` property now has a real plugin to be off,
  pinned in the plugin's own suite. Verification: 32 plugin tests, core
  226 (its reflection cases rebuilt around a diatonic shift, case 33 of
  the property fuzzer included), editor 85, api 17, and **all 347 browser
  e2e checks green across the five scripts** — `verify-phase5.mjs` drives
  the whole cycle, four presses, byte-identical return and the four-step
  undo unwind, unchanged, which is what proves the extraction
  behaviour-neutral. `spikes/verify-tauri.sh` did **not** run: it needs
  GNU `timeout`, which macOS does not ship (neither `timeout` nor
  `gtimeout` on PATH) — the same environment gap the 2026-09-12
  post-mortem recorded, still unfixed; nothing in this slice touches Rust.
  Docs: the plugin's `README.md` and `BUILDING.md` (the worked example
  later plugins copy), a new **Writing a plugin** reference page walking
  through it, the `reference/plugins` row, DESIGN.md's host-and-plugins
  note. `App.tsx` **3,364 → 3,321** (−43: the `reflect` branch and the
  `reflectCycle` ref).

- **Plugin contract hardened after the first slice-2 attempt (2026-09-14).**
  A context-free agent built the reflection plugin on 2026-09-12: 31
  tests, all e2e green, 1.2 kB lazy chunk — and it imported
  `SetPitchesCommand`, `collectPitchEvents` and a helper from
  `@battuta/core`. Asked about rule 1 of `packages/plugins/README.md`
  ("everything through `@battuta/api`") it rewrote the rule twice to fit
  the code; nothing in the toolchain objected at any step. The plan's
  "no extension-host process yet" was also read as "no command
  messages". The code was rolled back; the agent's own post-mortem
  (`packages/plugins/reflection/POSTMORTEM-2026-09-12.md`, §7) named the
  two things missing, and both exist now. **`@battuta/api` is
  standalone** (still 0.1.0: that number was never tagged or published,
  only handed to one agent, so the surface changes under it): no import of core or the editor; `CaretPosition`,
  `BlockSelection`, `Pitch`, `PitchEvent` are the api's own plain types;
  `ReadonlyDocument` (which handed every plugin the live `CoreScore` and
  `EventIndex`) is replaced by a `DocumentInfo` snapshot with a document
  `id`, and by a **query facade** — `ctx.query.pitchEventsIn(block)`,
  `ctx.query.blockOf(ids)` — answered by the host from the model as
  data. **Commands are data**: `ctx.execute({ type: "core.setPitches",
  targets, label })`; the host's `toCommand` is the only place that
  knows the core command, copies the plugin's data, and throws on any
  type it has not published. `PluginEntry.load` now resolves a module
  namespace (what `import()` returns) — a slice-1 bug the attempt hit.
  Vite names a `battuta-shared` chunk for core, api and every plugin
  manifest (the attempt's two chunking failures: Rollup settled core
  inside the plugin chunk, then folded an unassigned manifest into it).
  **Hard rules with teeth**: `apps/editor/test/plugin-boundaries.test.ts`
  fails CI on any plugin import outside `@battuta/api`/react/its own
  files (static, type-only, re-export, dynamic), any workspace
  dependency but the api, a manifest importing plugin code, DOM globals,
  or a missing README/BUILDING heading — verified against inline samples
  so it works before the first plugin exists, then scans every package.
  Decisions recorded for slice 2: plugin packages export `src/` (no
  build, no prepare); the reflection maths leaves core for the plugin
  (no MEI knowledge → the plugin's); core keeps `SetPitchesCommand` and
  `collectPitchEvents`; no fuzz harness leaves core (plugins define no
  commands). Side effect: the api's prepare no longer needs to order
  itself after core — `scripts/prepare.mjs` from the packaging fix is
  gone. The api's `README.md`, `packages/plugins/README.md` (a "read
  this first" on the two misreadings, a data-contract table, the rules
  table with their enforcer), PLANNING.md (host API, slice 2 brief,
  risks, progress) updated. `App.tsx` 3,363 → 3,364 (the
  document snapshot has more fields than the model mirror had).
- **Fresh-clone install fixed (2026-09-12, found by CI on the slice-1
  push).** `npm ci` runs every workspace's `prepare`, and npm does not
  order them by dependency: on the runner `@battuta/api`'s `tsc` ran
  before `@battuta/core` had a `dist/`, so the api's declarations could
  not resolve core's types (`TS2307: Cannot find module '@battuta/core'`).
  Locally it passed only because core was already built. The api's
  `prepare` is now `scripts/prepare.mjs`: build core first when its dist
  is missing, then emit — idempotent, and the same `npm ci` works on a
  fresh machine. Reproduced by deleting both dists and running the api's
  prepare alone, then with a full `npm ci`. Plugins avoid the whole class
  of problem by pointing their `exports` at `src/` (no prepare), the
  default `packages/plugins/README.md` recommends.
- **The browser e2e scripts pass again — 347 checks, five scripts, all
  green (2026-09-12).** Three causes, none of them the host. (1) The
  hand-made fixture `fixtures/synthetic-context-changes.mei` had been
  OVERWRITTEN on this machine by a score saved from the app (`bt-` ids,
  twelve measures) and the folder was gitignored, so the loss was
  invisible; every script addresses that fixture by id (`cc-m2n1`).
  Reconstructed from the scripts' own assertions — ten measures, c4+e4
  halves then a whole g4, a slur and a tie crossing m1→m2, four sharps
  from m3, a whole b4 in m4, a tenor clef on staff 2 from m5, 6/8 from
  m7 — with the constraints listed in its header comment, and now
  COMMITTED (`.gitignore` keeps ignoring the corpus, which
  `spikes/fetch-fixtures.sh` downloads from sample-encodings; see
  `fixtures/README.md`). (2) UI removed in 0.0.2 that the scripts still
  drove: the demo-file `<select>` (now the hidden file input, as "open
  file…" uses), the header `+m`/`−m` buttons (numpad keys), the header
  save (menu), and the perf HUD that is off by default — all behind a
  shared `spikes/lib/e2e.mjs` (`openFixture`, `menuClick`, `setPerf`,
  `setLayout`, `clickFirstNote`). (3) 0.0.3's own moves: repeats on
  alt+r (three places), the layout default following the browser
  locale (the AZERTY block now selects the layout explicitly), and one
  semantic drift — a meter change is score-wide from its measure on, so
  the "succeeds on an empty measure" check inserts the measure at the
  END of the score instead of after m1, where the full 4/4 measures
  behind it rightly refuse 3/4. One check was loosened on purpose:
  ctrl+o now asserts the app clicked its hidden file input, with
  Chromium's chooser dialog best-effort (headless builds differ). The
  identical-before-and-after comparison that closed slice 1 stands; the
  gates are now real: app 18, phase 2 20, phase 3 21, phase 4 67,
  phase 5 221. `verify-core-tiles.mjs` (core-level, reads the same
  fixture and the four corpus scores) passes as well.
- **Slice 1 — Host skeleton, closed 2026-09-12.** `@battuta/api` 0.1.0:
  the manifest (id, `engines.battuta`, activation events, capabilities,
  `commands` + `keybindings` contributions), the plugin context (stores
  over the document and the editor state, `execute`, `registerCommand`,
  `notice`, `confirm`, settings and storage namespaces, slots, panels,
  `subscriptions`), `validateManifest`, `satisfiesEngine` (npm caret
  semantics, no dependency) and `DisposableStore`. Its public surface is
  snapshotted in `api-report.d.ts` — generated through the compiler API
  so a stale `dist/` cannot mask a change — and a test refuses a changed
  surface without a version bump. The host lives in
  `apps/editor/src/host/`: a registry that validates, refuses an
  unsatisfied API range or a missing capability, keeps a failed plugin
  LISTED with the reason, applies declarative contributions at
  registration and loads code only on an activation event (pressing a
  contributed key fires `onCommand:` implicitly); the keymap as a
  reactive store (core ∪ contributions; a rebind of a plugin key lives
  in the same per-layout override blob and survives off/on); `header`,
  `statusBar` and `menu` slots plus bottom/side panels that render
  nothing while empty; notice, confirm, per-plugin settings (inside
  `battuta.settings.v1` under `plugins`) and storage
  (`battuta.plugin.<id>.v1`); `execute` bound to the active session with
  the same `afterCommand` as every core edit; a **Plugins tab** in the
  🌣 editor with a persisted switch, and `?plugins=off` for a session
  with nothing registered. Decisions: the host is a module singleton
  (no React context, nothing for StrictMode to double-create); plugin
  keys are dispatched only after the core key chain falls through, so a
  plugin can never shadow a core key; the host offers no capabilities
  yet (`midi` arrives with slice 3); the **bundle budget** covers the
  HTML entry's static JS+CSS closure — workers and dynamic imports
  excluded — measured at 592.8 kB (607,010 bytes), ceiling 620,000 in
  `apps/editor/budget.json`, and every `packages/plugins/*` module is
  forced into a `plugin-<name>` chunk so a leak into the host fails by
  name. Dead end: class stores handed to `useSyncExternalStore` as bare
  method references lost `this` and no tile rendered — `useStore` wraps
  the calls and the class stores bind `get`/`subscribe` as arrow
  properties. `App.tsx` 3,330 → 3,363: the confirm/invoke helpers and
  the keymap loading left; the bridges (document/editor mirrors,
  executor, notices), four slot mounts and the Plugins-tab props came
  in. The count starts falling with slice 2. Tests: 15 host tests
  (registration rules, lazy activation, off/on with every disposable
  firing, the no-plugins property, namespaces) and 17 API tests; CI
  gains the api suite, a production build and the budget check. Docs:
  `packages/plugins/README.md` (where things are, package anatomy, the
  ten rules, verification, the README/BUILDING templates), a
  `reference/plugins` page in the guide, the DESIGN.md note extended.
  **Finding — the e2e scripts do not pass at HEAD on this machine,
  before or after the slice**: `verify-phase2.mjs` selects the demo-file
  dropdown removed from the web build in 0.0.2; `verify-app.mjs` fails
  three content checks and times out on page view; phase 3 fails the
  block drag, phase 4 three entry checks, phase 5 stops at a fixture id.
  Run one at a time against pristine HEAD and against this tree
  (bundled Chromium), the five scripts produce IDENTICAL PASS/FAIL
  sets — that identity is this slice's behaviour-neutrality evidence.
  The scripts also hardcoded one Linux machine's paths; they now take
  `BATTUTA_ROOT`, `CHROME` (`bundled` = Playwright's Chromium) and
  `SCRATCH`, defaults unchanged. Repaired the same day — the bullet above.
- **Slices reworked to run one at a time, each a complete brief
  (2026-09-12).** The eight slices became ten: the MIDI service leaves
  the host skeleton as its own slice (nothing needs it before the
  on-screen keyboard, and a host-service extraction should be judged on
  its own), and the lanes become two slices (lyrics defines the point,
  harmony confirms it and deletes the old path). Every slice now
  carries the same six blocks — delivers, proves, leaves `App.tsx`,
  gates, documents, done when — so a fresh session, person or agent,
  can take one slice plus the previous plugin's `BUILDING.md` and
  start. A slice closes on its documents, not its code; the next does
  not open before. Estimates are the original ones, shared across the
  split halves.
- **Every plugin ships two documents (2026-09-12).** `README.md` — how
  to use it — and `BUILDING.md` — how it was built: origin, manifest,
  API surface, state, commands, tests, dead ends, recipe, under fixed
  headings so two plugins read side by side. The second is written for
  the next author, human or agent; the reflection plugin (slice 2) is
  the worked example the "Writing a plugin" guide walks through, and
  the docs drift check will fail a `BUILDING.md` missing a heading.
  The templates land in slice 1 (`packages/plugins/README.md`).
- **DESIGN.md annotated ahead of the phase (2026-09-12):** a *Host and
  plugins* note in the architecture overview (core → command → host →
  plugins; render and interaction become host services) and one-line
  notes on every section that becomes a plugin — the overlay hook,
  conversion, the on-screen keyboard, playback, reference layers, OMR.
  The full section is written at the phase exit from those notes.

## 0.0.3 — 2026-09-12 (Phase 8 — Quality of life)

**Plan** (Phase 8, opened 2026-09-05; moved here from PLANNING.md).
Defer the two research phases and serve the request stream instead:
triage what users ask for by size — S ships in this round, M gets its
own slot, L becomes a phase — and ship the S/M items as 0.0.3.

**Exit criteria (met):** every triaged request shipped, each with tests
in the suite that guards its area, docs updated (user guide, and
DESIGN.md for anything architectural), and the decision trail below.

**The triage, as it closed** — ten requests, all shipped:

| | Request | Shipped as |
|---|---|---|
| S | 6/4 time signature | the meter list |
| S | numpad 0 enters a rest | input mode (NumLock-off included) |
| S | a duration change clears the dot | alt+←/→ *and* the digits 1–7 |
| S | repeats usable in input mode | alt+r, plus lone end repeats 𝄇 |
| S | the dirty-close alert is invisible in the shell | native confirm dialogs |
| S | transpose the MIDI | ±12 st on sends and the playback export |
| M | mouse-free context bar | F6, arrows, live-applying cycles |
| M | group/ungroup staves | shift+G, none → brace → bracket |
| M | lyrics | one verse, MuseScore-style typing |
| M | playback to MIDI devices | the MIDI checkbox and its sink |

Two more fixes came out of testing those rather than from a request:
page view clipping staff-group symbols, and macOS Option-composition
breaking every alt binding (alt+b auto-beam had been dead on Macs).

- **Phase 8 closed, Phase 9 opened (2026-09-12).** With the round's
  requests shipped, PLANNING.md opens **Phase 9 — Extension
  architecture (v0.1.0)**: features that would weigh the editor down
  become plugins and the editor becomes a host. The evidence is this
  round's own shape — the requests split cleanly into quality-of-life
  fixes that belong in the core and features that every user would
  carry whether or not they use them, while `App.tsx` grew to 3,300
  lines with a 33-branch key dispatcher and 81 hooks. Bundle weight is
  already handled lazily (the piano, the Humdrum converter); the host
  is what needs protecting. The model is VSCode's, cut down: manifest
  contribution points, activation events, and a narrow versioned
  `@battuta/api` — no extension-host process, no marketplace, third
  party deferred. **Phases 6 and 7 fold into it**: reference layers
  become the overlay slice (and its exit criterion), OMR follows as the
  second overlay plugin. Live file watching, open since 0.0.2, ships
  inside the folder-view slice.
- **Repeats moved to alt+r, usable in input mode, and lone end repeats**
  (request: "repeat only works with input mode off"). alt+r on a block
  still pairs 𝄆 𝄇; with NO selection it toggles an END repeat 𝄇 on the
  caret's measure (`ToggleEndRepeatCommand`, prior barline restored on
  revert). Playback needed NOTHING: probed that Verovio's timemap
  auto-expands a lone rptend by looping to the top (m1 m2𝄇 m3 plays
  m1 m2 m1 m2 m3), and battuta's own expansion initializes repeatStart
  at 0 so volta/jump scores behave identically — pinned by an expansion
  test and an e2e play-through (22.5 s → 26.5 s with the repeat).
  Found & fixed underneath: macOS composes Option+letter into a symbol
  (alt+r → "®"), so alt bindings on plain letters never matched on Macs
  — `keyMatches` now falls back to the physical key code for alt
  bindings, which repairs alt+b auto-beam on macOS too.
- **MIDI transpose** (request): a ±12-semitone select beside the MIDI
  checkbox shifts the MIDI SENDS and the playback-MIDI export by the
  chosen offset — the built-in piano is never transposed. Applies LIVE
  (the schedule reads it per attack; each attack's note-off carries the
  same shifted pitch, so a mid-playback change can never strand a note),
  clamps at the MIDI range with on/off kept paired, persists in
  settings.
- **Playback to MIDI devices** (request): a MIDI checkbox in the player
  row routes play to EVERY connected MIDI output instead of the sampler
  — same timemap, expansion, tie merging and gates, so the wire carries
  the player's exact interpretation, and the highlight still follows
  (the transport keeps timing; the 2 MB piano never loads in this mode).
  One `MidiSink` covers both environments: Web MIDI outputs in browsers,
  a new midir OUTPUT bridge in the shell (`midi_open_outputs`/
  `midi_send`, ports deduped by name like the inputs). Sends are
  timer-scheduled with every sounding note tracked, and `panic()` —
  wired into pause, seek, tempo change, stop and sink swaps — cancels
  what is pending and releases what sounds, then sweeps with CC 123: an
  external synth can never be left hanging. No outputs → notice + audio
  fallback; the choice persists in settings.
  - **Follow-up (midi-sink couldn't hear us)**: sending to destinations
    only reaches apps that EXPOSE an input port; consumer apps that
    LISTEN to sources (midi-sink connects to every input port the way
    battuta itself does) heard nothing. The shell now also publishes a
    virtual SOURCE named "battuta" while MIDI mode is on — listeners
    pick it up like a hardware keyboard — retracted on uncheck
    (`midi_close_outputs`), excluded from battuta's own input bridge
    (feedback loop otherwise), and not on Windows (WinMM has no virtual
    ports). Verified with a standalone listener probe: the source is
    visible beside the hardware keyboard and delivers byte-identical
    events.
- **Confirm dialogs were invisible in the shell** (request: the
  dirty-close alert never appeared). Root cause: wry does not implement
  the webview's confirm panel — `window.confirm` is a SILENT NO-OP that
  returns false — so all three guards misbehaved in the shell: a dirty
  tab could never be closed, a mismatched paste silently refused, and
  the external-change save guard silently cancelled. Every confirm now
  routes through `confirmDialog`: a native rfd OK/Cancel dialog in the
  shell (`confirm_dialog` command), the built-in modal in browsers, and
  the async refactor keeps the browser e2e behavior byte-identical.
- **Page view clipped staff-group symbols** (found testing the groups):
  braces/brackets overhang the system's left edge, and the page viewBox
  was cropping them. Root cause predates the feature — Verovio's
  `setOptions` MERGES, so switching tile → page kept the tile mode's
  sticky `adjustPageWidth/Height: true` and zero side margins; the page
  was silently content-cropped all along. PAGE_OPTIONS now counters the
  tile stickies explicitly (adjustPage* off, 10 mm margins all around),
  so page view renders the full page with honest margins.
- **Lyrics lane** (request; design decision: one verse, MuseScore-style
  typing): `l` at the caret (or the harmony select) opens a lane in the
  harm-lane mechanism — space/enter commits the syllable and advances to
  the next NOTE (rests skipped), `-` commits with a hyphen and the word
  position (i/m/t + con="d") is derived from the previous note's state,
  arrows commit and move, esc commits and leaves. Syllables are
  `<verse n="1"><syl>` INSIDE the note (unlike harm's startid anchor),
  so tiles, copy/paste and undo carry them with the note for free;
  chords anchor on their first note (universally rendered). Un-defers
  lyrics from the deliberate-deferral list; verse 2+, melisma extenders
  and figured bass stay deferred.
- **Group/ungroup staves** (request; design decision: one gesture):
  shift+G on a block spanning staves cycles the group symbol none →
  brace → bracket → none (`CycleStaffGroupCommand`), bar.thru following
  the symbol. An exact-match existing group (the scoreDef's root
  included) is restyled in place — the root is never unwrapped, only
  cleared; wrapping requires adjacent sibling staffDefs, and a range
  crossing an existing group refuses. Byte-identical revert through the
  whole cycle.
- **Mouse-free context bar** (request; design decision: F6 + live
  cycling): F6 focuses the status bar, ←/→ rove between the selects,
  ↑/↓ on the value selects (clef/key/meter) cycle AND apply — each step
  is one undoable command, so browsing key signatures by ear is safe —
  while on the action selects (staves/voices/harmony) they open the
  picker; esc returns to the score. Keyboard-driven changes skip the
  selects' blur-on-change (a ref-guarded exception), so focus stays in
  the bar; the mouse path still releases focus, which the e2e suite
  asserts.
- **First request batch triaged (2026-09-05)** — six requests into
  PLANNING.md's Phase 8 list: three S (shipped below), three M
  (mouse-free context bar; group/ungroup staves; a lyrics lane in the
  harmony-lane mechanism — which un-defers lyrics from the deliberate
  deferral list, syllables first).
- **Duration change clears the dot** (request, both halves): alt+←/→ on
  an existing note used to carry the dot onto the new value, and the
  duration DIGITS (1–7) kept the pending dot for the next entries —
  both surprised more than they helped. A new base value now starts
  plain in both paths (entry state synced; re-dot with the dot key).
- **Numpad 0 enters a rest** (request): the numpad digits already set
  durations, so 0 completes the row. Probed: with NumLock OFF numpad-0
  arrives as key "Insert" (code Numpad0), which collided with the
  Insert = input-mode toggle — in input mode the code wins and a rest
  is entered; everywhere else Insert still toggles. alt+numpad-0 stays
  the finger-change key.
- **6/4 joins the meter list** (request).
- **Phases 6 and 7 deferred (2026-09-05).** Reference layers and OMR
  correction stay planned but unstarted: the requests arriving since
  0.0.2 — small quality-of-life fixes up to deeper engine changes —
  take priority over opening a research phase. PLANNING.md now leads
  with **Phase 8 — Quality of life (v0.0.3)**, which triages incoming
  requests by size (S ships in 0.0.3, M gets its own slot, L becomes a
  phase); the two research phases keep their entries, marked deferred.
- **DESIGN.md caught up with 0.0.2.** The design document predated the
  score tempo, the on-screen keyboard, format conversion, the session
  safety net and the distribution pipeline; it now describes them at
  design altitude (a conversion layer beside the render layer, the
  keyboard as a keymap projection, persistence/distribution under the
  shell decision) so the next deep-engine request is argued against a
  document that matches the shipped editor.

## 0.0.2 — 2026-08-30

Validated on Linux, macOS and Windows before tagging; the first release
signed on macOS and carried by package managers (Homebrew tap, apt repo,
winget pending its initial manifest).

- **Distribution pipeline.** release.yml signs + notarizes the macOS
  universal build (Developer ID via tauri-action; unset secrets leave a
  fork's build unsigned rather than failing). Publishing a release now
  fans out on its own: a cask pushed to vibetuned/homebrew-tap, a
  GPG-signed apt repository rebuilt into the Pages site at /apt (a
  Launchpad PPA would rebuild from source on their builders — a binary
  repo serves the CI-built deb instead), and a winget version-bump PR
  (first manifest submitted by hand; the job skips until it exists).
- **macOS tofu fix**: the SMP Musical Symbols block (𝅝 𝅗𝅥 𝄆 𝄇 𝄐 𝄪) has NO
  macOS system font, so UI glyphs rendered as black squares — and form
  controls don't inherit font-family, so buttons missed any fallback. A
  35KB Noto Music subset ships in the app (@font-face gated by
  unicode-range, `button/select/input { font-family: inherit }`) and in
  the docs site, which shows the same glyphs in its keymap tables.
- **Windows MIDI dedupe**: a driver that registers the same device as
  two input ports delivered every note twice. Both paths dedupe by port
  name now — Web MIDI's attach (first port wins, duplicates actively
  DETACHED so a rebroadcast can't leave a stale handler) and the shell's
  midir bridge (device list and connections).
- **Build chain**: @battuta/core gained a `prepare` script, so npm
  install/ci builds its dist — a fresh clone's dev/test/typecheck work
  with no manual core build (previously only `tauri build` was covered,
  and the docs had dropped the last mention of the manual step). The
  editor's prebuild uses the workspace idiom, typescript is declared in
  core, and the workflows' explicit core-build steps are gone (npm ci's
  prepare covers them; core no longer compiles twice per CI leg).
- **Import/export for every Verovio-convertible format.** Import:
  MusicXML (plain and zipped `.mxl`), ABC, Plaine & Easie, Humdrum kern —
  all routes (file input, native dialog, double-click launch) convert to
  MEI on open, as a NEW unsaved document so ctrl+s can never overwrite
  the source with MEI. Export (battuta menu): written-score MIDI, SVG
  pages, Humdrum, PAE. The converters run Verovio's HUMDRUM-enabled
  build (+4.6 MB wasm) in a separate worker spawned lazily on first
  conversion — the render pool never pays for it. A pinning test runs
  the real toolkit over a sample of every format in the table, so a
  format promise Verovio can't keep fails CI. Probed: `inputFrom` is
  sticky on the toolkit and POISONS `loadZipDataBuffer` (the zip's inner
  LoadData parses the extracted MusicXML as the leaked format) — every
  worker operation sets its own, with an `.mxl` fixture pinning the fix.
  `.mxl` crosses Tauri IPC base64-encoded; `export_file` writes any
  export bytes through the native save dialog.
- **Playback MIDI export** — the player's SOLVED interpretation as a
  `.mid`, not Verovio's written-score MIDI: expansion (repeats, voltas,
  one D.S./D.C. jump), tie chains merged to single held notes, and the
  articulation/slur gates, generated from the same PlaybackData the
  player consumes. The SMF uses 500 ticks/quarter at 120 bpm so 1 tick =
  1 ms — timemap milliseconds transfer without drift (the score tempo is
  already in them). Tests parse the emitted bytes: one attack per tie
  chain, staccato at exactly half, gates resolved through the
  repeat-pass idMap, off-before-on at equal ticks.
- **Session restore + close confirmation.** The open tabs (full MEI,
  names, paths, dirty flags, active tab) persist to localStorage —
  debounced 1 s after every edit, synchronously on beforeunload — and
  come back on the next start; restored-dirty tabs keep their star via a
  sentinel saved-mark. Closing the app saves the session; a crash loses
  at most the debounce. Closing a DIRTY TAB asks first (clean tabs
  don't). In the shell, a double-clicked file opens alongside the
  restored tabs; dev restores only when unsaved work is at stake, so the
  fixture workflow and e2e determinism are untouched.
- **External-change guard** (shell): a `file_mtime` command records each
  file's modification time at open/save; plain ctrl+s re-checks first
  and asks before overwriting a file another program rewrote.
- **The header, reorganised**: two rows — tabs/views/🎹 on top, the
  score's own title + tempo (and, in page view, the player) below. File
  chores and tools moved into ONE menu under the battuta name (open,
  save, exports, shortcuts, perf numbers, regenerate ids); the +m/−m/⧉m
  buttons retired (numpad and the on-screen keyboard cover them). Perf
  numbers are off by default everywhere (was: on in dev).
- **On-screen keyboard for touch devices** (🎹, auto-shown on coarse
  pointers): a two-octave piano driving the SAME entry path as Web MIDI
  (explicit pitch+octave, multi-touch chords, caret advance on release)
  with an octave rail; sticky ctrl/alt/shift latches with real-keyboard
  semantics (shift uppercases letters and follows each LAYOUT's shifted
  punctuation — `,`→`<` QWERTY but `,`→`?` AZERTY); a four-way digit pad
  (plain = durations, shift = voltas, alt = fingering/finger change);
  and one button per keymap action, GENERATED from the live keymap so
  rebinds and new actions appear on their own. Actions that are a
  modifier away from another key (marcato = shifted accent, tuplet =
  shifted tie, …) have no button — the latch is the button, and keys
  RELABEL live under a latch, tinted where remapped. Coverage tests hold
  the panel against the keymap in both layouts: a keymap action the
  panel can't reach fails CI, and every synthesized event must
  keyMatches its binding.
- **Score tempo** (♩= button beside the title): sets `@midi.bpm` on the
  scoreDef — an undoable command like the title. Verovio's timemap
  follows it, so playback speed tracks the document (the × select
  multiplies on top), and page view engraves a synthesized `♩ = bpm`
  marking over the first measure (copy-on-write at serialization; the
  document tree is only read).
- **Docs + web editor deployed**: battuta.vibetuned.com (Astro guide)
  with the editor at /editor, one Pages workflow building both; the
  editor builds with `--base=/editor/` in CI only. New user-guide pages
  and screenshots for the menu, the on-screen keyboard, imports/exports
  and the safety net.
- **CI tests** (`test.yml`): the core suite and the editor's guard
  tests run on every push/PR; corpus-dependent core tests skip cleanly
  where the local-only fixtures corpus is absent.
- **Page-view score player** (▶ / ⏸ / ⏹ next to the view toggle):
  Verovio's timemap drives BOTH the audio and a moving note highlight
  from one timeline, so they cannot drift. Sound is Tone.js's Sampler
  over a self-hosted Salamander piano subset (~2 MB of mp3, every third
  semitone, embedded in the bundle — no CDN); sounding pitch per note id
  comes from `getMIDIValuesForElement` (Verovio resolves key signatures,
  measure accidentals, and ties), note lengths from the timemap's own
  on→off spans, so held/tied notes sound once for their full span. The
  view auto-scrolls when the playing measure leaves the viewport; any
  edit, tab switch, or view switch stops playback (the timemap is stale
  the moment the document changes). The shell smoke gained a probe that
  decodes a sample through WebKitGTK's gstreamer stack — verified on
  Linux.
- **Playback follows the form** (part 2): plain repeat barlines are
  auto-expanded by Verovio's timemap; voltas and one dal-segno/da-capo
  jump (with optional fine) are synthesized into an MEI `<expansion>`
  from battuta's own repeat knowledge (`buildExpansion` in core — pure,
  volta number-sets like [1,2][3] supported, loopback to `rptstart` when
  present else to the top, the recap takes only final endings; exotic
  forms fall back to unexpanded). Repeated passes play as `-rendN` id
  clones, and the highlight maps every clone back to its notated id via
  `renderToExpansionMap` — that mapping was the missing piece the first
  tester round spotted: audio repeated but the notes stopped lighting.
  Probed behaviors that shaped this: with an expansion active Verovio
  does NOT auto-expand plain repeats (the plist must encode everything),
  and `expansionMap[id][0]` is always the notated id.
- **To Coda** joins the `o` cycle (coda → **To Coda** → segno → fine →
  D.S. → D.C. → off). MEI has no separate func for it — both marks are
  `repeatMark func="coda"` — so the TEXT CONTENT is the encoding: bare
  renders Verovio's 𝄌 glyph (the destination), `>To Coda<` renders the
  text (the jump-out marker). Playback honors the pair: a D.S./D.C.
  recap that reaches the To Coda marker jumps to the 𝄌 sign ("al Coda");
  either mark alone stays decorative. Found & fixed underneath: the
  harmony lane's Tab→Enter could commit the PRE-completion buffer — the
  window key listener re-attaches after React effects, so a fast second
  key hit a stale closure; the handler now reads the buffer through a
  ref. (This was the wandering phase5 "flake" at the harm commit.)
- **Attack intensity** (`I` — shift+i, since plain `i` toggles note
  input): cycles sf → sfz → rinf → rfz → off at the target note. These
  are MEI `<dynam>`s, not articulations, so the volume-cycle machinery
  was generalized (`CycleDynamCommand` takes its text list); one dynam
  per note — an existing volume marking is cleared first, and the same
  applies in reverse. Verovio renders all four with SMuFL dynamics
  glyphs (probed).
- **Tie after tie fixed** (n_n_n): tying the second pair used to
  clobber the shared note's `tie="t"` with `"i"`, orphaning the first
  tie (Verovio drops unmatched halves — it vanished from the page and
  the sound). `ToggleTieCommand` is now chain-aware: the shared note
  becomes `@tie="m"`, and untoggling any link in a chain splits it into
  valid remainders (removing the middle of i-m-m-t leaves two ties).
  Render and playback merge follow automatically.
- **3/2** joins the meter select (common in practice scores). On
  non-empty measures the exact-fit validator still refuses with
  "adjust it first" — by design; set the meter before entering, or on
  whole-measure rests, and it applies freely.
- **The view follows the caret**: when keyboard navigation or note
  entry pushes the caret off-screen, the edit view scrolls it back
  (centered, smooth) — only on real caret moves, never on re-layout or
  zoom ticks, with margins clearing the sticky header and status bar. A
  caret landing in a still-virtualized tile scrolls to its placeholder,
  which triggers the render and completes the follow.
- **One selection model** (tester ask: shift-runs and mouse blocks
  behaved differently): every action now derives the granularity it
  needs from whichever input exists. A shift-run drives measure-shaped
  actions through its bounding measures (voltas, repeat barlines,
  reflection, copy/paste, structural counts); a single-staff mouse
  block drives event-shaped actions through its run (slur, tie chain,
  hairpin, pedal, tuplet, grace pair — edge rests trimmed so span
  endpoints land on notes); transpose/accidentals from a block cover
  every event in it. New behaviors: `r` with a shift-run toggles
  repeats; ctrl+c with a run copies its full measure span.
- **Cross-staff slurs unlocked**: shift-clicking across staves now
  selects an ENDPOINT PAIR (the run model can't span staves), and `S`
  slurs it — `ToggleSlurCommand` accepts cross-staff endpoints and
  writes `staff="1 2"` (probed: Verovio draws them, same-measure and
  across measures). Hairpins accept the pair too; grace-pair and tie
  chain still require one voice and refuse cleanly.
- **Two more stale-closure races fixed** (the harmony-lesson pattern):
  key handlers now read the selection and block through refs, so a
  fast click→key sequence (shift-click an endpoint, immediately press
  S) can't act on the previous selection.
- **Playback respects ties, slurs, and articulations** (tester find:
  tied notes re-attacked). Probed first: Verovio's timemap re-attacks
  tie continuations and its MIDI values neither merge ties nor shorten
  staccato — so the document supplies the truth. New core module
  `playback.ts`: the tie-pair graph (from `@tie` i/m/t chains and
  `<tie>` elements) merges each chain into ONE attack held for the
  summed span (works through repeat-pass clone ids via the expansion
  map), and per-note gates shape the release — slur/phrase spans and
  tenuto sound full value, staccato 50%, staccatissimo 30%, an explicit
  articulation beats the slur, and unshaped notes now get a slight
  detach (90%) so legato is audible by contrast. 7 unit tests + e2e
  plumbing checks.
- **Reflection cycle** (`shift+R` on a block selection): the serial
  forms of the selected material — prime → **inversion** (diatonic
  mirror about each voice's first note) → **retrograde** (pitch content
  reversed over the rhythm skeleton: durations and rests stay put, so
  measures stay valid by construction) → **retrograde inversion** →
  back to prime, byte-identically. Pitch content moves as
  pname/oct/accid triples; each voice in the block reflects
  independently; each press is one undo step. The cycle derives every
  form from the base captured at the first press (version-keyed — any
  other edit re-bases it). Retrograde needs chord sizes to mirror
  (pitches move between events, structure never changes) and is skipped
  with a notice otherwise. Core: `SetPitchesCommand` + pure form math
  in `reflect.ts`, covered by the property fuzzer and 6 unit tests.
- **Toasts get a × dismiss** on their left — close before the timeout;
  as a side effect the toast text is now selectable (error messages get
  copied around), since the whole-body click-to-dismiss is gone.
- **Add staff places the caret**: *add staff below* now lands the caret
  on the new staff's first measure, ready for note entry (selection and
  block cleared; the notice says where it went).
- **Dialogs remember the last folder**: open and save-as start in the
  folder of the last opened or saved score (persisted in settings; the
  shell only applies it when the folder still exists). File-association
  opens seed it too. Tester follow-up: the **"open file…" button** used
  to bypass this entirely — it clicked the hidden browser file input
  even in the shell (WebKit's own chooser, always starting at Home);
  it now routes through the same native open dialog as ctrl+o, keeping
  the input as the browser fallback. The shell also logs the starting
  dir it passes, for future portal debugging.
- **macOS round** (tester findings on an M-series Mac): the `.app`
  launches, file association works; two fixes shipped — (1) **MIDI
  hot-plug**: CoreMIDI posts device-list changes to the run loop of the
  thread that created the MIDI client, and the poll thread only slept,
  so plug/unplug was never seen; on macOS it now pumps a CFRunLoop for
  the poll interval (`core-foundation`, cfg-gated; ALSA/WinMM behavior
  untouched). (2) **Grey dock icon** — root cause found on-device: the
  icns format was never at fault; macOS 26
  re-themes any icon with TRANSPARENT CORNERS as a legacy pre-shaped
  icon, discarding our white card and repainting the black glyph on a
  system tile that is dark grey under the Dark icon style. Fix: the
  macOS artwork is now fully opaque edge-to-edge (`icons/
  battuta-macos.iconset/`, glyph inset ~12%), icns built natively with
  `iconutil`. The dmg's warning-then-installer behavior is Gatekeeper
  on an unsigned image — expected until a Developer ID is added (the
  CI workflow picks up Apple signing secrets when configured).
- **The D.C./D.S. mark now cuts the first pass** (tester find): a
  mid-score da capo used to play through to the end before restarting —
  the base pass now stops AT the jump mark, the material after it (the
  coda) plays only via the To Coda jump, and a recap that walks back
  into the mark without having jumped ends the piece there (no loop).
  Jumps at the very end of the score behave exactly as before.
- **Tempo + progress** (part 3): a tempo select (0.5×–2×, persisted in
  settings) next to the player — live, the schedule rebuilds at the
  current musical position — plus a clickable progress bar with a
  mm:ss / mm:ss readout showing listening time at the chosen tempo;
  clicking seeks (`transport.seconds`, highlights clear and relight).
  `scorePlayer.stop()` is now a pure no-op until something actually
  played, keeping Tone entirely off the editing path.

First feedback round on the installed 0.0.1 (tested on Linux):

- **Title input**: a *title* button in the header opens an inline editor
  for the MEI `<title>` (meiHead/fileDesc/titleStmt — created when a
  file lacks the chain, one undo step). The button itself relabels to
  the current title, and page view now really prints it — two fixes
  underneath: `serializeForPageView` never carried `meiHead`, and the
  page renderer set Verovio's `header: "none"` (now `"auto"`).
- **Toasts**: errors, save confirmations, and refusal notices now show
  as bottom-right toasts (auto-dismiss, click to close) — errors used to
  hide in the perf status line, invisible in the shell.
- **Dirty marker**: tabs show `*` when the document has unsaved changes
  (undo-stack position vs. the last save; undoing back to the saved
  state reads clean again).
- **Row navigation**: `Insert` toggles note input (both directions),
  `Home`/`End` jump to the start/end of the current engraved row,
  `PageUp`/`PageDown` move to the previous/next row keeping the caret's
  staff and voice where possible.
- **Finger changes**: `alt+6..0` writes a change-of-finger on the note's
  existing fingering — `alt+2` then `alt+6` gives `2-1`; the same key
  removes the substitution, a different one replaces it.
- **Separate QWERTY/AZERTY keymaps**: a layout toggle in the shortcut
  editor (🌣) — merged defaults double-booked keys (QWERTY's simile `'`
  is AZERTY's unshifted digit-4, colliding with durations). Each layout
  has its own defaults and its own saved overrides.
- **Persisted options**: keyboard layout and zoom level survive restarts
  (`localStorage`, `battuta.settings.v1`); new documents open at the
  last-used zoom.
- **Drag-selection overlay**: block-selection drags no longer paint the
  native text-selection highlight in WebKitGTK (`-webkit-user-select`
  applied through the SVG content).
- `node spikes/verify-phase5.mjs` grew to 184 checks covering all of it.
- **License**: AGPL-3.0-only — LICENSE file added, declared in every
  manifest (package.json ×3, Cargo.toml, tauri.conf.json bundle).

## 0.0.1 — 2026-08-08 (first release)

First packaged release: Linux `deb` + `AppImage`, app icon, and `.mei`
file association.

- **Bundles**: `npx tauri build` from `apps/editor` produces
  `battuta_0.0.1_amd64.deb` (~6 MB) and `battuta_0.0.1_amd64.AppImage`
  (~81 MB, WebKitGTK bundled). Production builds no longer embed the
  fixtures corpus (vite `publicDir` is dev-only now, ~13 MB lighter);
  the deb declares the ALSA dependency for the MIDI bridge.
- **`.mei` file association** (three pieces, because Tauri's
  `fileAssociations` alone isn't enough on Linux): a shared-mime-info
  package mapping `*.mei` → `application/x-mei+xml`, a custom desktop
  entry template with `Exec=battuta-editor %F` (Tauri's default omits
  `%F`, so file managers would never pass the clicked file), and
  launch-argument plumbing — the shell stores `argv[1]` and the frontend
  pulls it via an `initial_score` command on mount (pull, not push: a
  Rust-side emit would race the webview subscriber, the same trap the
  MIDI indicator fell into). Double-clicking a `.mei` in a file manager
  opens it in battuta. On macOS the same path is fed by the `Opened`
  run-loop event instead of argv.
- **App icon**: generated from `icons/battuta-white.svg` (the ♭ +
  Bussotti-sharps mark on a white card — the transparent variant
  rendered gray in desktop shells) — full Tauri set (32/128/256/512
  png, multi-res `.ico`, real `.icns`) wired into `bundle.icon`.
- **Sticky top bar**: the header (brand, tabs, save/open/⟲id/🌣) stays
  pinned while the score scrolls, solid background, hairline border.
- **Status-bar dropdowns readable in the shell**: WebKitGTK renders
  select popups natively and ignored the dark option colors
  (tauri#11755) — fixed with `appearance: none` + `color-scheme: dark`
  + a data-URI chevron on all six status-bar selects.
- **Startup banner tells the truth**: `tauri build` enables the tauri
  crate's `custom-protocol` feature directly rather than the app's
  wrapper feature, so the old `#[cfg]`-keyed banner mislabeled bundled
  builds as "DEV SERVER"; it now keys on `tauri::is_dev()`.
- Version bumped to 0.0.1 (tauri.conf.json + Cargo.toml); shell smoke
  grew a launch-with-a-`.mei`-argument check (6 checks total).

### Packaging groundwork (2026-08-05 → 08-08)

- **The embedded-asset build renders**: the Phase-0 WebKitGTK blank-webview
  bug is gone with current WebKitGTK/Tauri (verified: `tauri://localhost`
  loads, workers + WASM boot, tiles render). The startup IPC bench is now
  gated behind `?ipcbench`.
- **Native open/save**: `ctrl+o` opens a score through the system dialog
  (XDG portal via `rfd` — native on Wayland), `ctrl+s` saves silently to
  the score's known path, `ctrl+shift+s` (or an unsaved score) opens
  save-as and renames the tab to the chosen file. In browsers the same
  keys fall back to the file input and a download. The *save* button uses
  the same path-aware logic.
- **Native MIDI**: WebKitGTK has no Web MIDI API, so the shell bridges it —
  a `midir` (ALSA) thread connects every input port, streams note on/off
  to the webview as Tauri events, and polls for hot-plug every 2s; the
  frontend feeds them into the exact same pipeline as Web MIDI (status-bar
  indicator, device list, chords, advance-on-release). Building the shell
  needs `libasound2-dev`.
- **Clean shell UI**: the packaged app starts on a fresh blank score (no
  demo fixtures — the fixtures select is dev-only), and all performance
  numbers (render timings, measure/pool stats, per-tile ms labels) hide
  behind a **⏱ toggle** in the header — off by default in the shell, on
  in dev where the e2e suites read them.
- **Shell smoke**: `sh spikes/verify-tauri.sh` (needs a display and
  `libasound2-dev`) — builds the embedded bundle, launches it, and asserts
  the page loads over `tauri://`, tiles render, `save_score` writes real
  MEI to disk, the MIDI bridge delivers a fake device and note into the
  UI, and a `.mei` launch argument opens as the active tab.

## Phase 5 — Polish (2026-08-05 → 2026-08-08)

**Plan.** Preferences, keymap customization, session restore, crash-safe
autosave (command log replay), MusicXML import via Verovio's converter,
export (MEI, MusicXML, per-page SVG/PDF via Verovio), packaging for
Linux/macOS/Windows through Tauri, docs and sample corpus. Only after
real usage: evaluate whether the core's hot paths (context hashing,
duration arithmetic, fragment splicing) justify the Rust/WASM rewrite
behind the existing interface. *(Moved up from Phase 7, 2026-08-02:
keymap customization, autosave, and import/export matter for daily use
now, while reference layers and OMR are the research-heavy phases.
Reference layers and OMR shifted to Phases 6 and 7 unchanged.)*

**Landed:**

- **Status bar** (VSCode-style, bottom): `INPUT (i)` toggles note input on
  click and becomes `1/8 ♪ (4)` while active — current duration, its
  glyph (dot included), and the digit key that selects it, updating live;
  the clef / key / meter selects live here too and always display the
  **context in force at the caret** (clef per staff — stepping onto a
  tenor-clef staff flips the indicator; key and meter score-wide), with
  picking a value still applying the change at the caret's measure;
  `MIDI ><` flips to a green `MIDI <>` with a device count when
  controllers are present (hot-plug aware) and clicking it lists the
  connected devices. A **staves select** sits beside the context ones,
  showing the staff count: *add staff below* appends a treble staffDef and
  an mRest staff to every measure (valid under any meter by construction);
  *remove caret staff* takes out the caret's staff everywhere — its
  staffDef, mid-piece staffDefs, and staff-anchored control events — one
  undo step each, last staff refused.
- **Shortcut editor** (🌣 in the header — the Phase 5 headliner): every
  key binding routed through a **keymap** — the editor lists all ~30
  actions by group with their current keys, click a binding and press the
  new key to rebind (letters carry case, alt carries, shift is explicit
  for symbols), duplicates get a soft amber warning, *reset all* restores
  defaults, and overrides persist in localStorage. Physical-code bindings
  (durations, fingering, voltas) and system chords are listed but locked.
  The old two-line keyboard hint is gone — the editor is the help.
- **Status-bar navigation aids**: a caret position readout right of the
  INPUT indicator — `[ m 10, s 2, v 1, n 6 ]` (measure, staff, voice,
  note) — and a **zoom** button left of the MIDI square replacing the
  header select: click for **+ / − / reset** (50%–250% in 25% steps), or
  use `ctrl +` / `ctrl −` / `ctrl 0` anywhere (browser page-zoom
  suppressed).
- **Random ids + repair**: `newId()` is now random (`bt-` + 8 base36
  chars, crypto-sourced) — counter enumeration kept re-minting ids that
  already existed in previously saved files, and no seeding survives
  every path. For documents that already accumulated duplicates, the
  **⟲id** header button regenerates every `xml:id` with all
  `#references` (startid/endid/plist/…) rewritten to follow — one undo
  step. Saves are now **pretty-printed** (two-space indent; elements with
  text content stay compact so mixed content is untouched; the parser
  drops whitespace-only text, so formatted files reload to the identical
  tree).
- **Fingering** (`alt+1..5`): sets the fingering on the target note or
  chord — rendered by Verovio as a small digit above the staff (`<fing>`
  control events; the same number again removes it, a different one
  replaces it). `alt+shift+1..5` stacks additional fingers (chords,
  substitutions) and removes exactly that number if present. Same target
  rule as the dot — the just-entered note in input mode, else the caret
  note — and matched by physical key, so AZERTY's shifted digit row works
  identically. One undo step each. (`<fingGrp>` is unsupported by Verovio,
  so plural fingering = several stacked `<fing>` elements.)
- **Auto-beam** (`alt+b`): groups the caret measure's eighth-and-shorter
  notes into beams — every measure the selection touches with one press —
  with the longest beam spanning **half the measure regardless of meter**
  (onset decides the half; rests and longer notes break groups; runs of
  one stay unbeamed). Idempotent: existing beams are lifted and regrouped.
  The other half of the policy: **beams are formatting, and rhythm edits
  dissolve them** — entry, duration changes, merge/split, and
  delete-to-rests unbeam their measure *first* (so overwrite entry never
  refuses at a beam boundary) and no broken beams survive; re-beam with
  `alt+b` once the rhythm settles. All one-undo-step, byte-identical
  unwind (the un/re-beam travels with the edit).
- **Single markings** (tester round): **marcato** = the accent key
  shifted (`shift+;` — on AZERTY that's `.`, so the dot keeps its
  unshifted forms `.`/`:` and gains nothing new to learn); **staccatissimo**
  = the staccato key shifted (`<` / AZERTY `?`); **double sharp** = `S`
  with no selection (with a selection `S` is still the slur; on chords it
  opens the per-note picker with 𝄪); **fermata** = `h`; and `w` **circles
  the four ornaments** — arpeggio (chords) → tremolo (`bTrem` wrap) →
  trill → mordent → off. All follow the dot's target rule (just-entered
  note in input mode, else the caret), toggle on repeat, one undo step
  each. The `o` key cycles the full **repeat-mark family: coda → segno →
  fine → dal segno → da capo → off** (all `repeatMark`s).
- **Simile and measure repeats** (the physical `ù`/`'` key): unshifted
  replaces **one beat** at the target with the simile slash (`<beatRpt/>`,
  consuming sub-beat events exactly like overwrite entry, refusing at
  boundaries; the slash toggles back to a beat rest); shifted (`%` on
  AZERTY, `"` on QWERTY) cycles the caret measure's voice through
  **content → `%` (mRpt) → `%%` (mRpt2, claiming the next measure) →
  empty** — the original content returns via undo. The duration model
  knows all three: measure repeats fill their measure, the beat repeat
  counts as an unresolved beat.
- **Block-selection feedback round**: with two selected notes of
  *different* pitches, `m` cycles the first into a **grace note** —
  acciaccatura (slashed) → appoggiatura → none — folding its written time
  into the main note like a merge and giving it back on the way out
  (same-pitch pairs still merge); `P` toggles a **pedal** line over the
  selection (down at the first note, up at the last); and `shift+1..9` on a
  block toggles that **volta number** on the bracket — numbers build up
  into mixes like `[1, 2][3]` (one `<ending n="1, 2">`, one `n="3"`),
  removing the last number removes the bracket, and ranges crossing an
  existing ending are refused. Closing **barlines renormalize across the
  bracket group**: every bracket with a later sibling ends with a repeat
  barline, the last with a double barline — unless it closes the score,
  whose final barline is left alone. Per-measure tiles draw their bracket
  segment, and page view shows the true spanning bracket — its serializer
  now keeps structural containers instead of flattening measures into a
  bare section.
- **Harmony lanes** (the *harmony* select in the status bar): two typed
  annotation lanes over MEI `<harm>` — **chord symbols** above the staff
  and **Roman numeral analysis** below (`@type="rna"`), independent of
  each other. Picking a lane opens a floating editor at the caret with a
  **closed grammar**: only characters that can extend a valid symbol are
  accepted (roots A–G, qualities m/maj/dim/aug/sus/add/alt, Δ/ø/°/±,
  extensions and alterations, slash basses; numerals I–vii with °/ø/+,
  figured-bass inversions 6/64/65/43/42/2, secondary /X, accidental
  prefixes, N6 and It/Fr/Ger+6 — `o`/`0` normalize to °/ø). Live
  validity coloring, **tab autocompletes** from suggestions, **enter
  commits and advances** to the next event, arrows commit and move,
  escape leaves the lane. Editing an event with an existing symbol loads
  it for correction; committing empty deletes it. One undo step per
  symbol, and the annotations ride copy/paste like every control event.
- **Tuplets** (`shift+t` on a selection): 3 selected notes become a
  **triplet** (3:2), 6 a **sextuplet** (6:4) — the run shrinks to its
  tuplet time and the freed duration becomes rests after it, so the
  measure stays valid; a selection inside a tuplet **unwraps** it,
  consuming those rests back (byte-identical round trip). Refuses wrong
  counts, non-consecutive runs, mixed-duration runs whose freed time
  isn't writable, and unwraps without their rests. Rhythm-edit rules
  apply: the measure unbeams first, and members stay caret-addressable.
  This closed the last Phase 4 leftover besides file watching.
- **Multiple voices** (per staff, per measure): a *voices* dropdown in
  the status bar shows the caret's voice, switches between the staff's
  voices, and *add a voice* puts a new layer (whole-measure rests) into
  that staff **from the caret's measure onward** — like clef/key/meter
  changes; at m1 that means the whole score. Mid-piece additions draw
  the engraver's **double barline** at the boundary (existing special
  barlines are left alone). *Remove this voice* takes it out from the
  caret's measure on, with its anchored control events; a staff's last
  voice is refused. Note entry works in any voice exactly like voice 1
  (Verovio stems voice 1 up, voice 2 down). **Voice colors**: where a
  staff has more than one voice, voice 1 turns blue and voice 2 violet
  (3 amber, 4 magenta) — zero-specificity CSS driven by Verovio's
  `data-n`, so the caret/selection colors always win. Plain ↑/↓ traverse
  voices before staves and continue onto the next/previous **line** when
  the measure's slots run out (text-editor rows: entering at the top slot
  going down, the bottom slot coming up, nearest note under the caret's
  x); ←/→ stop at a voice's start and end (no jumping
  across measures the voice doesn't reach), and inserted measures mirror
  every voice of their neighbor. All single undo steps, byte-identical
  revert.
- **Repeats** (`r` on a block selection): wraps the selected measures in
  repeat barlines (`@left="rptstart"` / `@right="rptend"` — the bis);
  the same block again removes them, and undo restores any barline the
  repeat overwrote (double bars survive). In input mode `r` still enters
  rests.
- **Copy/paste carries control events**: fingering, dynamics, hairpins,
  and slurs whose anchors live inside the copied block travel with it —
  pasted with freshly remapped anchor ids and retargeted staff numbers;
  events reaching outside the block (half a hairpin) stay behind, and
  control events attached to the *replaced* region are cleaned up rather
  than left dangling. Paste also normalizes measure `@n` like the
  structural ops, so stale numbering from older saves heals on the first
  paste. Byte-identical undo covers all of it.
- **Hairpins** (`p` with a selection): select a run of notes — across
  measures too — and `p` cycles a hairpin over it: none → crescendo →
  decrescendo → none (`<hairpin>` with startid/endid in the start
  measure, rendered across tile boundaries by the span segmentation).
  With no selection, `p` keeps cycling p/f dynamics on the note. One
  undo step per press.
- **Measure numbers stay sane**: insert/delete/duplicate renumber `@n`
  sequentially (page view prints it at every system start — this used to
  show compounding "4aaaa" template names). A surviving pickup keeps its
  0-based numbering; non-numeric editorial numbering is never touched;
  undo restores the original numbers exactly.
- **Tabs**: a `+` button opens a fresh blank score (one treble staff, 4/4,
  four empty measures, named untitled-1, -2, …) ready for note entry, and
  **open file…** loads any `.mei`/`.xml` from disk into a new tab named
  after the file. `node spikes/verify-phase5.mjs` (165 checks).

## Phase 4 — Note entry and MEI round-trip hardening (2026-08-02 → 08-05)

**Plan.** Keyboard note entry at the caret (pitch letters or MIDI input
via Web MIDI, duration keys, chord building, rests, ties, tuplets).
Dotted rhythms, articulations, basic dynamics. In parallel, harden
serialization: preserve-unknown-verbatim round-trip tests over a corpus
of third-party MEI files, id stability across save/load, and
file-watching so external edits reload cleanly.

**Exit criteria (met; file watching deferred, tuplets landed in Phase
5):** transcribe a short passage from scratch by keyboard/MIDI without
touching raw XML; corpus round-trip suite green.

**Landed:**

- **Note input mode** (`i` to toggle): overwrite-mode entry that is
  duration-invariant by construction — equal swaps in place, shorter fills
  the remainder with rests, longer consumes following events (refusing
  loudly at beam/tuplet/measure boundaries); a–g pitches with
  nearest-octave guessing, shift+A–G chord building, `r` rests, 7..1
  durations (5 = quarter), `.` dot, s/v/n accidentals, `t` tie (back to the
  predecessor — across the barline when the note opens the measure; works
  outside input mode too, on the caret note; pitch-checked), `,` staccato, `;`/`!` accent, and `p` cycling
  dynamics (none → p → mp → mf → f → none). **Web MIDI is a first-class input**: in
  input mode, note-ons enter at the caret, keys held together build chords
  (note-off tracking), devices hot-plug via `onstatechange`, the HUD shows
  what is connected, and a note played outside input mode hints at pressing
  `i`. **Keyboard-layout independent**: duration
  digits also match by physical key position (`e.code`), so AZERTY's
  unshifted number row works without Shift; the dot is `.` or `:` (both
  character-based — `:` is unshifted on AZERTY), accent is `;` — no physical
  key serves two different actions on any layout. The dot always applies to
  a real event — the just-entered note, or the note/rest at the caret (in
  or out of input mode) — re-entered in place with the duration difference
  consumed from / released to the following rests; subsequent entries
  inherit the resulting dot state (no separate prospective toggle).
- **Round-trip hardening**: the session keeps the FULL document tree —
  `meiHead`, unknown elements/attributes, comments, `<?xml-model?>` PIs —
  and save serializes all of it. Corpus tests prove serialization is a
  fixpoint, no content is lost across cycles, and a reloaded save needs
  zero new ids. Compatibility note: Verovio rejects comments before the
  root element (PIs are fine), so prologue comments are preserved by moving
  them just inside `<mei>`.
- 172 core tests; the property fuzzer covers the whole command pool (a
  stale modulo had silenced part of it) and promptly caught a real bug:
  measures inserted or duplicated at a mid-piece context change landed
  AFTER the interleaved def, adopting the next section's meter — a
  duplicated 4/4 measure inside a fresh 7/8 region. Structural inserts now
  stay in their source region (defs bind to the measure they precede);
  `node spikes/verify-phase4.mjs` covers the exit criterion: transcribe a
  passage from scratch by keyboard, no XML touched, durations always valid.
- **Merge/split** (`m` / `x`): merge the caret event with the next — same
  pitch (or both rests / identical chord pitch-sets), adjacent in the same
  container, sum expressible as one written duration (quarter+eighth →
  dotted quarter; half+eighth → refused) — keeps the first event's id and
  dissolves the inner tie pair. Split halves any note/rest/chord in place
  (dur×2, dots preserved: dotted half → two dotted quarters), ties
  redistributed. Whole-measure rests participate too: `x` splits an mRest
  into two half-capacity rest runs (meter-aware — 6/8 gives two dotted
  quarters), and merging rests back up to the full measure collapses them
  into an mRest — so the shortcuts work in freshly inserted measures. Backspace erases the *previous* note and steps back
  (text-editor semantics); Delete stays at the caret.
- **Context editing** (clef… / key… / meter… dropdowns): change or
  add a clef, key signature, or meter at the caret's measure, MEI-natively.
  Mid-piece clef changes are written as **inline `<clef>` elements before
  the barline** (the engraver's position) — interleaved `staffDef` clefs
  render in tiles but are ignored by Verovio's full-document renders, so
  the inline form is what survives page view and export.
  At measure 1 the initial `scoreDef`/`staffDef` attributes are edited in
  place (conflicting child elements and per-staff overrides removed);
  mid-piece an interleaved `scoreDef` (key/meter, score-wide) or
  `staffDef n` (clef, staff-local) is inserted before the measure — or
  merged into one already sitting there, so repeated changes never stack
  defs. Meter changes are validated against every measure up to the next
  meter change and refused naming the first measure that no longer fits;
  whole-measure rests always fit, so preparing empty sections works freely.
  Downstream tiles re-render (context propagates), and the changed-context
  header policy makes the new key/meter visible exactly where it changes.
  One undo step each.
- **Cross-measure slurs** (`S`): select notes with shift+click/shift+arrows
  (any number of measures apart) — or just place the caret to slur to the
  next event — and press `S`; the same pair again removes it. The `<slur>`
  control event lives in the START measure of the real MEI document (no
  shadow state, save stays a plain serialize): per-measure tiles render it
  through the existing span segmentation — the start tile draws an outgoing
  curve to the slice edge, the end tile an incoming stub, and measures the
  curve merely passes over stay untouched. Staff-local, one undo step,
  fully covered by the property fuzzer. (Verovio occasionally draws an
  exuberant curve on a continuation stub — cosmetic, upstream.)
- **Chord accidentals are per-note**: pressing s/v/n (or s/f/n outside
  input mode) on a chord no longer sharps every note — a small picker pops
  up at the chord listing its notes (`1:c4 2:e4 3:g4`); press the note's
  letter or number to apply the accidental to just that note, esc to
  cancel. One undo step. (MIDI entry is untouched — it knows exact
  pitches.) Chord children aren't indexed events, so this rides a
  dedicated `ChordNoteAccidentalCommand` anchored on the chord's id.
- **Multi-measure ties** (`t` on a selection): a note held across measures
  is a chain of ties, so selecting the same-pitch run and pressing `t`
  ties every consecutive pair in one undo step, with proper MEI `@tie`
  values (`i`/`m`/`t`, merging with ties that continue past the run's
  edges); the same selection unties it. Refuses loudly on pitch changes or
  gaps. Rendering fix underneath: Verovio *skips* an unmatched `@tie` half
  in an isolated slice, so boundary-crossing ties never drew their curves
  on either tile — the segmenter now injects explicit `<tie>` continuation
  stubs for edge notes (incoming and outgoing), which also fixes the
  plain cross-barline `t` tie from note entry.

## Phase 3 — Copy/paste and arranging (2026-08-02)

**Plan.** This phase is the reason the project exists. Serialize
selections to MEI clipboard fragments with context metadata. Implement
the three paste policies (replace-measures, splice-at-caret,
overlay-as-new-layer) with the duration validator gating every commit.
Add multi-document support (tabs or split view) and cross-file block
paste with the meter/key compatibility pass. Add structural measure
commands: insert/delete measures, split/merge, duplicate measure range.

**Exit criteria (met):** the target workflow works start to finish — open
two files, block-select four measures of one staff in file A, paste into
a different staff in file B, transpose, save, and the result opens
correctly in Verovio and mei-friend.

**Landed:**

- Edit view renders **bare tiles**: clef, key signature, meter, and
  staff-group brackets are hidden (their values stay in force for pitch
  spelling and staff positions). Symbols appear only on the first measure;
  clef/keysig/meter are each re-drawn only on the tile where they *change*.
  Done with MEI visibility attributes (`clef.visible`, `keysig.visible`,
  `meter.form="invis"`, `system.leftline`), not CSS — Verovio reclaims the
  space, so bare tiles are also narrower.
- Tiles join into a **continuous system**: zero side margins, near-linear
  duration spacing (`spacingLinear: 0.03`, `spacingNonLinear: 1.0`) so equal
  durations get equal widths across tiles. Display zoom is a fixed,
  user-selectable factor (header control, per document) — staff size is
  constant across documents and a big ensemble is simply taller, like a real
  score; zoom is never derived from tile height (lesson learned: deriving it
  shrank orchestral staves). Verovio's per-tile measure numbers are
  suppressed (each tile is a "system start").
- **Row layout like a real score**: the editor owns the flow layout (greedy
  fill by rendered tile widths). Each row starts with a synthesized
  **system-start header** (clef + key signature + brackets over an invisible
  measure, cached by context); tiles themselves draw only *changes* plus the
  opening meter. Every tile displays in a uniform box with its **top staff
  line pinned to a shared baseline** (max extents above/below the staff over
  the document — ledger lines, lyrics, fermatas included).
- **Uniform inter-staff spacing via two-pass feedback, per row**: pass 1
  renders tiles unforced and parses the inter-staff gap their content needs
  (lyrics push staves apart) plus the real ink extent above the top staff
  line; pass 2 re-renders each row with the row's max need forced as
  Verovio's `spacingStaff` (a minimum, so the max of all needs is reachable
  by all). Row box heights hug their own content — a lyric-free row stays
  compact. `spacingStaff` also pads above the *first* staff, so tiles pin
  to the intrinsic ink extent and crop the padding. Staff lines verified
  pixel-identical across each row. Chosen over rendering whole rows as
  single slices, which would have made structural edits, row sizing, and
  per-measure drag-and-drop harder.
- Tabs have close buttons; zoom is per-document.
- `@battuta/core`: exact-rational **duration model** (dots, tuplets, mRest,
  grace, meter capacity) powering the paste validator; **block selection**
  (measure-range × staff-range) and **clipboard fragments** (plain data +
  readable MEI text for the system clipboard); `planPasteReplace` returns
  typed refusals/warnings; `PasteReplaceMeasuresCommand` (replace-measures
  policy) plus insert/delete/duplicate-measures commands. 54 tests; the
  property suite fuzzes paste + structural commands against the corpus and
  asserts byte-identical unwind AND the duration invariant after every step.
- Editor: document **tabs** with a shared clipboard, **drag block selection**
  across tiles/staves, ctrl+c/ctrl+v (paste refusals surface the validator's
  reason; warnings ask), structural buttons (+m/−m/⧉m, also on numpad +/−/*), save-to-MEI download.
- E2E (`node spikes/verify-phase3.mjs`): the target workflow start to
  finish — block-copy chorale measures, paste into another document's other
  staff, validator refuses a short measure into a full one, save, and the
  exported file re-parses with zero duration problems and renders in a fresh
  Verovio toolkit.
- Deferred from this phase: splice-at-caret and overlay-as-new-layer paste
  policies; split view. (Split/merge measures landed in Phase 4.)

> **Progress note (2026-08-02) — Phases 0–3 delivered, plus view-layer work
> beyond plan.** Phases 0–3 exit criteria all hold, verified by headless e2e
> suites (`spikes/verify-*.mjs`) and 55 core tests including fast-check
> properties (apply/revert identity, duration invariant, interleaved
> undo/redo — all run against real corpus files). Beyond the plan:
> the runner bake-off got a fourth candidate (persistent doc + `select()`:
> rejected, O(document) floor) and a real Tauri IPC measurement (~1–2 ms).

## Phase 2 — Selection, caret, and the command engine (2026-08-02)

**Plan.** Implement event selection (click, shift-click, shift-arrow) and
block selection (measure-range × staff-range), both stored as model
ranges. Implement the caret with model coordinates and keyboard
navigation. Build the command engine: command objects with apply/revert,
dirty-region reporting wired to tile invalidation, undo/redo stack. Ship
the first real edits: transpose by step/octave, toggle accidental,
delete-events-to-rests.

**Exit criteria (met):** arrow-key navigation feels like a text editor;
transposing a selection updates only its tiles within the latency budget;
undo/redo is reliable under property-based tests (random command
sequences, then full unwind, yields a byte-identical document).

**Landed:**

- `@battuta/core`: event index (chords are events, beams/tuplets are
  transparent), caret navigation (left/right across measures, staff
  up/down), event ranges for shift-selection; command engine with
  apply/revert + dirty-region reporting, undo/redo stack; first edits:
  transpose by step/octave, toggle accidental, delete-to-rests.
  40 tests including fast-check properties: random command sequences —
  with interleaved undo/redo — fully unwound restore the document
  byte-identically (run against real corpus files).
- Editor: click/keyboard caret (blinking bar projected from model position),
  shift-click / shift-arrow selection, keymap, edit-latency HUD. Dirty
  tiles re-render via cache-key change alone:
  measured 19 ms edit→screen with exactly 1 tile re-rendered; undo/redo hit
  the tile cache (~4 ms). Verify: `node spikes/verify-phase2.mjs` (16 checks).

## Phase 1 — Read-only tiled viewer (2026-08-02)

**Plan.** Build the real pipeline with no editing: MEI → core tree (with
id generation, effective-context resolver for clef/key/meter per
measure/staff) → tile synthesis → Verovio render → tile cache → flow
layout of tiles into rows → virtualized scrolling. Add the page view
(full Verovio layout) and a toggle between views. Click a note in either
view and it highlights via id.

**Exit criteria (met):** open any MEI file from the existing pipelines
and from mei-friend samples; scroll a 500-measure score smoothly;
clicking notation highlights the corresponding element; context-resolver
tests green.

**Landed:**

- `@battuta/core`: MEI tree, score builder, **effective-context resolver**
  (clef/key/meter/staff-lines/transposition per measure × staff; attribute and
  child-element forms; interleaved scoreDef/staffDef; inline clefs) with a
  19-test vitest suite plus a Verovio smoke test (507/507 corpus tiles render;
  `npm test -w @battuta/core`, `node spikes/verify-core-tiles.mjs`)
- Editor: worker pool (hardware-scaled), tile cache keyed by
  context-hash + content-hash, virtualized tile grid (shared
  IntersectionObserver), page-view toggle (full Verovio paged layout),
  id-based click selection in both views
- End-to-end check: `node spikes/verify-app.mjs` (context fixture renders
  correct key/clef/meter per tile; 313-measure scroll; page view)
- Control-event segmentation at tile boundaries: boundary-crossing
  slurs/ties/phrases/hairpins are rewritten as tstamp-anchored continuation
  stubs (incoming stubs injected from a per-score span index); verified at
  the render level on both synthetic and corpus files
- Tauri 2 shell in `apps/editor/src-tauri` with a real IPC benchmark
  (results in BENCHMARKS.md)

## Phase 0 — Skeleton and spike (2026-08-02)

**Plan.** Set up the Tauri + Vite + TypeScript + React workspace with the
core as a separate package (`packages/core`, zero DOM imports). Spike the
two riskiest assumptions: (a) render a single measure slice through
Verovio and confirm the output SVG carries the source `xml:id`s;
(b) measure Verovio render time for a slice vs. a full document on a real
200+ measure file, to validate that tiling is worth it.

**Exit criteria (met):** a window opens, loads an MEI file, renders one
measure tile, and logs timing numbers for slice vs. full render.

**Landed:**

- Slice rendering preserves `xml:id`s end to end (spike A: PASS)
- Tiling beats full re-layout by 30–100× per edit (spike B: PASS)
- Runner decision: **Verovio WASM in a Web Worker pool** — see
  [BENCHMARKS.md](BENCHMARKS.md) for the full bake-off (main thread vs
  worker vs native C++, plus the persistent-document/`select()` variant,
  spike C: rejected)
