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