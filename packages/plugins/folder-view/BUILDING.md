# Building the Folder view plugin

> The first plugin in this repository that is **not an extraction**.
> Nothing of it ever lived in `App.tsx`, so the number that matters is
> the one that did not move: `App.tsx` **2,991 → 2,991**, and the host's
> only diff is the two lines in `plugins.ts` that every plugin costs.

## 1. Origin

A new feature, built to PLANNING.md Phase 9, **slice 9b**, after **9a**
(2026-09-16) lifted what a folder view needs and cannot make itself: the
`workspace` host service, `ctx.documents`, and `path` / `dirty` on
`DocumentInfo`. Slice 9 was chosen to be a new feature rather than an
extraction precisely to measure that claim — a plugin can add a whole
feature without the host growing for it.

What it does: a side panel listing the scores in a folder the user
opened, with sub-folders opening in place; open tabs marked and unsaved
ones starred, both read from `ctx.documents`; a click opening a score
through the host's own open path; and a recursive watch keeping the list
level with the disk.

| Added | Where |
| --- | --- |
| The list model — what is shown, at what depth, and what a change makes stale | `src/tree.ts` (92 lines, pure) |
| The panel | `src/Panel.tsx` |
| Activation, the workspace wiring, the panel's lifetime | `src/index.tsx` |
| The 📁, the command, the setting key | `src/manifest.ts` |
| A browser e2e | `spikes/verify-folder-view.mjs` (15 checks) |
| A shell e2e | `probe5` in `src-tauri/src/main.rs`, checked by `verify-tauri.sh` |

Outside the package: `host/plugins.ts` (+2 lines) and the editor's
`package.json` dependency. Nothing else. Initial chunk **368.7 kB**
against the 375.0 kB ceiling 9a set.

## 2. Manifest

| Declared | Why |
| --- | --- |
| `contributes.slotItems` — 📁 in `header`, `dimUntilActive`, running `battuta.folder-view.toggle` | The entry point cannot come from the panel's own code: it would not be there to open it. `dimUntilActive` because the button means "the panel is showing", and before the plugin runs it definitionally is not. |
| `contributes.commands` — the one toggle | The 📁's click target, and what `onCommand:` names. |
| `activationEvents: ["onCommand:battuta.folder-view.toggle", "onSettings:folder"]` | The click, and "you had a folder open when I last quit". A user who never opens the panel never fetches this code. |
| `capabilities: ["workspace"]` | Offered by every build; `ctx.workspace.available` is what says whether the shell is there, so the panel can tell the user rather than fail. |

Deliberately **not** declared: no keybinding (a new feature earns a key
when someone asks for one; the union keymap snapshot stays
byte-identical either way), no `onStartup`, no `onDocument:` (9a left it
unfired for want of a consumer, and `ctx.documents` is the better answer
— a store, not an event), no lanes, no exports.

## 3. API surface

`@battuta/api` **0.1.15**; this plugin added **nothing** to it. Every
call below landed in 9a with this panel named as its consumer, which is
why the slice ran without a stop.

**Read**
- `ctx.workspace.available` — a browser build says so and offers nothing else.
- `ctx.workspace.readDir(path)` — one folder's entries; folders first, hidden skipped.
- `ctx.documents` — every open tab, with `path` and `dirty`. The marks come from here and **never from the DOM**.
- `ctx.settings.get("folder")`.

**Act**
- `ctx.workspace.pickFolder()` — the native dialog; the picked folder becomes readable.
- `ctx.workspace.openFolder(path)` — re-admit last session's folder.
- `ctx.workspace.openDocument(path)` — the host's ONE open path: an import converts, an already-open tab is focused, the mtime is recorded for the external-change guard. None of that is this plugin's to reproduce.
- `ctx.workspace.watch(root, fn)` — recursive, coalesced per path by the host.
- `ctx.settings.set("folder", path)`, `ctx.notice`.

**UI**
- `ctx.panels.open({ side: "side" })` — this panel is the side area's **first consumer** (mounted since slice 1, unused until now), which is how §7.1 was found.
- `ctx.slots.add("header", …)` — the live 📁 replacing the declared face.

**Not used, deliberately:** `ctx.execute` (§5), `ctx.query`, `ctx.editor`,
`ctx.actions`, `ctx.keymap`, `ctx.lanes`, `ctx.formats`, `ctx.midi`,
`ctx.audio`, `ctx.view`, `ctx.storage`, `ctx.confirm`.

## 4. State

**Transient (memory).** One `FolderState` signal: the picked root, a map
of folder path → entries for every folder that has been read, the set of
folders the user expanded, an error string, a busy flag. Plus the live
watch's disposable. All safe to lose — it is a picture of a folder, and
the folder is the truth.

