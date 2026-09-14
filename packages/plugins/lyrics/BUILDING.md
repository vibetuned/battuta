# Building the lyrics lane

The third battuta plugin, and the first on the `lanes` point. Written for
the next author — a person or an agent — who has this file,
`packages/plugins/README.md`, and nothing else.

Read it after `reflection/BUILDING.md` (the plugin *shape*) and
`onscreen-keyboard/BUILDING.md` (UI, and what happens when a slice stops).
This one is the shortest of the three, and that is the finding: **the slice
before it did the hard part.** Slice 5a lifted the lane mechanism into the
host with both lanes still running on it, so 5b had nothing to invent — no
api addition, no host change, no gap. If your extraction feels like this
one, the point you are building on was designed against two consumers
rather than one.

## 1. Origin

An extraction, in two hops. Lyrics shipped in 0.0.3 as one of two
near-identical modals inside `App.tsx`'s key handler; slice 5a (2026-09-14)
made the *mechanism* a host module (`apps/editor/src/host/lanes.tsx`) with
lyrics and harmony as INTERNAL specs and their bodies still in `App.tsx`.
This slice moves the lyrics body out.

| What | Where it was | Where it is |
| --- | --- | --- |
| the lyrics `LaneSpec` (read, commit, the three advance keys, the hint) | `App.tsx`, registered as an internal lane | `src/index.ts` |
| `commitSyl`'s wordpos/con logic | inside that spec's `commit` | `src/syllable.ts`, pure |
| the `lyrics` binding (`l`) | `apps/editor/src/keymap.ts` `defaultKeymap()` | `src/manifest.ts` `contributes.keybindings` |
| the `lyrics` rule (`when: !entryMode && !!caretId`) | `App.tsx`'s action table | the command handler, declining on `ctx.editor` |
| the lane's status-bar row | the internal spec's `label` | `contributes.lanes`, rendered before the code loads |
| the panel caption `SHORT.lyrics` | `onscreen-keyboard/src/keys.ts`, keyed `lyrics` | same file, keyed `battuta.lyrics.open` (§7.3) |

**`App.tsx`: 3,145 → 3,117 lines (−28)**, and the `lyrics` row left
`keymap.ts`. The plugin is 226 lines of source across three files, of which
about 70 are code — the rest is the manifest and comments. It is *larger*
than what it replaced, for the same reason slice 2's was: a manifest states
in data what the App stated by being the App.

## 2. Manifest

```
id                battuta.lyrics
engines.battuta   ^0.1.5
capabilities      none
activationEvents  onLane:battuta.lyrics.verse1,
                  onCommand:battuta.lyrics.open
contributes       1 lane, 1 command, 1 keybinding
```

- **One lane**, `battuta.lyrics.verse1` — declared, so the status bar lists
  it before a byte of this code exists. That is the same lesson as the
  on-screen keyboard's 🎹: an entry point cannot come from the code it
  loads. Picking it fires `onLane:<id>`, the plugin activates, registers
  the spec, and the host opens the lane.
- **The id says `verse1`** because verse 1 is all 0.0.3 wrote. A second
  verse is then a second lane rather than a breaking change to this one.
- **`onLane:` and `onCommand:`, nothing else.** The two ways in are the
  status bar and the `l` key; a user who does neither never loads this.
- **One keybinding**, `l`, with the label, group (`entry`) and text copied
  **verbatim** from 0.0.3's core keymap entry — what keeps the shortcut
  editor, the on-screen keyboard and the generated reference reading as
  they did. A test pins the label string.
- **The lane's face — `label`, `name`, `glyph`, `place` — is in the
  manifest**, and `src/index.ts` spreads it into the spec rather than
  retyping it, so the status-bar row and the floating editor can never
  disagree.

Deliberately NOT declared: no `capabilities` (no MIDI, no workspace, no
playback), no `onStartup`, no slot item, no panel, no settings or storage
keys (§4).

## 3. API surface

