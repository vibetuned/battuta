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