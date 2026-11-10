// Model usage today (MUI-T01): tokens each agent spent since local midnight, read from the
// CLIs' own session files. Read-only and local: nothing here is sent anywhere, and only token
// counts (never message content) are kept.
//
//   Claude Code  ~/.claude/projects/<folder>/<session>.jsonl: every assistant line carries the
//                API's `usage`. One message is written as several lines (one per content block)
//                with the same message id, so lines are counted once per id.
//   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl: `token_count` events carry the
//                session's running total (and the plan's rate limits); today's tokens are the
//                increase since midnight.
//   Gemini CLI, Antigravity CLI: no per-turn token log HQ can read, so their usage is unknown
//                (tokens: null), never a guessed 0.
//
// Sandboxed agents keep these files inside their sandbox, so HQ reads them with `sbx exec`
// (only while the session runs: exec would start a stopped sandbox). Local agents' files are on
// this machine. Files are appended to, so each read starts where the last one ended.

import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BUDGET_PROVIDERS, summarizeUsage, type AgentConfig, type BudgetProvider, type ProjectConfig, type RateLimitWindow, type TokenCounts, type UsageSnapshot, type UsageSource } from "../src/data/types";
import type { Hub } from "./hub";
import { run } from "./lib/exec";
import { log } from "./lib/log";
import { sessionName } from "./paths";
import { workspaceFor } from "./workspace";

/** How often every agent is read again (turn ends also trigger a read). */
export const USAGE_REFRESH_MS = 90_000;
/** Most bytes read from one file per request (exec output is capped at 8 MB). */
const CHUNK = 4 * 1024 * 1024;
/** A turn's last lines can land just after its Stop hook. */
const TURN_SETTLE_MS = 2_000;

// ---------------------------------------------------------------- the day

export interface DayBounds {
  day: string; // "2026-11-10"
  start: number; // local midnight, ms
  end: number; // next local midnight, ms
}

/** Local midnight to midnight around `now` (DST days are 23 or 25 hours long). */
export function localDay(now: Date): DayBounds {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: `${y}-${pad(m + 1)}-${pad(d)}`, start: new Date(y, m, d).getTime(), end: new Date(y, m, d + 1).getTime() };
}

// ---------------------------------------------------------------- budgets

/** Largest budget accepted (a sanity cap on hand-typed numbers). */
export const MAX_DAILY_BUDGET = 1e12;

/**
 * A budget from Settings or config.json: a whole number of tokens, `null` to clear it
 * (null, 0 or empty), or `undefined` when the value is invalid and should be ignored.
 */
export function budgetValue(v: unknown): number | null | undefined {
  if (v === null || v === 0 || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[,_\s]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
  if (n === 0) return null;
  return Math.min(MAX_DAILY_BUDGET, Math.round(n));
}

/** Applies a patch of budgets (per provider: a number sets it, null clears it, anything else is ignored). */
export function patchBudgets(current: ProjectConfig["dailyTokenBudgets"], patch: unknown): ProjectConfig["dailyTokenBudgets"] {
  const next: Partial<Record<BudgetProvider, number>> = { ...(current ?? {}) };
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    for (const p of BUDGET_PROVIDERS) {
      if (!Object.hasOwn(patch, p)) continue;
      const v = budgetValue((patch as Record<string, unknown>)[p]);
      if (v === null) delete next[p];
      else if (v !== undefined) next[p] = v;
    }
  }
  for (const k of Object.keys(next)) if (!BUDGET_PROVIDERS.includes(k as BudgetProvider)) delete next[k as BudgetProvider];
  return Object.keys(next).length ? next : undefined;
}

// ---------------------------------------------------------------- parsing

export const zeroCounts = (): TokenCounts => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 });

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function counts(input: number, output: number, cacheWrite: number, cacheRead: number): TokenCounts {
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite };
}

function addInto(into: TokenCounts, c: TokenCounts) {
  into.input += c.input;
  into.output += c.output;
  into.cacheWrite += c.cacheWrite;
  into.cacheRead += c.cacheRead;
  into.total += c.total;
}

