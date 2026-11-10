// Integer-zoom camera over the world container: drag to pan, wheel to zoom,
// eased fly-to. Positions are rounded so pixels stay crisp.

import type { Container } from "pixi.js";

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
// Zoom moves in steps of 1/devicePixelRatio, so zoom × dpr is always a whole
// number and every art pixel covers whole device pixels (1.5x is crisp on Retina).
const DPR = Math.max(1, Math.round(window.devicePixelRatio || 1));
const STEP = 1 / DPR;
const LADDER = [0.5, 0.25, 0.125]; // zooms below 1
const SLACK = 48; // world px the view may drift past the campus edge when the campus is larger than the view
const PAD = 48; // world px of lawn around the content that fit-to-view may crop
const snapPx = (v: number) => Math.round(v * DPR) / DPR;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Flight {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  t: number;
  dur: number;
}

export class Camera {
  zoom = 2;
  x = 0; // world point at the centre of the free area
  y = 0;
  worldW = 1;
  worldH = 1;
  private flight: Flight | null = null;
  /** True while the view is the "whole campus" framing; panning or zooming by hand clears it. */
  framed = false;

  constructor(
    private world: Container,
    private viewport: () => { w: number; h: number },
    private insets: () => Insets,
    private reducedMotion: () => boolean,
    /** Insets used only to pick the framing zoom. Overlays that slide over the map (drawers) are left out, so opening one never shrinks the campus. */
    private fitInsets: () => Insets = insets,
  ) {}

  /** Sets the campus size; returns true if it changed. */
  setWorldSize(w: number, h: number): boolean {
    const changed = w !== this.worldW || h !== this.worldH;
    this.worldW = w;
    this.worldH = h;
    return changed;
  }

  /** The zoom that shows the whole campus (its lawn margin may be cropped by PAD) in the free area, on a crisp step. */
  private fitRaw(): number {
    const { w, h } = this.viewport();
    const i = this.fitInsets();
    const fw = Math.max(100, w - i.left - i.right);
    const fh = Math.max(100, h - i.top - i.bottom);
    const cw = Math.max(1, this.worldW - PAD * 2);
    const ch = Math.max(1, this.worldH - PAD * 2);
    const c = Math.min(fw / cw, fh / ch);
    if (c >= 1) return Math.floor(c / STEP + 1e-6) * STEP;
    return LADDER.find((z) => z <= c + 1e-6) ?? LADDER[LADDER.length - 1]; // below 1: halves, which stay even under nearest-neighbour scaling
  }

  /** Lowest zoom: normally 1, halves of it when a big campus needs that to fit. */
  minZoom(): number {
    return Math.min(MIN_ZOOM, this.fitRaw());
  }

  private snap(z: number) {
    const lo = this.minZoom();
    if (z < 1) return Math.max(lo, LADDER.find((l) => l <= z + 1e-6) ?? lo);
    return Math.min(MAX_ZOOM, Math.round(z / STEP) * STEP);
  }

  /** Zoom that shows the whole campus in the free area. */
  fitZoom(): number {
    return this.snap(this.fitRaw());
  }

  /** Frames the whole campus, centred in the free area. */
  home(animate = true) {
    this.flyTo(this.worldW / 2, this.worldH / 2, this.fitZoom(), animate);
    this.framed = true;
  }

  flyTo(x: number, y: number, zoom = this.zoom, animate = true) {
    this.framed = false;
    const z = this.snap(zoom);
    if (!animate || this.reducedMotion()) {
      this.flight = null;
      Object.assign(this, { x, y, zoom: z });
      this.apply();
      return;
    }
    this.flight = { from: { x: this.x, y: this.y, z: this.zoom }, to: { x, y, z }, t: 0, dur: 0.7 };
  }

  /** `delta` is in steps (+1 = one step closer). */
  zoomBy(delta: number, anchor?: { x: number; y: number }) {
    const z = this.snap(
      delta < 0 && this.zoom <= 1 ? this.zoom / 2 : delta > 0 && this.zoom < 1 ? this.zoom * 2 : this.zoom + delta * STEP,
    );
    if (z === this.zoom) return;
    this.flight = null;
    this.framed = false;
    if (anchor) {
      // Keep the world point under the cursor fixed.
      const before = this.screenToWorld(anchor.x, anchor.y);
      this.zoom = z;
      const after = this.screenToWorld(anchor.x, anchor.y);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    } else this.zoom = z;
    this.apply();
  }

  panBy(dxScreen: number, dyScreen: number) {
    this.flight = null;
    this.framed = false;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.apply();
  }

  update(dt: number) {
    const f = this.flight;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / f.dur);
    const e = easeInOut(f.t);
    this.x = f.from.x + (f.to.x - f.from.x) * e;
    this.y = f.from.y + (f.to.y - f.from.y) * e;
    // Zoom snaps at the middle of the flight so it stays on a step.
    this.zoom = f.t < 0.5 ? f.from.z : f.to.z;
    if (f.t >= 1) this.flight = null;
    this.apply();
  }

  private centre() {
    const { w, h } = this.viewport();
    const i = this.insets();
    return { cx: i.left + (w - i.left - i.right) / 2, cy: i.top + (h - i.top - i.bottom) / 2 };
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.world.x) / this.zoom, y: (sy - this.world.y) / this.zoom };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: wx * this.zoom + this.world.x, y: wy * this.zoom + this.world.y };
  }

  apply() {
    const { cx, cy } = this.centre();
    const { w, h } = this.viewport();
    const i = this.insets();
    // Keep the campus in view: centred when it is smaller than the free area, else the edge stops the view (with some slack).
    const fit = (pos: number, world: number, view: number) => {
      const half = view / 2 / this.zoom;
      if (world <= half * 2) return world / 2;
      const m = half - SLACK > 0 ? SLACK : 0;
      return Math.max(half - m, Math.min(world - half + m, pos));
    };
    this.x = fit(this.x, this.worldW, Math.max(100, w - i.left - i.right));
    this.y = fit(this.y, this.worldH, Math.max(100, h - i.top - i.bottom));
    this.world.scale.set(this.zoom);
    this.world.position.set(snapPx(cx - this.x * this.zoom), snapPx(cy - this.y * this.zoom));
  }
}
