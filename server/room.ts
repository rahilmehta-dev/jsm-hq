// The project-room API: how any project (in any language) creates its room in the office and tells HQ what
// its workers are doing. Local only, with its own token (never the agents' or the browser's).
//
// An office can hold several project rooms (one per project), each with its own workers. A room's id is a
// slug of its name. Every call that touches one room takes its id as `?room=<id>` (or `"room"` in the body);
// with a single room it can be left out, so projects written for one room keep working. With several, a call
// that doesn't say which gets a 400 listing the ids.
//   GET    /room         one room and its workers' latest status ({ room, status, rooms: [ids] })
//   GET    /rooms        every room, each with its status
//   PUT    /room         create or replace a room: { name, workers: [{ id?, name, kind?, color? }], demo?, id? }
//                        (by `?room=` / `id`, else by the name's slug: the same name replaces, a new name adds a room)
//   DELETE /room         remove a room
//   POST   /room/event   { worker, state?, note?, ttl?, handoff?: { from?, to? }, room? }

import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { agentPalette } from "../src/theme/tokens";
import { projectRoomsOf, roomIdOf, roomWorkerKey } from "../src/data/types";
import type { ProjectRoomConfig, ProjectWorker, ProjectWorkerKind, RoomWorkerState, RoomWorkerStatus } from "../src/data/types";
import type { Hub } from "./hub";

const KINDS: ProjectWorkerKind[] = ["fetcher", "writer", "sender", "custom"];
const STATES: RoomWorkerState[] = ["idle", "working", "error", "done"];
export const MAX_ROOMS = 12;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

type Room = ProjectRoomConfig & { id: string };

/** A project room from outside (the browser or a project): names clipped, kinds and ids checked, colors from the palette. */
export function cleanProjectRoom(raw: unknown): Room | null {
  const input = (raw ?? null) as Partial<ProjectRoomConfig> | null;
  if (!input || typeof input !== "object") return null;
  const used = new Set<string>();
  const workers = (Array.isArray(input.workers) ? input.workers : []).slice(0, 12).map((w, i): ProjectWorker => {
    const name = clip(w?.name, 40).trim() || "Worker";
    // A project may name its worker's id (so its events keep matching); otherwise it comes from the name.
    const base = slug(clip(w?.id, 40)) || slug(name) || "worker";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    const kind = KINDS.includes(w?.kind as ProjectWorkerKind) ? (w.kind as ProjectWorkerKind) : "custom";
    const color = typeof w?.color === "string" && (agentPalette as readonly string[]).includes(w.color) ? w.color : agentPalette[(i + 3) % agentPalette.length];
    return { id, name, kind, color };
  });
  const name = clip(input.name, 40).trim() || "Project";
  return { id: roomIdOf({ id: clip(input.id, 40), name }), name, workers, ...(input.demo === false ? { demo: false } : {}) };
}

/**
 * Saves the rooms (and the first one as the legacy `projectRoom`). Statuses move to their new keys, and
 * those of workers or rooms that are gone are forgotten.
 */
export function setRooms(hub: Hub, rooms: Room[]) {
  const cfg = hub.snap.config;
  const before = projectRoomsOf(cfg);
  const wasScoped = before.length > 1;
  const scoped = rooms.length > 1;
  const kept: Record<string, RoomWorkerStatus> = {};
  for (const r of before)
    for (const w of r.workers) {
      const status = hub.snap.roomWorkers?.[roomWorkerKey(r.id, w.id, wasScoped)];
      if (status && rooms.find((x) => x.id === r.id)?.workers.some((x) => x.id === w.id)) kept[roomWorkerKey(r.id, w.id, scoped)] = status;
    }
  hub.snap.roomWorkers = kept;
  if (wasScoped !== scoped) hub.snap.roomHandoffs = []; // their ends were named the old way
  if (rooms.length) {
    cfg.projectRooms = rooms;
    cfg.projectRoom = rooms[0];
  } else {
    delete cfg.projectRooms;
    delete cfg.projectRoom;
  }
  hub.configChanged();
}

/** Adds the room, or replaces the one with the same id. False when that would be more than MAX_ROOMS. */
export function upsertRoom(hub: Hub, room: Room): boolean {
  const rooms = projectRoomsOf(hub.snap.config);
  const at = rooms.findIndex((r) => r.id === room.id);
  if (at === -1 && rooms.length >= MAX_ROOMS) return false;
  if (at === -1) rooms.push(room);
  else rooms[at] = room;
  setRooms(hub, rooms);
  return true;
}

export function removeRoom(hub: Hub, id: string) {
  setRooms(hub, projectRoomsOf(hub.snap.config).filter((r) => r.id !== id));
}

/**
 * The browser's single-room editor: with one room (or none) it replaces it, whatever its name; with several it
 * replaces the one with the same id. null removes the first room.
 */
export function setRoom(hub: Hub, room: Room | null) {
  const rooms = projectRoomsOf(hub.snap.config);
  if (!room) return setRooms(hub, rooms.slice(1));
  if (rooms.length <= 1) return setRooms(hub, [room]);
  upsertRoom(hub, room);
}