| Phase | Call | Why |
| --- | --- | --- |
| read | `ctx.query.lyricAt(eventId)` | the syllable under the caret (`read`), and the PREVIOUS note's (mid-word) |
| read | `ctx.editor.get().entryMode` | `l` declines in note entry |
| write | `{ type: "core.setSyl", eventId, value }` | returned from `commit`; the host executes it as one undo step |
| lifecycle | `ctx.lanes.register(spec)` | the lane's behaviour, once the plugin is awake |
| lifecycle | `ctx.lanes.open(id)` | what the `l` key does |
| lifecycle | `ctx.registerCommand(id, handler)` | the declared command behind `l` |

Types named from `@battuta/api`: `PluginContext`, `PluginManifest`, plus
`CaretPosition`, `LaneSpec`, `LaneAdapter`, `PluginEntry` and `SylValue` in
the tests. Values: only `definePlugin`. **No react** — a lane plugin
renders nothing; the floating editor is the host's.

**What the API had to grow for this plugin: nothing.** `@battuta/api` stays
at **0.1.5** and `api-report.d.ts` is unchanged. Every piece this needed —
`contributes.lanes`, `ctx.lanes`, `core.setSyl`, `ctx.query.lyricAt` — was
added by slice 5a, *with this plugin named as the consumer*. That is the
whole design of the split: the host half is decided where host halves are
decided, and the plugin half is then a context-free session's to write.

**What it did NOT need, and why that is the interesting part:**

- **No navigation query.** The hardest thing lyrics does is know whether it
  is mid-word, which needs the PREVIOUS note — and a plugin cannot walk the
  caret path. The host hands `commit` a `prevEventId` of the lane's own
  kind (`advance: "note"`, so rests are skipped) and the plugin asks
  `lyricAt` about it. **One field on the commit payload replaced a whole
  query surface.**
- **No `accepts` / `transform` / `complete` / `suggest`.** Those four
  `LaneSpec` fields are harmony's closed grammar. Lyrics is free text, so
  it leaves all four unset — which is what proves the point was not shaped
  around one lane.
- **No `ctx.lanes.active` store.** The plugin never asks whether its lane
  is open: it opens it, and the host does the rest.

## 4. State

**Transient (memory).** None. Not one variable in the `activate` closure —
the buffer, the open lane and the caret are the host's, and the syllable is
read from the document every time.

**Persisted.** No settings key, no storage key; a test asserts both are
untouched after a full typing session.

**Document (MEI).** `<syl>` inside `<verse n="1">` on a note or chord,
written by core's `SetSylCommand` through the `core.setSyl` message.
Nothing else: no ids minted by the plugin, no sidecar, no `<annot>`. A
score this plugin typed into is indistinguishable from one typed by hand,
which is why turning the plugin off leaves every existing verse alone.

**Nothing mutates the document outside `ctx.execute`** — and this plugin
does not call it directly either: `commit` RETURNS a message and the host
executes it. That is stricter than the reflection plugin, which calls
`ctx.execute` itself, and it falls out of the lane protocol: a commit that
returns null writes nothing, and one that returns `{ refuse }` writes
nothing and shows a notice. Structurally: the package imports
`@battuta/api` and its own two modules, there is no door to core, and
`apps/editor/test/plugin-boundaries.test.ts` fails the build if one
appears.

## 5. Command messages

One message, and the command behind it is core's:

**`{ type: "core.setSyl", eventId, value }`** → `SetSylCommand`, built by
the host's `toCommand` (`apps/editor/src/host/messages.ts`). Added by slice
5a with this plugin as the named consumer.

- **Sent** from `commit`, once per committed buffer that actually changes
  something — the key that committed (`-`, space, Enter, Escape, an arrow)
  is what decides the hyphenation.
