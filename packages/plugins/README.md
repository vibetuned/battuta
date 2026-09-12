# Plugins — conventions and templates

Everything a person or an agent needs to build a battuta plugin — or to
extract an existing feature into one — without having read the rest of
the repository. The architecture is in `PLANNING.md` (Phase 9); this file
is the practical side: where things are, what a plugin package looks
like, the rules the host enforces, how to verify, and the two documents
every plugin must carry.

## Where things are

| Path | What it is |
| --- | --- |
| `packages/api/` | `@battuta/api`, the contract. `src/manifest.ts` (what a plugin declares), `src/context.ts` (what a plugin receives). `api-report.d.ts` is the committed snapshot of the public surface. |
| `apps/editor/src/host/index.ts` | `createHost()` and the app's `host` singleton: keymap store, slots, panels, registry, notices, confirm, document/editor mirrors, `execute`, `dispatchKey`. |
| `apps/editor/src/host/registry.ts` | Registration rules, activation events, on/off, `runCommand`. Read its header comment first. |
| `apps/editor/src/host/keymapStore.ts` | Core keymap ∪ plugin bindings, reactive; overrides per layout. |
| `apps/editor/src/host/slots.tsx` | `<Slot>` (header / statusBar / menu) and `<Panels>` (bottom / side). |
| `apps/editor/src/host/services.ts` | Settings and storage namespaces, the enabled flag. |
| `apps/editor/src/host/plugins.ts` | **The list of shipped plugins.** Adding a plugin = adding an entry here. |
| `apps/editor/src/App.tsx` | The host UI. Plugin keys are dispatched at the END of its key handler (`host.dispatchKey`), slots sit in the header row, the battuta menu and the status bar. |
| `apps/editor/test/host.test.ts` | The host's guarantees as tests — the fastest way to see how the pieces fit. |
| `apps/editor/src/ShortcutEditor.tsx` | The 🌣 editor: shortcuts tab (your bindings appear there automatically) and the Plugins tab (your on/off switch). |
| `docs/src/content/docs/reference/plugins.mdx` | The user-facing page; gains one row per plugin. |
| `CHANGELOG.md` → `0.1.0 — unreleased` | Where your slice's bullet goes. `PLANNING.md` → Phase 9 → your slice: the brief. |

## Anatomy of a plugin package

```
packages/plugins/<name>/
  package.json        "@battuta/plugin-<name>"; exports "." and "./manifest"
  tsconfig.json       strict TS; "jsx": "react-jsx" if the plugin renders panels
  src/manifest.ts     export const manifest: PluginManifest = { … }   (no imports of plugin code!)
  src/index.ts(x)     export default definePlugin({ activate, deactivate })
  test/*.test.ts      vitest, against createHost() with memory settings/storage
  README.md           how to use it          (template below)
  BUILDING.md         how it was built       (template below)
```

The manifest module must stay tiny and import nothing from the plugin's
code: the host imports it statically to know your commands and bindings
before your code is ever fetched. The code is reached only through
`load: () => import("@battuta/plugin-<name>")`.

**Registration** — three edits outside your package:

1. `apps/editor/src/host/plugins.ts`: add
   `{ manifest, load: () => import("@battuta/plugin-<name>") }` (the
   manifest imported from `@battuta/plugin-<name>/manifest`).
2. `apps/editor/package.json`: add `"@battuta/plugin-<name>": "*"` to
   dependencies, then `npm install` at the repo root (the workspace glob
   `packages/plugins/*` is already there).
3. `docs/.../reference/plugins.mdx`: one row in the table.

Vite names your code's chunk `plugin-<name>`; the bundle-budget check
(`npm run budget -w @battuta/editor`) fails a build in which that chunk
is reachable from the initial chunk — i.e. someone imported your package
statically from the host.

Whether plugin packages point `exports` at `src/` (Vite and `tsc` both
consume TypeScript sources of linked workspace packages, so no build step)
or at a built `dist/` like core and api do, and whether plugin code may
import `@battuta/core` directly for pure helpers and `Command` classes,
are the first plugin's decisions to make and record in its `BUILDING.md`.
Later plugins follow the precedent.

## The rules the host enforces (and the ones it cannot)

1. **Everything through `@battuta/api`.** No imports from `apps/editor`,
   no DOM or SVG access, no reaching into the React tree. UI only through
   `ctx.slots.add(...)` and `ctx.panels.open(...)`, which take render
   functions.
2. **Mutation only through `ctx.execute(command)`.** One undo step, same
   invalidation as a core edit. A command is a core `Command` (apply /
   revert / dirty regions) — byte-identical revert is the invariant the
   fuzzer checks. The host never mutates the document on a plugin's behalf.
3. **No document state outside the document.** Transient state lives in
   memory; small values in `ctx.settings`; larger ones in `ctx.storage`.
   Anything about the SCORE goes into MEI through a command (or a declared
   sidecar file). "All plugins off" must leave every document byte-identical.
4. **Declare before you use.** Commands in the manifest; handlers in
   `activate` via `ctx.registerCommand` (the host refuses a handler for an
   undeclared command). Keybindings may only name your own commands. A
   binding whose id collides with a core action id is ignored — core wins.
5. **Dispose everything.** What the context hands back is tracked for
   you; anything else you create (timers, listeners) goes into
   `ctx.subscriptions`. Off = `deactivate()` then every disposable fires;
   the user sees no reload and nothing of yours remains.
