/**
 * The lyrics lane, as a plugin.
 *
 * `l` (or the status-bar lane select) opens a text lane under the staff;
 * typing builds a syllable, space or enter commits it and moves to the
 * next NOTE — over rests — and `-` commits it hyphenated, so a word can be
 * spread across several notes. The verse goes into the MEI as `<syl>`
 * inside `<verse n="1">`.
 *
 * Everything the lane MECHANISM does — the buffer, the key protocol, the
 * floating editor, the advance over the caret path, reloading when the
 * caret moves — is the host's (slice 5a). What is here is only what is
 * particular to lyrics: they hang on notes, they advance note by note,
 * three keys commit, and a committed buffer becomes `<syl>` attributes.
 * That last part is `syllable.ts`, pure and testable on its own.
 *
 * Imports `@battuta/api` and this package's own files, and nothing else.
 * The single write is a `core.setSyl` message the host turns into core's
 * `SetSylCommand`, so this plugin cannot mutate in a way the host has not
 * published — and `apps/editor/test/plugin-boundaries.test.ts` fails the
 * build if that ever stops being true.
 */
import { definePlugin, type PluginContext } from "@battuta/api";
import { COMMAND_OPEN, LANE_ID, manifest } from "./manifest";
import { syllableCommit } from "./syllable";

const LANE = manifest.contributes!.lanes![0]!;

export default definePlugin({
  activate(ctx: PluginContext) {
    ctx.lanes.register({
      ...LANE,
      // A syllable hangs on a note or a chord; the host refuses a commit
      // anywhere else (with an empty buffer it lets the caret pass a rest
      // by, which is how you skip one while typing a verse).
      attachesTo: "note",
      // …and the advance therefore skips rests: the next syllable belongs
      // to the next NOTE, not to the next event.
      advance: "note",
      // Space and Enter end a word; `-` ends a syllable and hyphenates.
      advanceOn: [" ", "Enter", "-"],
      hint: "lyrics: type at the caret · space/enter advances · - hyphenates · esc leaves",
      // No `accepts`, `transform`, `complete` or `suggest`: lyrics are free
      // text, so every printable character is admitted, nothing is
      // rewritten, a buffer is never "incomplete", and there is nothing to
      // suggest. Those four fields are the harmony lane's.
      read: (eventId) => ctx.query.lyricAt(eventId)?.text ?? "",
      commit: ({ eventId, buffer, key, prevEventId }) => {
        const value = syllableCommit({
          buffer,
          key,
          existing: ctx.query.lyricAt(eventId),
          // The host hands over the previous note along the caret path;
          // its `con` is how this syllable knows it is mid-word. That one
          // answer is the whole reason the plugin needs no model access.
          previous: prevEventId ? ctx.query.lyricAt(prevEventId) : null,
        });
        // null = nothing changed: no command, no undo step, no notice.
        return value === null ? null : { type: "core.setSyl", eventId, value };
      },
    });

    ctx.registerCommand(COMMAND_OPEN, () => {
      // `l` does nothing in note entry, where it is a plain letter waiting
      // for a use — 0.0.3's rule. The status-bar select still opens the
      // lane from entry mode, because the HOST leaves entry mode for it;
      // that is the select's behaviour, not the key's.
      if (ctx.editor.get().entryMode) return;
      ctx.lanes.open(LANE_ID);
    });
  },
});
