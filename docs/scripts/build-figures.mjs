/**
 * Build every notation figure in the user guide.
 *
 * Verovio engraves the snippets (the same toolkit the editor renders with,
 * so a figure cannot show notation battuta could not produce), and cairo
 * — via `rsvg-convert` from librsvg — rasterises the site icons: favicon,
 * apple touch icon, and the social card.
 *
 * Output:
 *   public/figures/<name>.svg   the engraving, ink fixed near-black (the
 *                               guide frames each one as a paper card, which
 *                               reads under both site themes)
 *   public/figures/<name>.png   rasters where one is needed
 *   public/favicon-*.png, og.png   site icons and the social card
 *
 * Run: npm run figures   (part of npm run build)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const outDir = join(here, "../public/figures");
const iconDir = join(here, "../public");

// ---------------------------------------------------------------------------
// MEI snippet helpers. Deliberately verbose rather than clever: each figure
// is a readable little document you can paste into the editor to check it.
// ---------------------------------------------------------------------------

/** Wrap staff bodies in a complete MEI document. */
function mei({ staves = 1, clefs = ["G2"], keysig, meter = "4/4", body, expansion = "" }) {
  const [count, unit] = meter.split("/");
  const staffDefs = Array.from({ length: staves }, (_, i) => {
    const [shape, line] = (clefs[i] ?? "G2").split("");
    return `<staffDef n="${i + 1}" lines="5" clef.shape="${shape}" clef.line="${line}"/>`;
  }).join("");
  const grp = staves > 1 ? `<staffGrp symbol="brace" bar.thru="true">${staffDefs}</staffGrp>` : `<staffGrp>${staffDefs}</staffGrp>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead><fileDesc><titleStmt><title/></titleStmt></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="${count}" meter.unit="${unit}"${keysig ? ` keysig="${keysig}"` : ""}>${grp}</scoreDef>
    <section>${expansion}${body}</section>
  </score></mdiv></body></music></mei>`;
}

/** One measure. `content` is staff/layer markup; `controls` are its control events. */
const m = (n, content, { controls = "", left, right } = {}) =>
  `<measure n="${n}"${left ? ` left="${left}"` : ""}${right ? ` right="${right}"` : ""}>${content}${controls}</measure>`;

/** A staff holding one voice. */
const staff = (n, layer, layerN = 1) => `<staff n="${n}"><layer n="${layerN}">${layer}</layer></staff>`;

/** Shorthand: "c4/4" → note c octave 4, duration 4. Extra attrs appended. */
const note = (spec, attrs = "") => {
  const [pitch, dur] = spec.split("/");
  const pname = pitch[0];
  const oct = pitch.slice(1);
  return `<note pname="${pname}" oct="${oct}" dur="${dur}"${attrs ? ` ${attrs}` : ""}/>`;
};
const rest = (dur, attrs = "") => `<rest dur="${dur}"${attrs ? ` ${attrs}` : ""}/>`;
/** Notes from a compact list: n("c4/8 d4/8 e4/4") */
const n = (specs, attrs = "") => specs.trim().split(/\s+/).map((s) => note(s, attrs)).join("");
/** Same, but each note carries an xml:id: id-1, id-2, … */
const ids = (prefix, specs, attrs = "") =>
  specs
    .trim()
    .split(/\s+/)
    .map((s, i) => note(s, `xml:id="${prefix}${i + 1}"${attrs ? ` ${attrs}` : ""}`))
    .join("");

// ---------------------------------------------------------------------------
// The figures. Each one illustrates exactly one documented action.
// `scale` trades size for detail; `margin` trims the crop.
// ---------------------------------------------------------------------------

