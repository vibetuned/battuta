/**
 * Scanned pages as images instead of a PDF (2026-10-11): PNG, JPEG, WebP —
 * whatever the platform decodes — one image a page. An image IS a page at
 * its own resolution, which is what the OMR annotation files describe
 * (their `image` is a `…_pageN.png`), so annotations apply at scale 1.
 * Pages go in the order a `_pageN` in their names gives, else by name.
 * No DOM: `createImageBitmap` reads the size, a blob URL shows the image.
 */
import type { RenderedPage } from "./pdf";

/** What the panel hands over for an image. */
export interface ImageFile {
  name: string;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] as const;

export const isImageName = (name: string): boolean => (IMAGE_EXTENSIONS as readonly string[]).includes(name.split(".").pop()?.toLowerCase() ?? "");

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif" };

const pageIn = (name: string): number | null => {
  const m = /_page(\d+)\.[a-z0-9]+$/i.exec(name);
  return m ? Number(m[1]) : null;
};

/** The order pages go in: by a `_pageN` in their names when every name has one, else by name, numbers compared as numbers. */
export function orderImages<T extends { name: string }>(files: readonly T[]): T[] {
  const numbered = files.every((f) => pageIn(f.name) !== null);
  return [...files].sort((a, b) => (numbered ? pageIn(a.name)! - pageIn(b.name)! : a.name.localeCompare(b.name, undefined, { numeric: true })));
}

/** The pages, in order, as images the scans and the strip crop. A file the platform cannot decode is an error naming it. */
export async function loadImages(files: readonly ImageFile[]): Promise<RenderedPage[]> {
  const pages: RenderedPage[] = [];
  for (const f of orderImages(files)) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const blob = new Blob([await f.arrayBuffer()], { type: f.type || MIME[ext] || "application/octet-stream" });
    let size: { width: number; height: number };
    try {
      const bitmap = await createImageBitmap(blob);
      size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch {
      throw new Error(`${f.name} could not be read as an image`);
    }
    pages.push({ page: pages.length + 1, url: URL.createObjectURL(blob), ...size });
  }
  return pages;
}