export type FileKind = "claude" | "codex";

/** What HQ keeps of one session file: token records by time, never content. */
export interface FileState {
  kind: FileKind;
  /** Bytes consumed so far (always at a line end). */
  offset: number;
  /** Codex: the session's folder (from session_meta), to tell local agents' sessions apart. */
  cwd?: string;
  /** Not this agent's session (a local Codex session from another folder): skipped. */
  skip?: boolean;
  /** Claude: one record per message id. Codex: one per increase of the running total. */
  records: Map<string, { ts: number; c: TokenCounts }>;
  /** Codex: the last running total seen, and how many increases were recorded. */
  cum?: TokenCounts;
  n?: number;
  rate?: { ts: number; windows: RateLimitWindow[] };
}

export const newFileState = (kind: FileKind): FileState => ({ kind, offset: 0, records: new Map() });

export function kindOf(path: string): FileKind | null {
  const p = path.replace(/\\/g, "/");
  if (p.includes("/.codex/sessions/") || p.includes("/sessions/rollout-") || /\/rollout-[^/]*\.jsonl$/.test(p)) return "codex";
  if (p.includes("/projects/") && p.endsWith(".jsonl")) return "claude";
  return null;
}

/** One Claude Code transcript line → a usage record, or null (not an assistant reply, or malformed). */
export function claudeRecord(line: string): { key: string; ts: number; c: TokenCounts } | null {
  let o: { type?: unknown; timestamp?: unknown; requestId?: unknown; uuid?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } };
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || o.type !== "assistant" || !o.message || typeof o.message !== "object") return null;
  const u = o.message.usage;
  if (!u || typeof u !== "object") return null;
  const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  const key = [o.message.id, o.requestId, o.uuid].find((k): k is string => typeof k === "string" && k.length > 0);
  if (!key) return null;
  return { key, ts, c: counts(num(u.input_tokens), num(u.output_tokens), num(u.cache_creation_input_tokens), num(u.cache_read_input_tokens)) };
}

function rateWindows(r: unknown, ts: number): RateLimitWindow[] {
  if (!r || typeof r !== "object") return [];
  const out: RateLimitWindow[] = [];
  for (const label of ["primary", "secondary"]) {
    const w = (r as Record<string, unknown>)[label] as Record<string, unknown> | null | undefined;
    if (!w || typeof w !== "object" || typeof w.used_percent !== "number" || !Number.isFinite(w.used_percent)) continue;
    const resetsAt =
      typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : typeof w.resets_in_seconds === "number" ? new Date(ts + w.resets_in_seconds * 1000).toISOString() : null;
    out.push({
      label,
      windowMinutes: typeof w.window_minutes === "number" ? w.window_minutes : null,
      usedPercent: Math.min(100, Math.max(0, w.used_percent)),
      resetsAt,
    });
  }
  return out;
}

/** Applies one Codex session line to the file's state. */
export function applyCodexLine(f: FileState, line: string) {
  let o: { type?: unknown; timestamp?: unknown; payload?: Record<string, unknown> };
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  if (!o || typeof o !== "object" || !o.payload || typeof o.payload !== "object") return;
  if (o.type === "session_meta") {
    if (typeof o.payload.cwd === "string") f.cwd = o.payload.cwd;
    return;
  }
  if (o.type !== "event_msg" || o.payload.type !== "token_count") return;
  const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(ts)) return;
  const windows = rateWindows(o.payload.rate_limits, ts);
  if (windows.length && (!f.rate || ts >= f.rate.ts)) f.rate = { ts, windows };
  const info = o.payload.info as { total_token_usage?: Record<string, unknown> } | null | undefined;
  const t = info?.total_token_usage;
  if (!t || typeof t !== "object") return;
  // OpenAI's input count includes the cached part.
  const cached = num(t.cached_input_tokens);
  const now = counts(Math.max(0, num(t.input_tokens) - cached), num(t.output_tokens), 0, cached);
  const prev = f.cum ?? zeroCounts();
  // A smaller running total means a new count started (it never goes down otherwise).
  const reset = now.input < prev.input || now.output < prev.output || now.cacheRead < prev.cacheRead;
  const delta = reset ? now : counts(now.input - prev.input, now.output - prev.output, 0, now.cacheRead - prev.cacheRead);
  f.cum = now;
  if (delta.total === 0 && delta.cacheRead === 0) return; // the same total repeated (e.g. a rate-limit-only update)
  f.n = (f.n ?? 0) + 1;
  f.records.set(`n${f.n}`, { ts, c: delta });
}

