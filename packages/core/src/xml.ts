/**
 * Core XML tree. The core never touches the DOM; it consumes any DOM-shaped
 * tree (browser DOMParser output, @xmldom/xmldom in Node) through the
 * structural DomLike* interfaces below and converts it to CoreElement.
 *
 * CoreElement is sufficient for rendering slices and analysis. It is NOT yet
 * a byte-stable round-trip representation (comments and processing
 * instructions are dropped) — save-path serialization is Phase 4 work.
 */

export interface CoreElement {
  tag: string;
  attrs: Record<string, string>;
  children: (CoreElement | string)[];
}

/* Structural stand-ins for the W3C DOM types (no DOM lib in this package). */
export interface DomLikeNode {
  nodeType: number;
  nodeValue: string | null;
}
export interface DomLikeElement extends DomLikeNode {
  localName: string | null;
  nodeName: string;
  attributes: { length: number; item(index: number): { name: string; value: string } | null };
  childNodes: { length: number; item(index: number): DomLikeNode | null };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** Convert a DOM-shaped element tree into a CoreElement tree. */
export function fromDom(el: DomLikeElement): CoreElement {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a && !a.name.startsWith("xmlns")) attrs[a.name] = a.value;
  }
  const children: (CoreElement | string)[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i);
    if (!node) continue;
    if (node.nodeType === ELEMENT_NODE) {
      children.push(fromDom(node as DomLikeElement));
    } else if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      const text = node.nodeValue ?? "";
      if (text.trim() !== "") children.push(text);
    }
  }
  return { tag: el.localName ?? el.nodeName, attrs, children };
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** Serialize a CoreElement subtree to XML (no pretty-printing). */
export function serialize(el: CoreElement): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  if (el.children.length === 0) return `<${el.tag}${attrs}/>`;
  const inner = el.children.map((c) => (typeof c === "string" ? escapeText(c) : serialize(c))).join("");
  return `<${el.tag}${attrs}>${inner}</${el.tag}>`;
}

export function deepClone(el: CoreElement): CoreElement {
  return {
    tag: el.tag,
    attrs: { ...el.attrs },
    children: el.children.map((c) => (typeof c === "string" ? c : deepClone(c))),
  };
}

/** First descendant (or self) with the given tag, depth-first. */
export function findFirst(el: CoreElement, tag: string): CoreElement | null {
  if (el.tag === tag) return el;
  for (const c of el.children) {
    if (typeof c === "string") continue;
    const hit = findFirst(c, tag);
    if (hit) return hit;
  }
  return null;
}

/** All descendants with the given tag, in document order. */
export function findAll(el: CoreElement, tag: string, out: CoreElement[] = []): CoreElement[] {
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

export function childElements(el: CoreElement): CoreElement[] {
  return el.children.filter((c): c is CoreElement => typeof c !== "string");
}

/** djb2 over a string — cheap, stable content hashing for cache keys. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
