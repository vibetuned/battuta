/**
 * The plugin manifest: everything the host needs to know about a plugin
 * WITHOUT loading its code. Declarative contributions (commands,
 * keybindings) take effect at registration; the code is fetched only
 * when one of the activation events fires. A disabled or never-triggered
 * plugin therefore costs exactly one manifest object.
 */

/** Events the host fires; a plugin's code loads on the first one it declares. */
export type ActivationEvent =
  | "onStartup"
  | `onCommand:${string}`
  | `onLane:${string}`
  | `onFormat:${string}`
  | `onDocument:${string}`
  | `onView:${string}`
  | "onPlay"
  | `onPointer:${string}`;

export const ACTIVATION_EVENT_PREFIXES = ["onStartup", "onCommand:", "onLane:", "onFormat:", "onDocument:", "onView:", "onPlay", "onPointer:"] as const;

/**
 * Host capabilities a manifest may require. A capability is a platform
 * service with a browser backend and a shell backend (never a plugin);
 * the host refuses to register a plugin needing one it does not offer.
 * Grows as host services are lifted (`midi` lands in slice 3).
 */
export type HostCapability = "midi" | "workspace" | "playback";

export const HOST_CAPABILITIES: readonly HostCapability[] = ["midi", "workspace", "playback"];

/**
 * UI slots a plugin may place an item in. `header` is the first header row
 * (tabs, view toggle); `docHeader` the second (title, tempo, and the player
 * in page view — where a playback plugin's controls go); `statusBar` the
 * bottom bar; `menu` the battuta menu. Panels are a separate mechanism.
 */
export type SlotName = "header" | "docHeader" | "statusBar" | "menu";

export const SLOT_NAMES: readonly SlotName[] = ["header", "docHeader", "statusBar", "menu"];

export type KeyboardLayout = "qwerty" | "azerty";

export interface CommandContribution {
  /** Global command id; convention `<pluginId>.<verb>`, e.g. `battuta.reflection.cycle`. */
  id: string;
  /** Shown in menus and notices. */
  title: string;
}

export interface KeybindingContribution {
  /** The command this key runs; must be one of the plugin's own `commands`. */
  command: string;
  /** e.key values that trigger it (letters carry their case, so "R" means shift+r). */
  keys: string[];
  /** When set, e.altKey must equal it; unset means alt must be OFF. */
  alt?: boolean;
  /** When set, e.shiftKey must equal it (for non-letter keys). */
  shift?: boolean;
  /** Row label in the shortcut editor and the on-screen keyboard. */
  label: string;
  /** Shortcut-editor group: an existing one (entry, accidentals, marks, rhythm, repeats, system) or a new one. */
  group: string;
  /** Context note shown in the editor, e.g. "block selection". */
  when?: string;
  /** Per-layout key overrides where the default keys do not exist on a layout. */
  layouts?: Partial<Record<KeyboardLayout, { keys: string[]; shift?: boolean }>>;
}

/**
 * A slot item DECLARED in the manifest rather than added at runtime: the
 * host renders it before the plugin's code has ever loaded, and clicking
 * it runs one of the plugin's commands — which is what activates the
 * plugin. This is how a plugin's UI gets an entry point: a button that
 * opens a panel cannot be contributed by the panel's own code, or it would
 * not be there to open it. Runtime `ctx.slots.add` stays the way to
 * contribute an item that needs live state.
 */
export interface SlotItemContribution {
  /** Stable within the plugin. */
  id: string;
  slot: SlotName;
  /** The item's face: an emoji or a very short label. */
  label: string;
  /** Tooltip. */
  title?: string;
  /** Run on click; must be one of the plugin's own `commands`. */
  command: string;
  /** Lower renders first among the slot's items. */
  order?: number;
}

export interface PluginContributions {
  commands?: CommandContribution[];
  keybindings?: KeybindingContribution[];
  slotItems?: SlotItemContribution[];
}

