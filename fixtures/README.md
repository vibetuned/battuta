# fixtures/

MEI scores the tests, spikes and e2e scripts open.

- **`synthetic-context-changes.mei`** — hand-made, **committed**. The
  browser e2e scripts (`spikes/verify-*.mjs`) address its notes by id
  (`cc-m2n1` = measure 2, note 1), so its shape is part of the tests; the
  header comment inside the file lists what they rely on. Never resave it
  from the app — battuta regenerates ids.
- **`pdf-reference/`** — **committed**. The PDF reference's example: a
  Verovio engraving of Chopin's Polonaise in G minor (2 pages, 38
  measures) and its OMR annotation files, one per page
  (`…_page1.json`, `…_page2.json`: a box per element in the pixels of the
  page at 254 dpi, keyed by MEI id). The names are the dataset's own
  content ids. `spikes/verify-pdf-reference.mjs` and `verify-tauri.sh`
  (probe8) load it; its source MEI is not included, so the e2e builds a
  score carrying its measure ids.
- **Everything else is the public-domain corpus** from
  [music-encoding/sample-encodings](https://github.com/music-encoding/sample-encodings),
  gitignored (13 MB) and fetched on demand:

  ```sh
  sh spikes/fetch-fixtures.sh
  ```

  It downloads the four scores the scripts use (Bach chorale, Beethoven
  quartet, Hymn to Joy, Brandenburg 2) and skips files already present.

The dev server serves this folder at `/`, and the editor auto-opens the
synthetic fixture on startup in dev builds. Production builds embed none
of it.
