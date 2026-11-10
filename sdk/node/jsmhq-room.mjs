// My HQ project-room client for Node 18+ (no dependencies). Copy this file into your project.
// It never throws: if My HQ isn't running your project keeps working and nothing shows in the office.
//
//   import { Room } from "./jsmhq-room.mjs";
//   const room = new Room(); // reads HQ_ROOM_URL and HQ_ROOM_TOKEN (My HQ: Settings -> Team -> Project room)
//   await room.setup("Job referrals", [{ id: "fetcher", name: "Mailbot", kind: "fetcher" }]);
//   await room.working("fetcher", "Fetching 12 emails", async () => fetchEmails());
//   await room.handoff("writer", "fetcher");
//
// When My HQ has several project rooms, say which one is yours: new Room({ room: "job-referrals" }) or the
// HQ_ROOM_ID env var (a room's id is a slug of its name). With one room you can leave it out.

export class Room {
  constructor({ url = process.env.HQ_ROOM_URL || "http://127.0.0.1:7420", token = process.env.HQ_ROOM_TOKEN || "", timeoutMs = 1000, room = process.env.HQ_ROOM_ID || "" } = {}) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.room = room;
  }

  async #call(method, path, body, scoped = true) {
    try {
      if (scoped && this.room) path += `?room=${encodeURIComponent(this.room)}`;
      const res = await fetch(this.url + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return await res.json();
    } catch {
      return null; // My HQ isn't there: carry on
    }
  }

  /** Creates or replaces the room. workers: [{ id, name, kind: "fetcher"|"writer"|"sender"|"custom", color? }]. */
  setup(name, workers, { demo = false } = {}) {
    return this.#call("PUT", "/room", { name, workers, ...(demo ? {} : { demo: false }) });
  }

  /** Every project room in My HQ ({ rooms: [...] }), or null if My HQ isn't there. */
  rooms() {
    return this.#call("GET", "/rooms", undefined, false);
  }

  /** state: "idle" | "working" | "error" | "done". Holds for ttl seconds (default 120, 8 for done), then idle. */
  status(worker, state = "working", note, ttl) {
    return this.#call("POST", "/room/event", { worker, state, ...(note ? { note } : {}), ...(ttl ? { ttl } : {}) });
  }

  /** An envelope flies from a worker (or "in") to another (or "out"). */
  handoff(to, from) {
    return this.#call("POST", "/room/event", { handoff: { to, ...(from === undefined ? {} : { from }) } });
  }

  /** Working while `fn` runs, then done (or error if it throws). */
  async working(worker, note, fn) {
    await this.status(worker, "working", note);
    try {
      const out = await fn();
      await this.status(worker, "done", note);
      return out;
    } catch (err) {
      await this.status(worker, "error", note || "Failed");
      throw err;
    }
  }
}
