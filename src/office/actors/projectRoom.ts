// The project rooms' workers (one pavilion per project): non-AI characters (a mail fetcher, a writer on a local model, a sender…).
// A project reports what they do through the project-room API (see server/room.ts); the room then shows
// their real state, notes and hand-offs. Until a project connects, the room plays a looping demo of the
// pipeline (mail comes in, is written, then goes out) so it can be seen and designed first.

import { Sprite, type Container } from "pixi.js";
import type { ProjectWorkerKind, RoomHandoff, RoomWorkerState, RoomWorkerStatus } from "../../data/types";
import { robotSprites } from "../draw/robots";
import { drawScreen } from "../draw/live";
import { labelReg } from "../engine/font";
import { C } from "../engine/palette";
import { ellipse, type Pen } from "../engine/pen";
import type { OfficeLayout, Pavilion, ProjectStation, PxRect } from "../layout/layout";
import { tileCentre } from "../layout/layout";

const STEP = 2.4; // demo: seconds for one hop of the pipeline
const TRAVEL = 1.4; // of which the envelope is in the air
const BUSY = 1.8; // the worker then works on it
const FLIGHT = 1.2; // a real hand-off's flight, in seconds
const RANK: Record<ProjectWorkerKind, number> = { fetcher: 0, writer: 1, sender: 2, custom: 3 };

/** What the scene knows about the project rooms' workers right now. */
export interface RoomView {
  /** Worker statuses, keyed like `roomWorkers` (`<roomId>/<workerId>` when there are several rooms). */
  statuses: Record<string, RoomWorkerStatus>;
  /** Per room id: play the demo while that project has not reported anything. Missing = true. */
  demo: Record<string, boolean>;
}

interface Robot {
  station: ProjectStation;
  sprite: Sprite;
  textures: ReturnType<typeof robotSprites>["textures"];
  x: number;
  y: number;
}

interface Flight {
  from: { x: number; y: number };
  to: { x: number; y: number };
  t0: number;
}

