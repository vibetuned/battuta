/**
 * The instrument's raw material: a Salamander Grand subset, ~2 MB, every
 * third semitone (the sampler pitch-shifts between). Embedded in the
 * build as hashed asset URLs, never a CDN — battuta is local-first, and
 * the Tauri custom protocol serves these the same way it serves the
 * scripts.
 *
 * The samples are the PLUGIN's, as Tone.js is: the host owns the audio
 * context and no instrument (slice 7a). This module is reached only
 * through a dynamic `import()` from `player.ts`, so the URLs are not even
 * in the plugin's own eager chunk — opening page view costs the transport
 * row, pressing play costs the engine and the piano.
 *
 * `import.meta.glob` is Vite's compile-time transform; the plugin's
 * tsconfig has no ambient Vite types (`types: []`, as every plugin's
 * does), so the shape is named here rather than pulled in as a
 * dependency. The cast is erased before Vite sees the call.
 */
interface GlobbingImportMeta {
  glob(pattern: string, options: { eager: true; query: "?url"; import: "default" }): Record<string, string>;
}

const SAMPLE_FILES = (import.meta as unknown as GlobbingImportMeta).glob("../assets/*.mp3", { eager: true, query: "?url", import: "default" });

/** "../assets/Ds4.mp3" -> "D#4" (Tone.Sampler note names) -> the built URL. */
export function sampleUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [path, url] of Object.entries(SAMPLE_FILES)) {
    const m = /([A-G])(s?)(\d)\.mp3$/.exec(path);
    if (m) urls[`${m[1]}${m[2] ? "#" : ""}${m[3]}`] = url;
  }
  return urls;
}