const FIGURES = [
  // --- entry -------------------------------------------------------------
  {
    name: "entry-run",
    alt: "A bar of four eighth notes followed by a quarter rest and a quarter note",
    mei: mei({ body: m(1, staff(1, n("c4/8 d4/8 e4/8 f4/8") + rest("4") + n("g4/4"))) }),
  },
  {
    name: "durations",
    alt: "The duration palette: whole, half, quarter, eighth, sixteenth, thirty-second, sixty-fourth",
    spacing: 0.6,
    mei: mei({
      meter: "4/4",
      body: m(1, staff(1, n("c5/1 c5/2 c5/4 c5/8 c5/16 c5/32 c5/64")), { right: "invis" }).replace("<measure", '<measure metcon="false"'),
    }),
  },
  {
    name: "dots",
    alt: "A quarter note, a dotted quarter, and a double-dotted quarter",
    mei: mei({
      body: m(1, staff(1, `${note("c5/4")}${note("d5/4", 'dots="1"')}${note("e5/4", 'dots="2"')}`), { right: "invis" }).replace("<measure", '<measure metcon="false"'),
    }),
  },
  {
    name: "accidentals",
    alt: "Sharp, flat, natural and double sharp on four notes",
    mei: mei({
      body: m(
        1,
        staff(
          1,
          `${note("f4/4", 'accid="s"')}${note("b4/4", 'accid="f"')}${note("c5/4", 'accid="n"')}${note("f5/4", 'accid="x"')}`,
        ),
      ),
    }),
  },
  {
    name: "chord",
    alt: "A C major chord built from three stacked notes, then a single note",
    mei: mei({
      body: m(
        1,
        staff(1, `<chord dur="2">${n("c4/2 e4/2 g4/2")}</chord>${note("c5/2")}`),
      ),
    }),
  },
  {
    name: "chord-accidental",
    alt: "A chord where only the middle note carries a sharp",
    mei: mei({
      body: m(1, staff(1, `<chord dur="1">${note("c4/1")}${note("e4/1", 'accid="s"')}${note("g4/1")}</chord>`)),
    }),
  },

  // --- rhythm ------------------------------------------------------------
  {
    name: "merge-before",
    alt: "A quarter note tied to an eighth note on the same pitch",
    mei: mei({
      body: m(1, staff(1, `${note("c5/4", 'xml:id="a1" tie="i"')}${note("c5/8", 'tie="t"')}${rest("8")}${rest("4")}${rest("4")}`)),
    }),
  },
  {
    name: "merge-after",
    alt: "The same rhythm merged into a single dotted quarter note",
    mei: mei({ body: m(1, staff(1, `${note("c5/4", 'dots="1"')}${rest("8")}${rest("4")}${rest("4")}`)) }),
  },
  {
    name: "split-after",
    alt: "A dotted half note split into two dotted quarters",
    mei: mei({ meter: "3/4", body: m(1, staff(1, `${note("c5/4", 'dots="1"')}${note("c5/4", 'dots="1"')}`)) }),
  },
  {
    name: "beam-before",
    alt: "Eight unbeamed eighth notes",
    mei: mei({ body: m(1, staff(1, n("c4/8 d4/8 e4/8 f4/8 g4/8 a4/8 b4/8 c5/8"))) }),
  },
  {
    name: "beam-after",
    alt: "The same eighth notes grouped into two beams, one per half measure",
    mei: mei({
      body: m(1, staff(1, `<beam>${n("c4/8 d4/8 e4/8 f4/8")}</beam><beam>${n("g4/8 a4/8 b4/8 c5/8")}</beam>`)),
    }),
  },
  {
    name: "tuplet",
    alt: "A 3:2 triplet of quarter notes followed by a quarter rest",
    mei: mei({
      body: m(1, staff(1, `<tuplet num="3" numbase="2">${n("c5/4 d5/4 e5/4")}</tuplet>${rest("4")}`)),
    }),
  },
  {
    name: "sextuplet",
    alt: "A 6:4 sextuplet of eighth notes followed by rests",
    mei: mei({
      body: m(1, staff(1, `<tuplet num="6" numbase="4"><beam>${n("c5/8 d5/8 e5/8 f5/8 g5/8 a5/8")}</beam></tuplet>${rest("4")}${rest("4")}`)),
    }),
  },
  {
    name: "grace",
    alt: "An acciaccatura and an appoggiatura before their main notes",
    mei: mei({
      body: m(
        1,
        staff(
          1,
          `${note("b4/8", 'grace="acc" stem.mod="1slash"')}${note("c5/4")}${rest("4")}${note("b4/8", 'grace="unacc"')}${note("c5/4")}${rest("4")}`,
        ),
      ),
    }),
  },
  {
    name: "simile",
    alt: "A beat of music followed by a simile slash standing for the repeated beat",
    mei: mei({
      body: m(1, staff(1, `<beam>${n("c4/8 e4/8")}</beam><beatRpt/>${rest("4")}${rest("4")}`)),
    }),
  },
  {
    name: "measure-repeat",
    alt: "A written measure, a measure repeat sign, and a two-measure repeat sign",
    mei: mei({
      body:
        m(1, staff(1, `<beam>${n("c4/8 e4/8 g4/8 e4/8")}</beam>${rest("2")}`)) +
        m(2, staff(1, "<mRpt/>")) +
        m(3, staff(1, "<mRpt2/>")) +
        m(4, staff(1, "<mSpace/>")),
    }),
  },

  // --- marks -------------------------------------------------------------
  {
    name: "articulations",
    alt: "Staccato, accent, marcato and staccatissimo on four notes",
    mei: mei({
      body: m(
        1,
        staff(
          1,
          `${note("c5/4", 'artic="stacc"')}${note("c5/4", 'artic="acc"')}${note("c5/4", 'artic="marc"')}${note("c5/4", 'artic="stacciss"')}`,
        ),
      ),
    }),
  },
  {
    name: "fermata",
    alt: "A held note with a fermata over the final chord",
    mei: mei({
      body: m(1, staff(1, `${n("c5/4 b4/4")}${note("c5/2", 'xml:id="f1"')}`), {
        controls: `<fermata startid="#f1" place="above" form="norm"/>`,
      }),
    }),
  },
  {
    name: "ornaments",
    alt: "An arpeggiated chord, a tremolo, a trill and a mordent",
    mei: mei({
      body:
        m(1, staff(1, `<chord xml:id="c1" dur="2">${n("c4/2 e4/2 g4/2")}</chord><bTrem><note pname="c" oct="5" dur="2" stem.mod="3slash"/></bTrem>`), {
          controls: `<arpeg startid="#c1"/>`,
        }) +
        m(2, staff(1, `${note("e5/2", 'xml:id="t1"')}${note("d5/2", 'xml:id="t2"')}`), {
          controls: `<trill startid="#t1"/><mordent startid="#t2" form="lower"/>`,
        }),
    }),
  },
  {
    name: "dynamics",
    alt: "The dynamics cycle: p, mp, mf, f under four notes",
    mei: mei({
      body: m(1, staff(1, ids("d", "c5/4 c5/4 c5/4 c5/4")), {
        controls: `<dynam startid="#d1">p</dynam><dynam startid="#d2">mp</dynam><dynam startid="#d3">mf</dynam><dynam startid="#d4">f</dynam>`,
      }),
    }),
  },
  {
    name: "intensity",
    alt: "Attack intensity markings sf, sfz, rinf and rfz",
    mei: mei({
      body: m(1, staff(1, ids("i", "c5/4 c5/4 c5/4 c5/4")), {
        controls: `<dynam startid="#i1">sf</dynam><dynam startid="#i2">sfz</dynam><dynam startid="#i3">rinf</dynam><dynam startid="#i4">rfz</dynam>`,
      }),
    }),
  },
  {
    name: "hairpin",
    alt: "A crescendo hairpin spanning four notes, then a decrescendo",
    mei: mei({
      body:
        m(1, staff(1, ids("h", "c4/4 e4/4 g4/4 c5/4")), { controls: `<hairpin startid="#h1" endid="#h4" form="cres"/>` }) +
        m(2, staff(1, ids("k", "c5/4 g4/4 e4/4 c4/4")), { controls: `<hairpin startid="#k1" endid="#k4" form="dim"/>` }),
    }),
  },
  {
    name: "slur",
    alt: "A slur arching over four notes",
    mei: mei({ body: m(1, staff(1, ids("s", "c4/4 e4/4 g4/4 f4/4")), { controls: `<slur startid="#s1" endid="#s4"/>` }) }),
  },
  {
    name: "tie-chain",
    alt: "One pitch tied across three notes and over a barline",
    mei: mei({
      body:
        m(1, staff(1, `${n("c4/4 d4/4")}${note("e4/4", 'tie="i"')}${note("e4/4", 'tie="m"')}`)) +
        m(2, staff(1, `${note("e4/4", 'tie="t"')}${rest("4")}${rest("2")}`)),
    }),
  },
  {
    name: "pedal",
    alt: "A pedal line from the first to the last note of the measure",
    mei: mei({
      body: m(1, staff(1, ids("p", "c3/4 e3/4 g3/4 c4/4")), {
        controls: `<pedal startid="#p1" dir="down"/><pedal startid="#p4" dir="up"/>`,
      }),
      clefs: ["F4"],
    }),
  },
  {
    name: "fingering",
    alt: "Fingerings 1, 2, 3 above three notes and a 3-1 finger change on the fourth",
    mei: mei({
      body: m(1, staff(1, ids("g", "c4/4 d4/4 e4/4 f4/4")), {
        controls: `<fing startid="#g1">1</fing><fing startid="#g2">2</fing><fing startid="#g3">3</fing><fing startid="#g4">3-1</fing>`,
      }),
    }),
  },

  // --- structure ---------------------------------------------------------
  {
    name: "voices",
    alt: "Two voices in one staff, stems up and stems down",
    mei: mei({
      body: m(
        1,
        `<staff n="1"><layer n="1">${n("g4/4 a4/4 b4/4 c5/4")}</layer><layer n="2">${n("e4/2 d4/2")}</layer></staff>`,
      ),
    }),
  },
  {
    name: "staves",
    alt: "A two-staff system, treble over bass, joined by a brace",
    marginLeft: 60,
    mei: mei({
      staves: 2,
      clefs: ["G2", "F4"],
      body: m(1, staff(1, n("c5/4 b4/4 a4/4 g4/4")) + staff(2, n("c3/2 g3/2"))),
    }),
  },
  {
    name: "clef-change",
    alt: "A bass clef appearing mid-staff before the barline",
    mei: mei({
      clefs: ["G2"],
      body: m(1, staff(1, `${n("c5/4 b4/4 a4/4 g4/4")}<clef shape="F" line="4"/>`)) + m(2, staff(1, n("c3/2 g2/2"))),
    }),
  },
  {
    name: "key-meter-change",
    alt: "A key signature and meter change at the start of the second measure",
    mei: mei({
      body:
        m(1, staff(1, n("c5/4 b4/4 a4/4 g4/4"))) +
        `<scoreDef keysig="3f" meter.count="3" meter.unit="4"/>` +
        m(2, staff(1, n("e5/4 f5/4 g5/4"))),
    }),
  },

  // --- repeats and form --------------------------------------------------
  {
    name: "repeat-barlines",
    alt: "Two measures wrapped in repeat barlines",
    mei: mei({
      body:
        m(1, staff(1, n("c4/4 d4/4 e4/4 f4/4")), { left: "rptstart" }) +
        m(2, staff(1, n("g4/4 f4/4 e4/4 d4/4")), { right: "rptend" }),
    }),
  },
  {
    name: "voltas",
    alt: "A first-and-second-time ending followed by a third-time ending",
    mei: mei({
      body:
        m(1, staff(1, n("c4/2 e4/2")), { left: "rptstart" }) +
        `<ending n="1, 2">${m(2, staff(1, n("g4/2 f4/2")), { right: "rptend" })}</ending>` +
        `<ending n="3">${m(3, staff(1, n("e4/2 c4/2")), { right: "end" })}</ending>`,
    }),
  },
  {
    name: "repeat-marks",
    alt: "Segno, To Coda, coda sign, fine and dal segno marks over three measures",
    marginTop: 100,
    mei: mei({
      body:
        m(1, staff(1, `${note("c4/2", 'xml:id="r1"')}${note("e4/2", 'xml:id="r2"')}`), {
          controls: `<repeatMark func="segno" startid="#r1"/><repeatMark func="coda" startid="#r2">&gt;To Coda&lt;</repeatMark>`,
        }) +
        m(2, staff(1, `${note("g4/2", 'xml:id="r3"')}${note("e4/2", 'xml:id="r4"')}`), {
          controls: `<repeatMark func="coda" startid="#r3"/><repeatMark func="fine" startid="#r4"/>`,
        }) +
        m(3, staff(1, `${note("d4/2", 'xml:id="r5"')}${note("c4/2")}`), {
          controls: `<repeatMark func="dalSegno" startid="#r5"/>`,
          right: "end",
        }),
    }),
  },

  // --- harmony -----------------------------------------------------------
  {
    name: "harmony-chords",
    alt: "Chord symbols above the staff: Cmaj7, Am7, D7 slash F sharp, G13",
    mei: mei({
      body: m(1, staff(1, ids("y", "c4/4 a4/4 f4/4 g4/4")), {
        controls: `<harm startid="#y1">Cmaj7</harm><harm startid="#y2">Am7</harm><harm startid="#y3">D7/F#</harm><harm startid="#y4">G13</harm>`,
      }),
    }),
  },
  {
    name: "harmony-rna",
    alt: "Roman numeral analysis below the staff: I, vi, V65 of V, V7",
    mei: mei({
      body: m(1, staff(1, ids("z", "c4/4 a4/4 f4/4 g4/4")), {
        controls: `<harm type="rna" place="below" startid="#z1">I</harm><harm type="rna" place="below" startid="#z2">vi</harm><harm type="rna" place="below" startid="#z3">V65/V</harm><harm type="rna" place="below" startid="#z4">V7</harm>`,
      }),
    }),
  },

  // --- arranging ---------------------------------------------------------
  {
    name: "reflect-prime",
    alt: "The original four-note phrase",
    mei: mei({ body: m(1, staff(1, n("c4/4 e4/4 g4/4 f4/4"))) }),
  },
  {
    name: "reflect-inversion",
    alt: "The phrase inverted: every interval mirrored about the first note",
    mei: mei({ body: m(1, staff(1, n("c4/4 a3/4 f3/4 g3/4"))) }),
  },
  {
    name: "reflect-retrograde",
    alt: "The phrase retrograded: pitch content reversed over the same rhythm",
    mei: mei({ body: m(1, staff(1, n("f4/4 g4/4 e4/4 c4/4"))) }),
  },
  {
    name: "reflect-retrograde-inversion",
    alt: "The phrase in retrograde inversion",
    mei: mei({ body: m(1, staff(1, n("g3/4 f3/4 a3/4 c4/4"))) }),
  },
  {
    name: "transpose",
    alt: "A phrase and the same phrase transposed up one step",
    mei: mei({
      body: m(1, staff(1, n("c4/4 e4/4 g4/4 e4/4"))) + m(2, staff(1, n("d4/4 f4/4 a4/4 f4/4"))),
    }),
  },

  // --- landing page card art (also rasterised) ---------------------------
  {
    name: "card-entry",
    alt: "A short melodic phrase",
    raster: true,
    scale: 55,
    mei: mei({ body: m(1, staff(1, `<beam>${n("c5/8 d5/8 e5/8 g5/8")}</beam>${note("e5/4", 'artic="stacc"')}${rest("4")}`)) }),
  },
  {
    name: "card-arrange",
    alt: "Two staves of material being combined",
    scale: 55,
    mei: mei({
      staves: 2,
      clefs: ["G2", "F4"],
      body: m(1, staff(1, n("e5/4 d5/4 c5/2")) + staff(2, `<chord dur="1">${n("c3/1 g3/1")}</chord>`)),
    }),
  },
  {
    name: "card-form",
    alt: "Repeat barlines with a first and second ending",
    scale: 55,
    mei: mei({
      body:
        m(1, staff(1, n("c4/2 e4/2")), { left: "rptstart" }) +
        `<ending n="1">${m(2, staff(1, n("g4/2 f4/2")), { right: "rptend" })}</ending>` +
        `<ending n="2">${m(3, staff(1, n("e4/2 c4/2")), { right: "end" })}</ending>`,
    }),
  },
];

