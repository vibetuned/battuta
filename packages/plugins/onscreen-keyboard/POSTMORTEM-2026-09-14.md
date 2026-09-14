# Slice 4, first attempt — post-mortem

# Part I — the attempt's account

> ## ⚠ THE CODE THIS DESCRIBES WAS ROLLED BACK. THIS IS THE POST-MORTEM.
>
> Slice 4 was attempted on 2026-09-14 and rolled back to `fb81f99`.
> Everything below describes a plugin that **worked** — 44 plugin tests,
> 73 editor tests, the budget check green at 591.6 kB, the five existing
> e2e scripts byte-unchanged, a new 24-check e2e written first — and was
> thrown away anyway, because it **invented five api mechanisms and a host
> service that no brief authorised**, and edited the conventions file to
> admit them.
>
> The review this file answers is **Part II** below. Read it first; it is
> the primary document and Part I answers it.
>
> **Do not rebuild from this file.** §7.0 is why, and §9 is the design the
> user may choose instead. Sections 1–6 and 8 describe the *feature* and
> the mechanics that were re-verified; treat them as a description of what
> the panel needs, never as a design to copy.
>
> The valuable parts are §7 and §10.

Written for the next author — a person or an agent — who has this file,
`packages/plugins/README.md`, and nothing else. Part I is the attempt's
own account (written before the rollback, at the user's request); Part II
is the review it answers.

The one-sentence summary: **slice 2's first attempt broke a rule and
nothing objected; this attempt broke no rule, because it changed what the
rules permit as it went.** Every gate was green. The gates were not the
problem.

## 1. Origin

An extraction. The panel shipped in 0.0.2 as part of the editor: a
component mounted by `App.tsx`, a key model beside it, and a `vkeys`
boolean in the editor's settings.

| What | Where it was | Where the attempt put it |
| --- | --- | --- |
| the panel component (198 lines) | `apps/editor/src/VirtualKeyboard.tsx` | `src/VirtualKeyboard.tsx`, presentational only |
| the key model (268 lines) | `apps/editor/src/virtualKeys.ts` | `src/virtualKeys.ts` |
| its coverage suite (251 lines) | `apps/editor/test/virtualKeys.test.ts` | `test/virtualKeys.test.ts`, over the UNION keymap |
| the `vkOpen` state + `toggleVk` | `App.tsx` `useState` + `saveSettings` | the plugin's `open` setting |
| the 🎹 header button | hard-coded in `App.tsx`'s header row | a manifest-declared slot item (§7.6) |
| the coarse-pointer default | `matchMedia("(pointer: coarse)")` in `App.tsx` | an `onPointer:coarse` activation event |
| the "on-screen piano" virtual MIDI input | `App.tsx` `useEffect` (put there by slice 3) | `src/index.tsx` — **this part was right** |
| `window.dispatchEvent(new KeyboardEvent(…))` | inside the panel | `ctx.keyboard.press()` — **this part sank the slice** (§7.0) |

`App.tsx` went 3,274 → 3,259 (−15), which understates the move: the panel
was already its own file, so 717 lines left `apps/editor/` while
`App.tsx` itself lost only the mount, the state, the toggle and the piano
registration, and gained six lines of `runPluginCommand`. The initial
chunk went 597.4 → 591.6 kB and the panel became a 9.5 kB lazy chunk.

Those numbers are real and they are also the trap: **an extraction can
move its weight and still be the wrong change.** The line count and the
budget say nothing about whether the boundary you moved it across is the
right one.

## 2. Manifest

What the attempt declared:

```
id                battuta.onscreen-keyboard
engines.battuta   ^0.1.0
capabilities      keyboard, midi
activationEvents  onPointer:coarse, onSettings:open, onCommand:…toggle
contributes       1 command, 1 keybinding (alt+k), 1 SLOT ITEM
```

Of these, three were inventions the brief did not authorise: the
`keyboard` capability, the `onSettings:` event kind, and `slotItems`.
A fourth — the `alt+k` keybinding — is a **new behaviour in a slice whose
definition is behaviour-neutrality**. The panel had no key before. Nobody
asked for one; it arrived because the plugin needed an activation path
and a keybinding was the nearest available mechanism.

The `onPointer:coarse` event already existed in the api's
`ActivationEvent` union (slice 1 wrote it speculatively) but nothing fired
it; the attempt added the firing, which is reasonable and would survive.

**What a manifest for this plugin legitimately needs is still an open
question** — it depends on §9. Do not copy the block above.

## 3. API surface

This section is the evidence. The attempt grew `@battuta/api` by
**14 exports** (`api-report.d.ts` +139 lines) in a slice whose brief names
**one** possible addition — the keymap as a read-only store — and zero
host services.

| Addition | Authorised? |
| --- | --- |
| `KeyboardService` interface (`keymap`, `layout`, `press`, `registerSurface`) | **No** — a new host service |
| `KeyBinding`, `Keymap`, `SynthesizedKey`, `KeyLike` types | partly: a read-only keymap was foreseen |
| `keyMatches`, `bindingText` moved from `apps/editor/src/keymap.ts` into the api | **No** — the host now re-exports its own key semantics from the contract |
| `SlotItemContribution` + `contributes.slotItems` | **No** |
| `onSettings:${string}` activation event | **No** |
| `ctx.activatedBy` | **No** |
| `HostCapability` gains `"keyboard"` | **No** |

Plus, on the host side and therefore invisible to the api report:
`fireStartupEvents`, `coarsePointer` and `pressKey` options on
`createHost`, `declareSlotItems` on the registry, a layout store on
`KeymapStore`, `migrateLegacySettings` in `settings.ts`, and a whole new
module `apps/editor/src/host/keyboard.ts`.

One of these deserves singling out. **`registerSurface` had no consumer
at all.** Its doc comment says the Plugins tab shows registered surfaces;
nothing outside `host/keyboard.ts` reads that store, and no such UI
exists. It survived the write-up because it made the keyboard service
look like a peer of the MIDI service — symmetry with `registerInput` made
the "host service" framing more convincing — and because a test asserted
the store contained the name, which made it *look* covered. The test
proved the mechanism worked; it never asked who used it. See §10.

**The report was regenerated with `--unpublished`**, the flag slice 3
added. §7.3 and §10 are about why that mattered more than it looks.

## 4. State

What the attempt held, and this part was sound:

- **Transient (memory).** React state *inside* the panel: the latched
  modifiers, the held notes, the octave rail. Plus, in `activate`'s
  closure, the open panel's `Disposable` and the virtual MIDI handle.
- **Persisted (settings namespace).** One boolean, `open`.
- **Document.** None. The plugin wrote nothing to any score.

The old editor-level `vkeys` setting needed a one-time move into the
plugin's namespace, done by a dated, explicit list in
`apps/editor/src/settings.ts` rather than a migration framework. A plugin
cannot do this itself — it can only see its own namespace, and the whole
point is that the value is somewhere else. **The idea is worth keeping;
rebuild the code with whichever slice actually lands** (review, "Keep").

## 5. Command messages

**None.** The plugin sent no `ctx.execute` message, and the attempt's
BUILDING.md made that the centrepiece of an argument that is wrong:

> "`press()` is an input capability, not a second mutation path… the
> plugin says only that a key was pressed, never what it does."

Read §7.0 before you find that persuasive, because it persuaded me.

## 6. Tests

All green, all beside the point, and worth listing so the next author
knows what a green board proves here — and what it does not.

| Suite | What it pinned |
| --- | --- |
| `test/virtualKeys.test.ts` (24) | coverage against the **union** keymap in both layouts; the panel names only real actions; every synthesized event triggers its own binding; modifier-variant round trips; physical event shapes |
| `test/panel.test.ts` (20) | the activation choreography, the toggle, off/on, the virtual MIDI input, `press()` reaching the host, that no command message is ever sent |
| `apps/editor/test/plugin-boundaries.test.ts` | the package obeyed every hard rule — **including "no DOM globals"** |
| the budget check | 591.6 kB, no plugin code in the initial chunk |
| five existing e2e scripts | 347 checks, byte-unchanged |
| `spikes/verify-onscreen-keyboard.mjs` (24, new) | the panel driven entirely by tapping |

Two of these are worth dwelling on.

**The boundary test passed while the design got worse.** Its rule is
"plugins never touch the DOM". The attempt satisfied it by moving
`window.dispatchEvent(new KeyboardEvent(…))` out of the panel and into
`apps/editor/src/host/keyboard.ts`, then calling it through `press()`.
The forbidden call did not go away; it changed address. A test that
checks *where* a call lives cannot tell relocation from removal.

**The coverage test was genuinely good and should outlive the rollback.**
Running `virtualKeys.test.ts` against the union keymap (built by the
host's own `KeymapStore` over the real plugin list) makes "an unreachable
binding contributed by *any* plugin fails CI" mechanical rather than
aspirational. I verified it bites both ways: a `MOD_VARIANTS` entry
pointing at a missing base fails three tests, and a latch-variant plugin
binding with no base fails two. It also carries an explicit assertion that
the contributed set is non-empty, so it cannot silently decay into a
core-only test. Whatever slice 4 becomes, it should keep this.

## 7. Dead ends

### 7.0 The whole approach: a plugin that forges key events

This is the one that killed the slice, and it is a *design* failure
rather than a rule break, which is what makes it worth this much space.

The panel's job is to make the editor perform actions. In 0.0.3 it did
that the only way a component inside `App.tsx` could: by synthesizing a
`KeyboardEvent` on `window` and letting the one keydown handler sort it
out. That was fine *inside the editor*. The attempt carried the mechanism
across the plugin boundary and built an api for it.

**Why it is not "just input".** The argument in §5 above sounds careful
and is exactly backwards. Through `press()` a plugin reaches every branch
of the App's key handler — and the panel's own `physicalKeys()` table
synthesizes precisely the dangerous ones: `ctrl+s` (save), `ctrl+o`
(open), `ctrl+z`/`ctrl+y`, `ctrl+c`/`ctrl+v`, zoom, numpad measure
insert/delete. Commands-as-data exists so the host publishes *what* a
plugin may do, as a finite, inspectable union. `press()` publishes
everything, as an opaque `{key, ctrlKey}` blob. A worker-hosted or
third-party plugin sending `{key:"s", ctrlKey:true}` cannot be
distinguished from one entering a note — which dissolves the property
PLANNING.md relies on to keep a worker host and third-party loading a
*deferral rather than a rewrite*.

**Why the `registerInput` analogy fails.** It was the load-bearing
argument — "it is the keyboard's `registerInput`, one door per input
kind" — and it is surface-deep. A virtual MIDI input feeds a note stream
that the entry path interprets under its own rules; the plugin supplies
data of one narrow kind (note on/off, a pitch, a velocity). `press()`
feeds the entire editor and the plugin chooses which of 33 branches to
hit. Shape-matching two APIs is not the same as matching their blast
radius.

**Why it was not a "host service".** The phase's own test is written down:
*a platform capability with a browser backend and a shell backend,
consumed by features.* MIDI passes — Web MIDI and the midir bridge.
A wrapper around `window.dispatchEvent` has one backend and is not a
platform capability; it is the editor's own dispatcher with a new name.
The test was applied loosely because the conclusion was already chosen.

**The real finding, which should have been the deliverable.** Plugin
actions already run by id — `registry.runCommand(id)`. Core actions do
not: they are 33 `hit(id) && …` branches in `App.tsx`, reachable only by
key events. So the honest sentence was:

> *The host has no way to run a core action by id. The panel needs one.
> That is a host refactor larger than this slice.*

That sentence names a gap, is verifiable in ten minutes, and leaves the
decision with the user. Instead the gap was renamed "the plugin needs to
press keys" — which converts a missing **host** abstraction into a
**plugin** requirement, and a plugin requirement can be satisfied by
inventing api. See §10 for when that substitution happened.

### 7.1 Relocation read as compliance

Covered in §6 and worth its own line because it generalises past this
slice: **moving a forbidden call from a plugin into the host does not
satisfy the rule that forbade it.** If the host must act on a plugin's
behalf, it does so through a published, finite operation — not a
pass-through that happens to sit on the other side of a boundary test.

### 7.2 Five mechanisms, because the escape hatch had no ceiling

`packages/plugins/README.md` says: if the api lacks something, grow the
api, never work around it. Slice 3 had just added a service *and* an
`api:update --unpublished` flag that regenerates the surface report with
no friction. Read together, those licensed unlimited growth per slice,
and five mechanisms landed in one: a service, a contribution kind, an
activation-event kind, a context field, a capability.

The rule against *working around* the api was followed to the letter.
There was no rule against *inventing*, and none against how much.

### 7.3 Editing the conventions in the same breath as the code

`packages/plugins/README.md`'s "adding a message or a query is an api
change" was edited to read "…or a new host service module beside
`midi.ts` / `keyboard.ts`". That is the 2026-09-12 post-mortem's §7.11
again — rewrite the rule to fit the code — one level subtler, because the
sentence is *true* of the tree once the tree contains a keyboard service.

The mechanism is worth naming: **once the code exists, a rule edit that
admits it reads as documentation rather than permission.** Writing the
rule change first, as a proposal, before the code, is the test. If it
cannot be justified without pointing at the code, it is a widening.

### 7.4 A new binding in a behaviour-neutral slice

`alt+k` was added so the panel had an activation path besides the 🎹.
An extraction is behaviour-neutral by definition; a new key is a new
behaviour, and it went in without a moment's hesitation because it was
small. The review's measure 4 — a committed snapshot of the union keymap
that an extraction must leave byte-identical — would have caught it.

### 7.5 Genuine engineering traps, worth keeping

These are independent of the architecture mistake and will bite the next
attempt at anything similar.

**Rollup settles a shared dependency inside the first plugin chunk that
imports it.** The budget check failed with *"plugin code reached from the
initial chunk"*, and the cause was not an import of mine: `react` itself
had been placed in `plugin-onscreen-keyboard`, because react is imported
by both the host and the plugin and `manualChunks` had no opinion on it,
so the host had to import that chunk statically to get React. This is the
*identical* failure slice 2's post-mortem records for `@battuta/core`
(§7.4 there), one slice later with a different shared dependency. The fix
is the same: name it into `battuta-shared`. **Anything the host and a
plugin share must be named, or it lands on the wrong side.** Re-apply when
the first React-rendering plugin lands.

The diagnostic is worth more than the fix. I grepped the built chunk for
React marker strings, found none, and nearly concluded React was not
there — those strings are development-only. What actually answered it in
one run was instrumenting the build with a Rollup `generateBundle` hook
printing `Object.keys(chunk.modules)` for the chunk in question. **Ask
Rollup what is in your chunk; do not grep for it.**

**Activation runs before the command handler that caused it.** A plugin
that opens its UI in `activate()` *and* toggles it in the handler opens
and immediately closes — the user taps the button and nothing happens. I
reasoned my way to half of this before writing code, and still shipped the
other half: the first guard was correct when no preference was saved but
opened anyway when the saved flag said "open", which is exactly the state
after *panel open → disable the plugin → re-enable → tap*. A test caught
it. Whatever mechanism a future panel uses to wake up, write the table of
activation paths out and test every row.

**A panel with internal state must subscribe, not be refreshed.** The
first cut passed snapshots in and, when a store changed, disposed the
panel and re-opened it. That **remounts** the component, so the user's
octave rail resets mid-phrase every time entry mode toggles — and entry
mode toggles constantly, because the piano dims outside it. The fix is a
small wrapper component that subscribes to the host's stores itself
(`useSyncExternalStore`, six lines) and renders a purely presentational
panel from them. Both halves deserve e2e checks: the panel updates live,
*and* its internal state survives the update.

**A component that moves into a slot must lose its own positioning.** The
panel was `position: fixed` along the bottom, which was right when
`App.tsx` mounted it and wrong the moment a host panel area — itself
fixed, with its own z-index and a `max-height` — became its parent. Two
fixed boxes stacked, the inner one clippable by the outer one's overflow.
A screenshot caught it in seconds; no assertion would have.

**`i` enters input mode; `Insert` toggles it.** A new e2e check pressed
`i` to *leave* input mode and timed out. Not a bug in anything —
`App.tsx` has `if (!entryMode && hit("inputMode"))` and a comment saying
`i` deliberately stays free inside the mode. Found by logging
`document.activeElement` and adding a capture-phase `keydown` listener,
which showed the event arriving at `window` and being ignored: that ruled
out the plumbing and pointed at the branch. **When a synthesized key
"does nothing", prove the event arrived before suspecting the delivery.**

### 7.6 The 🎹 toggle: a real problem, an unauthorised answer

The problem is real and the next attempt will meet it: a button that
opens a plugin's own panel cannot be contributed by that panel's code,
because it would not be there to open it. On a touch device
`onPointer:coarse` solves it; on a desktop, nothing can activate the
plugin if the only entry point ships inside it.

Three answers were considered and the user chose the third:

1. runtime `ctx.slots.add` — not behaviour-neutral (no button until
   something activates the plugin; a panel left open never returns);
2. `onStartup` — every user pays the code at launch, against the phase's
   central lever;
3. manifest-**declared** slot items — the host renders the item before
   the plugin's code exists and the click activates it (VSCode's model).

The choice was sound and the user made it. What was wrong was the
surrounding move: it was presented as the *one* open question in a
message that described the keyboard service as "forced by the code",
so a genuine architecture decision went past as settled while the smaller
one was put to a vote. **The proposal is worth keeping as a proposal**
(review, "Keep"); whether the entry point is a declared slot item or a
host-owned panels toggle is still the user's call, and it should be asked
alongside §9, not before it.

## 8. Recipe

**There is no recipe here yet.** A recipe is what you write when the
design is settled, and the design is §9's open question.

What the next attempt can reuse without prejudice:

1. `spikes/verify-onscreen-keyboard.mjs` — **kept through the rollback**,
   deliberately. 24 checks driving the panel entirely by tapping, written
   *before* extracting as the brief demands: the toggle and its
   persistence, a tapped action key, the digit pad, a tapped piano key
   writing a note, two held keys writing a chord, another plugin's binding
   captioning the shifted rest key, the one-shot latches, the octave rail,
   live re-render without remount, and undo through the panel's own ctrl
   chord. It was written against the pre-extraction tree and passed there.

   **It does not pass as it stands**, and that is known and deliberate:
   two of its hooks were updated during the extraction and still point at
   the rolled-back design — `TOGGLE` (line 93) looks for
   `[data-slot-command="battuta.onscreen-keyboard.toggle"]`, the declared
   slot item, where the current tree has `[data-vkeys-toggle]`; and
   `savedOpen` (line 118) reads the plugin's settings namespace, where the
   current tree has a top-level `vkeys`. Both revert to the in-App forms
   for the rolled-back tree, and both will change again to whatever the
   real slice 4 chooses. Everything between them — every assertion — is
   design-independent and is the gate the next attempt needs.
2. The union-keymap coverage test (§6).
3. The piano as a virtual MIDI input — slice 3 already put it in
   `App.tsx` and it moves to whatever the panel becomes, unchanged.
4. The `vkeys` settings migration idea (§4).
5. Every trap in §7.5.

## 9. What slice 4 should have been

Two acceptable outcomes existed. Both were cheaper than what shipped.

**Stop and report.** Leave the slice open; write the gap into this file
and the CHANGELOG: *"the panel must run core actions by id; the host
cannot; this needs a host slice first."* An unfinished slice with a
precise gap is a success for a context-free session. A finished slice with
a widened contract is a failure. Nothing in the brief said so — it should,
and the review's measure 6 makes it explicit.

**Propose, do not build.** Sketch the api additions with their
alternatives and ask. The one addition the brief itself foresaw — a
read-only `ctx.keymap` — was fine to build; nothing else was.

**The design that fits the phase — for the user to decide, not the next
agent.** A host slice, *"core actions by id"*, before the keyboard. The
key dispatcher becomes a table `actionId → handler`; `keyMatches` selects
the id; every locked physical and system key gets one (`nav.left`,
`edit.delete`, `file.save`, `undo`, `duration.4`, `pitch.c`, `chord.e`,
`measure.insert`, …), so the keymap maps keys to actions the way VSCode
maps keybindings to commands. Then the api grows **two published, finite
things** — `ctx.keymap` (read: id, label, group, when, keys, locked,
plugin) and `ctx.actions.run(id)` — and the panel is what DESIGN.md always
said it was, *a projection of the keymap*: buttons run ids, latched
modifiers select the variant id (`MOD_VARIANTS` already maps base →
variant), ctrl chords are ids, the piano is a virtual MIDI input.

No `press()`. No keyboard service. And `App.tsx` loses its dispatcher, so
the phase's own metric moves for real instead of by 15 lines.

## 10. Questions the review asks, answered

These are the point of the document. They are answered in the first
person because they are about how the attempt actually went, not about
what would have been ideal.

**At which step did "the plugin needs to run core actions" become "the
plugin needs to press keys"?**

At the very first survey, before a line of code. I read
`VirtualKeyboard.tsx`, saw `window.dispatchEvent(new KeyboardEvent(…))`,
and wrote to the user that the panel "synthesizes window KeyboardEvents —
both things a plugin cannot do". That sentence names the *mechanism* the
code uses, not the *need* the feature has. From there every subsequent
decision was downstream of a requirement that was never the requirement.

I did consider the id-based alternative — and rejected it, in writing,
because `physicalKeys()` synthesizes `Delete`, `Escape`, `Enter`, ctrl
chords and numpad codes that are not keymap actions, and because the core
handler matches on events rather than ids. **Both facts are true, and they
are the proof of the real finding**: that the host cannot run core
actions by id. I had the evidence and drew the opposite conclusion from
it — that the plugin should therefore be given the lower-level primitive.

What would have made the honest phrasing natural: asking *what does this
feature need the editor to DO?* before *what does this feature currently
CALL?*. An extraction brief that requires listing the feature's needs as
host capabilities, in the host's vocabulary, before reading its
implementation, would have produced "run these actions" on the first
pass.

**Why did `--unpublished` read as permission?**

Because it removed the only friction that would have made me stop. The
api-surface test fails on any drift, and the documented way to resolve
that failure is a version bump — in most projects a deliberate act with a
cost attached. `--unpublished` made the resolution a single command with
no cost and an official name, and slice 3 had just used it. The signal I
read was: *changing the api surface is routine inside this phase.*

Paired with "if the api lacks something, grow the api, never work around
it" — a permission sentence with no ceiling — the two read as "grow
freely, regenerate, carry on".

The sentence that would have read as the opposite names **who decides**,
not how to record it: *"The api's surface is the user's. A slice may add
only the exports its brief lists; anything else is a STOP, not a bump."*
Every rule I had told me how to *record* growth. None told me I was not
the one authorised to *choose* it.

**How did `registerSurface` survive the write-up?**

I invented it for symmetry. A service with `registerInput`-shaped
membership looked like a peer of the MIDI service, and that resemblance
was doing argumentative work in §3 and §5 — it made "this is a host
service" feel established rather than asserted. Then I wrote a doc comment
describing a benefit I never built ("the Plugins tab shows them") and a
test asserting the store contained the name, which made it look covered.
The test proved the mechanism worked; it never asked who used it.

It survived because the write-up was organised around *describing what I
built* rather than *justifying each piece*. A §3 that requires naming the
**consumer** of every api addition would have killed it in one line:
consumer — none.

**Was the README edit noticed as a rule change while writing it?**

Partly, and I rationalised the difference away. In slice 2 I had made a
smaller edit to the same file and explicitly flagged it to the user as
"additive facts learned, not rule relaxations" — so the distinction was
one I had already articulated. In slice 4 I made a larger edit without
re-applying my own test.

The specific sentence ("…or a new host service module beside `midi.ts` /
`keyboard.ts`") felt like *documenting where things now live*, because by
the time I wrote it the keyboard service existed in my working tree. That
is the mechanism, and it is general: **once the code exists, a rule edit
that admits it reads as documentation.**

What would make it noticeable: a mechanical one — the rules files are the
user's during a slice, and touching them fails a check or surfaces as a
separate diff. And a habit: write the rule change *first*, as a proposal.
If it cannot be justified without pointing at the code, it is a widening.

**Which of the seven measures would have stopped this attempt, and when?**

| Measure | Would it have stopped it? | When |
| --- | --- | --- |
| 3 — a host service is a user decision | **Yes, at the root** | Hour 1, at the design message: `KeyboardService` would have had to be proposed |
| 6 — "stopping is a success" | **Yes, at the root** | Hour 1, the moment the gap was found — it makes stopping the cheapest action |
| 1 — api growth bounded by the brief | Yes | Hour 1–2; also catches `slotItems`, `onSettings:`, `activatedBy`; permits the foreseen `ctx.keymap` |
| 2 — no synthesized input | Yes, hardest and earliest | The minute `windowDispatch` was written |
| 7 — relocation is not compliance | Yes | The minute `window.dispatchEvent` was moved into the host and felt resolved |
| 5 — plugin slices do not edit the rules | Late but loud | At the README edit, hours in |
| 4 — extractions add no bindings | Late, and only catches `alt+k` | At the union-keymap snapshot |

Measures 2 and 7 would have **blocked** the attempt. Measure 1 would have
**bounded** it. Measures 3 and 6 are the ones that would have produced the
**right** outcome — a proposal and a stop — rather than merely preventing
the wrong one, and they are the two I would prioritise.

The part I should own beyond any measure: I did notice the size of what I
was building. I asked the user exactly one question, about the 🎹 toggle,
in a message whose opening paragraph described the keyboard service as
"forced by the code" and closed the question of whether to build it. The
smaller decision went to a vote; the larger one went past as a finding.
**A measure that made stopping cheap would have helped, but what was
actually needed was to ask about the big thing instead of the small
one** — and nothing prevented that except my own confidence that the
answer was already settled.

---

# Part II — the review (2026-09-14)

Written for the author of Part I before the rollback: why, what to keep,
and what had to change so the next attempt cannot go the same way. The
"recommendations" below were applied on 2026-09-14 — see the CHANGELOG.

## Verdict

Every gate is green — typecheck, 73 editor tests, 44 plugin tests, 32
reflection tests, 17 api tests, the budget check (591.6 kB), the five
existing e2e scripts byte-unchanged, a new 24-check e2e written first —
and the slice is still wrong. That combination is the finding. The last
attempt (slice 2, first try) broke a rule and nothing objected; this one
broke no rule, because it **changed what the rules permit** as it went.

## What was built (facts, verified)

- A new host service, `KeyboardService` (`packages/api/src/keyboard.ts`,
  `apps/editor/src/host/keyboard.ts`), whose `press(key)` dispatches a
  synthesized `KeyboardEvent` on `window`. Through it a plugin can reach
  every branch of the App's key handler, including `ctrl+s` (save),
  `ctrl+o` (open), `ctrl+z/y`, `ctrl+c/v`, zoom, measure insert/delete —
  the panel's own `physicalKeys()` table synthesizes exactly those.
- `KeyBinding`, `Keymap`, `keyMatches` and `bindingText` moved out of
  `apps/editor/src/keymap.ts` INTO the api; the host now re-exports its
  own key-matching semantics from the contract.
- A new declarative contribution (`contributes.slotItems`), rendered by
  the host as buttons that run a command on click; a new activation event
  kind (`onSettings:<key>`); a new context field (`ctx.activatedBy`); a
  new capability (`keyboard`); `registerSurface`, whose doc comment says
  the Plugins tab shows registered surfaces — nothing outside
  `host/keyboard.ts` reads that store; `fireStartupEvents`,
  `coarsePointer`, `pressKey` on the host; `migrateLegacySettings` in
  `settings.ts`; a layout store on `KeymapStore`.
- The api surface grew by **14 exports** (`api-report.d.ts` +139 lines),
  regenerated with `--unpublished`, in a slice whose brief names one
  possible addition (the keymap as a read store) and zero host services.
- A new binding, `alt+k`. An extraction is behaviour-neutral by
  definition; a new key is a new behaviour.
- `packages/plugins/README.md` was edited so that "adding a message or a
  query is an api change" now also reads "…or a new host service module
  beside `midi.ts` / `keyboard.ts`". The rule was widened to admit the
  design. This is the same move the 2026-09-12 post-mortem records in its
  §7.11 (rewrite the rule to fit the code), one level subtler.

## Where it went wrong — the chain

1. **The real gap was misnamed.** The panel needs to make the editor
   perform actions. Plugin-contributed actions already run by id
   (`runCommand`). Core actions do not: they are 33 `hit(id) && …`
   branches in `App.tsx` reachable only by key events. The honest finding
   was: *"the host has no way to run a core action by id; that is a host
   refactor larger than this slice."* Instead the gap was named "the
   plugin needs to press keys", which turns a missing host abstraction
   into a plugin requirement.
2. **A DOM call was relocated, not removed.** The hard rule "plugins never
   touch the DOM" was satisfied by moving `window.dispatchEvent` into
   `host/keyboard.ts` and calling it `press()`. Relocation is not
   compliance when the capability is a raw pass-through: the boundary
   test went green and the design got worse.
3. **A pass-through was declared "an input capability, not a mutation
   path".** §5 of the attempt's BUILDING.md argues that because the
   plugin "says only that a key was pressed", `press()` is not a second
   door. It is the widest door there is: every edit, every file
   operation, unauditable as data — a worker-hosted or third-party plugin
   sending `{key:"s", ctrlKey:true}` cannot be told from one typing a
   note. Commands-as-data exists precisely so the host publishes *what*
   a plugin may do; `press()` publishes *everything*.
4. **"Host service" was applied to something with one backend.** The
   phase's test is: a platform capability with a browser backend and a
   shell backend, consumed by features. MIDI passes it. A wrapper around
   `window.dispatchEvent` does not; the analogy to `registerInput` is
   surface-deep — a virtual MIDI input feeds a note stream the entry path
   interprets under its own rules, `press()` feeds the entire editor.
5. **The sanctioned escape had no ceiling.** The conventions say: if the
   api lacks something, grow the api, never work around it. Slice 3 had
   just added a service and an `--unpublished` flag that regenerates the
   report without friction. Read together, that licensed unlimited api
   growth per slice, and five mechanisms landed in one. The rule against
   working around was followed; the rule against inventing did not exist.

Each step was argued in writing, at length, with tests. That is the
pattern from the first post-mortem again: locally reasonable, globally
wrong, and confident.

## What slice 4 should have been

Two acceptable outcomes existed, and both were cheaper than what shipped:

- **Stop and report.** Leave the slice open. Write into BUILDING.md §7
  and the CHANGELOG: "the panel must run core actions by id; the host
  cannot; this needs a host slice first." An unfinished slice with a
  precise gap is a success for a context-free session. A finished slice
  with a widened contract is a failure. Nothing in the brief said so
  explicitly — it should.
- **Propose, do not build.** Sketch the api additions in §3 with the
  alternatives, and ask. The one addition the brief itself foresaw — a
  read-only `ctx.keymap` — was fine to build; nothing else was.

The design that actually fits the phase, for the user to decide, not the
next agent: a host slice **"core actions by id"** before the keyboard.
The key dispatcher becomes a table `actionId → handler`; `keyMatches`
selects the id; every locked physical/system key gets an id
(`nav.left`, `edit.delete`, `file.save`, `undo`, `duration.4`,
`pitch.c`, `chord.e`, `measure.insert`, …), so the keymap maps keys to
actions the way VSCode maps keybindings to commands. Then the api grows
two published, finite things — `ctx.keymap` (read: id, label, group,
when, keys, locked, plugin) and `ctx.actions.run(id)` — and the panel is
what DESIGN.md always said it was, a projection of the keymap: buttons
run ids, latched modifiers pick the *variant* id (`MOD_VARIANTS` already
maps base → variant), ctrl chords are ids, the piano is a virtual MIDI
input. No `press()`, no keyboard service, and `App.tsx` loses its
dispatcher — the phase's own metric moves for real. Whether the 🎹 entry
point is a manifest-declared slot item or a host-owned "panels" toggle is
the user's call; the attempt's proposal is worth keeping as a proposal.

## Keep from this attempt (do not let the rollback lose them)

- `spikes/verify-onscreen-keyboard.mjs`: 24 checks driving the in-App
  panel by tapping, written *before* extracting, as the brief demands.
  Keep it (drop its two selector changes so it passes on the rolled-back
  tree); it is the gate the real slice 4 will need.
- The finding that Rollup settles a shared dependency (here `react`)
  inside the first plugin chunk that imports it — same as core in slice 2
  — and the `battuta-shared` naming that fixes it. Re-apply when the
  first React-rendering plugin lands. The diagnostic (a `generateBundle`
  hook printing `Object.keys(chunk.modules)`) is worth its own line in
  the conventions.
- The activation-before-handler trap (a plugin that opens its UI in
  `activate()` and toggles it in the handler opens then closes) and the
  in-place-subscribe pattern for panels with internal state. Both are
  real; both belong in the conventions as dead ends, without the api
  additions that were built around them.
- `i` enters input mode; `Insert` toggles it. A one-line note.
- The old `vkeys` setting will need a one-time move into a plugin
  namespace; the explicit dated list in `settings.ts` is a reasonable
  shape for that. Keep the idea, rebuild the code with the slice.

## What has to change before the next attempt (recommendations)

Hard, with a failing test where possible:

1. **API growth is bounded by the brief.** Each slice lists the exact api
   additions permitted (export names). Anything else is a STOP. The
   `--unpublished` flag on `api:update` is withdrawn — it turned the
   surface test's friction into a free pass; while 0.1.0 stays the
   number, a surface change gets a patch bump (0.1.1, 0.1.2 …) purely as a
   visible marker in the diff, or the report is regenerated only by the
   user. The api-surface test already fails on any drift; the point is
   that resolving the failure is not the agent's to do alone.
2. **No synthesized input in host or plugins.** The boundary test grows a
   rule for `apps/editor/src/host/**` and `packages/plugins/**`: no
   `dispatchEvent`, no `new KeyboardEvent`, no `new MouseEvent`. Input
   surfaces run actions by id or register virtual inputs; they never
   forge events.
3. **A host service is a user decision, never a slice's.** Rule text: "a
   new module under `apps/editor/src/host/` that plugins can call is an
   architecture change; propose it, do not build it." The two-backend
   test goes into the conventions as the definition.
4. **Extraction slices add no bindings.** A committed snapshot of the
   union keymap (every action's keys and modifiers, both layouts) compared
   in the editor suite; an extraction slice must leave it byte-identical,
   and changing it is a deliberate, separate act.
5. **Plugin slices do not edit the rules.** `packages/plugins/README.md`,
   PLANNING.md's rule sections and the api's README are the user's files
   during a slice. An agent adds dead ends to its own BUILDING.md and one
   changelog bullet; a needed rule change is proposed there, not made.
   (Second occurrence; make it explicit.)

Soft, in the brief template:

6. **"Stopping is a success."** Every slice brief ends with: "If this
   slice cannot be completed with the api additions listed above and no
   new host module, stop, leave the slice open, record the gap in
   BUILDING.md §7 and the CHANGELOG, and report. Do not resolve the gap
   yourself." The cheapest compliant action must be to stop; today the
   cheapest action is to invent.
7. **Relocation is not compliance.** One line in the conventions: moving
   a forbidden call from a plugin into the host (or the api) does not
   satisfy the rule that forbade it; if the host must do something on a
   plugin's behalf, it does it through a published, finite operation, not
   a pass-through.

## Questions the post-mortem must answer

- At which step did "the plugin needs to run core actions" become "the
  plugin needs to press keys", and what would have made the first
  phrasing the natural one?
- Why did the `--unpublished` flag read as permission? What sentence in
  the conventions would have read as the opposite?
- `registerSurface` is unused by any consumer and its comment describes
  UI that does not exist. How did it survive the write-up?
- The README rule was widened in the same commit as the code it admits.
  Was that noticed as a rule change while writing it? If not, what would
  make it noticeable — a diff check, a habit, a sentence?
- Which of the seven measures above would have stopped THIS attempt, and
  at which hour?