const centre = (r: PxRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const keyOf = (s: ProjectStation) => s.key ?? s.id;
const deskPoint = (s: ProjectStation) => ({ x: centre(s.desk).x, y: s.desk.y + 8 });

export class ProjectActors {
  private robots = new Map<string, Robot>();
  private flights: Flight[] = [];
  private key = "";

  /** Creates, restyles and removes the robots to match the layout's pavilions. */
  sync(l: OfficeLayout, layer: Container) {
    const stations = l.pavilions.flatMap((p) => p.stations);
    const key = stations.map((s) => `${keyOf(s)}|${s.color}|${s.kind}`).join(",") + `@${l.ox},${l.oy}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    for (const s of stations) {
      const sprites = robotSprites(s.color, false);
      const sprite = new Sprite(sprites.textures.back);
      layer.addChild(sprite);
      const c = tileCentre(l, s.stand);
      this.robots.set(keyOf(s), { station: s, sprite, textures: sprites.textures, x: c.x, y: c.y });
    }
  }

  clear() {
    for (const r of this.robots.values()) r.sprite.destroy();
    this.robots.clear();
    this.flights = [];
  }

  /** A real hand-off: an envelope flies from one worker (or a pavilion's in-tray) to another (or its out-tray). */
  handoff(l: OfficeLayout, h: RoomHandoff, t: number) {
    const find = (key: string | null) => {
      if (key === null) return null;
      for (const p of l.pavilions) {
        const s = p.stations.find((x) => keyOf(x) === key);
        if (s) return { p, s };
      }
      return null;
    };
    const a = find(h.from);
    const b = find(h.to);
    // An end that is null is the in-tray / out-tray of the pavilion at the other end (else the first pavilion).
    const home = (a ?? b)?.p ?? l.pavilions[0];
    if (!home) return;
    if ((h.from !== null && !a) || (h.to !== null && !b)) return;
    const from = a ? deskPoint(a.s) : centre(home.inbox);
    const to = b ? deskPoint(b.s) : centre(home.outbox);
    this.flights.push({ from, to, t0: t });
  }

  /** The demo's chain: inbox → fetcher → writer → sender → outbox. Workers outside it just work. */
  private chain(p: Pavilion): { nodes: { x: number; y: number }[]; stations: ProjectStation[] } {
    const stations = p.stations.filter((s) => s.kind !== "custom").sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.index - b.index);
    return { nodes: [centre(p.inbox), ...stations.map(deskPoint), centre(p.outbox)], stations };
  }

  private demoBusy(p: Pavilion, t: number): Set<string> {
    const { stations } = this.chain(p);
    const phase = t % ((stations.length + 1) * STEP + 1);
    const busy = new Set<string>();
    stations.forEach((s, j) => {
      const from = j * STEP + TRAVEL;
      if (phase >= from && phase < from + BUSY) busy.add(keyOf(s));
    });
    return busy;
  }

  /** A pavilion plays its demo until its project reports something (or the demo is turned off). */
  private isDemo(p: Pavilion, view: RoomView) {
    return view.demo[p.id] !== false && !p.stations.some((s) => view.statuses[keyOf(s)]);
  }

  /** What each worker shows now: the project's real report (until it expires), or the demo. */
  private states(l: OfficeLayout, t: number, view: RoomView): Map<string, { state: RoomWorkerState; note: string | null }> {
    const out = new Map<string, { state: RoomWorkerState; note: string | null }>();
    const now = Date.now();
    for (const p of l.pavilions) {
      const busy = this.isDemo(p, view) ? this.demoBusy(p, t) : null;
      for (const s of p.stations) {
        const k = keyOf(s);
        if (busy) out.set(k, { state: s.kind === "custom" || busy.has(k) ? "working" : "idle", note: null });
        else {
          const r = view.statuses[k];
          out.set(k, !r || now - Date.parse(r.at) > r.ttl * 1000 ? { state: "idle", note: null } : { state: r.state, note: r.note });
        }
      }
    }
    return out;
  }

  /** Moves the robots' sprites for this frame. */
  update(l: OfficeLayout, t: number, reduced: boolean, view: RoomView) {
    const states = this.states(l, t, view);
    for (const [k, r] of this.robots) {
      const working = states.get(k)?.state === "working";
      const hover = 3 + (reduced ? 0 : Math.floor(t * 2.5 + r.station.index) % 2);
      r.sprite.texture = working && !reduced && Math.floor(t * 8) % 2 ? r.textures.type : r.textures.back;
      r.sprite.position.set(Math.round(r.x) - 6, Math.round(r.y) - 13 - hover);
      r.sprite.zIndex = Math.round(r.y);
    }
  }

  draw(p: Pen, shadow: Pen, l: OfficeLayout, t: number, reduced: boolean, view: RoomView) {
    if (!l.pavilions.length) return;
    const states = this.states(l, t, view);
    for (const pv of l.pavilions)
      for (const s of pv.stations) {
        const k = keyOf(s);
        const r = this.robots.get(k);
        const st = states.get(k) ?? { state: "idle" as const, note: null };
        if (r) ellipse(shadow, Math.round(r.x), Math.round(r.y) + 1, 4, 1, C.shadow, 0.3);
        const screen = st.state === "error" ? "needs-input" : st.state === "done" ? "review-passed" : st.state === "working" ? "working" : "idle";
        drawScreen(p, s.desk.x + 15, s.desk.y - 4, screen, s.color, reduced ? 0 : t, s.index);
        if (s.kind === "writer" && st.state === "working" && !reduced) p.rect(s.desk.x + 58, s.desk.y + 10, 14, 12, "#aaffee", 0.3 + 0.25 * Math.sin(t * 6));
        if (r && (st.state === "working" || st.state === "error")) bubble(p, r.x, r.y - 30, t, st.state === "error");
        if (st.note && st.state !== "idle") noteTag(p, centre(s.desk).x, s.desk.y + 63, st.note, st.state === "error");
      }
    if (reduced) return;
    for (const pv of l.pavilions) this.drawDemoMail(p, pv, t, view);
    this.flights = this.flights.filter((f) => t - f.t0 < FLIGHT);
    for (const f of this.flights) envelope(p, f.from, f.to, (t - f.t0) / FLIGHT);
  }

  /** The demo's envelope, hopping along a pavilion's chain. Not drawn once its project is reporting. */
  private drawDemoMail(p: Pen, pv: Pavilion, t: number, view: RoomView) {
    if (!this.isDemo(pv, view)) return;
    const { nodes } = this.chain(pv);
    if (nodes.length < 2) return;
    const phase = t % ((nodes.length - 1) * STEP + 1);
    const hop = Math.floor(phase / STEP);
    const k = (phase - hop * STEP) / TRAVEL;
    if (hop >= nodes.length - 1 || k >= 1) return;
    envelope(p, nodes[hop], nodes[hop + 1], k);
  }
}

/** An envelope in flight, easing between two points along a small arc. k runs 0 → 1. */
function envelope(p: Pen, a: { x: number; y: number }, b: { x: number; y: number }, k: number) {
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const x = Math.round(a.x + (b.x - a.x) * e) - 4;
  const y = Math.round(a.y + (b.y - a.y) * e - Math.sin(e * Math.PI) * 22) - 3;
  p.rect(x, y, 9, 7, C.ink);
  p.rect(x + 1, y + 1, 7, 5, C.white);
  p.rect(x + 2, y + 2, 1, 1, C.pink);
  p.rect(x + 3, y + 3, 1, 1, C.pink);
  p.rect(x + 5, y + 2, 1, 1, C.pink);
}

/** A speech bubble: three dots that light up in turn when busy, an exclamation mark on an error. */
function bubble(p: Pen, cx: number, y: number, t: number, error: boolean) {
  const x = Math.round(cx) - 7;
  p.rect(x, y, 15, 9, C.ink);
  p.rect(x + 1, y + 1, 13, 7, error ? C.red : C.white);
  p.rect(Math.round(cx) - 1, y + 9, 3, 2, C.ink);
  if (error) {
    p.rect(x + 7, y + 2, 1, 3, C.white);
    p.rect(x + 7, y + 6, 1, 1, C.white);
    return;
  }
  for (let i = 0; i < 3; i++) p.rect(x + 3 + i * 4, y + 4, 2, 2, Math.floor(t * 4) % 3 === i ? C.ink : C.lav);
}

/** What the worker is doing, in a small label above its bubble. */
function noteTag(_p: Pen, cx: number, y: number, note: string, error: boolean) {
  const label = note.toUpperCase().slice(0, 26);
  labelReg.dynamic.push({ text: label, x: cx, y, prio: error ? 1 : 4 });
}