/**
 * Excerpts from real scores, rendered through Verovio's measure-range
 * selection. The guide should show the editor's own output, not only
 * synthetic snippets, when it claims something about real files.
 *
 * Sources live in docs/excerpts/ so the site builds anywhere: public-domain
 * music (Schumann, Album für die Jugend, op. 68) transcribed in battuta.
 */
const EXCERPTS = [
  {
    name: "real-score",
    alt: "Four measures of Schumann's Melodie for piano, two staves",
    file: join(here, "../excerpts/schumann-melodie.mei"),
    measureRange: "1-4",
    marginLeft: 60,
  },
  {
    name: "real-block",
    alt: "Two measures of a piano score, the shape a block selection copies",
    file: join(here, "../excerpts/schumann-soldatenmarsch.mei"),
    measureRange: "1-2",
    marginLeft: 60,
  },
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

// Verovio's setOptions is CUMULATIVE — anything left out keeps the value
// from the previous figure. Every option a per-figure override can touch is
// therefore listed here explicitly, or one wide figure silently stretches
// every figure after it.
const BASE_OPTIONS = {
  breaks: "none",
  adjustPageWidth: true,
  adjustPageHeight: true,
  header: "none",
  footer: "none",
  pageMarginLeft: 12,
  pageMarginRight: 12,
  pageMarginTop: 40,
  pageMarginBottom: 25,
  svgViewBox: true,
  svgRemoveXlink: true,
  scale: 45,
  spacingLinear: 0.25,
  spacingNonLinear: 0.6,
};

/** Display width per viewBox unit: keeps a one-measure figure from being
 *  blown up to full column width while letting longer ones fill it. */
const PX_PER_UNIT = 2.2;

/** Natural display size, from the engraving's own viewBox. */
function viewBoxOf(svg) {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!m) return {};
  return { width: Math.round(Number(m[1]) * PX_PER_UNIT), height: Math.round(Number(m[2]) * PX_PER_UNIT) };
}

