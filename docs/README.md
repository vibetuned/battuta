# docs — the battuta user guide

An [Astro Starlight](https://starlight.astro.build/) site explaining every
feature of the editor to people who did not write it. Standalone: its own
`package.json` and lockfile, no workspace entanglement with the app.

```sh
cd docs
npm install
npm run dev      # generates assets, then serves at the printed URL
npm run build    # assets → static site in dist/ → drift check
npm run preview  # serve dist/
```

## Nothing in the guide is typed twice

Two generators run before every build (`npm run assets`), so the guide cannot
disagree with the application:

**`scripts/build-figures.mjs`** — every notation figure. Verovio (the same
toolkit the editor renders with) engraves ~45 snippets defined inline in that
file, so a figure can never show notation battuta could not produce. Two of
them are real excerpts, selected by measure range out of the public-domain
scores in [`excerpts/`](excerpts/) (Schumann, op. 68, transcribed in battuta
itself). Output goes to `public/figures/*.svg` plus a `manifest.json` carrying
each figure's alt text and natural display size.

cairo — `rsvg-convert` from librsvg — rasterises the site icons from
`icons/battuta.svg`: `favicon-32/180/512.png`. It also builds `og.png`, the
1200×630 social card, from the white-card logo and one engraving, composed
with ImageMagick. Both tools are optional: if they are missing the figures
still build and the icon step warns.

**`scripts/build-keymap.mjs`** — the keyboard reference. It transpiles
`apps/editor/src/keymap.ts` with esbuild, imports it, and dumps both default
layouts to `src/data/keymap.json`. `KeymapTable.astro` renders slices of that
(`group="marks"`, `ids={[…]}`, `layout="azerty"`), which is how topic pages
show the bindings they discuss without anyone retyping them.

**`scripts/check.mjs`** — runs after the build (and on demand via
`npm run check`):

- every internal link resolves to a page in `dist/`
- every figure a page asks for was built, and every built figure is used
- every keymap action is explained somewhere other than the generated
  reference table (a warning, not an error — system chords legitimately live
  only there)

## Adding to the guide

- **A new page**: add the `.mdx` file under `src/content/docs/`, then list its
  slug in the sidebar in `astro.config.mjs`. Links between pages are written
  **relative** (`../marks/`) so they survive a base path.
- **A new figure**: add an entry to `FIGURES` in `scripts/build-figures.mjs`
  with a `name`, an `alt` string and its MEI, then use
  `<Figure name="…" caption="…" />`. `npm run figures` reports any snippet
  Verovio rejects.
- **A rebound key**: nothing to do here — regenerate with `npm run keymap`.

## Deploying

The site is base-path aware. For a GitHub Pages project site:

```sh
DOCS_BASE=/battuta npm run build
```

Figures go through `<Figure>`, which prefixes `import.meta.env.BASE_URL`, and
page links are relative, so no content changes are needed for either layout.

## Generated files

`public/figures/`, `public/favicon-*.png`, `public/og.png` and
`src/data/keymap.json` are build outputs and are not committed — `npm run dev`
and `npm run build` generate them. If the Figure component throws
`Figure "x" is not in figures/manifest.json`, run `npm run figures`.
