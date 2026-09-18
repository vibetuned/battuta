/**
 * Diagnose a note that never releases in playback (a tool, not a check):
 * open a score in the real editor, take the host's own timemap and
 * notation facts, build the SAME performance the player builds, and
 * replay the MIDI stream in the sink's delivery order looking for a pitch
 * attacked while it still sounds — the one thing a synth answers with a
 * voice held until "all notes off" — or an off and an on of one pitch
 * within two ms of each other. Prints the first sixteen attacks and what
 * is still sounding at the end. Written 2026-09-18 for a note held to the
 * end of `test.mei`; the stream was clean, and the sink's delivery was
 * made deterministic the same day.
 *
 * Run (node ≥ 23.6 strips the plugin's types):
 *   BATTUTA_ROOT=$PWD node --experimental-strip-types spikes/diag-playback-stream.mjs path/to/score.mei
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { buildPerformance } from "../packages/plugins/playback/src/performance.ts";
import { openFixture } from "./lib/e2e.mjs";

const ROOT = process.env.BATTUTA_ROOT ?? process.cwd();
const FILE = process.argv[2] ?? `${ROOT}/test.mei`;
const server = await createServer({ configFile: `${ROOT}/apps/editor/vite.config.ts`, root: `${ROOT}/apps/editor`, server: { port: 0 }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 1, null, { timeout: 60000 });
await openFixture(page, FILE, 3);
const { timemap, facts, tempo } = await page.evaluate(async () => ({ timemap: await window.__HOST__.query.timemap(), facts: window.__HOST__.query.notation(), tempo: window.__HOST__.document.get()?.tempo }));
await browser.close();
await server.close();
writeFileSync(`${ROOT}/spikes/out/diag-timemap.json`, JSON.stringify({ timemap, facts }, null, 1)); // spikes/out is ignored

console.log(`tempo ${tempo ?? "(none → 120)"}; ${timemap.events.length} events, ${Object.keys(timemap.notes).length} notes, ties ${JSON.stringify(facts.ties)}, marks ${Object.keys(facts.marks).length}`);
// notes without an off in the timemap
const on = new Map(), off = new Map();
for (const e of timemap.events) { for (const id of e.on ?? []) if (!on.has(id)) on.set(id, e.tstamp); for (const id of e.off ?? []) if (!off.has(id)) off.set(id, e.tstamp); }
const noOff = [...on.keys()].filter((id) => !off.has(id));
console.log(`notes with no off event: ${noOff.length ? noOff.join(", ") : "none"}`);

const perf = buildPerformance(timemap, facts);
console.log(`performance: ${perf.notes.length} attacks, total ${perf.totalMs} ms`);
perf.notes.slice(0, 16).forEach((n, i) => console.log(`  #${i + 1} ${n.id} pitch ${n.pitch} on ${n.onMs} dur ${n.durMs.toFixed(1)} (off ${(n.onMs + n.durMs).toFixed(1)})`));

// the sink's stream: per note ON then OFF are scheduled, notes in on order; timers at equal expiry fire in creation order
const stream = [];
perf.notes.forEach((n, i) => { stream.push({ t: n.onMs, kind: "on", pitch: n.pitch, id: n.id, seq: i * 2 }); stream.push({ t: n.onMs + n.durMs, kind: "off", pitch: n.pitch, id: n.id, seq: i * 2 + 1 }); });
stream.sort((a, b) => a.t - b.t || a.seq - b.seq);
const sounding = new Map();
const problems = [];
for (const ev of stream) {
  const c = sounding.get(ev.pitch) ?? 0;
  if (ev.kind === "on") { if (c > 0) problems.push(`pitch ${ev.pitch} attacked again at ${ev.t.toFixed(1)} ms by ${ev.id} while ${c} voice(s) still sound`); sounding.set(ev.pitch, c + 1); }
  else sounding.set(ev.pitch, Math.max(0, c - 1));
}
// near-coincident OFF/ON on one pitch (a race in real timers)
for (let i = 1; i < stream.length; i++) { const a = stream[i - 1], b = stream[i]; if (a.pitch === b.pitch && a.kind === "off" && b.kind === "on" && Math.abs(b.t - a.t) < 2) problems.push(`pitch ${a.pitch}: off of ${a.id} at ${a.t.toFixed(2)} and on of ${b.id} at ${b.t.toFixed(2)} are ${Math.abs(b.t - a.t).toFixed(2)} ms apart (timer race)`); }
console.log(problems.length ? `PROBLEMS:\n  ${problems.join("\n  ")}` : "no retrigger and no race in the stream");
const left = [...sounding.entries()].filter(([, c]) => c > 0);
console.log(left.length ? `still sounding at the end: ${left.map(([p, c]) => `${p}×${c}`).join(", ")}` : "nothing sounding at the end");
