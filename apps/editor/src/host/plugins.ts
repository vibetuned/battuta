/**
 * The plugins this build ships. The manifest is imported STATICALLY (a
 * small object, so the host knows the bindings and commands at once);
 * the code is a dynamic import, fetched on the first activation event.
 * Vite names each plugin's chunk `plugin-<name>` (vite.config.ts) and
 * the bundle-budget check refuses a build where one of those chunks is
 * reached from the initial chunk.
 *
 * Adding a plugin (see packages/plugins/README.md):
 *
 *   import { manifest as reflection } from "@battuta/plugin-reflection/manifest";
 *   …
 *   { manifest: reflection, load: () => import("@battuta/plugin-reflection") },
 */
import type { PluginEntry } from "@battuta/api";

export const BUILTIN_PLUGINS: readonly PluginEntry[] = [];
