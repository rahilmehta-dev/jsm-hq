import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remainingPercent, summarizeUsage, type AgentConfig, type HqConfig, type OfficeSnapshot, type UsageSnapshot } from "../src/data/types";
import type { Hub } from "./hub";
import {
  applyCodexLine,
  budgetValue,
  claudeProjectDir,
  claudeRecord,
  feed,
  hostReader,
  kindOf,
  localDay,
  measure,
  newAgentCache,
  newFileState,
  parseListing,
  patchBudgets,
  readInto,
  sumDay,
  UsageCollector,
  type TranscriptReader,
} from "./usage";

// Local times, so the tests hold in any time zone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (d: Date) => d.toISOString();

function claudeLine(id: string, when: Date, u: { input?: number; output?: number; cw?: number; cr?: number } = {}) {
  return JSON.stringify({
    type: "assistant",
    timestamp: iso(when),
    requestId: `req_${id}`,
    message: { id, role: "assistant", content: [{ type: "text", text: "secret content" }], usage: { input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_creation_input_tokens: u.cw ?? 0, cache_read_input_tokens: u.cr ?? 0 } },
  });
}

function codexLine(when: Date, total: { input: number; cached?: number; output: number } | null, rate?: unknown) {
  return JSON.stringify({
    timestamp: iso(when),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: total ? { total_token_usage: { input_tokens: total.input, cached_input_tokens: total.cached ?? 0, output_tokens: total.output, total_tokens: total.input + total.output } } : null,
      ...(rate ? { rate_limits: rate } : {}),
    },
  });
}

const agent = (id: string, cli: AgentConfig["cli"], extra: Partial<AgentConfig> = {}) => ({ id, cli, ...extra }) as AgentConfig;

/** A reader over in-memory files: path → content. */
function memReader(files: Record<string, string>, opts: { codexCwd?: string } = {}): TranscriptReader & { reads: number } {
  const r = {
    reads: 0,
    codexCwd: opts.codexCwd,
    async list() {
      return Object.entries(files).map(([path, text]) => ({ path, size: Buffer.byteLength(text) }));
    },
    async read(path: string, from: number, max: number) {
      r.reads += 1;
      return Buffer.from(files[path]).subarray(from, from + max).toString("utf8");
    },
  };
  return r;
}

describe("localDay", () => {
  it("runs from local midnight to the next local midnight", () => {
    const b = localDay(at(2026, 11, 10, 15, 30));
    expect(b.day).toBe("2026-11-10");
    expect(b.start).toBe(at(2026, 11, 10).getTime());
    expect(b.end).toBe(at(2026, 11, 11).getTime());
  });

  it("rolls over at midnight", () => {
    expect(localDay(at(2026, 11, 10, 23, 59)).day).toBe("2026-11-10");
    expect(localDay(at(2026, 11, 11, 0, 0)).day).toBe("2026-11-11");
    expect(localDay(at(2026, 12, 31, 23, 59)).end).toBe(at(2027, 1, 1).getTime());
  });
});

describe("midnight rollover", () => {
  it("counts only today's records and forgets yesterday's after midnight", () => {
    const f = newFileState("claude");
    feed(f, [claudeLine("m1", at(2026, 11, 9, 23, 58), { input: 100, output: 10 }), claudeLine("m2", at(2026, 11, 10, 0, 1), { input: 5, output: 7 }), claudeLine("m3", at(2026, 11, 10, 23, 59), { output: 1 })].join("\n") + "\n");
    expect(sumDay([f], localDay(at(2026, 11, 10, 12))).total).toBe(13);
    // The next day: nothing yet, and the old records are dropped.
    expect(sumDay([f], localDay(at(2026, 11, 11, 0, 0))).total).toBe(0);
    expect(f.records.size).toBe(0);
  });

  it("counts a Codex session that spans midnight from its total at midnight", () => {
    const f = newFileState("codex");
    for (const l of [codexLine(at(2026, 11, 9, 22), { input: 1000, output: 100 }), codexLine(at(2026, 11, 9, 23, 50), { input: 1500, output: 150 }), codexLine(at(2026, 11, 10, 0, 20), { input: 1800, cached: 200, output: 190 })])
      applyCodexLine(f, l);
    const today = sumDay([f], localDay(at(2026, 11, 10, 9)));
    // 300 more input (of which 200 cached), 40 more output.
    expect(today).toEqual({ input: 100, output: 40, cacheWrite: 0, cacheRead: 200, total: 140 });
  });

  it("shows unknown (not 0) when an agent's files were last read before midnight", () => {
    const cache = newAgentCache();
    cache.readAt = at(2026, 11, 9, 23, 30).getTime();
    const now = at(2026, 11, 10, 8);
    expect(measure(agent("a", "claude"), cache, localDay(now), now.getTime()).tokens).toBeNull();
    cache.readAt = at(2026, 11, 10, 0, 5).getTime();
    expect(measure(agent("a", "claude"), cache, localDay(now), now.getTime()).tokens?.total).toBe(0);
  });
});

