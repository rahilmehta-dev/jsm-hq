import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectRoomsOf, roomWorkerKey } from "../src/data/types";
import type { HqConfig, OfficeSnapshot } from "../src/data/types";
import type { Hub } from "./hub";
import { cleanProjectRoom, handleRoomHttp, setRoom } from "./room";
// @ts-expect-error -- the plain .mjs client ships without types
import { Room } from "../sdk/node/jsmhq-room.mjs";

const TOKEN = "t0ken";
let server: Server;
let base: string;
let hub: Hub;
const emitted: unknown[] = [];

const mkHub = (config: Partial<HqConfig> = {}) =>
  ({ snap: { config } as OfficeSnapshot, emit: (e: unknown) => emitted.push(e), configChanged: vi.fn() }) as unknown as Hub;

async function call(method: string, path: string, body?: unknown, token = TOKEN) {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const workers = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase(), kind: "custom" }));

beforeEach(async () => {
  emitted.length = 0;
  hub = mkHub();
  server = createServer((req, res) => {
    void handleRoomHttp(hub, TOKEN, req, res, new URL(req.url ?? "/", "http://x")).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe("room ids", () => {
  it("makes the id a slug of the name, or keeps a given one", () => {
    expect(cleanProjectRoom({ name: "Job Referrals!", workers: [] })?.id).toBe("job-referrals");
    expect(cleanProjectRoom({ name: "Renamed", id: "Job-Referrals", workers: [] })?.id).toBe("job-referrals");
    expect(cleanProjectRoom({ name: "!!!", workers: [] })?.id).toBe("project");
  });

  it("loads a config with only the old single projectRoom as one room", () => {
    const rooms = projectRoomsOf({ projectRoom: { name: "Job referrals", workers: [] } });
    expect(rooms.map((r) => r.id)).toEqual(["job-referrals"]);
    expect(projectRoomsOf({})).toEqual([]);
  });
});

describe("single room (backward compatible)", () => {
  it("works with no room id, and keeps statuses under the plain worker id", async () => {
    expect((await call("PUT", "/room", { name: "Job referrals", workers: workers("fetcher", "writer") })).status).toBe(200);
    expect((await call("POST", "/room/event", { worker: "fetcher", state: "working", note: "hi" })).status).toBe(200);
    expect(Object.keys(hub.snap.roomWorkers ?? {})).toEqual(["fetcher"]);
    expect(emitted).toContainEqual(expect.objectContaining({ type: "room.worker", workerId: "fetcher" }));
    const got = await call("GET", "/room");
    expect(got.json.room.id).toBe("job-referrals");
    expect(got.json.status.fetcher.state).toBe("working");
    // The first room is still mirrored as projectRoom for the single-room UI.
    expect(hub.snap.config.projectRoom?.name).toBe("Job referrals");
  });

  it("serves a room saved before ids existed", async () => {
    hub = mkHub({ projectRoom: { name: "Old", workers: [{ id: "a", name: "A", kind: "custom", color: "#fff" }] } });
    expect((await call("POST", "/room/event", { worker: "a" })).status).toBe(200);
    expect((await call("GET", "/room")).json.room.id).toBe("old");
  });

  it("the browser's editor (setRoom) still replaces the one room, even under a new name", () => {
    setRoom(hub, cleanProjectRoom({ name: "One", workers: workers("a") }));
    setRoom(hub, cleanProjectRoom({ name: "Two", workers: workers("b") }));
    expect(projectRoomsOf(hub.snap.config).map((r) => r.id)).toEqual(["two"]);
    setRoom(hub, null);
    expect(hub.snap.config.projectRooms).toBeUndefined();
    expect(hub.snap.config.projectRoom).toBeUndefined();
  });

  it("the Node client works without a room id", async () => {
    await call("PUT", "/room", { name: "Solo", workers: workers("w") });
    const room = new Room({ url: base, token: TOKEN, room: "" });
    expect(await room.status("w", "working")).toMatchObject({ ok: true });
    expect(hub.snap.roomWorkers?.w?.state).toBe("working");
  });
});

describe("several rooms", () => {
  beforeEach(async () => {
    await call("PUT", "/room", { name: "Alpha", workers: workers("fetcher", "writer") });
    await call("PUT", "/room", { name: "Beta", workers: workers("fetcher") });
  });

  it("adds a room for a new name and replaces one for the same name", async () => {
    expect(projectRoomsOf(hub.snap.config).map((r) => r.id)).toEqual(["alpha", "beta"]);
    await call("PUT", "/room", { name: "Alpha", workers: workers("only") });
    expect(projectRoomsOf(hub.snap.config).find((r) => r.id === "alpha")?.workers.map((w) => w.id)).toEqual(["only"]);
    expect(projectRoomsOf(hub.snap.config)).toHaveLength(2);
  });

  it("lets two rooms use the same worker id, with statuses scoped by room", async () => {
    await call("POST", "/room/event?room=alpha", { worker: "fetcher", state: "working" });
    await call("POST", "/room/event", { room: "beta", worker: "fetcher", state: "error" });
    expect(hub.snap.roomWorkers?.["alpha/fetcher"]?.state).toBe("working");
    expect(hub.snap.roomWorkers?.["beta/fetcher"]?.state).toBe("error");
    expect(roomWorkerKey("alpha", "fetcher", true)).toBe("alpha/fetcher");
    // GET answers with plain worker ids for the room asked about.
    expect((await call("GET", "/room?room=beta")).json.status.fetcher.state).toBe("error");
  });

  it("scopes handoffs to their room", async () => {
    await call("POST", "/room/event?room=alpha", { worker: "fetcher", handoff: { to: "writer" } });
    expect(hub.snap.roomHandoffs?.[0]).toMatchObject({ from: "alpha/fetcher", to: "alpha/writer" });
  });

  it("answers 400 with the room ids when a call doesn't say which room", async () => {
    for (const r of [await call("POST", "/room/event", { worker: "fetcher" }), await call("GET", "/room"), await call("DELETE", "/room")]) {
      expect(r.status).toBe(400);
      expect(r.json.rooms).toEqual(["alpha", "beta"]);
      expect(r.json.error).toMatch(/room/);
    }
    expect(hub.snap.roomWorkers).toEqual({});
  });

  it("answers 404 with the room ids for an unknown room, and for an unknown worker in a room", async () => {
    const r = await call("POST", "/room/event?room=nope", { worker: "fetcher" });
    expect(r.status).toBe(404);
    expect(r.json.rooms).toEqual(["alpha", "beta"]);
    const w = await call("POST", "/room/event?room=beta", { worker: "writer" });
    expect(w.status).toBe(404);
    expect(w.json.workers).toEqual(["fetcher"]);
  });

  it("lists every room at /rooms", async () => {
    const r = await call("GET", "/rooms");
    expect(r.json.rooms.map((x: { id: string }) => x.id)).toEqual(["alpha", "beta"]);
  });

  it("re-keys statuses when the office goes from one room to two, and back", async () => {
    await call("DELETE", "/room?room=beta");
    await call("POST", "/room/event", { worker: "fetcher", state: "working" });
    expect(Object.keys(hub.snap.roomWorkers ?? {})).toEqual(["fetcher"]);
    await call("PUT", "/room", { name: "Beta", workers: workers("fetcher") });
    expect(Object.keys(hub.snap.roomWorkers ?? {})).toEqual(["alpha/fetcher"]);
    await call("DELETE", "/room?room=beta");
    expect(Object.keys(hub.snap.roomWorkers ?? {})).toEqual(["fetcher"]);
  });

  it("removes a room's statuses with it", async () => {
    await call("POST", "/room/event?room=beta", { worker: "fetcher" });
    await call("DELETE", "/room?room=beta");
    expect(projectRoomsOf(hub.snap.config).map((r) => r.id)).toEqual(["alpha"]);
    expect(hub.snap.roomWorkers).toEqual({});
  });

  it("the Node client sends its room id", async () => {
    const room = new Room({ url: base, token: TOKEN, room: "beta" });
    expect(await room.status("fetcher", "done")).toMatchObject({ ok: true, room: "beta" });
    expect(hub.snap.roomWorkers?.["beta/fetcher"]?.state).toBe("done");
    const lost = new Room({ url: base, token: TOKEN, room: "" });
    expect(await lost.status("fetcher", "done")).toMatchObject({ rooms: ["alpha", "beta"] });
  });
});

describe("errors", () => {
  it("rejects a wrong token and an event with no room yet", async () => {
    expect((await call("GET", "/room", undefined, "bad")).status).toBe(401);
    const r = await call("POST", "/room/event", { worker: "x" });
    expect(r.status).toBe(404);
    expect(r.json.rooms).toEqual([]);
  });

  it("caps the number of rooms", async () => {
    for (let i = 0; i < 12; i++) expect((await call("PUT", "/room", { name: `P${i}`, workers: workers("a") })).status).toBe(200);
    expect((await call("PUT", "/room", { name: "One too many", workers: workers("a") })).status).toBe(400);
  });
});
