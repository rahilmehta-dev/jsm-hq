import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classic, mergedChip, reviewChip, stateChip } from "./tokens";

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // body text
const LARGE = 3; // large text, icons, component boundaries

describe("contrast helper", () => {
  it("matches known values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("classic palette text", () => {
  const { paper, platinum, platinum2, desk, ink, ink2, select, selectInk } = classic;
  const surfaces = { paper, platinum, platinum2, "#eeeeee": "#eeeeee" };
  for (const [name, bg] of Object.entries(surfaces)) {
    it(`ink and ink-2 are readable on ${name}`, () => {
      expect(contrast(ink, bg)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(ink2, bg)).toBeGreaterThanOrEqual(TEXT);
    });
  }
  it("selection text is readable", () => {
    expect(contrast(selectInk, select)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(select, paper)).toBeGreaterThanOrEqual(TEXT);
  });
  it("borders and focus rings are visible", () => {
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(LARGE);
    expect(contrast(select, paper)).toBeGreaterThanOrEqual(LARGE);
    expect(contrast(ink, desk)).toBeGreaterThanOrEqual(LARGE);
  });
});

describe("state chips", () => {
  const all = [...Object.entries(stateChip), ...Object.entries(reviewChip), ["merged", mergedChip] as const];
  for (const [name, c] of all) {
    it(`${name}: ink label on fill, mark visible on fill and paper`, () => {
      expect(contrast(classic.ink, c.fill)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(c.mark, c.fill)).toBeGreaterThanOrEqual(LARGE);
      expect(contrast(c.mark, classic.paper)).toBeGreaterThanOrEqual(LARGE);
    });
  }
});

describe("index.css stays in sync with tokens.ts", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const map: Record<string, string> = {
    paper: classic.paper,
    platinum: classic.platinum,
    "platinum-2": classic.platinum2,
    desk: classic.desk,
    ink: classic.ink,
    "ink-2": classic.ink2,
    select: classic.select,
    "select-ink": classic.selectInk,
  };
  for (const [k, v] of Object.entries(map)) {
    it(`--color-${k} is ${v}`, () => {
      expect(css).toMatch(new RegExp(`--color-${k}:\\s*${v};`, "i"));
    });
  }
  it("legacy text tokens still pass on the surfaces they sit on", () => {
    const get = (k: string) => css.match(new RegExp(`--color-${k}:\\s*(#[0-9a-f]{6});`, "i"))![1];
    for (const bg of ["cream", "cream-2", "cream-3"]) {
      expect(contrast(get("muted"), get(bg))).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(get("ink"), get(bg))).toBeGreaterThanOrEqual(TEXT);
    }
    for (const fg of ["red", "orange", "green"]) expect(contrast(get(fg), get("cream"))).toBeGreaterThanOrEqual(TEXT);
  });
  it("uses no blurred shadows or 11px text in the base styles", () => {
    expect(css).not.toMatch(/box-shadow:[^;]*\d+px \d+px [1-9]\d*px/);
  });
});

// ---- Phase 3.1: every token in the design brief ----
describe("brief tokens: text pairs (>= 4.5:1)", () => {
  const c = classic;
  const pairs: [string, string, string][] = [
    ["ink", c.ink, c.paper],
    ["ink on desk", c.ink, c.desk],
    ["ink on lawn", c.ink, c.lawn],
    ["ink on lawn-d", c.ink, c.lawnD],
    ["ink on warn-fill", c.ink, c.warnFill],
    ["ink on bad-fill", c.ink, c.badFill],
    ["ink on ok-fill", c.ink, c.okFill],
    ["ink-2 on paper", c.ink2, c.paper],
    ["ink-2 on platinum", c.ink2, c.platinum],
    ["ink-2 on platinum-2", c.ink2, c.platinum2],
    ["select-ink on select", c.selectInk, c.select],
    ["select on paper (links)", c.select, c.paper],
    ["well-ink on well", c.wellInk, c.well],
    ["well-dim on well", c.wellDim, c.well],
    ["well-err on well", c.wellErr, c.well],
  ];
  for (const [name, fg, bg] of pairs) {
    it(name, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT));
  }
});

describe("brief tokens: marks (>= 3:1)", () => {
  const c = classic;
  const marks = { working: c.markWorking, warn: c.markWarn, bad: c.markBad, ok: c.markOk, idle: c.markIdle };
  const fillFor: Record<string, string> = { working: "#cfe4f5", warn: c.warnFill, bad: c.badFill, ok: c.okFill, idle: "#e4e4e4" };
  for (const [name, m] of Object.entries(marks)) {
    it(`mark-${name} on paper and on its fill`, () => {
      expect(contrast(m, c.paper)).toBeGreaterThanOrEqual(LARGE);
      expect(contrast(m, fillFor[name])).toBeGreaterThanOrEqual(LARGE);
    });
  }
  it("marks stay in step with the chip tokens", () => {
    expect(stateChip.working.mark).toBe(c.markWorking);
    expect(stateChip["needs-input"].mark).toBe(c.markBad);
    expect(stateChip["in-review"].mark).toBe(c.markWarn);
    expect(stateChip["review-passed"].mark).toBe(c.markOk);
    expect(stateChip.idle.mark).toBe(c.markIdle);
    expect(stateChip["needs-input"].fill).toBe(c.badFill);
    expect(stateChip["in-review"].fill).toBe(c.warnFill);
    expect(stateChip["review-passed"].fill).toBe(c.okFill);
  });
});

describe("brief tokens: boundaries (>= 3:1)", () => {
  it("windows and plates are outlined in ink against every surface they sit on", () => {
    for (const bg of [classic.paper, classic.platinum, classic.desk, classic.lawn, classic.lawnD]) {
      expect(contrast(classic.ink, bg)).toBeGreaterThanOrEqual(LARGE);
    }
  });
  it("the terminal well separates from a platinum window", () => {
    expect(contrast(classic.well, classic.platinum)).toBeGreaterThanOrEqual(LARGE);
  });
});

describe("brief tokens: all mirrored in index.css", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const names: Record<string, string> = {
    warnFill: "warn-fill", badFill: "bad-fill", okFill: "ok-fill",
    markWorking: "mark-working", markWarn: "mark-warn", markBad: "mark-bad", markOk: "mark-ok", markIdle: "mark-idle",
    well: "well", wellInk: "well-ink", wellDim: "well-dim", wellErr: "well-err", lawn: "lawn", lawnD: "lawn-d",
  };
  for (const [key, cssName] of Object.entries(names)) {
    const hex = (classic as Record<string, string>)[key];
    it(`--color-${cssName} is ${hex}`, () => expect(css).toMatch(new RegExp(`--color-${cssName}:\\s*${hex};`, "i")));
  }
  it("every classic token has a CSS twin", () => {
    expect(Object.keys(classic).length).toBe(8 + Object.keys(names).length);
  });
  it("lawn is calm: HSL saturation <= 25%", () => {
    for (const hex of [classic.lawn, classic.lawnD]) {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      expect(s).toBeLessThanOrEqual(0.25);
    }
  });
});
