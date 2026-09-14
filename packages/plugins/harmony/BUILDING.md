# Building the harmony lanes

The fourth battuta plugin, the second on the `lanes` point, and the one
that decides whether the point was a point or a pair of special cases.
Written for the next author — a person or an agent — who has this file,
`packages/plugins/README.md`, and nothing else.

Read `lyrics/BUILDING.md` first: this file is mostly the same shape, and
the interesting parts are where it differs. The headline: **the point
needed no change for its second consumer** — not a field, not a query, not
a host line — and the two lanes here use `accepts`, `transform`,
`complete` and `suggest`, the four fields lyrics leaves unset. That is the
rule of three landing.

## 1. Origin

An extraction, in two hops, like lyrics. Harmony shipped in 0.0.3 as one
of two near-identical modals inside `App.tsx`'s key handler; slice 5a made
the mechanism a host module with harmony and lyrics as INTERNAL specs and
their bodies still in `App.tsx`. This slice moves the harmony bodies out —
**the last lane code in the App**.

| What | Where it was | Where it is |
| --- | --- | --- |
| the two `LaneSpec`s (one function of `kind`) | `App.tsx`, registered as internal lanes | `src/index.ts` |
| the grammars `CHORD_RE` / `RNA_RE` and their validators | `packages/core/src/harm.ts` | **stayed in core** after a detour (§7.2); `complete` asks `ctx.query.harmValid` |
| the charsets `HARM_CHARS` | `packages/core/src/harm.ts` | `src/grammar.ts` as `CHARS` (→ `accepts`) |
| the numeral key mapping (`o` → `°`, `0` → `ø`) | inline in the internal spec | `src/grammar.ts` as `transformRna` |
| `CHORD_QUALITIES`, `RNA_BASES`, `harmSuggestions` | `packages/core/src/harm.ts` | `src/grammar.ts` as `suggestions` (→ `suggest`) |
| the suggestion test | `packages/core/test/harm.test.ts` | `test/grammar.test.ts`, case for case |
| the lane faces (label, name, glyph, place) | the internal specs' arguments | `contributes.lanes` in the manifest |

**`App.tsx`: 3,109 → 3,091 lines (−18), and it now has no lane code at
all** — what remains is the lane *adapter* (the caret path and what sits
on it), which is the document's, not any lane's. Core's `harm.ts` lost 55
lines and three exports; `session.ts` lost `setHarm`, which nothing had
called since the internal specs left. `@battuta/api` **0.1.6 → 0.1.8**:
0.1.7 dropped `ctx.query.harmValid`, 0.1.8 changed what `core.setHarm`
promises.

**The grammar split, and where it landed after review.** Core's `harm.ts`
used to hold four kinds of thing. The brief split them by *validity*:
regexes and validators stay in core because `SetHarmCommand` refused on
them, the plugin takes the rest and asks core through
`ctx.query.harmValid`. That is how the slice first shipped, and on review
it did not survive its own justification:

> **the command refused because core owned the grammar.** The refusal was
> the only thing holding the regexes there, and it was circular.

So the whole grammar came over, and the line is simpler:

| Stays in core | Here |
| --- | --- |
| `harmTextAt` — where a `<harm>` hangs and how to read it; `isHarmText` — what may be written into it (asked as `harmValid`) | `CHARS` (→ `accepts`), `transformRna` (→ `transform`), `suggestions` (→ `suggest`, asking `harmValid` for its one grammar rule) |
| `SetHarmCommand` — how to write one, undoably | `CHARS` — which keys may extend a buffer (→ `accepts`) |
| `HarmKind` — which of the two ELEMENTS (§7.4) | `transformRna`, `CHORD_QUALITIES`, `RNA_BASES`, `suggestions` |

**Core knows how to put text into a `<harm>`; this plugin knows what text
a harmony is.** That is the reflection plugin's rule applied without an
exception — *if a function has no MEI knowledge — it transforms
`PitchEvent[]`, **parses a chord symbol**, decides a cycle — it is the
plugin's, even if it sat in core before* — and `CHORD_RE` is a regex over
a string, with MEI putting no constraint on `<harm>` text at all.