- **`value` is a `SylValue`**: `text`, and `wordpos` / `con` when the
  syllable is part of a longer word (§1's table, and `src/syllable.ts`).
  `{ text: "" }` clears the verse.
- **The command labels itself** — `lyric "hel"`, `lyric removed` — so the
  plugin passes no label, unlike `core.setPitches`.
- **Revert strategy: memento.** `SetSylCommand` snapshots the note's
  `<verse>` child (or its absence) and restores it wholesale, so a revert
  is byte-identical. Dirty region: the target's `(measureIndex, staffN)`.

The plugin defines no commands, so no fuzz harness leaves core.

## 6. Tests

| Suite | Pins | Run |
| --- | --- | --- |
| `test/syllable.test.ts` (11) | the wordpos/con table itself, as a table: a word opened, continued, closed; a whole word; that the PREVIOUS syllable decides mid-word; every case that must write NOTHING (an unchanged syllable under any key, an unchanged hyphen, an empty buffer on an empty note); clearing and re-hyphenating | `npx vitest run --root packages/plugins/lyrics` |
| `test/lyrics.test.ts` (15) | the lane and the key before any code loads; `l` opening it; `l` declining in entry mode while the status bar still opens it; typing a verse over a rest; the buffer reloading; an unchanged crossing writing nothing; clearing; the refusal on a rest and the empty buffer passing one; off/on taking lane, key and option together | same |
| `apps/editor/test/lanes.test.ts` | the lane MECHANISM — every key of the protocol, the advance over a rest, a refusal as a notice. Not this plugin's, and not re-tested here | `npm test -w @battuta/editor` |
| `packages/core/test/lyrics.test.ts` | `SetSylCommand` and `sylAt`: the write, the byte-identical revert, the refusal on a rest. Unchanged by this slice | `npx vitest run --root packages/core` |
| `apps/editor/test/keymap-snapshot.test.ts` | the union keymap, **changed by exactly one entry** (§7.1) | `npm test -w @battuta/editor` |
| `apps/editor/test/plugin-boundaries.test.ts` | this package obeys every hard rule | same |

The split is deliberate and worth copying: **the value table is pure and
enormous; the lifecycle suite is small and structural.** A plugin test
cannot apply a core command (that would need core), so the lifecycle suite
asserts the command's *label* at the session adapter and the *message*
straight off the registered spec — see §7.2.

**e2e gates.** `spikes/verify-lyrics.mjs` — 25 checks typing a verse
through the real editor, written by slice 5a *before* the mechanism moved,
so both hops have the same gate. **Every assertion is identical and neither
of its two design hooks had to move**: the lane still renders into
`[data-harm-input]` (the host's box, shared by every lane) and the script
opens the lane with the `l` key, which is still `l`. The five regression
scripts, `verify-onscreen-keyboard.mjs` and the shell smoke are unchanged.

## 7. Dead ends

Shorter than the two plugins before it, because the point underneath was
built for this. What is here is what cost time anyway.

### 7.1 The union keymap snapshot changes — deliberately, by exactly one entry

Every extraction before this one had to leave the snapshot byte-identical.
This one cannot: the `l` binding moves from core's `defaultKeymap()` to a
plugin manifest, so the row's ID changes (`lyrics` →
`battuta.lyrics.open`) even though the key does not. The brief said so in
advance, which is what makes it a decision rather than a regression:

```
-    "lyrics": { "keys": ["l"] },
+    "battuta.lyrics.open": { "keys": ["l"], "plugin": "battuta.lyrics" },
```

in both layouts, and nothing else. Regenerated with `npm run
keymap:snapshot -w @battuta/editor`; the diff is in the CHANGELOG bullet.
**Read the diff before you trust it** — that is the only thing standing
between "the id moved" and "a key changed".

### 7.2 A plugin test cannot see its own message

The lifecycle suite first recorded messages by wrapping `host.execute`. It
recorded nothing: the lane store is built inside `createHost` with the
host's own executor captured in its deps, so replacing the `execute`
property on the returned object changes nothing the lane ever calls. That
is not a bug — a store that could be re-pointed from outside would be a
worse one — but it leaves a plugin test two seams and neither is the
message:

- the **session adapter** receives the core `Command` the host built, whose
  `label` is all a plugin package may read of it (applying it would need
  core);
- the **registered spec** is reachable through `host.lanes.specOf(id)`, and
  calling its `commit` returns the message directly.

So the suite asserts the label at the adapter (proving the host really
executed) and the message at the spec (proving what the plugin asked for),
and `syllable.test.ts` proves the values. **Three assertions of three
different things beat one assertion through a seam that does not exist.**

### 7.3 A caption keyed by an id that moved — the third time

`onscreen-keyboard/src/keys.ts` had `SHORT.lyrics = "lyrics"`, keyed by the
core action id. The id is now `battuta.lyrics.open`, so the button's
caption would have fallen back to its bound key and read **"l"**. Nothing
would have failed: the coverage test asks whether every keymap row is
*reachable*, not whether its caption is the nice one.

This is the third slice in a row to meet it (the reflection cycle in slice
2, the on-screen keyboard's own variants in 4b), so it is not a trap any
more, it is a checklist item: **when a binding changes id, grep the repo
for the old id string, not just for compile errors.** Here that found the
caption; `docs/scripts/build-keymap.mjs` already reads plugin manifests
(slice 2 taught it to) and the shortcut editor renders from the union
keymap at runtime, so those two followed on their own.

### 7.4 What "leaves entry mode" belongs to

`l` must do nothing in note entry, but the status-bar lane box must open
the lane *and* leave entry mode. In `App.tsx` these were one branch and one
select, and it was easy to read the second as the lane's behaviour.

It is the HOST's: `ctx.lanes.open` always leaves entry mode, because that
is what picking a lane means. The plugin's handler therefore declines
*before* calling it (`if (ctx.editor.get().entryMode) return`) rather than
making `open` conditional — and the brief warned in exactly those words.
Two tests, one per path, because the difference is invisible in one.

### 7.5 What did not happen, and is worth recording as an absence

- **No api addition.** The first slice of this phase to need none and to
  have expected none: 5a's *API may grow* listed every piece with "5b" as
  the consumer, and the list was right. Compare slice 4b, which stopped
  on three gaps.
- **No new spec field.** The brief's *Stop when* is "a lane needs a third
  state of a field". Lyrics uses `attachesTo: "note"`, `advance: "note"`
  and a three-key `advanceOn`, all of which existed for it already, and
  leaves harmony's four grammar fields unset. Nothing needed a third state.
- **No state at all in the plugin.** Worth saying because the two previous
  plugins both hold some, and it is the sign of a point that fits: the
  document holds the syllables and the host holds the buffer, so there is
  nowhere for the plugin to keep anything.

## 8. Recipe

The shortest path to a lane plugin. Read `packages/plugins/README.md`
alongside; steps 1–8 of the reflection plugin's recipe still apply for the
package shape (no vitest config, extensionless relative imports, `exports`
at `src/`).

1. **Copy the package** from `packages/plugins/reflection` — a lane plugin
   needs no react and no jsx, so it is the smaller of the two templates.
2. **Write `src/manifest.ts` first**, and put the lane's FACE there
   (`id`, `label`, `name`, `glyph`, `place`). Spread it into the spec in
   `index.ts` instead of retyping: the status-bar row and the floating
   editor are then the same object.
3. **Declare the lane, do not only register it.** `contributes.lanes` is
   what puts it in the status bar before your code exists; `ctx.lanes.
   register` in `activate` is what gives it behaviour. Declare
   `onLane:<id>` so picking it wakes you.
4. **Put the lane's own logic in its own pure module** over plain data —
   not over `ctx`. Ours takes four values and returns a `SylValue | null`;
   it is the file with the tests worth reading, and it needs no host.
5. **Return messages from `commit`; never call `ctx.execute` there.** null
   = nothing changed (no undo step), `{ refuse: "…" }` = a notice and the
   key stops. The host does the rest.
6. **Ask what the host can hand you before asking for a query.** We needed
   the previous note; `LaneCommit.prevEventId` was already there. A query
   surface you do not add is the cheapest kind.
7. **Decline in the handler, not in the spec.** A plugin keybinding has no
   `when`; read `ctx.editor` and return.
8. **Grep for the old binding id** across the repo when one moves (§7.3),
   and regenerate the keymap snapshot deliberately (§7.1).
9. **Run the feature's e2e first**, against the tree as it is, and watch it
   pass — then extract, and watch it pass unchanged. For lyrics that script
   already existed because 5a wrote it before touching anything.
