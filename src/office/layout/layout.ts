// Turns the team + workflow config into an office: room modules on a tile grid.
//
//   ┌ back wall: plan board · sign · shelf · clock · window ─┬ server ┐
//   │ Lead corner (20 wide)          │ Lounge (≥ 9 wide)      │  room  │
//   │ ─────────────── corridor ───────────────────────────── │ racks  │
//   │ Desk grid (7×7 cubicles, pitch 8)   │ Review column     │        │
//   │ ════════════════ PR belt ═══════════╪═ gate ══════════════╗     │
//   └──────────────────────────────────────────────────────────╨─────┘
//   Garden courtyard on the lawn in front of the entrance (left).

import { projectRoomsOf, roomWorkerKey, supportsOllama, type AgentConfig, type Environment, type HqConfig, type ProjectRoomConfig, type ProjectWorkerKind } from "../../data/types";
import { deskCarpets } from "../engine/palette";
import { WalkGrid, type Tile } from "../engine/path";

export const TS = 16;
export const MARGIN = 4; // lawn around the building (tiles)
export const MARGIN_L = 9; // wider on the entrance side: the garden courtyard sits there

const LEAD_W = 20;
const MIN_LOUNGE_W = 9;
const REVIEW_W = 10;
const TOP_Y = 4; // first floor row
const DESK_Y = 14; // first cubicle row
const CUB = 7;
const PITCH = 8;
const RACKS_PER_ROW = 5;
const STATION_W = 7; // a project-room worker's station, in tiles
const STATION_H = 6;
const SECTION_COLS = 3; // most cubicle columns in one section
const CORRIDOR = 1; // extra empty tiles between sections (the 1-tile gutter of each block makes the corridor 2 wide)

/** Which part of the AI agents room an agent sits in: its CLI's section, or the local-model section. */
export type SectionId = "claude" | "codex" | "google" | "local";
export const SECTIONS: { id: SectionId; label: string; color: string }[] = [
  { id: "claude", label: "CLAUDE CODE", color: "#b0735a" },
  { id: "codex", label: "CODEX", color: "#5f9a82" },
  { id: "google", label: "ANTIGRAVITY", color: "#6f8fb8" },
  { id: "local", label: "LOCAL MODELS", color: "#8c7fae" },
];
export function sectionOf(a: AgentConfig): SectionId {
  if (a.provider === "ollama" && supportsOllama(a.cli)) return "local";
  return a.cli === "claude" ? "claude" : a.cli === "codex" ? "codex" : "google";
}

export interface Section {
  id: SectionId;
  label: string;
  color: string;
  x0: number; // first tile of the block
  w: number; // block width in tiles
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskSpot {
  agentId: string;
  index: number;
  x0: number; // cubicle origin, building tiles
  y0: number;
  seat: Tile;
  drop: Tile;
  rect: PxRect; // world px
  carpet: [string, string];
}

export interface Rack extends PxRect {
  name: string;
  agentId: string | null;
}

export type HitKind = "agent" | "plan" | "prs" | "gate" | "env" | "worker";

/** A non-AI worker's place in the project room. */
export interface ProjectStation {
  id: string;
  name: string;
  kind: ProjectWorkerKind;
  color: string;
  index: number;
  desk: PxRect; // the desk and its prop, world px
  stand: Tile;
  rect: PxRect;
  /** Where this worker's status is kept in `roomWorkers` (scoped by room id when there are several rooms). */
  key?: string;
}

/** One project's room as a small pavilion on the campus lawn. Tiles are building tiles (may lie below the building), rects are world px. */
export interface Pavilion {
  id: string;
  name: string;
  rect: PxRect; // the whole pavilion, walls included
  sign: PxRect; // the name sign above the glass front
  glass: PxRect; // the glass front, facing the stone path
  doorway: PxRect; // the opening in the glass front
  stations: ProjectStation[];
  planters: { x: number; y: number }[]; // world px, base centres
  inbox: PxRect;
  outbox: PxRect;
  x0: number; // tile of the pavilion's left wall, and its width and height in tiles
  y0: number;
  wTiles: number;
  hTiles: number;
}

const PAV_GAP = 2; // tiles of lawn between pavilions
const PAV_PATH = 3; // tiles between the building and the first row of pavilions (the stone path)
const PAV_FRONT = 4; // tiles above a pavilion's first station: sign + glass front

/** Size of a pavilion's interior for n workers: stations 7×6 tiles, one column up to 3 workers, two beyond. */
export function pavilionSize(workers: number): { cols: number; rows: number; w: number; h: number } {
  const cols = workers > 3 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(workers / cols));
  return { cols, rows, w: cols * STATION_W + 2, h: PAV_FRONT + rows * STATION_H + 1 };
}