**Persisted (`ctx.settings`).** One key, `folder`: the path, as a string.
It is also what `onSettings:folder` reads, so the panel comes back for
someone who left a folder open. Nothing else is persisted — not the
expanded set (it would go stale against the disk), not whether the panel
was up (§7.5).

**Document.** None. **Nothing mutates the document outside
`ctx.execute`** — and the stronger statement holds: this plugin never
writes anything, to the document or to disk. `ctx.execute` appears
nowhere in `src/`; the browser e2e asserts `undoDepth === 0` after
driving the whole panel; and the only write in the package is
`ctx.settings.set`.

## 5. Command messages

**None.** A folder view reads. Opening a score is
`ctx.workspace.openDocument`, which is the host's open path — so a
converted import still arrives as a new unsaved document, an already-open
file is focused rather than opened twice, and the mtime the
external-change guard needs is recorded. A plugin that opened files
itself would have to reproduce all three, and would get one of them
wrong.

## 6. Tests

`npm run test:plugins` (or `npx vitest run --root packages/plugins/folder-view`) — 36 tests:

| Suite | Pins |
| --- | --- |
| `test/tree.test.ts` (15) | The list model as a table: extensions and titles on both path separators, folders listed whether or not they hold a score, `.mei` listed and the importable formats not (with the reason, so closing §7.1's gap has a test to change rather than a comment to notice), depth-first rows with expansion spliced in, an expanded folder whose contents have not arrived showing nothing under it, and which folders a change makes stale. |
| `test/folder-view.test.ts` (21) | The plugin against a real `createHost()` and a fake shell bridge: the 📁 before any code loads; the three wake-up paths; pick → list → expand → open; one `readDir` per folder and **one watch for the whole tree**; a file appearing on disk appearing in the list; a change in an unopened folder costing nothing; a deleted sub-folder leaving the tree instead of blanking the panel; the open and dirty marks coming from `ctx.documents`; a browser saying the shell is required and asking for nothing; **and not forgetting the folder there** (§7.4); a folder that is genuinely gone being forgotten with a message; and the switch taking the panel, the 📁 and the watch away together. |

**Gates:**
- `spikes/verify-folder-view.mjs` — **15 checks, browser.** The declared
  📁 before the plugin loads and its dimming, the panel opening in the
  **side** area with the host's `aria-label`, the "desktop app required"
  note, no controls a browser could not honour, toggling from the 📁 and
  from the panel's own ×, no keybinding, and nothing written to the
  document.
- `verify-tauri.sh` **probe5** — the shell half, through the same UI:
  the folder picked without a dialog, two scores listed, `two.mei` opened
  by clicking its row, and that row **marked open from `ctx.documents`**.
  Measured on macOS: `probe5: folder view ok (2 entries, opened two.mei,
  marked open, guard no (kind not modified))`.
- Editor 138, core 224, api 20, plugins 222; `verify-app` 18, `phase2`
  20, `phase3` 21, `phase4` 67, `phase5` 221, `lyrics` 25, `keyboard` 24,
  `formats` 14 — all unchanged.
- The union keymap snapshot, byte-identical. `npm run budget` — 368.7 kB
  against 375.0 kB.

**One gate is not green, and it is not this slice's** (§7.6): probe4,
9a's workspace check, fails on macOS because the platform reports an
append as `created` where the assertion expects `modified`. It fails with
this plugin absent, and `verify-tauri.sh` exits there before reaching
probe5 — so probe5 was run and read from the log directly.

## 7. Dead ends

Start from `onscreen-keyboard/BUILDING.md` §7 — the only other panel, and
every trap in it applies here (activation before the handler, a panel
that subscribes instead of being re-opened, a component that loses its
own `position: fixed` in a slot). §7.1 and §7.2 below are what a panel
in the SIDE area adds to that list.

### 7.1 The side panel area starts underneath the app header

The side area has existed since slice 1 and had no consumer until this
panel. It is `position: fixed; top: 0; bottom: 24; width: 280;
z-index: 32`. The app's header is `position: sticky; top: 0; z-index: 35`
and **75 px tall** (83 px to its bottom edge unscrolled), spanning the
full width — so the side area's first ~83 px are behind it. Anything
drawn there is invisible and unclickable.

Found by the browser e2e on its first run, in the best possible way:

```
<header>…</header> intercepts pointer events
    - retrying click action
```

— Playwright refusing to click the panel's own ×, because something else
was on top of it. A human would have seen a panel that looked right and
had a dead strip at the top.

The host's `slots.tsx` is not this slice's to edit, so the clearance is
the plugin's: `HEADER_CLEARANCE = 92` as the panel's `paddingTop`, with
its sticky header offset to match. It looks correct rather than gappy —
the app header is opaque white and sits exactly over the cleared strip.

**What makes it acceptable rather than a time bomb is that it is pinned,
not trusted.** `verify-folder-view.mjs` clicks the panel's × and
`probe5` clicks its first row; a header that grows past 92 px fails a
test instead of hiding a control.

**The gap to close, and it is the host's:** a panel cannot know the
inset, and must not measure it (rule 4 — no DOM). Either the side area
starts below the header (`top` set from the same place the header's
height is decided), or `PanelSpec` gains the host's content inset and the
panel uses it. Consumers: this panel today; any side or bottom panel
after it — the bottom area has the same shape against the status bar,
and got away with it because 24 px happened to be right.

> **An extension point with no consumer is a promise, not a feature.**
> The side area was "mounted since slice 1" and was wrong for five
> slices, because nothing had ever been put in it.

*Resolved the same day (2026-09-16, in-house), and more than asked.* The
side area now starts BELOW the header — the App measures the header and
publishes its height as `--battuta-header-h`, which the area's `top`
reads — and the user moved it to the LEFT, as most applications place a
file view, and made it PUSH the score right (`<main>` takes a matching
left margin while a side panel is up) instead of covering it, which had
made editing beside it impossible. `HEADER_CLEARANCE` is gone from this
panel; the clicks that pinned it stay in the e2e.

### 7.2 A declared entry point has TWO hooks over its life

The shell probe could not find the 📁:

```
probe5: folder view FAILED: no folder-view button in the header
  (slot items: battuta.onscreen-keyboard:toggle;
   plugins: … battuta.folder-view=active)
```

The plugin was **active**, which is the mechanism working exactly as
designed: a runtime slot item with the same id REPLACES the declared
face, so the button changes identity — `data-slot-command` while the
plugin is asleep, `data-folder-toggle` once it is running. The probe
looked only for the first.

It was active because a previous run had persisted a folder and
`onSettings:folder` woke it at startup — so the failure is only
reproducible on the *second* run, which is the kind that gets diagnosed
as flakiness.

Anything that addresses a declared entry point from outside must match
**either** hook (`[data-slot-command="…"], [data-folder-toggle]`), and
must not assume the panel is closed: the same wake-up path opens it
before any click. Both e2e scripts do this now. Worth saying plainly in
the conventions, because every plugin with a declared item has this shape
and only this slice has had a test that addresses one from outside twice.

### 7.3 An error state has to carry its way out

Second finding from the same shell run. A folder remembered from a
previous session had been deleted, so `openFolder` answered false, the
panel showed *"The folder … is no longer available"* — and nothing else.
No button. The only escape was to turn the plugin off and on.

The body rendered `error` **instead of** the picker rather than above it,
which reads as obviously right when you write it and is a dead end the
moment it fires. Fixed by rendering the message *and* the picker while
there is no root.

> **A message that explains why something failed is half a UI.** The
> other half is the control that does something about it — and the state
> where it is missing is exactly the state nobody clicks through by hand.

### 7.4 "No shell" and "no folder" are the same `false`, and must not be

`ctx.workspace.openFolder(path)` returns false when the folder is gone —
and also when there is no shell at all, because the browser backend
answers false to everything. The startup restore reads that answer and
clears the remembered folder when it fails.

Open the browser build once and your desktop app has forgotten its
folder.

The fix is one condition (`if (ctx.workspace.available)` before
forgetting) and the lesson is the shape: **a service that degrades
gracefully returns the same value for "it went wrong" and "I am not
here", and only the caller knows which it is asking about.**
`available` is the discriminator; a call's return value is not. Pinned by
two tests that differ only in whether the bridge exists.

### 7.5 What is persisted is the folder, not the panel

The keyboard persists `open` and comes back through `onSettings:open`.
The obvious symmetry is to do both here: persist the folder *and*
whether the panel was up.

Not done, and the brief is why: activation is on `onSettings:folder`, so
**having a folder is what "in use" means** for this plugin. A second key
would mean a plugin that wakes at startup to decide not to show anything
— it would load its code to do nothing, which is the one thing activation
events exist to avoid.

The cost is real and is in the README: closing the panel is for the
session; restarting brings it back while a folder is remembered. If that
turns out to annoy, the answer is not a second setting but for "close" to
clear the folder — one meaning of "I am done with this folder", not two
overlapping ones.

### 7.6 The live guard does not fire on macOS, and that is 9a's

probe5 reports `guard no (kind not modified)`. The live external-change
guard filters `if (e.kind !== "modified") return;`, and macOS FSEvents
reports an append to a recently created file as **`created`** — its
per-path flags are cumulative, so a file the test created seconds earlier
keeps its "created" flag on every later event. Linux inotify reports
`modified`.

Evidence it is not this slice's: 9a's own probe4 asserts `change modified
two.mei` and fails the same way with this plugin absent — measured on a
`dist` built before the plugin existed:

```
probe4: workspace ok (2 entries, scoped, change created two.mei)
```

So `verify-tauri.sh` exits at probe4 on macOS and never reaches probe5.
probe5 therefore **reports** the guard rather than asserting it, and was
verified by running the shell binary directly.

Not fixed here: the guard lives in `App.tsx` and probe4 is 9a's check,
neither of which this slice may edit. The fix is the user's and is
probably two lines — accept `created` as well as `modified` in both
places, or have the Rust side normalise a kind for a path that already
exists. Written, not resolved.

*Resolved the same day (2026-09-16, in-house), the two-line way:* the
guard ignores only `removed` — a file that is OPEN here and reports
created or modified has changed under us either way — and probe4 accepts
either kind. The FSEvents semantics are recorded beside both.

### 7.7 The extension question, answered the way the brief allowed

The brief planted this one: the panel must know which extensions are
scores, the host's `openExtensions` is not on the api, and *"write the
gap; do not resolve it — or list `.mei` only and say so."*

Both were done. `SCORE_EXTS = ["mei"]`, and the temptation worth naming
is the third option nobody sanctioned: **copy the extension list into the
plugin.** It is six strings and it would work today. It would also be
wrong the first time someone turned the formats plugin off, because the
list is not a constant — it is what the registry currently claims. That
is harmony's §7.2 again in a different costume: a plugin that copies an
answer to avoid asking the question signs up for the two to drift.

The addition to propose is in the brief already:
`ctx.formats.extensions: Store<readonly string[]>` — a store, not a
getter, because the answer changes when a plugin is switched. Consumers:
this list, and a drag-and-drop target after it. `test/tree.test.ts` has
the assertion that will change when it lands.

*Decided (2026-09-16, the user):* `.mei` only stays. The folder view is a
view of MEI scores; a MusicXML or ABC file in the folder is opened through
the open dialog and becomes an MEI tab, which the view then shows. No
addition to the api; the assertion in `test/tree.test.ts` stands as the
rule.

### 7.8 What did not happen

- **`App.tsx` 2,991 → 2,991.** The slice's actual result. The host's diff
  is `plugins.ts` +2 and a `package.json` dependency.
- **No api addition** (0.1.15 unchanged), no new host module, no keymap
  change, no command message.
- **No `deactivate()`**: everything is a disposable the host tracks, with
  the watch added last so it is released first.
- **The panel is never re-opened to refresh it.** `ctx.documents`
  republishes on every edit, so a panel that re-opened on new props would
  remount — collapsing every folder the user had expanded, on every
  keystroke. It subscribes in place (4b's §7.6, with a sharper
  consequence here than the octave rail that taught it).

## 8. Recipe

The shortest path to a plugin like this one — a panel over a host
service, and the first NEW feature rather than an extraction.

1. **Read what the host already offers before designing anything.** 9a
   built `ctx.workspace` and `ctx.documents` against this panel as their
   named consumer, so nothing here had to be invented or worked around.
   The one thing the brief knew was missing (§7.7) it said so in advance.
2. **Put the model in a pure module first** (`src/tree.ts`) and test it
   as a table. Everything about *what is shown* belongs there; the panel
   then holds only subscriptions and callbacks, and the lifecycle test
   does not have to reason about rows.
3. **Write the wake-up table as a comment before the code**, and give it
   a test per row. Three rows here; the keyboard's four.
4. **Copy the six-line `useStore`** and hold state in one signal. Pass
   the store and a flat `actions` object into the component — that is
   what lets a test read the whole contract off `render().props` without
   react-dom.
5. **Both e2e halves, early.** A browser script for what works without
   the platform (the entry point, the panel, the honest refusal) and a
   shell probe for the rest. The browser one found §7.1 on its first run
   and the shell one found §7.2 and §7.3; none of the three would have
   been found by unit tests, because all three are about a real DOM and a
   real previous session.
6. **Check in this order:**
   ```sh
   npm run typecheck -w @battuta/plugin-<name>
   npm run typecheck -w @battuta/editor
   npx vitest run --root packages/plugins/<name>
   npm test -w @battuta/editor          # boundaries, keymap snapshot
   npm run build -w @battuta/editor && npm run budget -w @battuta/editor
   BATTUTA_ROOT=$PWD CHROME=bundled node spikes/verify-<name>.mjs
   sh spikes/verify-tauri.sh            # the shell half
   ```
7. **For a new feature, measure the thing the slice is claiming.** Here
   it was not the budget: it was `wc -l apps/editor/src/App.tsx` before
   and after, and `git diff --stat apps/editor/src/`. A new feature that
   cost the host two lines is the whole point of the phase, and it is
   worth printing.