/** Which room a call means: by id (or name), or the only room. Otherwise a ready-made error that lists the ids. */
export function pickRoom(rooms: Room[], ref: unknown): { room: Room } | { code: number; error: string; rooms: string[] } {
  const ids = rooms.map((r) => r.id);
  const want = typeof ref === "string" ? ref.trim() : "";
  if (want) {
    const room = rooms.find((r) => r.id === slug(want) || r.name.toLowerCase() === want.toLowerCase());
    return room ? { room } : { code: 404, error: `no project room "${want}"`, rooms: ids };
  }
  if (!rooms.length) return { code: 404, error: "no project room yet: PUT /room first", rooms: ids };
  if (rooms.length > 1) return { code: 400, error: "there are several project rooms: say which with ?room=<id> (or \"room\" in the body)", rooms: ids };
  return { room: rooms[0] };
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

interface EventBody {
  room?: unknown;
  worker?: unknown;
  state?: unknown;
  note?: unknown;
  ttl?: unknown;
  handoff?: { from?: unknown; to?: unknown };
}

/** Handles /room requests. Returns false when the path isn't a room one. */
export async function handleRoomHttp(hub: Hub, token: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/room" && url.pathname !== "/rooms" && url.pathname !== "/room/event") return false;
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!safeEqual(req.headers.authorization ?? "", `Bearer ${token}`)) return json(401, { error: "unauthorized: send the project-room token as a Bearer token" }), true;
  const rooms = () => projectRoomsOf(hub.snap.config);
  const key = (room: Room, workerId: string) => roomWorkerKey(room.id, workerId, rooms().length > 1);
  /** A room's statuses, by the worker's own id. */
  const statusOf = (room: Room) => {
    const out: Record<string, RoomWorkerStatus> = {};
    for (const w of room.workers) {
      const s = hub.snap.roomWorkers?.[key(room, w.id)];
      if (s) out[w.id] = s;
    }
    return out;
  };
  const queryRoom = url.searchParams.get("room");
  try {
    if (url.pathname === "/rooms" && req.method === "GET") return json(200, { rooms: rooms().map((r) => ({ ...r, status: statusOf(r) })) }), true;
    if (url.pathname === "/room" && req.method === "GET") {
      const picked = pickRoom(rooms(), queryRoom);
      if ("error" in picked) return json(picked.code, { error: picked.error, rooms: picked.rooms }), true;
      return json(200, { room: picked.room, status: statusOf(picked.room), rooms: rooms().map((r) => r.id) }), true;
    }
    if (url.pathname === "/room" && req.method === "PUT") {
      const body = JSON.parse((await readBody(req)) || "null") as Record<string, unknown> | null;
      // The room to replace comes from ?room= or "id"; without either, from the name.
      const next = cleanProjectRoom(body && typeof body === "object" ? { ...body, id: queryRoom || body.id } : body);
      if (!next) return json(400, { error: "send { name, workers: [{ name, kind? }] }" }), true;
      if (!upsertRoom(hub, next)) return json(400, { error: `at most ${MAX_ROOMS} project rooms`, rooms: rooms().map((r) => r.id) }), true;
      return json(200, { room: next, rooms: rooms().map((r) => r.id) }), true;
    }
    if (url.pathname === "/room" && req.method === "DELETE") {
      const picked = pickRoom(rooms(), queryRoom);
      if ("error" in picked) return json(picked.code, { error: picked.error, rooms: picked.rooms }), true;
      removeRoom(hub, picked.room.id);
      return json(200, { ok: true, rooms: rooms().map((r) => r.id) }), true;
    }
    if (url.pathname === "/room/event" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as EventBody;
      const picked = pickRoom(rooms(), queryRoom || body.room);
      if ("error" in picked) return json(picked.code, { error: picked.error, rooms: picked.rooms }), true;
      const room = picked.room;
      const workers = room.workers;
      const find = (v: unknown) => {
        const k = typeof v === "string" ? v.trim().toLowerCase() : "";
        return k ? workers.find((w) => w.id === k || w.name.toLowerCase() === k) : undefined;
      };
      const w = find(body.worker);
      if (body.worker !== undefined && !w) return json(404, { error: `no worker "${String(body.worker)}" in the room`, room: room.id, workers: workers.map((x) => x.id) }), true;
      if (w) {
        const state = STATES.includes(body.state as RoomWorkerState) ? (body.state as RoomWorkerState) : "working";
        const ttl = Math.min(3600, Math.max(1, Number(body.ttl) || (state === "done" ? 8 : 120)));
        const status: RoomWorkerStatus = { state, note: clip(body.note, 60).trim() || null, at: new Date().toISOString(), ttl };
        (hub.snap.roomWorkers ??= {})[key(room, w.id)] = status;
        hub.emit({ type: "room.worker", workerId: key(room, w.id), status });
      }
      if (body.handoff) {
        const end = (v: unknown, dflt: string | null) => (v === "in" || v === "out" ? null : (find(v)?.id ?? dflt));
        const from = body.handoff.from === undefined ? (w?.id ?? null) : end(body.handoff.from, null);
        const to = end(body.handoff.to, null);
        const handoff = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, from: from && key(room, from), to: to && key(room, to) };
        hub.snap.roomHandoffs = [handoff, ...(hub.snap.roomHandoffs ?? [])].slice(0, 20);
        hub.emit({ type: "room.handoff", handoff });
      }
      return json(200, { ok: true, room: room.id }), true;
    }
    return json(405, { error: "method not allowed" }), true;
  } catch {
    return json(400, { error: "bad request: send JSON" }), true;
  }
}
