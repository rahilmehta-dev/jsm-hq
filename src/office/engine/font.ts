// 3×5 bitmap font for in-world signs and tags.

import { C } from "./palette";
import { box, type Pen } from "./pen";

const FONT: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."], G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"], J: ["..#", "..#", "..#", "#.#", ".#."], K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: [".#.", "#.#", "#.#", "#.#", ".#."], P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"], R: ["##.", "#.#", "##.", "#.#", "#.#"], S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."], W: ["#.#", "#.#", "###", "###", "#.#"], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."], Z: ["###", "..#", ".#.", "#..", "###"],
  0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["##.", "..#", ".#.", "#..", "###"], 3: ["##.", "..#", ".#.", "..#", "##."],
  4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "##.", "..#", "##."], 6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "##."],
  "#": ["#.#", "###", "#.#", "###", "#.#"], "-": ["...", "...", "###", "...", "..."], ".": ["...", "...", "...", "...", ".#."], ":": ["...", ".#.", "...", ".#.", "..."],
  "!": [".#.", ".#.", ".#.", "...", ".#."], "?": ["##.", "..#", ".#.", "...", ".#."], "+": ["...", ".#.", "###", ".#.", "..."], "/": ["..#", "..#", ".#.", "#..", "#.."],
  "(": ["..#", ".#.", ".#.", ".#.", "..#"], ")": ["#..", ".#.", ".#.", ".#.", "#.."], ",": ["...", "...", "...", ".#.", "#.."], "'": [".#.", ".#.", "...", "...", "..."],
  "&": [".#.", "#.#", ".#.", "#.#", ".##"], "_": ["...", "...", "...", "...", "###"], "=": ["...", "###", "...", "###", "..."], ">": ["#..", ".#.", "..#", ".#.", "#.."],
  "·": ["...", "...", ".#.", "...", "..."], "—": ["...", "...", "###", "...", "..."],
  " ": ["...", "...", "...", "...", "..."],
};

export const textW = (str: string, s = 1) => Math.max(0, String(str).length * 4 - 1) * s;

export function text(p: Pen, str: string, x: number, y: number, color: string, s = 1) {
  const up = String(str).toUpperCase();
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let i = 0; i < up.length; i++) {
    const gl = FONT[up[i]] ?? FONT["?"];
    for (let gy = 0; gy < 5; gy++) {
      const row = gl[gy];
      // Merge horizontal runs into one rect.
      let gx = 0;
      while (gx < 3) {
        if (row[gx] !== "#") {
          gx += 1;
          continue;
        }
        let run = 1;
        while (gx + run < 3 && row[gx + run] === "#") run += 1;
        p.rect(x0 + (i * 4 + gx) * s, y0 + gy * s, run * s, s, color);
        gx += run;
      }
    }
  }
}

/** Plate colours: solid white, black outline, black text (21:1). Never translucent. */
export const PLATE = { fill: "#ffffff", line: "#000000", ink: "#000000" } as const;

/**
 * Small tag: black text on a solid white plate with a 1px black outline, centred on cx.
 * `accent` (an agent or status colour) shows as a 2px swatch on the plate's left edge, so identity
 * survives without ever being the text colour. `_legacyBg` is ignored (kept so existing callers compile): no coloured plates.
 */
export function tag(p: Pen, str: string, cx: number, y: number, _legacyBg?: string, accent?: string) {
  const w = textW(str);
  if (accent === C.white) accent = undefined;
  const sw = accent ? 3 : 0;
  const x = Math.round(cx - (w + sw) / 2) + sw;
  box(p, x - 3 - sw, y - 2, w + 6 + sw, 9, PLATE.fill, PLATE.line);
  if (accent) p.rect(x - 2 - sw, y - 1, 2, 7, accent);
  text(p, str, x, y, PLATE.ink);
}

/** Clips a label to fit `maxPx` wide. */
export function fit(str: string, maxPx: number): string {
  const max = Math.max(1, Math.floor((maxPx + 1) / 4));
  return str.length <= max ? str : str.slice(0, Math.max(1, max - 1)) + ".";
}