6. **Activate as late as possible.** Keybindings activate you implicitly
   (`onCommand:<id>` fires when the key is pressed); declare `onStartup`
   only if you must run before any interaction — it costs every user your
   code at launch.
7. **Pin the API.** `engines.battuta: "^<API_VERSION>"`. If the API has to
   grow for you: change `packages/api/src`, bump its version, run
   `npm run api:update -w @battuta/api`, and write the change under the
   unreleased heading in `CHANGELOG.md`.
8. **Extractions are behaviour-neutral.** Every existing e2e script passes
   unchanged; if none drives the feature you are extracting, add one
   FIRST, then extract.
9. **Plugin keys come after core keys.** `host.dispatchKey` runs only when
   every core branch of the key handler fell through, and never while a
   text lane or the shortcut editor owns the keyboard.
10. **Two documents, always** — README.md and BUILDING.md, below. A slice
    is not closed without them.

## Verifying

```sh
npm run typecheck -w @battuta/editor
npx vitest run --root packages/core
npx vitest run --root packages/api
npm test -w @battuta/editor
npm run build -w @battuta/editor && npm run budget -w @battuta/editor
# browser e2e (Vite dev + Playwright's bundled Chromium); each script prints
# PASS/FAIL lines and exits 1 on any FAIL. Once: fetch the corpus scores.
sh spikes/fetch-fixtures.sh
mkdir -p /tmp/battuta-e2e
for s in app phase2 phase3 phase4 phase5; do
  BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-$s.mjs || echo "FAILED: $s"
done
sh spikes/verify-tauri.sh                     # the shell smoke; needs a display and Rust
```

Run the e2e scripts one at a time: two concurrent Chromiums plus two
Verovio worker pools make the render waits flaky. The scripts open the
committed fixture `fixtures/synthetic-context-changes.mei` and address
its notes by id (`cc-m2n1`) — never resave that file from the app.

Plugin tests run against a real host in memory:

```ts
import { createHost, memorySettings } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
const host = createHost({ layout: "qwerty", plugins: [entry], settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });
host.dispatchKey({ key: "R", shiftKey: true, altKey: false });   // presses your binding
```

`apps/editor/test/host.test.ts` shows the full pattern (a fixture plugin
that contributes one of everything, then every guarantee asserted).

## Closing a slice

- [ ] `README.md` and `BUILDING.md` in the plugin package, from the templates.
- [ ] Row in `docs/src/content/docs/reference/plugins.mdx`; `cd docs && npm run build` passes its drift check.
- [ ] `CHANGELOG.md` bullet under `0.1.0 — unreleased`: decisions, dead ends, `App.tsx` lines before → after (`wc -l apps/editor/src/App.tsx`), API version and any change to it, bundle figure if it moved.
- [ ] `DESIGN.md`: the feature's "becomes a plugin" note updated to how it is one (a sentence or two).
- [ ] `PLANNING.md`: the slice's status line under *Migration*.
- [ ] Everything under *Verifying* green, e2e scripts unchanged (or the new one you added first).

---

## Template — README.md (how to use it)

```markdown
# <Plugin name>

<One paragraph: what it does, in the user's terms. What a score gains
from it. When you would turn it off.>

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → <name>. Off deactivates it at
once: <what disappears — bindings, panel, menu items>. The switch is
remembered; a rebind of its keys survives off/on.

## Keys

<Never retype a table.> Its bindings appear in the shortcut editor under
the *<group>* group and on the on-screen keyboard; the generated
reference is at <link to docs reference/keyboard>.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| `<key>` | settings | <meaning, default> |
| `<key>` | storage | <what is kept, how big it can get> |

## What it does not do

<Deliberate limits, one line each.>

## Guide

<Link to the user-guide page.>
```

## Template — BUILDING.md (how it was built)

Fixed headings, in this order, all eight present even if a section says
"none". Write for the next author — a person or an agent — who has this
file, `packages/plugins/README.md`, and nothing else.

```markdown
# Building <plugin name>

## 1. Origin

<Extraction: what the code was before — files, the `App.tsx` branches,
hooks and refs it replaced; the commit range; `App.tsx` line count
before → after. New feature: the spec it was built to (link the
PLANNING.md slice / DESIGN.md section).>

## 2. Manifest

<Every contribution point and activation event declared, each with its
one-line reason. Then what was deliberately NOT declared, and why.>

## 3. API surface

<Every `@battuta/api` call used, grouped: read (document, editor,
settings/storage get), write (execute, settings/storage set), lifecycle
(registerCommand, slots, panels, subscriptions, notice, confirm). Anything
the API had to grow for this plugin, and the version that carried it.>

## 4. State

<Transient (memory): what and why it is safe to lose. Persisted
(storage namespace): keys and sizes. Document (MEI or sidecar): which
elements/attributes, through which commands. Then the sentence: "Nothing
mutates the document outside `ctx.execute`," and how you know.>

## 5. Commands

<Each command: what it changes, its revert strategy (memento or inverse),
its dirty regions, and how the apply-then-revert fuzzer covers it (or why
it cannot yet).>

## 6. Tests

<The suites and what each pins; how to run them; which e2e scripts gated
the extraction and stayed green (or the one you added first).>

## 7. Dead ends

<What was tried and dropped, with the reason. The most valuable section:
it is what stops the next plugin from repeating the experiment. "None" is
suspicious.>

## 8. Recipe

<The shortest path to a plugin like this one: files to copy, names to
change, the order to do it in, the checks to run at each step.>
```
