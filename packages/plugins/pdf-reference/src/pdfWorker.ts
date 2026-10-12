/**
 * The PDF library's worker, as this plugin's OWN worker file — the formats
 * plugin's pattern: the bundler emits it from a `new URL(…, import.meta.url)`
 * in `pdf.ts`, so it is reached only from this plugin's chunk. Importing
 * the library's worker module is all it takes: it starts its message
 * handler by itself when it finds it is running in a worker.
 */
import "pdfjs-dist/build/pdf.worker.mjs";