/**
 * Figures are shown through <img>, which renders the SVG as an isolated
 * document — `currentColor` there resolves to the SVG's own default, not the
 * page's text colour, so a "theme-aware" figure is not possible this way.
 * Instead the ink is a fixed near-black and the guide gives every figure a
 * light paper card, which reads correctly under both themes (and is what
 * notation looks like anyway).
 */
const INK = "#16191d";
const themeable = (svg) =>
  svg
    .replace(/ color="black"/g, ` color="${INK}"`)
    .replace(/<desc>[^<]*<\/desc>/, "")
    .replace(/\n\s*\n/g, "\n");

mkdirSync(outDir, { recursive: true });

const mod = await createVerovioModule();
const toolkit = new VerovioToolkit(mod);
const version = toolkit.getVersion();

let built = 0;
const rastered = [];
const manifest = [];

for (const fig of FIGURES) {
  toolkit.setOptions({
    ...BASE_OPTIONS,
    ...(fig.scale ? { scale: fig.scale } : {}),
    ...(fig.marginTop ? { pageMarginTop: fig.marginTop } : {}),
    ...(fig.marginLeft ? { pageMarginLeft: fig.marginLeft } : {}),
    ...(fig.spacing ? { spacingLinear: fig.spacing } : {}),
  });
  if (!toolkit.loadData(fig.mei)) {
    console.error(`✗ ${fig.name}: Verovio rejected the snippet\n${toolkit.getLog()}`);
    process.exitCode = 1;
    continue;
  }
  const raw = toolkit.renderToSVG(1);
  const log = toolkit.getLog().replace(/\[Warning\] No header found in the MEI data, trying to proceed\.\.\.\s*/g, "").trim();
  if (log) console.warn(`  ${fig.name}: ${log.split("\n").join(" / ")}`);

  writeFileSync(join(outDir, `${fig.name}.svg`), themeable(raw));
  manifest.push({ name: fig.name, alt: fig.alt, ...viewBoxOf(raw) });
  built++;

  if (fig.raster) {
    // cairo, through librsvg: the raster the landing page cards use.
    const tmp = join(outDir, `.${fig.name}.raster.svg`);
    writeFileSync(tmp, raw.replace(/ color="black"/g, ' color="#1c1c1e"'));
    try {
      execFileSync("rsvg-convert", ["-h", "220", "-b", "none", "-o", join(outDir, `${fig.name}.png`), tmp]);
      rastered.push(`${fig.name}.png`);
    } catch (err) {
      console.warn(`  ${fig.name}: rsvg-convert unavailable, PNG skipped (${err.message})`);
    }
  }
}