/**
 * Places one pavilion per project room in rows on the lawn south of the building, left to right, wrapping
 * to a new row once a row is wider than `rowTiles`. The campus grows downward as rooms are added.
 * `originTy` is the tile row of the first pavilion row; `scoped` keys worker statuses by room.
 */
export function layoutPavilions(
  rooms: (ProjectRoomConfig & { id: string })[],
  opts: { ox: number; oy: number; originTy: number; rowTiles: number },
): { pavilions: Pavilion[]; bottomTy: number; rightTx: number } {
  const scoped = rooms.length > 1;
  const px = (tx: number) => opts.ox + tx * TS;
  const py = (ty: number) => opts.oy + ty * TS;
  const pavilions: Pavilion[] = [];
  let tx = 0;
  let ty = opts.originTy;
  let rowH = 0;
  let rightTx = 0;
  for (const room of rooms) {
    const sz = pavilionSize(room.workers.length);
    if (tx > 0 && tx + sz.w > opts.rowTiles) {
      tx = 0;
      ty += rowH + PAV_GAP + 1;
      rowH = 0;
    }
    const x0 = tx;
    const y0 = ty;
    const stations: ProjectStation[] = room.workers.map((w, i) => {
      const sx = x0 + 1 + (i % sz.cols) * STATION_W;
      const sy = y0 + PAV_FRONT + Math.floor(i / sz.cols) * STATION_H;
      return {
        id: w.id,
        name: w.name,
        kind: w.kind,
        color: w.color,
        index: i,
        desk: { x: px(sx + 1), y: py(sy), w: 5 * TS, h: 2 * TS },
        stand: [sx + 2, sy + 2] as Tile,
        rect: { x: px(sx), y: py(sy) - 6, w: STATION_W * TS, h: 3 * TS + 6 },
        key: roomWorkerKey(room.id, w.id, scoped),
      };
    });
    const mid = x0 + Math.floor(sz.w / 2);
    pavilions.push({
      id: room.id,
      name: room.name,
      x0,
      y0,
      wTiles: sz.w,
      hTiles: sz.h,
      rect: { x: px(x0), y: py(y0), w: sz.w * TS, h: sz.h * TS },
      sign: { x: px(x0), y: py(y0), w: sz.w * TS, h: TS },
      glass: { x: px(x0), y: py(y0 + 1), w: sz.w * TS, h: 2 * TS },
      doorway: { x: px(mid - 1), y: py(y0 + 1), w: 2 * TS, h: 2 * TS },
      stations,
      planters: [
        { x: px(x0) + 10, y: py(y0 + sz.h) - 4 },
        { x: px(x0 + sz.w) - 10, y: py(y0 + sz.h) - 4 },
        { x: px(x0) - 8, y: py(y0 + 1) + 12 },
        { x: px(x0 + sz.w) + 8, y: py(y0 + 1) + 12 },
      ],
      inbox: { x: px(x0 + 1) + 2, y: py(y0 + 3) - 2, w: 26, h: 20 },
      outbox: { x: px(x0 + sz.w - 1) - 30, y: py(y0 + 3) - 2, w: 26, h: 30 },
    });
    rowH = Math.max(rowH, sz.h);
    tx += sz.w + PAV_GAP;
    rightTx = Math.max(rightTx, x0 + sz.w);
  }
  return { pavilions, bottomTy: pavilions.length ? ty + rowH : opts.originTy, rightTx };
}

