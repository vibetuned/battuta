# Changelog

The phase-by-phase record of battuta, newest first: what each phase set
out to do (plan + exit criteria, moved here from
[PLANNING.md](PLANNING.md)) and what actually landed (moved here from the
README's old Status section). The open phase — extension architecture,
with reference layers and OMR folded into it — stays in
[PLANNING.md](PLANNING.md); its running record — one bullet per
decision, one per slice as it closes — is the unreleased section
below.

## 0.1.0 — unreleased (Phase 9 — Extension architecture)

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