// --- excerpts from real files, via Verovio's measure-range selection -------

for (const ex of EXCERPTS) {
  if (!existsSync(ex.file)) {
    console.warn(`  ${ex.name}: ${ex.file} not found — excerpt skipped`);
    continue;
  }
  toolkit.setOptions({ ...BASE_OPTIONS, ...(ex.marginLeft ? { pageMarginLeft: ex.marginLeft } : {}) });
  if (!toolkit.loadData(readFileSync(ex.file, "utf8"))) {
    console.error(`✗ ${ex.name}: Verovio rejected ${ex.file}\n${toolkit.getLog()}`);
    process.exitCode = 1;
    continue;
  }
  toolkit.select({ measureRange: ex.measureRange });
  toolkit.redoLayout();
  const raw = toolkit.renderToSVG(1);
  writeFileSync(join(outDir, `${ex.name}.svg`), themeable(raw));
  manifest.push({ name: ex.name, alt: ex.alt, ...viewBoxOf(raw) });
  built++;
}
// select() is sticky on the toolkit — reset it so nothing else inherits it.
toolkit.select({ measureRange: "all" });

// ---------------------------------------------------------------------------
// Site icons — cairo rasterises the app logo the shell already ships.
// ---------------------------------------------------------------------------

// The site header logo: the white-card mark, copied rather than duplicated so
// the app's icons stay the single source of truth.
const headerLogo = join(repo, "icons/battuta-white.svg");
if (existsSync(headerLogo)) {
  mkdirSync(join(here, "../src/assets"), { recursive: true });
  writeFileSync(join(here, "../src/assets/logo.svg"), readFileSync(headerLogo, "utf8"));
}