describe("remainingPercent", () => {
  it("is null without a known, positive budget", () => {
    expect(remainingPercent(500, null)).toBeNull();
    expect(remainingPercent(500, undefined)).toBeNull();
    expect(remainingPercent(0, 0)).toBeNull();
    expect(remainingPercent(0, -10)).toBeNull();
    expect(remainingPercent(0, Number.NaN)).toBeNull();
  });

  it("is the share of the budget left, clamped to 0–100", () => {
    expect(remainingPercent(0, 1000)).toBe(100);
    expect(remainingPercent(250, 1000)).toBe(75);
    expect(remainingPercent(1, 3)).toBe(66.7);
    expect(remainingPercent(1000, 1000)).toBe(0);
    expect(remainingPercent(5000, 1000)).toBe(0);
  });
});

describe("summarizeUsage", () => {
  const bounds = { day: "2026-11-10", since: iso(at(2026, 11, 10)) };
  const t = (total: number) => ({ input: total, output: 0, cacheWrite: 0, cacheRead: 0, total });

  it("gives null percent everywhere when no budget is set", () => {
    const u = summarizeUsage([agent("a", "claude")], { a: { source: "claude-transcripts", tokens: t(400) } }, undefined, bounds, "now");
    expect(u.agents[0]).toMatchObject({ tokens: t(400), budget: null, remainingPercent: null, unlimited: false });
    expect(u.providers[0]).toMatchObject({ provider: "anthropic", tokens: 400, remainingPercent: null });
  });

  it("shares a provider's budget between its agents", () => {
    const u = summarizeUsage(
      [agent("a", "claude"), agent("b", "claude"), agent("c", "codex")],
      { a: { source: "claude-transcripts", tokens: t(300) }, b: { source: "claude-transcripts", tokens: t(200) }, c: { source: "codex-sessions", tokens: t(50) } },
      { anthropic: 1000 },
      bounds,
      "now",
    );
    expect(u.providers.find((p) => p.provider === "anthropic")).toMatchObject({ tokens: 500, budget: 1000, remainingPercent: 50 });
    expect(u.agents.find((a) => a.agentId === "b")?.remainingPercent).toBe(50);
    expect(u.agents.find((a) => a.agentId === "c")).toMatchObject({ budget: null, remainingPercent: null });
    expect(u.total).toEqual({ tokens: 550, measured: 3, unmeasured: 0 });
  });

  it("keeps unmeasurable agents unknown and local models unlimited", () => {
    const u = summarizeUsage(
      [agent("g", "gemini"), agent("l", "claude", { provider: "local" }), agent("o", "codex", { provider: "ollama" })],
      { l: { source: "claude-transcripts", tokens: t(9000) }, o: { source: "codex-sessions", tokens: t(1) } },
      { google: 100, anthropic: 10 },
      bounds,
      "now",
    );
    const g = u.agents.find((a) => a.agentId === "g")!;
    expect(g).toMatchObject({ provider: "google", source: "none", tokens: null, remainingPercent: null });
    expect(u.providers.find((p) => p.provider === "google")).toMatchObject({ tokens: 0, unmeasured: 1, remainingPercent: null }); // unknown usage: no percent
    const l = u.agents.find((a) => a.agentId === "l")!;
    expect(l).toMatchObject({ provider: "local", unlimited: true, budget: null, remainingPercent: null });
    expect(u.providers.find((p) => p.provider === "local")).toMatchObject({ tokens: 9001, unlimited: true, remainingPercent: null });
    expect(u.total).toEqual({ tokens: 9001, measured: 2, unmeasured: 1 });
  });
});