export interface Hit {
  kind: HitKind;
  id: string;
  rect: PxRect;
}

export interface OfficeLayout {
  key: string;
  W: number; // building size in tiles
  H: number;
  ox: number; // building origin in world px
  oy: number;
  worldW: number;
  worldH: number;
  mainW: number;
  grid: WalkGrid; // building tile coords
  lead: { agentId: string | null; seat: Tile; rect: PxRect };
  plan: { board: PxRect; spot: Tile };
  lounge: { x0: number; w: number; coffee: Tile[] };
  desks: DeskSpot[];
  sections: Section[];
  corridors: { x0: number; w: number }[]; // the empty lanes between sections (tiles)
  pavilions: Pavilion[]; // one per project room, on the lawn south of the building
  courtyard: PxRect; // the central garden in front of the entrance, world px
  belt: { y: number; x0: number; x1: number; topY: number | null }; // px; topY = vertical run end
  gate: PxRect | null;
  prBoard: PxRect | null;
  serverRoom: { glassX: number; x0: number; w: number } | null; // tiles
  racks: Rack[];
  mailbox: PxRect | null;
  cables: { agentId: string; pts: [number, number][] }[];
  door: Tile;
  wander: Tile[];
  hits: Hit[];
}

export function layoutKey(config: HqConfig, envs: Environment[]): string {
  const wf = config.workflow;
  return JSON.stringify([
    config.team.map((a) => [a.id, a.name, a.color, a.isLead, sectionOf(a)]),
    wf.review.enabled,
    wf.review.tool,
    wf.deploy.enabled,
    envs.map((e) => e.name),
    config.project.officeName ?? "",
    projectRoomsOf(config).map((r) => [r.id, r.name, r.workers.map((w) => [w.id, w.name, w.kind, w.color])]),
  ]);
}

export function deskColumns(n: number): number {
  if (n <= 4) return Math.max(1, n);
  return Math.min(5, Math.ceil(n / 2));
}

