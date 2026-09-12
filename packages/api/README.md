# @battuta/api

The plugin contract of the battuta host: the manifest a plugin declares,
the activation events that load its code, and the context it receives —
everything a plugin can see or do. Pure types plus three small runtime
helpers (`validateManifest`, `satisfiesEngine`, `DisposableStore`); no DOM,
no React runtime (React's `ReactNode` type is used for slot items).

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
