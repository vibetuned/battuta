// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

/**
 * The battuta user guide.
 *
 * `base` is empty by default so `npm run dev` serves at the root. For a
 * GitHub Pages project site, build with the repository name as the base:
 *
 *   DOCS_BASE=/battuta npm run build
 *
 * Every internal link in the content is RELATIVE and every figure goes
 * through <Figure>, which prefixes import.meta.env.BASE_URL — so both
 * layouts work without touching the pages.
 */
export default defineConfig({
  site: "https://vibetuned.github.io",
  base: process.env.DOCS_BASE ?? "/",
  integrations: [
    starlight({
      title: "battuta",
      description:
        "User guide for battuta, the local-first MEI score editor: note entry, arranging, form, playback and every keyboard shortcut.",
      logo: { src: "./src/assets/logo.svg", alt: "battuta" },
      favicon: "/favicon-32.png",
      head: [
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/favicon-180.png" } },
        { tag: "meta", attrs: { name: "theme-color", content: "#12161c" } },
        // Social card: built by scripts/build-figures.mjs from the app logo and
        // a Verovio engraving, composed with cairo + ImageMagick.
        { tag: "meta", attrs: { property: "og:image", content: "/og.png" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "/og.png" } },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/vibetuned/battuta" }],
      // Adds the click-to-enlarge handler for figures and screenshots on top
      // of Starlight's own <head>.
      components: { Head: "./src/components/Head.astro" },
      editLink: { baseUrl: "https://github.com/vibetuned/battuta/edit/main/docs/" },
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { slug: "install" },
            { slug: "tour" },
            { slug: "first-score" },
            { slug: "concepts" },
          ],
        },
        {
          label: "Editing",
          items: [
            { slug: "guide/navigation" },
            { slug: "guide/selection" },
            { slug: "guide/note-entry" },
            { slug: "guide/rhythm" },
            { slug: "guide/marks" },
            { slug: "guide/harmony" },
            { slug: "guide/structure" },
            { slug: "guide/form" },
          ],
        },
        {
          label: "Working with scores",
          items: [{ slug: "guide/arranging" }, { slug: "guide/playback" }, { slug: "guide/files" }],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/keyboard" },
            { slug: "reference/status-bar" },
            { slug: "reference/limits" },
            { slug: "reference/troubleshooting" },
            { slug: "reference/whats-new" },
          ],
        },
      ],
    }),
  ],
});