const logo = join(repo, "icons/battuta.svg");
if (existsSync(logo)) {
  const icons = [
    ["favicon-32.png", 32],
    ["favicon-180.png", 180],
    ["favicon-512.png", 512],
  ];
  for (const [file, size] of icons) {
    try {
      execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", join(iconDir, file), logo]);
      rastered.push(file);
    } catch (err) {
      console.warn(`  ${file}: rsvg-convert unavailable (${err.message})`);
      break;
    }
  }
} else {
  console.warn(`  icons/battuta.svg not found at ${logo} — site icons skipped`);
}

// --- social preview card: cairo rasters composed with ImageMagick ----------
// 1200×630 is what link previews expect. Built from the same two sources the
// guide itself uses: the app logo and a Verovio engraving.
const ogStrip = join(outDir, ".og-strip.png");
const ogLogo = join(outDir, ".og-logo.png");
const og = join(iconDir, "og.png");
try {
  const stripSvg = join(outDir, ".card-entry.raster.svg");
  const cardLogo = join(repo, "icons/battuta-white.svg"); // the white card reads on a dark ground
  if (!existsSync(stripSvg) || !existsSync(cardLogo)) throw new Error("sources missing");
  execFileSync("rsvg-convert", ["-w", "760", "-b", "none", "-o", ogStrip, stripSvg]);
  execFileSync("rsvg-convert", ["-w", "150", "-h", "150", "-o", ogLogo, cardLogo]);
  execFileSync("magick", [
    "-size", "1200x630", "xc:#12161c",
    ogLogo, "-geometry", "+90+85", "-composite",
    "(", ogStrip, "-background", "white", "-alpha", "remove", "-alpha", "off", "-bordercolor", "white", "-border", "16", ")",
    "-geometry", "+204+352", "-composite",
    "-fill", "#e7edf4", "-pointsize", "80", "-annotate", "+290+160", "battuta",
    "-fill", "#8b99a9", "-pointsize", "32", "-annotate", "+292+215", "MEI score editor — user guide",
    og,
  ]);
  rastered.push("og.png");
} catch (err) {
  console.warn(`  og.png: not built (${err.message.split("\n")[0]})`);
} finally {
  for (const f of [ogStrip, ogLogo]) rmSync(f, { force: true });
}
// The intermediate raster sources are not part of the site.
for (const fig of FIGURES) if (fig.raster) rmSync(join(outDir, `.${fig.name}.raster.svg`), { force: true });

writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify({ verovio: version, figures: manifest }, null, 2)}\n`);

console.log(`figures: ${built} SVG engraved by Verovio ${version}`);
console.log(`icons:   ${rastered.length} PNG rasterised by cairo${rastered.length ? ` (${rastered.join(", ")})` : ""}`);
