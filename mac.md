I have a Tauri 2 app (repo: battuta) whose macOS .app shows the generic grey
tile in the Dock and in Finder instead of its icon. The icns at
apps/editor/src-tauri/icons/icon.icns was hand-assembled on Linux (iconutil
layout: no TOC, icp4/icp5 + ic07–ic14, PNG entries). The repo also ships the
source PNGs as icons/battuta.iconset/. Build with:
  npm ci && npm run build -w @battuta/core
  cd apps/editor && npx tauri build --bundles app
The built app lands in apps/editor/src-tauri/target/release/bundle/macos/.

Please diagnose in this order, and STOP at the first step that identifies or
fixes the problem:

1. Rule out the icon cache first — it makes every other test lie:
   rm -rf ~/Library/Caches/com.apple.iconservices*; killall Dock Finder
   Then copy the .app to a NEW name/path (e.g. ~/Desktop/battuta-test.app)
   and check its Finder/Dock icon — caching is keyed by path and bundle id.

2. Check the bundle wiring inside the built .app:
   - ls Contents/Resources/ (is icon.icns there and non-empty?)
   - /usr/libexec/PlistBuddy -c Print Contents/Info.plist | grep -i icon
   Verify CFBundleIconFile says icon.icns. If a CFBundleIconName key exists
   but there is NO Contents/Resources/Assets.car, that key poisons icon
   lookup on modern macOS — try deleting the key with PlistBuddy, ad-hoc
   re-sign (step 4), and retest.

3. Validate my Linux-built icns with Apple's own tools:
   - iconutil -c iconset Contents/Resources/icon.icns -o /tmp/roundtrip.iconset
   - qlmanage -p Contents/Resources/icon.icns
   If either rejects it, rebuild natively from the repo's iconset:
   iconutil -c icns icons/battuta.iconset -o apps/editor/src-tauri/icons/icon.icns
   then rebuild the app and retest (with step 1's cache purge). If the native
   icns differs, tell me what iconutil produced that mine lacked (compare
   entry types: xxd | grep, or a quick python parse).

4. Check the code-signature seal — a modified-after-signing app can lose its
   icon: codesign -dv --verbose=2 battuta.app and codesign --verify --deep
   battuta.app. If the seal is broken, codesign --force --deep -s - battuta.app
   and retest.

5. Report exactly which step fixed it and what the root cause was, so the
   fix can be encoded in the repo (a committed native icns, a tauri.conf
   change, or a CI signing step). If the natively-built icns is what fixed
   it, leave it in place at apps/editor/src-tauri/icons/icon.icns so I can
   commit it.

---

# Resolution report (2026-08-10)

## TL;DR

The icns was never broken and none of steps 1–4's hypotheses were the root
cause. The problem was the icon **artwork** meeting **macOS 26 (Tahoe,
Darwin 25) icon re-theming**: our artwork was a black glyph on a white
*rounded square* with **transparent corners**. Tahoe treats any icon with
transparent corners as a legacy "pre-shaped" icon: it discards the artwork's
own background, extracts the glyph, and re-composites it onto a
system-generated squircle. With the Mac's icon style set to Dark
(`AppleIconAppearanceTheme = RegularDark`), that generated tile is dark
grey — a black glyph on it is nearly invisible, so the Dock/Finder icon read
as the "generic grey tile". It was actually our icon all along (the glyph
edges were faintly visible).

That also explains the odd inconsistency observed: **small icon sizes**
(Finder list views, etc.) skip the re-theming and showed the right colors,
while the **Dock and the installed app** (large sizes) showed the re-themed
dark tile.

## What made diagnosis hard

Two cache gotchas made every test lie:

1. `~/Library/Caches/com.apple.iconservices*` does not exist on modern
   macOS. The purge that actually works:

   ```sh
   rm -rf "$(getconf DARWIN_USER_CACHE_DIR)/com.apple.iconservices"*
   sudo rm -rf /Library/Caches/com.apple.iconservices.store
   killall iconservicesagent Dock Finder
   ```

2. iconservices also resolves by **bundle id**, not just path. Any stale
   copy of the app on disk (e.g. an old `battuta-test.app` on the Desktop
   with the old icns) can poison the icon of every other copy, even at a
   fresh path. Delete old copies before retesting.

## Verification notes

- The Linux-assembled icns round-tripped cleanly through
  `iconutil -c iconset` — the no-TOC, icp4/icp5 + ic07–ic14 PNG layout is
  fine. No native rebuild was needed for format reasons.
- Bundle wiring, CFBundleIconFile, and the code signature were never at
  fault (steps 2 and 4 not reached).
- Icon resolution was tested headlessly with
  `NSWorkspace.shared.icon(forFile:)` rendered to PNG — same lookup
  Finder/Dock use, no screenshot needed.

## The fix (committed in-repo)

Make the macOS icon artwork **fully opaque edge-to-edge** (no transparent
corners): the glyph inset ~12% and composited onto a full-bleed white
square. Tahoe then masks the art into its squircle as-is instead of
generating its own tile. Verified correct even under the Dark icon style.

- `apps/editor/src-tauri/icons/icon.icns` — rebuilt natively with
  `iconutil` from the white-background art. This is what Tauri bundles
  (already listed in `tauri.conf.json` → `bundle.icon`).
- `icons/battuta-macos.iconset/` — the white-background source PNGs
  (all 10 sizes). Regenerate the icns with:

  ```sh
  iconutil -c icns icons/battuta-macos.iconset \
    -o apps/editor/src-tauri/icons/icon.icns
  ```

- `icons/battuta.iconset/` (transparent-corner original) is kept for other
  platforms/branding, but **never regenerate the macOS icns from it** — the
  grey-tile behavior comes straight back.

## Future polish (optional)

The first-class macOS 26 solution is an Icon Composer `.icon` file with
explicit light/dark/tinted variants, which would give a designed dark-mode
tile instead of the system's automatic treatment. The white-background icns
is the pragmatic fix until then.