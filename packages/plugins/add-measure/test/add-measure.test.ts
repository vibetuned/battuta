/**
 * The plugin against a fake context: it puts one `end` tile on the overlays
 * point, the tile is a button marked for the pen, and pressing it sends
 * `core.appendMeasure` — a refusal becomes a notice. The + sits in the
 * middle of the staves.
 */
import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import type { EndOverlayProps, OverlaySpec, PluginContext } from "@battuta/api";
import plugin from "../src/index";
import { manifest } from "../src/manifest";
import { middleOf } from "../src/Plus";

function fixture(refuse = false) {
  const overlays: OverlaySpec[] = [];
  const executed: unknown[] = [];
  const notices: string[] = [];
  const ctx = {
    overlays: { add: (spec: OverlaySpec) => (overlays.push(spec), { dispose: () => {} }) },
    execute: (m: unknown) => {
      if (refuse) throw new Error("no measure to copy");
      executed.push(m);
    },
    notice: (text: string) => void notices.push(text),
  } as unknown as PluginContext;
  void plugin.activate(ctx);
  return { overlays, executed, notices };
}

const end: EndOverlayProps = { measureCount: 3, width: 150, height: 200, staves: [{ n: 1, lines: [60, 68, 76, 84, 92], context: { clef: { shape: "G", line: 2 }, keysig: "0", meter: { count: "4", unit: "4" } } as never }] };

describe("the add-measure plugin", () => {
  it("wakes at startup, on by default, and puts one end tile on the overlays point", () => {
    expect(manifest.activationEvents).toEqual(["onStartup"]);
    expect(manifest.enabledByDefault).toBeUndefined();
    const f = fixture();
    expect(f.overlays.map((o) => [o.id, typeof o.end, o.render, o.band])).toEqual([["plus", "function", undefined, undefined]]);
  });

  it("the tile is a button the pen can tap; pressing it appends a measure", () => {
    const f = fixture();
    // `end` gives the Plus element; rendered, it is the button.
    const plus = f.overlays[0]!.end!(end) as ReactElement<{ end: EndOverlayProps; onAdd: () => void }>;
    const el = (plus.type as (props: { end: EndOverlayProps; onAdd: () => void }) => ReactElement<{ "data-pen-tap": boolean; "data-add-measure": boolean; onClick: () => void; title: string }>)(plus.props);
    expect(el.type).toBe("button");
    expect(el.props["data-pen-tap"]).toBe(true);
    expect(el.props["data-add-measure"]).toBe(true);
    el.props.onClick();
    expect(f.executed).toEqual([{ type: "core.appendMeasure" }]);
    expect(f.notices).toEqual([]);
  });

  it("a refusal is a notice", () => {
    const f = fixture(true);
    const plus = f.overlays[0]!.end!(end) as ReactElement<{ end: EndOverlayProps; onAdd: () => void }>;
    plus.props.onAdd();
    expect(f.notices).toEqual(["add measure refused: no measure to copy"]);
  });

  it("the + sits in the middle of the staves: the middle line of one, between the staves of a system, the box's middle without any", () => {
    expect(middleOf([{ lines: [60, 68, 76, 84, 92] }], 200)).toBe(76);
    expect(middleOf([{ lines: [60, 68, 76, 84, 92] }, { lines: [140, 148, 156, 164, 172] }], 300)).toBe(116);
    expect(middleOf([], 200)).toBe(100);
  });
});