**What this costs, stated plainly:** `core.setHarm` now writes the text it
is given, so a plugin sending that message directly can write junk into a
`<harm>` — exactly as `core.setSyl` already lets any text into a `<syl>`.
Nothing the USER can do reaches it: the lane's `complete` stops an
incomplete buffer before a message is built, which is where the refusal
was always felt. What is gained is that turning the plugin off unloads the
grammar with the feature, and that there is one opinion about what a chord
symbol is instead of two modules agreeing.

## 2. Manifest

```
id                battuta.harmony
engines.battuta   ^0.1.8
capabilities      none
activationEvents  onLane:battuta.harmony.chord, onLane:battuta.harmony.rna
contributes       2 lanes, 0 commands, 0 keybindings
```

- **Two declared lanes**, so the status bar lists both before a byte of
  this code exists. Picking either fires its `onLane:` — and `activate`
  registers **both**, because a user who picks one will pick the other.
- **`onLane:` and nothing else.** Harmony has no key and never had one, so
  there is no `onCommand:` to declare either. That is the difference from
  lyrics, and it is the whole activation story.
- **No keybinding**, which is why the union keymap snapshot is
  byte-identical through this slice — the first lane extraction where it
  is.
- **The faces live in the manifest** (`LANES`, keyed by lane id) and
  `src/index.ts` spreads them into the specs, so the status-bar row and
  the floating editor cannot disagree. The strings are 0.0.3's verbatim.

Deliberately NOT declared: no capabilities, no `onStartup`, no slot item,
no panel, no settings or storage keys (§4).

## 3. API surface

| Phase | Call | Why |
| --- | --- | --- |
| read | `ctx.query.harmAt(eventId, kind)` | the lane's `read`, and what `commit` compares against |
| ask | `ctx.query.harmValid(kind, text)` | the lane's `complete`, and the predicate `suggestions` takes for its slash-continuation rule (restored 2026-09-15, see §7.2) |
| write | `{ type: "core.setHarm", eventId, kind, text }` | returned from `commit`; the host executes it |
| lifecycle | `ctx.lanes.register(spec)` | twice, once per lane |

That is the whole list — three entries, and no `ctx.execute`, no
`ctx.editor`, no `ctx.notice`. Types named: `HarmKind`, `LaneSpec`,
`PluginContext`, `LaneContribution`, `PluginManifest`, plus test-only
ones. Values: `definePlugin`. **No react**: a lane plugin renders nothing.

**What the API had to grow for this plugin: nothing — and then it
SHRANK.** The message and the two queries landed in-house before the
slice, with this plugin named as their consumer, which is what made the
extraction gapless. Then the grammar came over, and
`ctx.query.harmValid` lost its only consumer: an api export with nobody
outside its own module to call it is symmetry, not design, so it left
(**0.1.7**). One more number followed, and it is the honest one:
`core.setHarm`'s doc comment promised a refusal, and the message no longer
refuses — the report snapshots the prose because the prose IS the
contract, so the guard refused to regenerate until the version moved
(**0.1.8**). **An api that can shrink is the consumer-naming rule working
in both directions; a guard that catches a comment is the surface report
working as intended.** *And then it grew back (0.1.10, 2026-09-15):*
`harmValid` returned with the consumer this slice had not seen — the next
writer of a `<harm>` (§7.2). The two paragraphs above stand as what the
slice believed and why; the table above them is current.

**What did NOT have to change, which is the point of the slice:**

- **No spec field.** The brief's *Stop when* was "the harmony lane needs a
  spec field or a query the internal spec did not". It needed neither:
  `attachesTo: "event"`, `advance: "event"`, `advanceOn: ["Enter"]`,
  `accepts`, `transform`, `complete`, `suggest`, `read`, `commit` were all
  already there, because 5a ran these two lanes on them before either
  left. **A point shaped against two consumers before either is extracted
  is what makes the extraction boring.**