describe("budgets", () => {
  it("accepts whole positive numbers, clears on 0/empty/null, ignores junk", () => {
    expect(budgetValue(500000)).toBe(500000);
    expect(budgetValue("1,000,000")).toBe(1_000_000);
    expect(budgetValue(12.6)).toBe(13);
    expect(budgetValue(0)).toBeNull();
    expect(budgetValue("")).toBeNull();
    expect(budgetValue(null)).toBeNull();
    expect(budgetValue(-5)).toBeUndefined();
    expect(budgetValue("lots")).toBeUndefined();
    expect(budgetValue({})).toBeUndefined();
    expect(budgetValue(1e20)).toBe(1e12);
  });

  it("patches per provider and drops unknown keys", () => {
    expect(patchBudgets(undefined, { anthropic: 1000, local: 5, evil: 1 })).toEqual({ anthropic: 1000 });
    expect(patchBudgets({ anthropic: 1000, openai: 50 }, { anthropic: 0 })).toEqual({ openai: 50 });
    expect(patchBudgets({ openai: 50 }, { openai: null })).toBeUndefined();
    expect(patchBudgets({ openai: 50 }, { openai: "nope" })).toEqual({ openai: 50 });
    expect(patchBudgets({ openai: 50 }, "garbage")).toEqual({ openai: 50 });
    expect(patchBudgets(undefined, ["x"])).toBeUndefined();
  });
});

describe("Claude Code transcripts", () => {
  it("counts each message once, though it is written as several lines", () => {
    const f = newFileState("claude");
    const when = at(2026, 11, 10, 9);
    feed(f, [claudeLine("m1", when, { input: 2, output: 35, cw: 100, cr: 5000 }), claudeLine("m1", when, { input: 2, output: 35, cw: 100, cr: 5000 }), claudeLine("m2", when, { output: 3 })].join("\n") + "\n");
    expect(sumDay([f], localDay(when))).toEqual({ input: 2, output: 38, cacheWrite: 100, cacheRead: 5000, total: 140 });
  });

  it("skips malformed lines and lines without usage", () => {
    const f = newFileState("claude");
    const when = at(2026, 11, 10, 9);
    const lines = [
      "{not json",
      "",
      "null",
      "42",
      JSON.stringify({ type: "user", timestamp: iso(when), message: { content: "hi" } }),
      JSON.stringify({ type: "assistant", timestamp: iso(when), message: { id: "x" } }),
      JSON.stringify({ type: "assistant", timestamp: "not a date", message: { id: "y", usage: { output_tokens: 9 } } }),
      JSON.stringify({ type: "assistant", timestamp: iso(when), message: { usage: { output_tokens: 9 } } }),
      JSON.stringify({ type: "assistant", timestamp: iso(when), message: { id: "z", usage: { output_tokens: "9", input_tokens: -4 } } }),
      claudeLine("ok", when, { output: 4 }),
    ];
    expect(() => feed(f, lines.join("\n") + "\n")).not.toThrow();
    expect(sumDay([f], localDay(when)).total).toBe(4);
    expect(claudeRecord("[]")).toBeNull();
  });

  it("leaves a half-written last line for the next read", () => {
    const f = newFileState("claude");
    const when = at(2026, 11, 10, 9);
    const full = claudeLine("m1", when, { output: 10 }) + "\n";
    const line2 = claudeLine("m2", when, { output: 5 });
    expect(feed(f, full + line2.slice(0, 20))).toBe(Buffer.byteLength(full));
    expect(f.offset).toBe(Buffer.byteLength(full));
    feed(f, line2 + "\n");
    expect(sumDay([f], localDay(when)).total).toBe(15);
  });

  it("maps a folder to Claude Code's project folder name", () => {
    expect(claudeProjectDir("/Users/rahilmehta/.jsmhq/jsm-hq/dwight")).toBe("-Users-rahilmehta--jsmhq-jsm-hq-dwight");
  });
});