export function generateLayout(config: HqConfig, envs: Environment[]): OfficeLayout {
  const lead: AgentConfig | undefined = config.team.find((a) => a.isLead);
  const workers = config.team.filter((a) => !a.isLead);
  const review = config.workflow.review.enabled;
  const hasServer = config.workflow.deploy.enabled && envs.length > 0;

  // Sections of the AI agents room: one block of cubicles per CLI, local models apart, with a corridor between.
  const groups = SECTIONS.map((s) => ({ ...s, agents: workers.filter((a) => sectionOf(a) === s.id) })).filter((g) => g.agents.length);
  if (!groups.length) groups.push({ ...SECTIONS[0], agents: [] });
  const blockCols = (n: number) => Math.min(SECTION_COLS, deskColumns(n));
  const rows = Math.max(1, ...groups.map((g) => Math.ceil(g.agents.length / blockCols(g.agents.length))));
  const sections: Section[] = [];
  const corridors: { x0: number; w: number }[] = [];
  let sx = 2;
  groups.forEach((g, gi) => {
    const w = blockCols(g.agents.length) * PITCH;
    sections.push({ id: g.id, label: g.label, color: g.color, x0: sx, w });
    sx += w;
    if (gi < groups.length - 1) {
      corridors.push({ x0: sx - 1, w: 1 + CORRIDOR });
      sx += CORRIDOR;
    }
  });
  const x0r = sx; // review column start
  const mainW = Math.max(LEAD_W + MIN_LOUNGE_W, x0r + (review ? REVIEW_W : 2) - 1);
  const loungeW = mainW - LEAD_W;

  const rackCount = hasServer ? envs.length : 0;
  const rackRows = Math.ceil(rackCount / RACKS_PER_ROW);
  const srW = hasServer ? Math.max(5, 2 + Math.min(rackCount, RACKS_PER_ROW) * 2) : 0;

  const yb = DESK_Y + rows * PITCH; // belt row
  const minH = hasServer ? Math.ceil((22 + rackRows * 112) / TS) + 3 : 0;
  const H = Math.max(yb + 3, minH);
  const W = 1 + mainW + (hasServer ? 1 + srW : 0) + 1;
  const glassX = mainW + 1;

  const ox = MARGIN_L * TS;
  const oy = MARGIN * TS;
  const px = (tx: number) => ox + tx * TS;
  const py = (ty: number) => oy + ty * TS;
  // Project rooms stand apart as pavilions on the lawn south of the building; the campus grows to fit them.
  const pav = layoutPavilions(projectRoomsOf(config), { ox, oy, originTy: H + PAV_PATH, rowTiles: Math.max(W, 18) });
  const worldW = Math.max(W, pav.rightTx) + MARGIN_L + MARGIN;
  const worldH = Math.max(H, pav.pavilions.length ? pav.bottomTy + 1 : 0) + MARGIN * 2;

  // ---------------------------------------------------------- walkable grid
  const grid = new WalkGrid(W, H);
  grid.set(1, TOP_Y, mainW, H - 2, true);
  grid.set(0, 13, 0, 13, true); // door
  // lead corner furniture
  grid.set(13, 5, 17, 6, false); // lead desk
  grid.set(18, 4, 19, 4, false); // bookshelf
  grid.set(11, 4, 11, 4, false); // plant
  grid.set(1, 4, 1, 4, false);
  for (const [x, y] of [[3, 8], [8, 8], [5, 10], [1, 11]] as Tile[]) grid.set(x, y, x, y, false);
  // lounge furniture
  const L = LEAD_W + 1;
  grid.set(L, 4, L + 3, 4, false); // counter + fridge
  grid.set(L + 2, 8, L + 5, 8, false); // couch
  grid.set(L + 3, 10, L + 4, 10, false); // table
  grid.set(mainW, 4, mainW, 4, false); // water cooler
  grid.set(mainW, 7, mainW, 8, false); // arcade
  // belt + bottom
  grid.set(2, yb, mainW, yb, false);


  // ---------------------------------------------------------- desks
  const placed = groups.flatMap((g, gi) => g.agents.map((a, j) => ({ a, j, cols: blockCols(g.agents.length), x: sections[gi].x0 })));
  const desks: DeskSpot[] = placed.map(({ a, j, cols, x }, i) => {
    const c = j % cols;
    const r = Math.floor(j / cols);
    const x0 = x + c * PITCH;
    const y0 = DESK_Y + r * PITCH;
    grid.set(x0, y0, x0 + CUB - 1, y0, false);
    grid.set(x0 + 1, y0, x0 + 1, y0, true); // door gap
    grid.set(x0, y0, x0, y0 + CUB - 1, false);
    grid.set(x0 + CUB - 1, y0, x0 + CUB - 1, y0 + CUB - 1, false);
    grid.set(x0 + 2, y0 + 1, x0 + 4, y0 + 2, false);
    return {
      agentId: a.id,
      index: i,
      x0,
      y0,
      seat: [x0 + 3, y0 + 3],
      drop: [x0 + 3, yb - 1],
      rect: { x: px(x0), y: py(y0) - 4, w: CUB * TS, h: CUB * TS + 4 },
      carpet: deskCarpets[i % deskCarpets.length],
    };
  });

  // ---------------------------------------------------------- review column
  let gate: PxRect | null = null;
  let prBoard: PxRect | null = null;
  if (review) {
    gate = { x: px(x0r + 2), y: py(yb) - 25, w: 68, h: 46 };
    grid.set(x0r + 2, yb - 1, x0r + 6, yb + 1, false);
    prBoard = { x: px(x0r + 4), y: py(yb - 6) + 4, w: 64, h: 40 };
    grid.set(x0r + 4, yb - 6, x0r + 7, yb - 3, false);
  }

  // ---------------------------------------------------------- server room
  const racks: Rack[] = [];
  let mailbox: PxRect | null = null;
  const beltY = py(yb) + 8;
  let beltX1: number;
  let beltTop: number | null = null;
  if (hasServer) {
    grid.set(glassX, 0, W - 1, H - 1, false);
    envs.forEach((env, i) => {
      const c = i % RACKS_PER_ROW;
      const r = Math.floor(i / RACKS_PER_ROW);
      racks.push({ name: env.name, agentId: env.agentId, x: px(glassX + 2) + c * 32, y: oy + 22 + r * 112, w: 32, h: 92 });
    });
    beltX1 = px(glassX + 1) + 8;
    beltTop = oy + 112;
  } else {
    beltX1 = px(mainW) - 4;
    mailbox = { x: px(mainW) - 6, y: py(yb) - 14, w: 22, h: 30 };
    grid.set(mainW, yb - 1, mainW, yb, false);
  }

  // ---------------------------------------------------------- cables (desk → own rack)
  const cables: OfficeLayout["cables"] = [];
  desks.forEach((d, i) => {
    const rack = racks.find((r) => r.agentId === d.agentId);
    if (!rack) return;
    const sx = px(d.x0 + 3) + 4 + (i % 3) * 3;
    const laneY = py(yb) - 4 - (i % 4) * 3;
    const rx = rack.x + 10 + (i % 3) * 4;
    cables.push({ agentId: d.agentId, pts: [[sx, py(d.y0 + 2) + 12], [sx, laneY], [rx, laneY], [rx, rack.y + rack.h]] });
  });

  // ---------------------------------------------------------- hits
  const hits: Hit[] = [];
  const planBoard = { x: px(2) + 3, y: oy + 19, w: 140, h: 40 };
  hits.push({ kind: "plan", id: "plan", rect: { x: planBoard.x - 3, y: planBoard.y - 8, w: planBoard.w + 6, h: planBoard.h + 14 } });
  if (lead) hits.push({ kind: "agent", id: lead.id, rect: { x: px(12), y: oy + 64, w: 6 * TS, h: 3 * TS } });
  for (const d of desks) hits.push({ kind: "agent", id: d.agentId, rect: d.rect });
  if (gate) hits.push({ kind: "gate", id: "gate", rect: { x: gate.x, y: gate.y - 16, w: gate.w, h: gate.h + 16 } });
  if (prBoard) hits.push({ kind: "prs", id: "prs", rect: { x: prBoard.x, y: prBoard.y, w: prBoard.w, h: prBoard.h + 26 } });
  for (const r of racks) hits.push({ kind: "env", id: r.name, rect: r });
  for (const pv of pav.pavilions) for (const s of pv.stations) hits.push({ kind: "worker", id: s.key ?? s.id, rect: s.rect });

  const coffee: Tile[] = [[L, 5], [L + 1, 5], [L + 2, 5]];
  // Idle agents also stroll down the corridors between sections.
  const hall: Tile[] = corridors.map((c) => [c.x0, DESK_Y + 3] as Tile);
  const wander: Tile[] = [[L + 3, 9], [L + 5, 9], [L + 6, 6], [4, 9], [7, 9], [6, 11], [Math.min(mainW - 1, L + 7), 11], ...hall];

  return {
    key: layoutKey(config, envs),
    W,
    H,
    ox,
    oy,
    worldW: worldW * TS,
    worldH: worldH * TS,
    mainW,
    grid,
    lead: { agentId: lead?.id ?? null, seat: [15, 7], rect: { x: px(12), y: oy + 64, w: 6 * TS, h: 3 * TS } },
    plan: { board: planBoard, spot: [6, 5] },
    lounge: { x0: L, w: loungeW, coffee },
    desks,
    sections,
    corridors,
    pavilions: pav.pavilions,
        courtyard: { x: TS, y: oy + 5 * TS, w: ox - 2 * TS, h: Math.max(8, H - 8) * TS },
    belt: { y: beltY, x0: px(2), x1: beltX1, topY: beltTop },
    gate,
    prBoard,
    serverRoom: hasServer ? { glassX, x0: glassX + 1, w: srW } : null,
    racks,
    mailbox,
    cables,
    door: [1, 13],
    wander: wander.filter(([x, y]) => grid.ok(x, y)),
    hits,
  };
}

/** Tile centre in world px. */
export function tileCentre(l: OfficeLayout, t: Tile): { x: number; y: number } {
  return { x: l.ox + t[0] * TS + 8, y: l.oy + t[1] * TS + 8 };
}