/**
 * Feeds newly read text into a file's state. Only whole lines are used; returns the bytes
 * consumed (a half-written last line is read again next time).
 */
export function feed(f: FileState, text: string): number {
  const end = text.lastIndexOf("\n");
  if (end < 0) return 0;
  const whole = text.slice(0, end + 1);
  for (const line of whole.split("\n")) {
    if (!line.trim()) continue;
    if (f.kind === "claude") {
      const r = claudeRecord(line);
      if (r) f.records.set(r.key, { ts: r.ts, c: r.c }); // a later line for the same message wins
    } else applyCodexLine(f, line);
  }
  const bytes = Buffer.byteLength(whole, "utf8");
  f.offset += bytes;
  return bytes;
}

/** Tokens in [start, end) across files; records from before the day are dropped. */
export function sumDay(files: Iterable<FileState>, bounds: Pick<DayBounds, "start" | "end">): TokenCounts {
  const total = zeroCounts();
  for (const f of files) {
    if (f.skip) continue;
    for (const [key, r] of f.records) {
      if (r.ts < bounds.start) f.records.delete(key);
      else if (r.ts < bounds.end) addInto(total, r.c);
    }
  }
  return total;
}

/** The newest rate limits a Codex session reported, while they still apply. */
export function latestRateLimits(files: Iterable<FileState>, now: number): RateLimitWindow[] {
  let best: FileState["rate"];
  for (const f of files) if (!f.skip && f.rate && (!best || f.rate.ts > best.ts)) best = f.rate;
  return (best?.windows ?? []).filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now);
}

// ---------------------------------------------------------------- reading files

export interface ListedFile {
  path: string;
  size: number;
}

/** Where an agent's session files are, and how to read them. Both calls throw when they can't read. */
export interface TranscriptReader {
  /** Session files changed since `sinceMs`. */
  list(sinceMs: number): Promise<ListedFile[]>;
  /** Up to `max` bytes of `path` from byte `from`. */
  read(path: string, from: number, max: number): Promise<string>;
  /** Only count Codex sessions started in this folder (local agents share ~/.codex). */
  codexCwd?: string;
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

async function walk(dir: string, sinceMs: number, out: ListedFile[]) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (isMissing(e)) return;
    throw e;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, sinceMs, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) {
      try {
        const s = await stat(p);
        if (s.mtimeMs >= sinceMs) out.push({ path: p, size: s.size });
      } catch {
        /* removed meanwhile */
      }
    }
  }
}

/** Claude Code's project folder name for a path: every other character becomes "-". */
export const claudeProjectDir = (path: string) => resolve(path).replace(/[^A-Za-z0-9]/g, "-");

/** A local agent: its files are on this machine. */
export function hostReader(agent: AgentConfig, workspace: string): TranscriptReader {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const roots = agent.cli === "claude" ? [join(claudeHome, "projects", claudeProjectDir(workspace))] : [join(codexHome, "sessions")];
  return {
    codexCwd: agent.cli === "codex" ? resolve(workspace) : undefined,
    async list(sinceMs) {
      const out: ListedFile[] = [];
      for (const r of roots) await walk(r, sinceMs, out);
      return out;
    },
    async read(path, from, max) {
      const fh = await open(path, "r");
      try {
        const buf = Buffer.alloc(max);
        const { bytesRead } = await fh.read(buf, 0, max, from);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await fh.close();
      }
    },
  };
}

