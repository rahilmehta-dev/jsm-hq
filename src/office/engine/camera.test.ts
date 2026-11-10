import { beforeAll, describe, expect, it } from "vitest";

let Camera: typeof import("./camera").Camera;
beforeAll(async () => {
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  ({ Camera } = await import("./camera"));
});

const make = (view = { w: 1400, h: 900 }) => {
  const world = { x: 0, y: 0, scale: { set() {} }, position: { set(x: number, y: number) { world.x = x; world.y = y; } } };
  const cam = new Camera(world as never, () => view, () => ({ left: 300, right: 16, top: 70, bottom: 16 }), () => true);
  return cam;
};

describe("Camera", () => {
  it("frames a small campus at normal zoom and centres it", () => {
    const cam = make();
    cam.setWorldSize(800, 500);
    cam.home(false);
    expect(cam.framed).toBe(true);
    expect(cam.zoom).toBeGreaterThanOrEqual(1);
    expect(cam.x).toBe(400);
    expect(cam.y).toBe(250);
  });

  it("zooms out below 1 when a tall campus needs it, and the whole campus fits", () => {
    const cam = make();
    cam.setWorldSize(1000, 3000);
    cam.home(false);
    expect(cam.zoom).toBeLessThan(1);
    expect(cam.minZoom()).toBeLessThan(1);
    expect((3000 - 96) * cam.zoom).toBeLessThanOrEqual(900 - 86); // the campus (less its lawn pad) fits the free height
    const out = make();
    out.setWorldSize(1000, 3000);
    out.home(false);
    out.zoomBy(1);
    expect(out.zoom).toBe(cam.zoom * 2 > 1 ? 1 : cam.zoom * 2);
    out.zoomBy(-5);
    expect(out.zoom).toBe(out.minZoom());
  });

  it("clears framed on pan/zoom and keeps the view inside the campus", () => {
    const cam = make();
    cam.setWorldSize(3000, 2000);
    cam.flyTo(1500, 1000, 3, false);
    expect(cam.framed).toBe(false);
    cam.panBy(-1e6, -1e6);
    expect(cam.x).toBeLessThanOrEqual(3000);
    expect(cam.y).toBeLessThanOrEqual(2000);
    cam.panBy(1e6, 1e6);
    expect(cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.y).toBeGreaterThanOrEqual(0);
  });

  it("reports whether setWorldSize changed the campus", () => {
    const cam = make();
    expect(cam.setWorldSize(800, 500)).toBe(true);
    expect(cam.setWorldSize(800, 500)).toBe(false);
  });
});