describe("Codex sessions", () => {
  it("counts increases of the running total, ignoring repeats and resets", () => {
    const f = newFileState("codex");
    const d = (h: number) => at(2026, 11, 10, h);
    for (const l of [
      codexLine(d(9), { input: 100, output: 10 }),
      codexLine(d(10), { input: 100, output: 10 }), // repeated total
      codexLine(d(11), null), // rate-limit-only update
      codexLine(d(12), { input: 300, cached: 50, output: 30 }),
      codexLine(d(13), { input: 40, output: 4 }), // a new count started
      "garbage",
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: "x" } }, timestamp: iso(d(14)) }),
    ])
      applyCodexLine(f, l);
    expect(sumDay([f], localDay(d(15)))).toEqual({ input: 290, output: 34, cacheWrite: 0, cacheRead: 50, total: 324 });
  });

  it("keeps the newest rate limits the CLI reported", () => {
    const f = newFileState("codex");
    const now = at(2026, 11, 10, 9);
    applyCodexLine(f, codexLine(now, { input: 1, output: 1 }, { primary: { used_percent: 42, window_minutes: 300, resets_in_seconds: 600 }, secondary: { used_percent: 7.5, window_minutes: 10080, resets_at: Math.floor(now.getTime() / 1000) + 86400 } }));
    const cache = newAgentCache();
    cache.files.set("s", f);
    cache.readAt = now.getTime();
    const m = measure(agent("c", "codex"), cache, localDay(now), now.getTime());
    expect(m.rateLimits).toEqual([
      { label: "primary", windowMinutes: 300, usedPercent: 42, resetsAt: new Date(now.getTime() + 600_000).toISOString() },
      { label: "secondary", windowMinutes: 10080, usedPercent: 7.5, resetsAt: new Date(Math.floor(now.getTime() / 1000) * 1000 + 86_400_000).toISOString() },
    ]);
    // After the primary window resets, only the weekly one still applies.
    const later = now.getTime() + 3_600_000;
    expect(measure(agent("c", "codex"), cache, localDay(now), later).rateLimits?.map((w: { label: string }) => w.label)).toEqual(["secondary"]);
  });
});

describe("readInto", () => {
  const when = at(2026, 11, 10, 9);
  const bounds = localDay(when);

  it("reads only what's new each time", async () => {
    const path = "/h/.claude/projects/-w/s.jsonl";
    const files = { [path]: claudeLine("m1", when, { output: 10 }) + "\n" };
    const reader = memReader(files);
    const cache = newAgentCache();
    await readInto(cache, reader, bounds, when.getTime());
    expect(sumDay(cache.files.values(), bounds).total).toBe(10);
    files[path] += claudeLine("m2", when, { output: 5 }) + "\n";
    await readInto(cache, reader, bounds, when.getTime());
    expect(sumDay(cache.files.values(), bounds).total).toBe(15);
    expect(reader.reads).toBe(2);
    await readInto(cache, reader, bounds, when.getTime());
    expect(reader.reads).toBe(2); // nothing new: no read
  });

  it("starts over when a file was rewritten, and forgets files gone from the listing", async () => {
    const path = "/h/.claude/projects/-w/s.jsonl";
    const files: Record<string, string> = { [path]: claudeLine("m1", when, { output: 10 }) + "\n" + claudeLine("m2", when, { output: 10 }) + "\n" };
    const cache = newAgentCache();
    await readInto(cache, memReader(files), bounds, when.getTime());
    files[path] = claudeLine("m3", when, { output: 1 }) + "\n";
    await readInto(cache, memReader(files), bounds, when.getTime());
    expect(sumDay(cache.files.values(), bounds).total).toBe(1);
    await readInto(cache, memReader({}), bounds, when.getTime());
    expect(cache.files.size).toBe(0);
  });

  it("only counts a local Codex agent's own folder", async () => {
    const meta = (cwd: string) => JSON.stringify({ type: "session_meta", timestamp: iso(when), payload: { cwd } });
    const files = {
      "/h/.codex/sessions/2026/11/10/rollout-a.jsonl": [meta("/w/mine"), codexLine(when, { input: 10, output: 1 })].join("\n") + "\n",
      "/h/.codex/sessions/2026/11/10/rollout-b.jsonl": [meta("/w/other"), codexLine(when, { input: 999, output: 9 })].join("\n") + "\n",
      "/h/.codex/sessions/2026/11/10/rollout-c.jsonl": [codexLine(when, { input: 500, output: 5 })].join("\n") + "\n", // no session_meta
    };
    const cache = newAgentCache();
    await readInto(cache, memReader(files, { codexCwd: "/w/mine" }), bounds, when.getTime());
    expect(sumDay(cache.files.values(), bounds).total).toBe(11);
  });

  it("ignores files that aren't session logs", async () => {
    const cache = newAgentCache();
    await readInto(cache, memReader({ "/h/notes.jsonl": claudeLine("m", when, { output: 3 }) + "\n" }), bounds, when.getTime());
    expect(cache.files.size).toBe(0);
    expect(kindOf("/home/agent/.claude/projects/-x/abc.jsonl")).toBe("claude");
    expect(kindOf("/home/agent/.codex/sessions/2026/11/10/rollout-1.jsonl")).toBe("codex");
  });

  it("parses the sandbox file listing", () => {
    expect(parseListing("120\t/home/agent/.claude/projects/-w/a.jsonl\nbad line\n\t/x\n7\t/home/agent/my file.jsonl\n")).toEqual([
      { path: "/home/agent/.claude/projects/-w/a.jsonl", size: 120 },
      { path: "/home/agent/my file.jsonl", size: 7 },
    ]);
  });
});