const LIST_SCRIPT = `for d in "$HOME/.claude/projects" "\${CODEX_HOME:-$HOME/.codex}/sessions"; do [ -d "$d" ] && find "$d" -type f -name '*.jsonl' -newermt "@$1" -printf '%s\\t%p\\n'; done 2>/dev/null; exit 0`;
const READ_SCRIPT = `tail -c +"$(( $1 + 1 ))" -- "$3" | head -c "$2"`;

/** Parses `find -printf '%s\t%p\n'` output. */
export function parseListing(stdout: string): ListedFile[] {
  const out: ListedFile[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const size = Number(line.slice(0, tab));
    const path = line.slice(tab + 1);
    if (Number.isFinite(size) && path) out.push({ path, size });
  }
  return out;
}

/** A sandboxed agent: its files are inside the sandbox, read with `sbx exec` (read-only commands). */
export function sandboxReader(sandbox: string): TranscriptReader {
  return {
    async list(sinceMs) {
      const r = await run("sbx", ["exec", sandbox, "sh", "-c", LIST_SCRIPT, "sh", String(Math.floor(sinceMs / 1000))], { timeoutMs: 15_000 });
      if (!r.ok) throw new Error(r.stderr.trim().split("\n").pop() || "sbx exec failed");
      return parseListing(r.stdout);
    },
    async read(path, from, max) {
      const r = await run("sbx", ["exec", sandbox, "sh", "-c", READ_SCRIPT, "sh", String(from), String(max), path], { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(r.stderr.trim().split("\n").pop() || "sbx exec failed");
      return r.stdout;
    },
  };
}

// ---------------------------------------------------------------- one agent

export interface AgentCache {
  files: Map<string, FileState>;
  /** When the last full read succeeded (0 = never). */
  readAt: number;
  error: string | null;
}

export const newAgentCache = (): AgentCache => ({ files: new Map(), readAt: 0, error: null });

/** Reads what's new in an agent's session files into its cache. Throws when the files can't be listed. */
export async function readInto(cache: AgentCache, reader: TranscriptReader, bounds: DayBounds, now: number) {
  const listed = await reader.list(bounds.start);
  const seen = new Set<string>();
  for (const { path, size } of listed) {
    const kind = kindOf(path);
    if (!kind) continue;
    seen.add(path);
    let f = cache.files.get(path);
    if (!f || size < f.offset) {
      // New, or rewritten from the start.
      f = newFileState(kind);
      cache.files.set(path, f);
    }
    if (f.skip) {
      f.offset = size;
      continue;
    }
    while (f.offset < size) {
      const text = await reader.read(path, f.offset, Math.min(CHUNK, size - f.offset));
      const used = feed(f, text);
      // A local agent counts only Codex sessions from its own folder (session_meta is the first line).
      if (reader.codexCwd && f.kind === "codex" && f.offset > 0 && (f.cwd === undefined || resolve(f.cwd) !== reader.codexCwd)) {
        f.skip = true;
        f.records.clear();
        f.offset = size;
        break;
      }
      if (used === 0) {
        // No line end in a whole chunk: a line that long can't be parsed, so skip past it. Otherwise the last line is still being written.
        if (size - f.offset >= CHUNK) f.offset += CHUNK;
        else break;
      }
    }
  }
  // Files not changed since midnight hold nothing for today.
  for (const path of [...cache.files.keys()]) if (!seen.has(path)) cache.files.delete(path);
  cache.readAt = now;
  cache.error = null;
}

export const sourceOf = (agent: Pick<AgentConfig, "cli">): UsageSource => (agent.cli === "claude" ? "claude-transcripts" : agent.cli === "codex" ? "codex-sessions" : "none");

/**
 * Today's measurement for one agent from its cache. Tokens are null when the CLI can't be
 * measured or the files haven't been read since midnight (unknown, not 0).
 */
export function measure(
  agent: Pick<AgentConfig, "cli">,
  cache: AgentCache | undefined,
  bounds: DayBounds,
  now: number,
): { source: UsageSource; tokens: TokenCounts | null; error: string | null; rateLimits?: RateLimitWindow[] } {
  const source = sourceOf(agent);
  if (source === "none") return { source, tokens: null, error: null };
  if (!cache || cache.readAt < bounds.start) return { source, tokens: null, error: cache?.error ?? null };
  const rateLimits = latestRateLimits(cache.files.values(), now);
  return { source, tokens: sumDay(cache.files.values(), bounds), error: cache.error, ...(rateLimits.length ? { rateLimits } : {}) };
}

// ---------------------------------------------------------------- the collector

export interface UsageDeps {
  now?: () => Date;
  /** How to read an agent's files, or null when they can't be read right now. */
  readerFor?: (agent: AgentConfig) => TranscriptReader | null;
}

/** Keeps `hub.snap.usage` current: reads every agent on a timer and after each finished turn. */
export class UsageCollector {
  private caches = new Map<string, AgentCache>();
  private reading = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = "";
  private readonly now: () => Date;
  private readonly readerFor: (agent: AgentConfig) => TranscriptReader | null;

  constructor(
    private hub: Hub,
    deps: UsageDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.readerFor = deps.readerFor ?? ((a) => this.defaultReader(a));
  }

  private defaultReader(agent: AgentConfig): TranscriptReader | null {
    if (sourceOf(agent) === "none") return null;
    if (agent.mode === "local") return hostReader(agent, workspaceFor(agent, this.hub.slug));
    // `sbx exec` would start a stopped sandbox: only read a running one.
    if (this.hub.status(agent.id)?.session.state !== "running") return null;
    return sandboxReader(sessionName(this.hub.slug, agent.id));
  }

  start() {
    this.publish();
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), USAGE_REFRESH_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A turn ended: its tokens are in the files now (give the CLI a moment to write them). */
  turnFinished(agentId: string) {
    setTimeout(() => void this.refresh(agentId).then(() => this.publish()), TURN_SETTLE_MS).unref?.();
  }

  async refreshAll() {
    await Promise.all(this.hub.snap.config.team.map((a) => this.refresh(a.id)));
    this.publish();
  }

  /** Reads one agent's new lines (one read at a time per agent). */
  refresh(agentId: string): Promise<void> {
    const busy = this.reading.get(agentId);
    if (busy) return busy;
    const p = this.read(agentId).finally(() => this.reading.delete(agentId));
    this.reading.set(agentId, p);
    return p;
  }

  private async read(agentId: string) {
    const agent = this.hub.cfg(agentId);
    if (!agent) return void this.caches.delete(agentId);
    const reader = this.readerFor(agent);
    if (!reader) return;
    const cache = this.caches.get(agentId) ?? newAgentCache();
    this.caches.set(agentId, cache);
    const now = this.now();
    try {
      await readInto(cache, reader, localDay(now), now.getTime());
    } catch (err) {
      cache.error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      log.warn(`usage: ${agent.name}: ${cache.error}`);
    }
  }

  /** Today's usage from what's cached (no reading). */
  snapshot(): UsageSnapshot {
    const now = this.now();
    const bounds = localDay(now);
    const team = this.hub.snap.config.team;
    for (const id of [...this.caches.keys()]) if (!team.some((a) => a.id === id)) this.caches.delete(id);
    const measured = Object.fromEntries(team.map((a) => [a.id, measure(a, this.caches.get(a.id), bounds, now.getTime())]));
    return summarizeUsage(team, measured, this.hub.snap.config.project.dailyTokenBudgets, { day: bounds.day, since: new Date(bounds.start).toISOString() }, now.toISOString());
  }

  /** Puts the current numbers in the snapshot; browsers are told only when something changed. */
  publish() {
    const usage = this.snapshot();
    const { checkedAt: _at, ...rest } = usage;
    const key = JSON.stringify(rest);
    if (key === this.last) {
      if (this.hub.snap.usage) this.hub.snap.usage.checkedAt = usage.checkedAt;
      return;
    }
    this.last = key;
    this.hub.setUsage(usage);
  }
}