- **No third state of a field.** Both harmony lanes take the same value of
  every field except `place`, the transform, and which grammar they ask
  about — so they are one function of `kind`, which is what they were in
  `App.tsx`.
- **No query beyond `harmAt`.** After the grammar moved, the only thing
  the plugin cannot answer for itself is what is already written at an
  event — which is the document's, and the one question it asks.

## 4. State

**Transient (memory).** None — not one variable in the `activate` closure.
The buffer, the open lane and the caret are the host's; the harmony is the
document's.

**Persisted.** No settings key, no storage key; a test asserts both.

**Document (MEI).** `<harm startid="#…">` in the event's measure —
`place="above"` for chord symbols, `type="rna" place="below"` for numerals
— written by core's `SetHarmCommand` through the `core.setHarm` message.
Nothing else. The two kinds are independent at the same event, which is
core's `isKind` rule, not the plugin's.

**Nothing mutates the document outside `ctx.execute`** — and this plugin
never calls it: `commit` RETURNS a message and the host executes it, so
even the write is data. Structurally: the package imports `@battuta/api`
and its own two modules, there is no door to core, and
`apps/editor/test/plugin-boundaries.test.ts` fails the build if one
appears.

## 5. Command messages

One message, both lanes:

**`{ type: "core.setHarm", eventId, kind, text }`** → `SetHarmCommand`,
built by the host's `toCommand`. `kind` is what makes one message serve
two lanes.

- **Sent** from `commit`, and only when `text !== harmAt(eventId, kind)` —
  unchanged text returns null, which matters here more than in lyrics
  because Enter walks the caret along a row of events that mostly carry no
  harmony at all. Every one of those must cost no undo step.
- **`text: ""` clears** the harmony of that kind at that event.
- **The command labels itself** and **refuses invalid text**, which is why
  `complete` asks the same grammar first: the host stops an incomplete
  buffer with a notice before the message is ever built.
- **Revert strategy: memento**, byte-identical; dirty region is the
  event's `(measureIndex, staffN)`.

The plugin defines no commands, so no fuzz harness leaves core.

## 6. Tests

| Suite | Pins | Run |
| --- | --- | --- |
| `test/grammar.test.ts` (13) | both grammars and the suggestion cases, **moved from core assertion for assertion**; that the pool caps at six and never offers the buffer back; the "/" continuation rule through an injected `valid`; both charsets, including that each refuses the other's keys; the transform, and that what it produces is admitted by the charset it feeds | `npx vitest run --root packages/plugins/harmony` |
| `test/harmony.test.ts` (17) | both lanes declared before any code loads and no key contributed; picking either registers BOTH; where the two differ (place, transform) and where they must not; a commit on a rest (which lyrics refuses); the two lanes independent over one event; unchanged text writing nothing; clearing; `complete`/`suggest`/`accepts` asking the document; off/on | same |
| `packages/core/test/harm.test.ts` | `SetHarmCommand` and `harmTextAt` — the ELEMENT. Every grammar case moved here, and the old "rejects invalid text" case is now "writes the text it is given" | `npx vitest run --root packages/core` |
| `apps/editor/test/lanes.test.ts` | the lane MECHANISM. Not this plugin's, and not re-tested here | `npm test -w @battuta/editor` |

**e2e gates.** `spikes/verify-phase5.mjs` §7i drives both lanes in the
browser — typing, Tab completion, the numeral landing below with
`type="rna"`, Escape, and the undo unwind — and **every assertion is
identical, with exactly the two design-dependent hooks the brief named
changed**: the select's option VALUES, `chord` / `rna` → the plugin's lane
ids. The select itself is found by `data-lanes`, which is the host's.
`verify-lyrics.mjs` and the other scripts are untouched, and the union
keymap snapshot is byte-identical.

## 7. Dead ends