export interface PluginManifest {
  /** Dotted lowercase id, e.g. `battuta.reflection`. Unique across the registry. */
  id: string;
  /** Display name for the Plugins tab. */
  name: string;
  /** The plugin's own version (informational). */
  version: string;
  description?: string;
  /** The `@battuta/api` range this plugin was built against, e.g. `^0.1.0`. */
  engines: { battuta: string };
  activationEvents: ActivationEvent[];
  capabilities?: HostCapability[];
  contributes?: PluginContributions;
}

const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** Every problem with a manifest, in plain words; empty means valid. */
export function validateManifest(input: unknown): string[] {
  const problems: string[] = [];
  if (typeof input !== "object" || input === null) return ["manifest must be an object"];
  const m = input as Record<string, unknown>;
  if (typeof m["id"] !== "string" || !ID_RE.test(m["id"])) problems.push(`id must be a dotted lowercase identifier like "battuta.reflection" (got ${JSON.stringify(m["id"])})`);
  if (typeof m["name"] !== "string" || !m["name"].trim()) problems.push("name is required");
  if (typeof m["version"] !== "string" || !/^\d+\.\d+\.\d+/.test(m["version"])) problems.push("version must be semver (x.y.z)");
  const engines = m["engines"] as Record<string, unknown> | undefined;
  if (typeof engines !== "object" || engines === null || typeof engines["battuta"] !== "string") problems.push("engines.battuta (an @battuta/api range) is required");
  const events = m["activationEvents"];
  if (!Array.isArray(events)) problems.push("activationEvents must be an array");
  else {
    for (const ev of events) {
      if (typeof ev !== "string" || !ACTIVATION_EVENT_PREFIXES.some((p) => (p.endsWith(":") ? ev.startsWith(p) && ev.length > p.length : ev === p))) {
        problems.push(`unknown activation event ${JSON.stringify(ev)}`);
      }
    }
  }
  const caps = m["capabilities"];
  if (caps !== undefined) {
    if (!Array.isArray(caps)) problems.push("capabilities must be an array");
    else for (const c of caps) if (!HOST_CAPABILITIES.includes(c as HostCapability)) problems.push(`unknown capability ${JSON.stringify(c)}`);
  }
  const contributes = m["contributes"] as PluginContributions | undefined;
  if (contributes !== undefined) {
    if (typeof contributes !== "object" || contributes === null) problems.push("contributes must be an object");
    else {
      const commandIds = new Set<string>();
      for (const c of contributes.commands ?? []) {
        if (!c || typeof c.id !== "string" || !c.id.trim()) problems.push("every command needs an id");
        else if (commandIds.has(c.id)) problems.push(`duplicate command id ${c.id}`);
        else commandIds.add(c.id);
        if (!c || typeof c.title !== "string" || !c.title.trim()) problems.push(`command ${c?.id ?? "?"} needs a title`);
      }
      for (const it of contributes.slotItems ?? []) {
        if (!it || typeof it.id !== "string" || !it.id.trim()) problems.push("every slot item needs an id");
        if (!it || typeof it.label !== "string" || !it.label.trim()) problems.push(`slot item ${it?.id ?? "?"} needs a label`);
        if (!it || !SLOT_NAMES.includes(it.slot)) problems.push(`slot item ${it?.id ?? "?"} needs a slot of ${SLOT_NAMES.join(", ")} (got ${JSON.stringify(it?.slot)})`);
        if (!it || typeof it.command !== "string" || !commandIds.has(it.command)) problems.push(`slot item ${it?.id ?? "?"} must name one of the plugin's own commands`);
      }
      for (const k of contributes.keybindings ?? []) {
        if (!k || typeof k.command !== "string" || !commandIds.has(k.command)) problems.push(`keybinding ${JSON.stringify(k?.command)} must name one of the plugin's own commands`);
        if (!k || !Array.isArray(k.keys) || k.keys.length === 0 || k.keys.some((x) => typeof x !== "string" || !x)) problems.push(`keybinding ${k?.command ?? "?"} needs a non-empty keys array`);
        if (!k || typeof k.label !== "string" || !k.label.trim()) problems.push(`keybinding ${k?.command ?? "?"} needs a label`);
        if (!k || typeof k.group !== "string" || !k.group.trim()) problems.push(`keybinding ${k?.command ?? "?"} needs a group`);
      }
    }
  }
  return problems;
}
