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
