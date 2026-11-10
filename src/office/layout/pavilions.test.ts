import { describe, expect, it } from "vitest";
import { layoutPavilions, pavilionSize, TS } from "./layout";

const room = (id: string, n: number) => ({
  id,
  name: id,
  workers: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, name: `W${i}`, kind: "custom" as const, color: "#fff" })),
});
const opts = { ox: 100, oy: 50, originTy: 30, rowTiles: 40 };

describe("layoutPavilions", () => {
  it("makes none for no rooms", () => {
    expect(layoutPavilions([], opts).pavilions).toEqual([]);
  });

  it("sizes a pavilion by its workers", () => {
    expect(pavilionSize(1)).toMatchObject({ cols: 1, rows: 1 });
    expect(pavilionSize(4)).toMatchObject({ cols: 2, rows: 2 });
    expect(pavilionSize(4).w).toBeGreaterThan(pavilionSize(3).w);
  });

  it("places pavilions side by side without overlap, then wraps to a new row", () => {
    const { pavilions, bottomTy } = layoutPavilions([room("a", 2), room("b", 2), room("c", 2), room("d", 2)], opts);
    expect(pavilions).toHaveLength(4);
    const [a, b] = pavilions;
    expect(b.rect.x).toBeGreaterThan(a.rect.x + a.rect.w);
    expect(pavilions[3].rect.y).toBeGreaterThan(a.rect.y); // the fourth does not fit in 40 tiles: wrapped
    expect(bottomTy).toBeGreaterThan(pavilions[0].y0 + pavilions[0].hTiles);
  });

  it("keeps every station inside its pavilion and scopes status keys when there are several rooms", () => {
    const { pavilions } = layoutPavilions([room("a", 5), room("b", 1)], opts);
    for (const p of pavilions)
      for (const s of p.stations) {
        expect(s.rect.x).toBeGreaterThanOrEqual(p.rect.x);
        expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(p.rect.x + p.rect.w);
        expect(s.desk.y + s.desk.h).toBeLessThanOrEqual(p.rect.y + p.rect.h);
      }
    expect(pavilions[0].stations[0].key).toBe("a/w0");
    expect(layoutPavilions([room("a", 1)], opts).pavilions[0].stations[0].key).toBe("w0");
    expect(pavilions[0].rect.x).toBe(opts.ox + 0 * TS);
  });
});

describe("generateLayout", () => {
  it("adds one pavilion per project room and grows the campus downward", async () => {
    const { generateLayout } = await import("./layout");
    const { presets } = await import("../../data/mock/presets");
    const base = structuredClone(presets.find((x) => x.id === "big-team")!.config);
    delete base.projectRoom;
    const none = generateLayout(base, []);
    expect(none.pavilions).toHaveLength(0);
    const one = generateLayout({ ...base, projectRooms: [room("a", 3)] }, []);
    const three = generateLayout({ ...base, projectRooms: [room("a", 3), room("b", 4), room("c", 1)] }, []);
    expect(one.pavilions).toHaveLength(1);
    expect(three.pavilions).toHaveLength(3);
    expect(one.worldH).toBeGreaterThan(none.worldH);
    expect(three.hits.filter((h) => h.kind === "worker")).toHaveLength(8);
    expect(three.hits.find((h) => h.id === "b/w0")).toBeTruthy();
  });
});
