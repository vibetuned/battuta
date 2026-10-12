# PDF reference

Open a score's PDF next to its MEI and see, **above every measure in edit
view, the scan of that measure** — scan on top, rendering below, the way
a correction against a source is done. A panel at the bottom shows the
system the caret is in, every measure outlined and the caret's
highlighted, and follows the caret as it moves. It is the start of the
facsimile: the PDF is placed by the annotation files an OMR pipeline
writes — one JSON per page, a box per measure, each keyed by the MEI id it
was annotated with.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → PDF reference. Off
deactivates it at once: the 📄 in the header, the panel and the scans go,
the room above the tiles goes with them, and the page images are released.
The switch is remembered. It has no keys.

## Using it

1. Click the **📄** in the header. The panel opens at the bottom.
2. **load a PDF or images…** — choose the PDF, or its pages as images
   (PNG, JPEG, WebP…; ordered by a `_pageN` in their names, else by name),
   and its page files (`…_page1.json`, `…_page2.json`, …) together; a `….graph.json` is used
   when no page file is given, and ignored (with a word) when they are.
   Every page is rendered once, at 254 dpi.
3. Each measure of the score is matched to an annotated one — **by id**
   when the score carries the annotated ids (an OMR output and its
   annotations), **in order** otherwise: the score's first measure is the
   PDF's first, and so on. The panel says which, how many were placed,
   and the two counts when they differ.
4. **on the score** draws each measure's scan above its tile: the
   measure's width by its system's height, fitted to the tile's width so
   the barlines stand over each other; a row's band is as tall as its
   tallest scan.
5. The strip shows the caret's system; **◀ ▶** step through the systems.

## Drawing systems and measures

A PDF without annotation files can be placed by hand: load it alone and
choose **draw systems and measures**. The page opens in the panel with two
tools — **▭ systems** (drag a box across a system), **| barlines**
(click where a barline is; click it again to take it away) and **≡
staves** (click between two staves to split the system there) — and **−
+** zoom the page up to four times. Measures are
the stretches between barlines, numbered as they will match the score;
the **×** at a system's corner removes it; **◀ ▶** turn the pages; **done**
returns to the strip. The scans follow as you draw. The drawing is kept
for that PDF (by its name and size) and comes back when it is loaded
again; **export PDF annotations** in the battuta menu writes it — or the
annotations read from files — as the OMR page files. With annotation files
loaded, there is nothing to draw.

## Keys

None. The 📄 is a header button.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| — | settings | nothing |
| `drawing:<pdf name>:<bytes>` | storage | the systems, barlines and staff splits drawn on that PDF, per page, in its rendered pixels — a few kB; the PDF and its images live for the session only |
| `drawing:images:<names>:<bytes>` | storage | the same, for pages loaded as images |

## What it does not do

- Write to the MEI: no `<facsimile>` or `<zone>` yet. Annotation files are
  read, never changed; a drawing is kept in the plugin's storage and
  leaves only through the export.
- Click a scan to move the caret, or a box in the strip to go to its
  measure.
- Show the clef and key at a row's start above its header cell.
- Detect systems or barlines by itself: a drawing is the user's.
- Handle repeats specially: a measure is one tile and one scan.

## Guide

[PDF reference](../../../docs/src/content/docs/guide/pdf-reference.mdx) in
the user guide.
