/**
 * Pages as images: a `_pageN` in every name orders them, otherwise their
 * names do (numbers compared as numbers); the extensions taken for images.
 * Decoding needs a browser — the e2e loads real images.
 */
import { describe, it, expect } from "vitest";
import { isImageName, orderImages } from "../src/images";

const named = (...names: string[]) => names.map((name) => ({ name }));

describe("images", () => {
  it("orders by _pageN when every name has one, as numbers", () => {
    expect(orderImages(named("x_page10.png", "x_page2.png", "x_page1.png")).map((f) => f.name)).toEqual(["x_page1.png", "x_page2.png", "x_page10.png"]);
  });

  it("orders by name otherwise, numbers as numbers", () => {
    expect(orderImages(named("scan 10.jpg", "scan 2.jpg", "cover.jpg")).map((f) => f.name)).toEqual(["cover.jpg", "scan 2.jpg", "scan 10.jpg"]);
    expect(orderImages(named("b_page1.png", "a.png")).map((f) => f.name)).toEqual(["a.png", "b_page1.png"]); // not every name numbered
  });

  it("knows an image by its extension", () => {
    expect(["a.PNG", "b.jpeg", "c.webp"].every(isImageName)).toBe(true);
    expect(["a.pdf", "b.json", "c.tiff", "noext"].some(isImageName)).toBe(false);
  });
});