The shortest §7 of the four plugins so far, which is itself the finding.
Start from `lyrics/BUILDING.md` §7 — its four entries all still apply, and
§7.3 there (a caption keyed by an id that moved) did not bite this time
only because harmony has no key.

### 7.1 A test's fake grammar that was wrong about itself

`test/grammar.test.ts` injects a narrowed `valid` predicate where the
plugin passes `ctx.query.harmValid`. Two assertions written against it
failed on the first run, and **both were the test being wrong, not the
code**: `Cm` *is* accepted by the fake regex, so `Cm/` was rightly offered;
and `suggest("chord", "")` returns the seven roots through an early return
that never meets the six-item cap.

Worth recording because the reflex is to "fix" the code when a fresh test
fails. The tell is that the same numbers came from core's own suite
unchanged: when a moved test fails on arrival, suspect the move, not the
thing moved. The cap and the root list are now asserted as the two
different behaviours they are.

### 7.2 A split justified by the thing it caused

The brief settled where the grammar goes in one sentence — validity in
core because the command refuses on it, affordances in the plugin — and
the slice shipped that way: three consts and a function moved, one call
site became a predicate parameter, core's export list lost two names.

It did not survive the first reading. **The command refused because core
owned the grammar**; nothing else held the regexes there, and "core must
keep them because core checks them" is an argument in a circle. The test
that breaks it is to ask what the module is FOR: core's `harm.ts` is for
the element — where a `<harm>` hangs, how to read it, how to write it
undoably — and none of that needs to know a chord from a numeral. MEI
itself does not.

Two things made the circularity easy to miss, and both are worth
recognising elsewhere. The justification was **true as stated** (the
command did refuse, so core did need the regexes) while being false about
causation. And the split *felt* principled — "validity versus
affordances" is a real distinction, it just was not the one that decides
where code lives. **A rule that explains the code you already have is not
the same as a rule that would have produced it.**

What is left is a line that needs no qualifier: core owns the element,
the plugin owns the vocabulary. §1 has the table and the one thing it
costs.

*Reversed the same day (2026-09-15, by the user).* The argument above was
right about one thing and blind to another. Right: "core refuses on it"
alone does not hold a grammar in core — that IS circular. Blind: the
grammar has a second writer coming. A generator plugin that reads a
measure and writes its harmony sends the same `core.setHarm`, and every
writer must be refused the same text; a guard that lives in one plugin
guards one plugin. So validity went back below every writer — core's
`isHarmText`, `SetHarmCommand` refusing on it, `ctx.query.harmValid`
restored on the api (0.1.10) — and this plugin kept the affordances and
asks the question (`complete` is `harmValid`; `suggestions` takes it as a
parameter). The rule the user stated: **if the api validates, it
validates every time.** The lesson for the next reader: when a rule
seems circular, look for the consumer it was protecting before deleting
it — the brief had not named the generator, and should have.

### 7.3 A per-keystroke host query, which the move deleted

While the grammar was split, `suggest` took the validator as an injected
predicate and the plugin passed `ctx.query.harmValid` — so every keystroke
asked the host whether the buffer was a complete symbol. Free today (a
regex behind a direct call), and exactly the line that would have become a
per-keystroke round-trip if the query facade ever moves to a worker, which
PLANNING.md keeps deferring rather than ruling out.

Moving the grammar removed it without anyone optimising anything:
`suggest` calls the validators in its own module now. Worth recording
because the reflex when you notice a hot call through an abstraction is to
cache it — and the better question is why the answer is on the other side
of the boundary at all.

*With §7.2 reversed, the per-keystroke query is back*, and accepted with
eyes open: a regex behind a direct call, and if the query facade ever
moves to a worker the answer is to batch or cache at that boundary, not
to copy the grammar into the plugin. The cost was always the lesser one.

### 7.4 What stayed in core, and the type that made it look wrong

The grammar moved and `HarmKind` did not, which reads at first like
something forgotten — the api declares its own `HarmKind` in
`document.ts`, so core's looks like a duplicate of a type the plugin can
already see.

