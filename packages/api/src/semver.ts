/**
 * The engine check: does the host's API version satisfy a plugin's
 * `engines.battuta` range? A deliberately small semver — exact, `^`, `~`,
 * comparison operators, `*`, and space-separated conjunctions — so the
 * API package carries no runtime dependency.
 */
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

const cmp = (a: Version, b: Version): number => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

function satisfiesOne(v: Version, comparator: string): boolean {
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(comparator);
  if (!m) return false;
  const op = m[1] ?? "=";
  const t = parseVersion(m[2]!);
  if (!t) return false;
  switch (op) {
    case "^":
      // npm caret: the leftmost non-zero component is fixed.
      if (cmp(v, t) < 0) return false;
      if (t.major > 0) return v.major === t.major;
      if (t.minor > 0) return v.major === 0 && v.minor === t.minor;
      return v.major === 0 && v.minor === 0 && v.patch === t.patch;
    case "~":
      return cmp(v, t) >= 0 && v.major === t.major && v.minor === t.minor;
    case ">=":
      return cmp(v, t) >= 0;
    case ">":
      return cmp(v, t) > 0;
    case "<=":
      return cmp(v, t) <= 0;
    case "<":
      return cmp(v, t) < 0;
    default:
      return cmp(v, t) === 0;
  }
}

/** True when `version` lies inside `range` (all space-separated comparators must hold). */
export function satisfiesEngine(range: string, version: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "" || r === "*") return true;
  return r.split(/\s+/).every((part) => satisfiesOne(v, part));
}