describe("hostReader", () => {
  let dir = "";
  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reads a local Claude agent's project folder, and copes with a missing one", async () => {
    dir = mkdtempSync(join(tmpdir(), "hq-usage-"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
    const workspace = "/Users/me/proj";
    const reader = hostReader(agent("a", "claude", { mode: "local" }), workspace);
    expect(await reader.list(0)).toEqual([]); // no folder yet

    const proj = join(dir, "projects", claudeProjectDir(workspace));
    mkdirSync(join(proj, "sub"), { recursive: true });
    const now = new Date();
    writeFileSync(join(proj, "s.jsonl"), claudeLine("m1", now, { output: 6 }) + "\n" + "{broken\n");
    writeFileSync(join(proj, "sub", "agent.jsonl"), claudeLine("m2", now, { output: 4 }) + "\n");
    writeFileSync(join(proj, "old.jsonl"), claudeLine("m0", now, { output: 100 }) + "\n");
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(join(proj, "old.jsonl"), old, old);

    const cache = newAgentCache();
    const bounds = localDay(now);
    await readInto(cache, reader, bounds, now.getTime());
    expect(cache.files.size).toBe(2);
    expect(sumDay(cache.files.values(), bounds).total).toBe(10);
  });
});

describe("UsageCollector", () => {
  function fakeHub(team: AgentConfig[], budgets?: HqConfig["project"]["dailyTokenBudgets"]) {
    const emitted: UsageSnapshot[] = [];
    const snap = { config: { team, project: { dailyTokenBudgets: budgets } } } as unknown as OfficeSnapshot;
    const hub = {
      snap,
      slug: "p",
      cfg: (id: string) => team.find((a) => a.id === id),
      status: () => undefined,
      setUsage: (u: UsageSnapshot) => {
        snap.usage = u;
        emitted.push(u);
      },
    } as unknown as Hub;
    return { hub, emitted, snap };
  }

  it("builds the snapshot, and only tells browsers when something changed", async () => {
    const now = at(2026, 11, 10, 9);
    const team = [agent("a", "claude"), agent("g", "gemini")];
    const files = { "/h/.claude/projects/-w/s.jsonl": claudeLine("m1", now, { input: 10, output: 90 }) + "\n" };
    const { hub, emitted, snap } = fakeHub(team, { anthropic: 1000 });
    const c = new UsageCollector(hub, { now: () => now, readerFor: (a) => (a.cli === "claude" ? memReader(files) : null) });
    c.publish();
    expect(emitted).toHaveLength(1);
    expect(snap.usage?.agents.find((x) => x.agentId === "a")?.tokens).toBeNull(); // not read yet: unknown

    await c.refreshAll();
    expect(emitted).toHaveLength(2);
    expect(snap.usage?.agents.find((x) => x.agentId === "a")).toMatchObject({ tokens: { total: 100 }, remainingPercent: 90 });
    expect(snap.usage?.agents.find((x) => x.agentId === "g")).toMatchObject({ source: "none", tokens: null, remainingPercent: null });
    expect(snap.usage?.day).toBe("2026-11-10");

    await c.refreshAll(); // same numbers: no event
    expect(emitted).toHaveLength(2);
  });

  it("keeps the last numbers and notes the error when a read fails", async () => {
    const now = at(2026, 11, 10, 9);
    let fail = false;
    const files = { "/h/.claude/projects/-w/s.jsonl": claudeLine("m1", now, { output: 7 }) + "\n" };
    const reader: TranscriptReader = {
      list: async (since) => {
        if (fail) throw new Error("sandbox not running");
        return memReader(files).list(since);
      },
      read: (p, f, m) => memReader(files).read(p, f, m),
    };
    const { hub, snap } = fakeHub([agent("a", "claude")]);
    const c = new UsageCollector(hub, { now: () => now, readerFor: () => reader });
    await c.refreshAll();
    fail = true;
    await c.refreshAll();
    expect(snap.usage?.agents[0]).toMatchObject({ tokens: { total: 7 }, error: "sandbox not running", remainingPercent: null });
  });
});