It is not the grammar, and that is the whole answer: **`HarmKind` is the
discriminator of an ELEMENT.** Core still has to know there are two kinds
of `<harm>` and how each is written — `isKind` reads `type="rna"`,
`SetHarmCommand` writes `type` and `place`, `harmTextAt` finds the right
one of the two anchored at an event. Those are MEI facts, which is
exactly what core kept when the vocabulary left. Moving it would have
meant core taking the kind as an untyped string, which buys nothing and
loses the one place a typo is caught.

**The duplication is forced, not accidental.** Neither package may import
the other: the api is standalone by rule (a plugin sees no core type, and
`plugin-boundaries` fails the build over it), and core sits below the api
so a swapped core changes nothing for plugins. Two layers that must not
depend on each other, both needing to name the same two strings, is the
price of the standalone rule — and the price is two string literals.

What WAS missing is the thing that keeps them equal. `toCommand` passes
the api's `HarmKind` into core's parameter, which fails to compile if the
API grows a member core lacks — but the other direction was silent: a
kind added to core alone would have left the api quietly unable to ask
for it. `apps/editor/src/host/messages.ts` now pins both directions with
a type-level assertion, in the one place both types are in scope. I
checked it bites by adding a third kind to core alone and watching the
editor's typecheck fail.

**When you find the same type in two layers, ask whether the layers may
import each other before calling it duplication.** If they may not, the
question is not "which copy is wrong" but "where do they meet, and is
that meeting point holding them together".

*Superseded the same day (2026-09-15, in-house).* The premise above was
too strong: "the api may not import core" guards plugins from the MODEL,
and a type-only re-export of a plain-data type is not the model. Core
owns `HarmKind` (and `SylValue`, `CaretPosition`, `BlockSelection`,
`Pitch`, `PitchEvent` — four of which had been declared twice since slice
2); `packages/api/src/document.ts` re-exports exactly those six, and the
surface report prints the declaration behind each so the pin covers their
shape. The assertion in `host/messages.ts` is gone because a type
declared once cannot drift; the build orders itself through a TypeScript
project reference (the api's `tsc -b` builds core first). The lesson
stands with one more step: **before pinning two copies together, ask
whether the rule that forbids the import forbids THIS import — a rule
about the model does not forbid re-exporting a data type.**

### 7.5 What did not happen

- **No gap.** The second slice in a row to need nothing from the api, and
  the first where the point itself was under test rather than the plugin.
- **No `App.tsx` lane code left.** The mechanism went in 5a, lyrics in 5b,
  harmony here; what remains is the adapter, which is the document's view
  of the caret path and would exist for any lane at all.
- **No keymap change.** Harmony is picked from the lane box, so the
  snapshot is byte-identical — unlike the lyrics slice, which moved `l`.

## 8. Recipe

A second lane plugin, after lyrics. Read that one's §8 first; these are
the differences.

1. **Declare every lane the plugin owns, and register them all on
   activation.** A user who picks one will pick the other, and one
   `onLane:` is enough to wake you.
2. **Write the specs as one function of what differs.** Ours differ in
   four values; the rest is shared, which is the honest way to say "these
   are two lanes of one feature".
3. **Own your vocabulary; ask the document about the document.** If your
   lane has a grammar, it is yours — what a symbol IS has no MEI knowledge
   (§7.2). Ask the host only what only the host can answer: where the
   caret is, what is already written there.
4. **Keep the pure module pure.** `grammar.ts` imports nothing at all, so
   it is testable with no fake and no host — and when something it needs
   looks like it must come through `ctx`, check whether it belongs to you
   (§7.3).
5. **Return null from `commit` when nothing changed.** For a lane whose
   advance key walks past mostly-empty events, that is the difference
   between an undo stack of edits and one of caret movements.
6. **Check the e2e's hooks before you start**: ours were two select option
   values, and knowing that up front is what made "every assertion
   identical" a claim rather than a hope.
