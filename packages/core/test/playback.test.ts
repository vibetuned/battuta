import { describe, it, expect } from "vitest";
import { buildEventIndex, playbackShaping, mergeTiedSpans, GATE_DEFAULT } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const setup = (body: string) => {
  const { score } = scoreFrom(mei(body));
  const index = buildEventIndex(score);
  return playbackShaping(score, index);
};

describe("playbackShaping", () => {
  it("chains @tie attributes across the barline (same pitch only)", () => {
    const s = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="c" oct="4" dur="2" tie="i"/><note xml:id="b" pname="c" oct="4" dur="2" tie="m"/>
      </layer></staff></measure>
      <measure n="2" xml:id="m2"><staff n="1"><layer n="1">
        <note xml:id="c" pname="c" oct="4" dur="2" tie="t"/><note xml:id="d" pname="c" oct="4" dur="2"/>
      </layer></staff></measure>`);
    expect(s.ties["a"]).toBe("b");
    expect(s.ties["b"]).toBe("c");
    expect(s.ties["c"]).toBeUndefined(); // t ends the chain
    expect(s.ties["d"]).toBeUndefined();
  });

  it("reads <tie> control events too", () => {
    const s = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="g" oct="4" dur="2"/><note xml:id="b" pname="g" oct="4" dur="2"/>
      </layer></staff><tie xml:id="t1" startid="#a" endid="#b"/></measure>`);
    expect(s.ties["a"]).toBe("b");
  });

  it("gates: staccato/staccatissimo/tenuto and slur legato (artic wins)", () => {
    const s = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="c" oct="4" dur="4"/><note xml:id="b" pname="d" oct="4" dur="4" artic="stacc"/>
        <note xml:id="c" pname="e" oct="4" dur="4" artic="stacciss"/><note xml:id="d" pname="f" oct="4" dur="4" artic="ten"/>
      </layer></staff><slur xml:id="sl" startid="#a" endid="#b"/></measure>`);
    expect(s.gates["a"]).toBe(1.0); // slurred
    expect(s.gates["b"]).toBe(0.5); // stacc beats the slur (portato-ish)
    expect(s.gates["c"]).toBe(0.3);
    expect(s.gates["d"]).toBe(1.0);
    expect(GATE_DEFAULT).toBeLessThan(1.0); // unshaped notes detach slightly
  });

  it("chord-level artic covers members; a member's own artic wins", () => {
    const s = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <chord xml:id="ch" dur="4" artic="stacc">
          <note xml:id="x" pname="c" oct="4"/><note xml:id="y" pname="e" oct="4" artic="ten"/>
        </chord><rest dur="4"/><rest dur="2"/>
      </layer></staff></measure>`);
    expect(s.gates["x"]).toBe(0.5);
    expect(s.gates["y"]).toBe(1.0);
  });
});

describe("mergeTiedSpans", () => {
  const events = [
    { tstamp: 0, on: ["a"] },
    { tstamp: 1000, off: ["a"], on: ["b"] },
    { tstamp: 2000, off: ["b"], on: ["x"] },
    { tstamp: 2500, off: ["x"] },
  ];

  it("merges a tie chain into one attack with the summed duration", () => {
    const { roots, durations } = mergeTiedSpans(events, { a: "b" }, {});
    expect(roots["a"]).toBe("a");
    expect(roots["b"]).toBe("a"); // continuation: no attack
    expect(durations["a"]).toBe(2000);
    expect(durations["x"]).toBe(500);
  });

  it("same-pitch repeats WITHOUT a tie re-attack normally", () => {
    const { roots, durations } = mergeTiedSpans(events, {}, {});
    expect(roots["b"]).toBe("b");
    expect(durations["a"]).toBe(1000);
    expect(durations["b"]).toBe(1000);
  });

  it("clone ids resolve through idMap (repeat passes stay tied)", () => {
    const cloned = [
      { tstamp: 0, on: ["a-rend2"] },
      { tstamp: 1000, off: ["a-rend2"], on: ["b-rend2"] },
      { tstamp: 2000, off: ["b-rend2"] },
    ];
    const { roots, durations } = mergeTiedSpans(cloned, { a: "b" }, { "a-rend2": "a", "b-rend2": "b" });
    expect(roots["b-rend2"]).toBe("a-rend2");
    expect(durations["a-rend2"]).toBe(2000);
  });
});
