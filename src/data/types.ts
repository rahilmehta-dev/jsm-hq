import type { StackConfig } from "./stack";
// Domain types shared by the data source, the store, the office and the HUD.

// ---------------------------------------------------------------- Config

/** sbx's machine-wide base network policy (`sbx policy init`). */
export type BasePolicy = "allow-all" | "balanced" | "deny-all" | "unknown";

/** Services sbx can inject keys for through its host proxy (the value never enters the VM). */
export const SERVICE_KEYS = ["anthropic", "openai", "github", "google", "groq", "mistral", "openrouter", "xai", "nebius", "copilot", "cursor", "devin", "droid"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/** VM size. null = let sbx decide (all host CPUs; 50% of RAM, 0.5–32 GB). Set at creation only. */
export interface SandboxResources {
  cpus: number | null;
  memoryGb: number | null;
}

/** Per-agent sandbox settings HQ applies through sbx. Machine-wide ones live in SbxState. */
export interface SandboxSettings {
  resources: SandboxResources;
  allow: string[]; // extra allowed domains for this sandbox, e.g. "registry.npmjs.org"
  deny: string[]; // blocked domains for this sandbox (deny wins over allow)
}

export type AgentMode = "sandbox" | "local";

/** Which coding agent CLI runs in the sandbox. */
export type AgentCli = "claude" | "codex" | "gemini" | "antigravity";

export const CLI_LABEL: Record<AgentCli, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", antigravity: "Antigravity CLI" };

/**
 * Where an agent's model comes from: the CLI's own cloud account, a local Ollama server, or any other
 * OpenAI/Anthropic-compatible server on this machine or the LAN ("local", for example Strata).
 */
export type ModelProvider = "default" | "ollama" | "local";

/** The "local" provider's label in Settings. */
export const LOCAL_SERVER_LABEL = "Local server (OpenAI/Anthropic-compatible)";

/** A local server's address when the project doesn't set one (shown as a hint; the setting is empty until typed). */
export const DEFAULT_LOCAL_SERVER_URL = "http://127.0.0.1:47831";

/** Ollama's address when the project doesn't set one. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Only Claude Code and Codex can run on a local Ollama model. */
export const supportsOllama = (cli: AgentCli) => cli === "claude" || cli === "codex";

/** Same two CLIs for a local server: Claude Code over the Anthropic API, Codex over the OpenAI one. */
export const supportsLocalServer = supportsOllama;

/** Narrows untrusted input (a UI message, an edited config) to a known CLI. */
export const isAgentCli = (v: unknown): v is AgentCli => typeof v === "string" && Object.hasOwn(CLI_LABEL, v);

export interface AgentConfig {
  id: string; // "john"
  name: string; // "John"
  role: string; // "Lead" | "Developer" | "QA" | anything
  isLead: boolean;
  cli: AgentCli;
  model: string; // optional start model ("" = the CLI's default; users can switch with /model)
  mode: AgentMode;
  color: string; // hex, used for the robot, owner dots and chips
  skills: string[];
  roleMd: string; // contents of ROLE.md
  sandbox: SandboxSettings;
  workspacePath: string | null; // an existing folder to use; null = HQ-managed clone
  /** MCP servers (names in sbx's registry) this agent's sandbox gets. */
  mcp?: string[];
  /** Where the model runs. Absent means "default" (the CLI's own cloud account), so older configs load unchanged. */
  provider?: ModelProvider;
  /** The Ollama model to run when provider is "ollama" (for example "qwen3-coder"). */
  ollamaModel?: string;
  /** The model id to run when provider is "local" (one of the server's /v1/models, for example "q2_0"). */
  localModel?: string;
}

/** An MCP server registered with Docker Sandboxes (`sbx mcp ls`). */
export interface McpServer {
  name: string;
  transport: string; // "remote http" | "local stdio" | …
  status: string; // "ready" | "needs-auth" | …
  nextStep: string | null; // e.g. "sbx mcp auth arcjet"
}

export interface McpState {
  servers: McpServer[];
  /** Per agent: servers attached to its sandbox right now (sbx can't detach one; recreating the sandbox does). */
  attached: Record<string, string[]>;
  error: string | null;
  checkedAt: string;
}

export interface NewMcpServer {
  name: string;
  url?: string;
  /** Local stdio server: a program on this Mac. */
  command?: string;
  args?: string[];
  /** Optional API key: sent as "Authorization: Bearer <key>", stored by sbx (never by HQ). */
  apiKey?: string;
}

export type ReviewTool = "coderabbit" | "greptile" | "copilot" | "human" | "custom";
export type DeployTool = "instacloud" | "vercel" | "custom";

export interface WorkflowConfig {
  review: { enabled: boolean; tool: ReviewTool; command: string };
  merge: { by: "human" | "lead" };
  deploy: { enabled: boolean; tool: DeployTool; command: string; perAgentEnvironments: boolean };
}

export interface ProjectConfig {
  /** Fixed once created: names sandboxes, tmux sessions and ~/.jsmhq/<id>. Renaming the project never changes it. */
  id: string; // "askwell"
  name: string; // "Askwell"
  repo: string; // "jsmastery-pro/askwell"
  path: string; // "~/developer/askwell"
  hqPort: number; // port sandboxes use to reach HQ via host.docker.internal
  exportPlan?: boolean; // also write the plan to docs/plan.md
  officeName?: string; // the sign on the office wall; empty = "My HQ"
  ollamaUrl?: string; // where Ollama runs for agents on the "ollama" provider; absent = DEFAULT_OLLAMA_URL
  localServerUrl?: string; // base address of the OpenAI/Anthropic-compatible server for the "local" provider (no /v1); absent = DEFAULT_LOCAL_SERVER_URL
  ponytail?: boolean; // install the ponytail skills (DietrichGebert/ponytail) for every agent; default off
  /** The user's own daily token budget per cloud provider (Settings → Project). Absent = no budget, so no percentage. */
  dailyTokenBudgets?: Partial<Record<BudgetProvider, number>>;
}

/** What a project-room worker does. It's a character in the office, not a coding agent. */
export type ProjectWorkerKind = "fetcher" | "writer" | "sender" | "custom";

export const WORKER_KIND_LABEL: Record<ProjectWorkerKind, string> = { fetcher: "Fetches emails", writer: "Writes emails (local model)", sender: "Sends emails", custom: "Other job" };

/** A non-AI-agent character in the project room: a script, a bot or a model that works on the project itself. */
export interface ProjectWorker {
  id: string;
  name: string;
  kind: ProjectWorkerKind;
  color: string;
}

/** The project room: a separate room for the project's own workers (for example a job-referral email pipeline). */
export interface ProjectRoomConfig {
  /** Stable id (a slug of the project's name). Absent in rooms saved before there could be several: use `roomIdOf`. */
  id?: string;
  name: string;
  workers: ProjectWorker[];
  /** Play the demo animation until a project sends real events. Absent = true. */
  demo?: boolean;
}

const roomSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** A room's id: the saved one, else a slug of its name. */
export function roomIdOf(room: { id?: string; name: string }): string {
  return roomSlug(room.id ?? "") || roomSlug(room.name) || "project";
}

/** Every project room in a config, each with its id. A config with only the old single `projectRoom` has one. */
export function projectRoomsOf(config: Pick<HqConfig, "projectRoom" | "projectRooms">): (ProjectRoomConfig & { id: string })[] {
  const list = Array.isArray(config.projectRooms) ? config.projectRooms : config.projectRoom ? [config.projectRoom] : [];
  return list.filter((r) => r && Array.isArray(r.workers)).map((r) => ({ ...r, id: roomIdOf(r) }));
}

/**
 * Where a worker's status is kept in `roomWorkers`. With one room it's the worker's own id (as before there
 * could be several); with more, `<roomId>/<workerId>`, since worker ids only have to be unique inside their room.
 */
export function roomWorkerKey(roomId: string, workerId: string, scoped: boolean): string {
  return scoped ? `${roomId}/${workerId}` : workerId;
}

/** What a project says one of its workers is doing (sent through the project-room API). */
export type RoomWorkerState = "idle" | "working" | "error" | "done";

export interface RoomWorkerStatus {
  state: RoomWorkerState;
  note: string | null; // what it's doing, for the bubble
  at: string; // when it was reported
  ttl: number; // seconds the status holds before the worker goes back to idle
}

/** A piece of work (an email, a file, a job) handed from one worker to the next. null = the room's in-tray / out-tray. */
export interface RoomHandoff {
  id: string;
  from: string | null;
  to: string | null;
}

export interface HqConfig {
  project: ProjectConfig;
  /** Optional: the project rooms in the office (one per project). Absent or empty = none. */
  projectRooms?: ProjectRoomConfig[];
  /** The first of `projectRooms`, kept for the single-room office UI and for configs saved before there could be several. Read rooms with `projectRoomsOf`. */
  projectRoom?: ProjectRoomConfig;
  team: AgentConfig[];
  workflow: WorkflowConfig;
  /** Optional: what the project is built with (plan 009). */
  stack?: StackConfig;
}

/** An agent asked to reach a domain its sandbox blocks (Team MCP `request_access`). */
export interface AccessRequest {
  id: string;
  agentId: string;
  domain: string;
  reason: string;
  at: string;
  status: "pending" | "allowed" | "denied";
}

export type AccessDecision = "agent" | "everyone" | "deny";

// ---------------------------------------------------------------- Live state

export type AgentState = "idle" | "working" | "needs-input" | "in-review" | "review-passed";

/** The agent's process: its tmux session running `sbx run` (Sandbox) or `claude` (Local). */
export type SessionState = "stopped" | "starting" | "running" | "failed";

export interface SessionInfo {
  state: SessionState;
  detail: string | null; // why it failed, or what it is doing
  workspace: string | null; // absolute folder path on the host
  sandbox: { cpus: number; memoryGb: number } | null; // what the existing sandbox actually has
}

export interface AgentStatus {
  agentId: string;
  state: AgentState;
  currentTaskId: string | null;
  stateSince: string; // ISO time
  note: string | null; // e.g. "Asking: max PDF size 10 MB or 20 MB?"
  session: SessionInfo;
}

export type BoardStatus = "active" | "planned" | "done";

export interface Board {
  id: string; // "P3"
  title: string; // "Phase 3 — Knowledge + chat"
  status: BoardStatus;
  order: number;
}

export type TaskStatus = "todo" | "in-progress" | "in-review" | "done" | "blocked";

export interface Task {
  id: string; // "P3-T02"
  boardId: string;
  title: string;
  ownerId: string | null;
  status: TaskStatus;
  needs: string[]; // task IDs
  prNumber: number | null;
  prRepo?: string; // "owner/name" of the PR's repo, when it isn't the main repo's number alone
  description?: string; // what to build
  files?: string[]; // the only files this task may edit
  doneWhen?: string; // acceptance criteria
  note?: string | null; // e.g. why it's blocked
}

export type ReviewState = "pending" | "reviewing" | "changes-requested" | "passed";

export interface PullRequest {
  repo?: string; // "owner/name"; unset for PRs without a known repo
  number: number;
  title: string; // "[P3-T02] Chat route"
  taskId: string;
  authorId: string;
  review: ReviewState;
  openComments: number;
  mergeable: boolean;
  merged: boolean;
  openedAt: string;
  url?: string; // link to GitHub
  branch?: string;
  closed?: boolean; // closed without merging — hidden from the board
  conflict?: boolean; // has merge conflicts with the base branch
  reviewNote?: string | null; // e.g. "CodeRabbit: review rate limited"
}

/** A PR's identity across repos: "owner/name#N", or just "N" when the repo is unknown. */
export function prKey(pr: { repo?: string; number: number }): string {
  return pr.repo ? `${pr.repo}#${pr.number}` : String(pr.number);
}

export type EnvironmentStatus = "live" | "deploying" | "sleeping";

export interface Environment {
  name: string; // "main" | agent id
  agentId: string | null;
  url: string;
  status: EnvironmentStatus;
  lastDeployAt: string;
}

/** The human at the keyboard, as a message sender. */
export const HUMAN_ID = "you";

/** One message carried by the Team MCP between two agents (or from you). */
export interface AgentMessage {
  id: string;
  at: string;
  fromId: string; // agent id, or HUMAN_ID
  toId: string;
  text: string;
  delivered?: "typed" | "on-stop" | "queued"; // how HQ handed it over
}

export type ActivityType =
  | "task.assigned"
  | "task.started"
  | "task.created"
  | "agent.needs-input"
  | "agent.answered"
  | "message"
  | "pr.opened"
  | "review.started"
  | "review.passed"
  | "review.changes"
  | "pr.merged"
  | "deploy"
  | "session"
  | "config";

export interface ActivityEvent {
  id: string;
  at: string;
  type: ActivityType;
  agentId: string | null;
  text: string;
}

/** What removing an agent would delete. Answer to `inspectWorkspace`. */
export interface WorkspaceInfo {
  agentId: string;
  path: string;
  managed: boolean; // HQ made this folder (only these can be deleted from HQ)
  exists: boolean;
  changedFiles: number; // uncommitted changes
  unpushedCommits: number; // commits on local branches that aren't on any remote
  sandboxName: string | null;
  sandboxExists: boolean;
}

export interface RemoveAgentOptions {
  deleteSandbox: boolean;
  deleteFolder: boolean;
}

// ---------------------------------------------------------------- Usage

/**
 * Whose tokens an agent spends: the CLI's cloud account, or a model on this machine/LAN
 * (Ollama or a local server), which has no limit.
 */
export type UsageProvider = "anthropic" | "openai" | "google" | "local";
/** Providers a daily budget can be set for. Local models are unlimited. */
export type BudgetProvider = Exclude<UsageProvider, "local">;
export const BUDGET_PROVIDERS: BudgetProvider[] = ["anthropic", "openai", "google"];
export const USAGE_PROVIDER_LABEL: Record<UsageProvider, string> = {
  anthropic: "Anthropic (Claude Code)",
  openai: "OpenAI (Codex)",
  google: "Google (Gemini CLI, Antigravity CLI)",
  local: "Local models",
};

/** The provider an agent's usage counts against. */
export function usageProviderOf(agent: Pick<AgentConfig, "cli" | "provider">): UsageProvider {
  if (agent.provider === "ollama" || agent.provider === "local") return "local";
  return agent.cli === "claude" ? "anthropic" : agent.cli === "codex" ? "openai" : "google";
}

/** Where an agent's numbers come from. "none": HQ can't measure this CLI, so tokens are null (unknown, not 0). */
export type UsageSource = "claude-transcripts" | "codex-sessions" | "none";

/** Tokens counted from the CLI's own session files. `total` = input + output + cacheWrite (cache reads are shown, not counted). */
export interface TokenCounts {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

/** A limit window the CLI itself reported (Codex writes its plan's rate limits into its session files). */
export interface RateLimitWindow {
  label: string; // "primary" | "secondary"
  windowMinutes: number | null;
  usedPercent: number;
  resetsAt: string | null;
}

export interface AgentUsage {
  agentId: string;
  provider: UsageProvider;
  source: UsageSource;
  /** Today's tokens (local midnight to midnight). null = not measurable, never a guessed 0. */
  tokens: TokenCounts | null;
  /** Local model: no budget and no battery, only the token count. */
  unlimited: boolean;
  /** The provider's daily budget this agent shares, if the user set one. */
  budget: number | null;
  /** What's left of the provider's daily budget, 0–100. null when there's no budget, it's unlimited, or an agent on it can't be measured. */
  remainingPercent: number | null;
  /** The most recent limits the CLI reported, if any. */
  rateLimits?: RateLimitWindow[];
  /** Why the last read failed (counts are from the read before). */
  error: string | null;
}

export interface ProviderUsage {
  provider: UsageProvider;
  /** Tokens measured today by this provider's agents. */
  tokens: number;
  /** Agents on this provider whose usage HQ can't measure (their tokens aren't in `tokens`). */
  unmeasured: number;
  budget: number | null;
  remainingPercent: number | null;
  unlimited: boolean;
}

export interface UsageSnapshot {
  day: string; // "2026-11-10", HQ's local date
  since: string; // ISO time of local midnight
  agents: AgentUsage[];
  providers: ProviderUsage[];
  /** Tokens measured today across the team. Percent is not given: there's no overall budget. */
  total: { tokens: number; measured: number; unmeasured: number };
  checkedAt: string;
}

/** What's left of a daily budget, 0–100 (one decimal). null without a positive budget: a percentage needs a known limit. */
export function remainingPercent(used: number, budget: number | null | undefined): number | null {
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) return null;
  const left = ((budget - used) / budget) * 100;
  return Math.round(Math.min(100, Math.max(0, left)) * 10) / 10;
}

/** Totals and percentages for per-agent counts. Shared by the server collector and the demo data. */
export function summarizeUsage(
  team: Pick<AgentConfig, "id" | "cli" | "provider">[],
  measured: Record<string, { source: UsageSource; tokens: TokenCounts | null; rateLimits?: RateLimitWindow[]; error?: string | null }>,
  budgets: ProjectConfig["dailyTokenBudgets"],
  bounds: { day: string; since: string },
  checkedAt: string,
): UsageSnapshot {
  const providers = new Map<UsageProvider, ProviderUsage>();
  for (const a of team) {
    const p = usageProviderOf(a);
    const budget = p === "local" ? null : (budgets?.[p] ?? null);
    const row = providers.get(p) ?? { provider: p, tokens: 0, unmeasured: 0, budget, remainingPercent: null, unlimited: p === "local" };
    const m = measured[a.id];
    if (m?.tokens) row.tokens += m.tokens.total;
    else row.unmeasured += 1;
    providers.set(p, row);
  }
  // Unknown usage on any of the provider's agents makes what's left unknown too (never an optimistic number).
  for (const row of providers.values()) row.remainingPercent = row.unlimited || row.unmeasured > 0 ? null : remainingPercent(row.tokens, row.budget);
  const agents: AgentUsage[] = team.map((a) => {
    const p = usageProviderOf(a);
    const row = providers.get(p)!;
    const m = measured[a.id];
    return {
      agentId: a.id,
      provider: p,
      source: m?.source ?? "none",
      tokens: m?.tokens ?? null,
      unlimited: row.unlimited,
      budget: row.budget,
      remainingPercent: row.remainingPercent,
      ...(m?.rateLimits?.length ? { rateLimits: m.rateLimits } : {}),
      error: m?.error ?? null,
    };
  });
  const list = [...providers.values()];
  return {
    day: bounds.day,
    since: bounds.since,
    agents,
    providers: list,
    total: { tokens: list.reduce((n, r) => n + r.tokens, 0), measured: agents.filter((a) => a.tokens).length, unmeasured: agents.filter((a) => !a.tokens).length },
    checkedAt,
  };
}

// ---------------------------------------------------------------- Setup

export type SetupCheckId = "os" | "sbx" | "sbx-login" | "sbx-policy" | "tmux" | "gh" | "gh-remote" | "github-secret" | "claude" | "codex" | "openai-secret" | "gemini" | "antigravity" | "google-secret" | "ollama" | "ollama-model" | "local-server" | "local-model";
export type SetupStatus = "ok" | "missing" | "unsupported" | "warning";

export interface SetupFix {
  command: string; // shown with a Copy button
  runnable: boolean; // HQ may run it in a visible terminal ("Run in terminal")
  docs: string | null;
}

export interface SetupCheck {
  id: SetupCheckId;
  label: string;
  status: SetupStatus;
  detail: string; // version found, or what is wrong
  neededFor: "sandbox" | "local" | "all" | "github";
  fix: SetupFix | null;
}

/** A network rule in effect for a sandbox, as sbx reports it. */
export interface SbxRule {
  id: string;
  decision: "allow" | "deny";
  resources: string[];
  source: "hq" | "kit" | "org" | "cli"; // cli = added with the sbx CLI, outside HQ
}

export interface SbxAgentState {
  rules: SbxRule[]; // empty until the sandbox exists
  keys: string[]; // service keys scoped to this sandbox
  envFile: { path: string; exists: boolean };
  syncError: string | null;
  /** Requests the sandbox blocked, waiting in sbx's approval queue (`sbx policy approval ls`). */
  approvals: SbxApproval[];
  /** Sandbox ports reachable from this machine (`sbx ports`), e.g. for a CLI's sign-in callback. */
  ports?: SbxPort[];
}

/** Terminal id of the Terminal panel: your own shell on this machine, not in a sandbox. */
export const HOST_TERMINAL = "shell:@host";

export interface SbxPort {
  sandbox: number;
  host: number;
}

export interface SbxApproval {
  id: string; // sbx's approval id
  host: string; // "mcp.notion.com:443"
  /** sbx's title as is, e.g. "GET api.example.com:443/v1/data" (shown, so different requests can be told apart). */
  title?: string;
  detail: string;
  /** False when sbx's entry is narrower than host:port (e.g. one HTTP method and path). */
  hostWide?: boolean;
  /** "TCP" or "UDP" from sbx's detail. HQ's allow rules are TCP, so others are answered through sbx. */
  protocol?: string;
}

/** What sbx actually has on this machine (read back, not saved settings). */
export interface SbxState {
  basePolicy: BasePolicy;
  proxy: string | null;
  globalKeys: string[]; // service keys available to every sandbox
  agents: Record<string, SbxAgentState>;
  checkedAt: string;
}

export interface MachineInfo {
  cpus: number;
  memoryGb: number;
  /** False on Windows: agents run inside HQ and stop when it stops (no tmux). */
  persistentAgents?: boolean;
}

export interface SetupState {
  machine: MachineInfo;
  checks: SetupCheck[];
  sandboxReady: boolean; // every sandbox check passes
  localReady: boolean; // Local mode can run
  /** Model ids the project's local server listed (GET /v1/models), when an agent uses the "local" provider. */
  localModels?: string[];
  checkedAt: string;
}

export interface OfficeSnapshot {
  /** True until the first-run welcome is finished for this repo (real HQ only). */
  welcome?: boolean;
  setup: SetupState;
  sbx: SbxState;
  config: HqConfig;
  agents: AgentStatus[];
  boards: Board[];
  tasks: Task[];
  pullRequests: PullRequest[];
  environments: Environment[];
  messages: AgentMessage[]; // newest first, last 100
  activity: ActivityEvent[]; // newest first, last 50
  accessRequests?: AccessRequest[];
  mcp?: McpState;
  actionItems?: ActionItem[];
  /** What each project-room worker is doing now, as its project reported it. Keys: see `roomWorkerKey`. */
  roomWorkers?: Record<string, RoomWorkerStatus>;
  /** Recent hand-offs (the scene animates each once). Newest first. */
  roomHandoffs?: RoomHandoff[];
  /** How a project connects to its room: the local address and token (shown in Settings). Never saved to config.json. */
  roomApi?: { url: string; token: string };
  /** Model tokens used today, per agent and per provider, measured on this machine (never sent anywhere). */
  usage?: UsageSnapshot;
}

/** Something an agent needs the user to do outside its sandbox (Team MCP `ask_user`). */
export interface ActionItem {
  id: string;
  fromId: string; // agent id
  taskId: string | null;
  title: string;
  details: string; // steps; never secret values
  waiting: boolean; // the agent can't continue without it
  status: "open" | "done" | "dismissed";
  note: string | null; // the user's note when closing it
  at: string;
  closedAt: string | null;
}

// ---------------------------------------------------------------- Inputs

export interface NewAgentInput {
  name: string;
  role: string;
  cli?: AgentCli;
  model?: string;
  mode: AgentMode;
  provider?: ModelProvider;
  ollamaModel?: string;
  localModel?: string;
}

/** First-run choices from the welcome screen. */
export interface WelcomeInput {
  projectName: string;
  lead: { name: string; cli: AgentCli };
  workers: { name: string; role: string; cli: AgentCli }[];
  reviewTool: ReviewTool;
  reviewEnabled: boolean;
  /** Optional: what the project is built with. */
  stack?: StackConfig;
}

export type AgentPatch = Partial<
  Pick<AgentConfig, "name" | "role" | "cli" | "model" | "mode" | "color" | "skills" | "roleMd" | "workspacePath" | "provider" | "ollamaModel" | "localModel">
>;

export interface WorkflowPatch {
  review?: Partial<WorkflowConfig["review"]>;
  merge?: Partial<WorkflowConfig["merge"]>;
  deploy?: Partial<WorkflowConfig["deploy"]>;
}
