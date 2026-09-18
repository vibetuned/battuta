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
 *   import { manifest as mine } from "@battuta/plugin-mine/manifest";
 *   …
 *   { manifest: mine, load: () => import("@battuta/plugin-mine") },
 */
import type { PluginEntry } from "@battuta/api";
import { manifest as folderView } from "@battuta/plugin-folder-view/manifest";
import { manifest as formats } from "@battuta/plugin-formats/manifest";
import { manifest as harmony } from "@battuta/plugin-harmony/manifest";
import { manifest as lyrics } from "@battuta/plugin-lyrics/manifest";
import { manifest as onscreenKeyboard } from "@battuta/plugin-onscreen-keyboard/manifest";
import { manifest as pitchReference } from "@battuta/plugin-pitch-reference/manifest";
import { manifest as playback } from "@battuta/plugin-playback/manifest";
import { manifest as reflection } from "@battuta/plugin-reflection/manifest";

export const BUILTIN_PLUGINS: readonly PluginEntry[] = [
  { manifest: reflection, load: () => import("@battuta/plugin-reflection") },
  { manifest: onscreenKeyboard, load: () => import("@battuta/plugin-onscreen-keyboard") },
  { manifest: lyrics, load: () => import("@battuta/plugin-lyrics") },
  { manifest: harmony, load: () => import("@battuta/plugin-harmony") },
  { manifest: playback, load: () => import("@battuta/plugin-playback") },
  { manifest: formats, load: () => import("@battuta/plugin-formats") },
  { manifest: folderView, load: () => import("@battuta/plugin-folder-view") },
  { manifest: pitchReference, load: () => import("@battuta/plugin-pitch-reference") },
];
