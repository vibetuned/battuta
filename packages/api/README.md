# @battuta/api

The plugin contract of the battuta host: the manifest a plugin declares,
the activation events that load its code, and the context it receives —
everything a plugin can see or do. **Standalone**: it imports nothing from
`@battuta/core` or the editor. What a plugin sees is data (`document.ts`:
snapshots, coordinates, pitches, the query facade; `midi.ts`: the MIDI
host service — devices, a note stream, virtual inputs, outputs;
`actions.ts`: the union keymap as data and the host's actions by id — the
door an input surface uses), what it does is a message (`messages.ts`: `ctx.execute({ type: "core.setPitches", … })`, mapped
to the real core command by the host). Pure types plus four small runtime
helpers (`validateManifest`, `satisfiesEngine`, `DisposableStore`,
`resolvePluginModule`); no DOM, no React runtime (React's `ReactNode` type
is used for slot items).

The host implementation lives in `apps/editor/src/host/`; the conventions
and templates for writing a plugin are in
[`packages/plugins/README.md`](../plugins/README.md).

## Versioning

The package version IS the API version. Plugins pin it through
`engines.battuta` (`"^0.1.0"`), and the host refuses to register a plugin
whose range its version does not satisfy.

`api-report.d.ts` is the committed snapshot of the public surface. The
surface test fails when the generated declarations differ from it, so a
type change cannot land unnoticed:

```sh
# after changing anything exported from src/:
#  1. bump "version" in package.json (0.x: minor for breaking, patch otherwise)
#  2. regenerate the report — refuses if the version was not bumped
npm run api:update -w @battuta/api
#  3. note the change under the unreleased heading in CHANGELOG.md
```

**The surface is the user's.** A slice may add only the exports its
brief lists; anything else is a STOP, not a bump. An approved change gets
a version bump even while the number is unpublished (0.1.0 → 0.1.1): the
bump is the visible marker in the diff, and the report script refuses to
rewrite the snapshot without one. (An earlier `--unpublished` flag that
skipped this was withdrawn on 2026-09-14 after a slice used it to grow the
surface by fourteen exports.)
