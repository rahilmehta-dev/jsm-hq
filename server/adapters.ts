// Per-CLI differences: which files HQ writes into the agent's folder and how
// the agent is launched. Everything else (hooks → state, Team MCP, delivery)
// is shared — Codex and Claude Code send the same hook payloads, and Gemini CLI's
// hooks are mapped onto them (see GEMINI_EVENTS), and so are Antigravity CLI's (ANTIGRAVITY_EVENTS).

import { agentRead, agentWrite } from "./lib/agentFs";
import type { AgentCli, AgentConfig, HqConfig } from "../src/data/types";
import { adoptRoleFile, excludeFromGit, HOOK_SCRIPT, isOurs, type RoleExtras, hookCommand, hookScriptFor, hqUrl, MCP_CONFIG, ROLE_FILE, roleMd, writeClaudeFiles, writeHookScript } from "./agentFiles";
import { run } from "./lib/exec";
import { claudeLocalEnv, claudeOllamaEnv, LOCAL_SERVER_KEY_ENV, localServerApiKey, localServerUrlFor, ollamaUrlFor, usesLocalServer, usesOllama, type LocalWire } from "./ollama";

export interface Launch {
  sbxAgent: string; // agent name for `sbx run`
  args: string[]; // the CLI's own arguments (not shell-quoted)
  /** Arguments for `sbx run` when they differ from `args` (a CLI that runs inside sbx's generic shell agent). */
  sbxArgs?: string[];
  /** Hosts the sandbox needs beyond HQ itself, allowed in the sandbox network policy before it starts. */
  policyHosts?: string[];
  /** Extra environment for the agent's process (for example a local model provider). */
  env?: Record<string, string>;
}

/** What goes into the files besides the role: `localWire` is the API Codex uses with a local server (probed at start). */
export type FileExtras = RoleExtras & { localWire?: LocalWire };

export interface CliAdapter {
  /** Writes HQ's files into the agent's folder (all git-excluded). */
  writeFiles(dir: string, agent: AgentConfig, cfg: HqConfig, token: string, extras?: FileExtras): Promise<void>;
  launch(agent: AgentConfig, cfg: HqConfig): Launch;
}

// ---------------------------------------------------------------- Claude Code

const claude: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    const ownRole = await adoptRoleFile(dir);
    writeClaudeFiles(dir, agent, cfg, token, { ...extras, ownRole });
  },
  launch(agent, cfg) {
    // On Ollama the model is the local one; Claude Code reaches it through ANTHROPIC_BASE_URL.
    if (usesOllama(agent)) {
      // Local mode keeps permission prompts on: an "auto" mode from the user's own settings would run its
      // safety classifier on the same local model, which is slow and times out, blocking every tool call.
      const prompts = agent.mode === "local" ? ["--permission-mode", "default"] : [];
      return { sbxAgent: "claude", args: ["--mcp-config", MCP_CONFIG, "--model", agent.ollamaModel?.trim() ?? "", ...prompts], env: claudeOllamaEnv(agent, cfg) };
    }
    // Same for a local server (Strata…): the Anthropic Messages API at ANTHROPIC_BASE_URL (Claude Code adds /v1/messages).
    if (usesLocalServer(agent)) {
      const prompts = agent.mode === "local" ? ["--permission-mode", "default"] : [];
      return { sbxAgent: "claude", args: ["--mcp-config", MCP_CONFIG, "--model", agent.localModel?.trim() ?? "", ...prompts], env: claudeLocalEnv(agent, cfg) };
    }
    // "Opus" / "Sonnet" / "Haiku" → Claude Code's aliases; anything else is passed as a full model id.
    const m = agent.model.trim();
    const model = !m || /^default$/i.test(m) ? null : /^(opus|sonnet|haiku)$/i.test(m) ? m.toLowerCase() : m;
    // Relative to the agent's folder, where it starts. An absolute path would be the host's, and on
    // Windows the folder has a different path inside the sandbox (C:\x on the host, /c/x in the sandbox).
    return { sbxAgent: "claude", args: ["--mcp-config", MCP_CONFIG, ...(model ? ["--model", model] : [])] };
  },
};

// ---------------------------------------------------------------- Codex

export const CODEX_CONFIG = ".codex/config.toml";
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Stop", "SessionEnd"];

const OLLAMA_PROVIDER = "hq-ollama";
const LOCAL_PROVIDER = "hq-local";

/** TOML basic string (JSON's escaping is valid TOML for these characters). */
const t = (s: string) => JSON.stringify(s);

export function codexConfig(agent: AgentConfig, cfg: HqConfig, token: string, dir: string, extras: FileExtras = {}): string {
  const url = hqUrl(agent, cfg.project.hqPort);
  const script = hookScriptFor(agent, dir);
  const lines = [
    "# Written by My HQ for this agent (git-excluded). Codex loads it once you trust this folder.",
    `developer_instructions = ${t(roleMd(agent, cfg, extras))}`,
    // Top-level keys come before any table. A provider of its own (not Codex's built-in "ollama" one)
    // so the address can be anything, including a sandbox's host.docker.internal.
    ...(usesOllama(agent) ? [`model = ${t(agent.ollamaModel?.trim() ?? "")}`, `model_provider = ${t(OLLAMA_PROVIDER)}`] : []),
    ...(usesLocalServer(agent) ? [`model = ${t(agent.localModel?.trim() ?? "")}`, `model_provider = ${t(LOCAL_PROVIDER)}`] : []),
    "",
    "[features]",
    "hooks = true",
    "",
    "[mcp_servers.hq]",
    `url = ${t(`${url}/mcp`)}`,
    `http_headers = { Authorization = ${t(`Bearer ${token}`)}, "X-HQ-Agent" = ${t(agent.id)} }`,
  ];
  if (usesOllama(agent)) lines.push("", `[model_providers.${OLLAMA_PROVIDER}]`, 'name = "Ollama"', `base_url = ${t(`${ollamaUrlFor(agent, cfg)}/v1`)}`, 'wire_api = "responses"');
  // The key (if the server needs one) is read from an environment variable, never written into the file.
  if (usesLocalServer(agent))
    lines.push(
      "",
      `[model_providers.${LOCAL_PROVIDER}]`,
      'name = "Local server"',
      `base_url = ${t(`${localServerUrlFor(agent, cfg)}/v1`)}`,
      `wire_api = ${t(extras.localWire ?? "responses")}`,
      ...(localServerApiKey() ? [`env_key = ${t(LOCAL_SERVER_KEY_ENV)}`] : []),
    );
  for (const event of CODEX_EVENTS)
    lines.push("", `[[hooks.${event}]]`, `[[hooks.${event}.hooks]]`, 'type = "command"', `command = ${t(hookCommand(url, token, agent.id, event, script))}`);
  return lines.join("\n") + "\n";
}

const codex: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    // A repo that commits its own Codex config can't take HQ's without changing a tracked file.
    const tracked = await run("git", ["ls-files", "--error-unmatch", CODEX_CONFIG], { cwd: dir });
    if (tracked.ok) throw new Error(`This repo commits ${CODEX_CONFIG}, so HQ can't add its Codex settings without changing a tracked file. Use Claude Code for this agent, or remove that file from the repo.`);
    // The role goes in the config (developer_instructions); the folder's own ROLE.md is included, never overwritten.
    const ownRole = await adoptRoleFile(dir);
    agentWrite(dir, CODEX_CONFIG, codexConfig(agent, cfg, token, dir, { ...extras, ownRole }), { mode: 0o600 });
    if (hookScriptFor(agent, dir)) writeHookScript(dir);
    excludeFromGit(dir, [CODEX_CONFIG, HOOK_SCRIPT]);
  },
  launch(agent) {
    // On Ollama the model and provider are in the config file written above.
    if (usesOllama(agent) || usesLocalServer(agent)) return { sbxAgent: "codex", args: [], ...(usesLocalServer(agent) && localServerApiKey() ? { env: { [LOCAL_SERVER_KEY_ENV]: localServerApiKey()! } } : {}) };
    const model = agent.model.trim() && !/^default$/i.test(agent.model.trim()) ? agent.model.trim() : null;
    return { sbxAgent: "codex", args: model ? ["-m", model] : [] };
  },
};


// ---------------------------------------------------------------- Gemini CLI

export const GEMINI_SETTINGS = ".gemini/settings.json";
/** Gemini CLI's hook events → the HQ event each one reports as (the name in the hook URL). */
const GEMINI_EVENTS: Record<string, string> = {
  SessionStart: "SessionStart",
  BeforeAgent: "UserPromptSubmit", // a prompt was submitted; the turn starts
  BeforeTool: "PreToolUse",
  AfterTool: "PostToolUse", // also clears "needs you" once a permission prompt is answered
  Notification: "PermissionRequest", // Gemini only notifies for tool permissions
  AfterAgent: "Stop", // the turn ended; HQ's reply can hand over queued messages
  SessionEnd: "SessionEnd",
};

type GeminiHook = { matcher?: string; hooks: { name?: string; type: "command"; command: string; timeout?: number }[] };
type GeminiSettings = { hooks?: Record<string, GeminiHook[]>; mcpServers?: Record<string, unknown>; context?: { fileName?: string | string[]; [k: string]: unknown }; [k: string]: unknown };

/** The context files Gemini loads: its default GEMINI.md (the repo's own, if any) plus HQ's role file. */
function geminiContextFiles(current: string | string[] | undefined): string[] {
  const files = current === undefined ? ["GEMINI.md"] : [current].flat();
  return files.includes(ROLE_FILE) ? files : [...files, ROLE_FILE];
}

/**
 * .gemini/settings.json: HQ's hooks and Team MCP server, plus the role file as extra context. Settings
 * and hooks already in the file are kept; only HQ's own hooks are replaced. Gemini's hook timeouts are
 * in milliseconds (Claude Code's are seconds).
 */
export function geminiSettings(existing: GeminiSettings, agent: AgentConfig, cfg: HqConfig, token: string, dir: string): GeminiSettings {
  const url = hqUrl(agent, cfg.project.hqPort);
  const script = hookScriptFor(agent, dir);
  const hooks: Record<string, GeminiHook[]> = { ...(existing.hooks ?? {}) };
  for (const [event, hqEvent] of Object.entries(GEMINI_EVENTS)) {
    const kept = (hooks[event] ?? []).map((e) => ({ ...e, hooks: e.hooks.filter((h) => !isOurs(h.command ?? "")) })).filter((e) => e.hooks.length);
    const ours = { name: `jsm-hq-${hqEvent}`, type: "command" as const, command: hookCommand(url, token, agent.id, hqEvent, script), timeout: 5000 };
    hooks[event] = [...kept, event === "BeforeTool" || event === "AfterTool" ? { matcher: "*", hooks: [ours] } : { hooks: [ours] }];
  }
  return {
    ...existing,
    // Gemini loads the role from its context files; the repo's own GEMINI.md keeps loading as usual.
    context: { ...existing.context, fileName: geminiContextFiles(existing.context?.fileName) },
    hooks,
    // trust: the agent may call HQ's tools without a confirmation prompt for each one.
    mcpServers: { ...existing.mcpServers, hq: { httpUrl: `${url}/mcp`, headers: { Authorization: `Bearer ${token}`, "X-HQ-Agent": agent.id }, trust: true } },
  };
}

const gemini: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    // A repo that commits its own Gemini settings can't take HQ's without changing a tracked file.
    const tracked = await run("git", ["ls-files", "--error-unmatch", GEMINI_SETTINGS], { cwd: dir });
    if (tracked.ok) throw new Error(`This repo commits ${GEMINI_SETTINGS}, so HQ can't add its Gemini settings without changing a tracked file. Use Claude Code for this agent, or remove that file from the repo.`);
    // The role goes in its own file that Gemini loads as context. GEMINI.md and ROLE.md are included, never overwritten.
    const ownRole = await adoptRoleFile(dir);
    agentWrite(dir, ROLE_FILE, roleMd(agent, cfg, { ...extras, ownRole }));
    let existing: GeminiSettings = {};
    try {
      existing = JSON.parse(agentRead(dir, GEMINI_SETTINGS) ?? "{}") as GeminiSettings; // a symlink reads as missing
    } catch {
      /* a broken file is replaced */
    }
    agentWrite(dir, GEMINI_SETTINGS, JSON.stringify(geminiSettings(existing, agent, cfg, token, dir), null, 2) + "\n", { mode: 0o600 });
    if (hookScriptFor(agent, dir)) writeHookScript(dir);
    excludeFromGit(dir, [GEMINI_SETTINGS, ROLE_FILE, HOOK_SCRIPT]);
  },
  launch(agent) {
    const model = agent.model.trim() && !/^default$/i.test(agent.model.trim()) ? agent.model.trim() : null;
    // In a sandbox, sbx starts `gemini --yolo` and appends flags after it; Local mode keeps permission prompts on.
    return { sbxAgent: "gemini", args: model ? ["-m", model] : [] };
  },
};

// ---------------------------------------------------------------- Antigravity CLI

export const ANTIGRAVITY_HOOKS = ".agents/hooks.json";
export const ANTIGRAVITY_MCP = ".agents/mcp_config.json";
export const ANTIGRAVITY_RULES = ".agents/rules/jsm-hq.md";
/** The key HQ's hooks live under in hooks.json; other hook names in the file are left alone. */
const ANTIGRAVITY_HOOK_NAME = "jsm-hq";
/**
 * Antigravity's hook events → the HQ event each reports as. It has no permission or notification event
 * and no SessionEnd: a prompt waiting on you can't be seen from hooks, and a session that ends is
 * noticed when its process exits. SessionStart only fires with the first prompt. In agy 1.5.3, none of
 * the PreToolUse/PostToolUse layouts tried (grouped or flat, with or without a matcher) fired in a test,
 * so tool use isn't reported; PreInvocation and Stop still drive working/idle. PreInvocation fires before each model call, so it also re-marks the
 * agent as working when a Stop hook continues the turn.
 */
const ANTIGRAVITY_EVENTS: Record<string, string> = { SessionStart: "SessionStart", PreInvocation: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse", Stop: "Stop" };
/** What a sandbox runs for Antigravity: installs agy once (the sandbox keeps it), then starts it with the arguments given. */
const ANTIGRAVITY_SANDBOX_START = [
  "set -o pipefail",
  'export PATH="$HOME/.local/bin:$PATH"',
  "command -v agy >/dev/null || { curl -fsSL https://antigravity.google/cli/install.sh | bash; } || { echo 'Could not install the Antigravity CLI in this sandbox.'; exec bash -l; }",
  'exec agy "$@"',
].join("; ");
/**
 * Hosts the Antigravity install and sign-in need. The installer fetches its release manifest from a
 * Google Cloud Run service, so its address is part of the policy; the rest are the CLI's own endpoints.
 */
const ANTIGRAVITY_SANDBOX_HOSTS = [
  "antigravity.google",
  "antigravity-cli-auto-updater-974169037036.us-central1.run.app",
  "storage.googleapis.com",
  "oauth2.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "aicode.googleapis.com",
];
/** Antigravity truncates a rule file past 24,000 bytes. */
const ANTIGRAVITY_RULE_LIMIT = 24_000;

type JsonObject = Record<string, unknown>;

/** hooks.json: HQ's hooks under their own name, next to any the file already has. Timeouts are in seconds. */
export function antigravityHooks(existing: JsonObject, agent: AgentConfig, cfg: HqConfig, token: string, dir: string): JsonObject {
  const url = hqUrl(agent, cfg.project.hqPort);
  const script = hookScriptFor(agent, dir);
  const entry: JsonObject = { enabled: true };
  for (const [event, hqEvent] of Object.entries(ANTIGRAVITY_EVENTS)) {
    const handler = { type: "command", command: hookCommand(url, token, agent.id, hqEvent, script), timeout: 5 };
    entry[event] = event === "PreToolUse" || event === "PostToolUse" ? [{ matcher: ".*", hooks: [handler] }] : [handler];
  }
  return { ...existing, [ANTIGRAVITY_HOOK_NAME]: entry };
}

/** mcp_config.json: the Team MCP server (Streamable HTTP, `serverUrl`), next to any servers the file already has. */
export function antigravityMcp(existing: JsonObject, agent: AgentConfig, cfg: HqConfig, token: string): JsonObject {
  const servers = (existing.mcpServers ?? {}) as JsonObject;
  return { ...existing, mcpServers: { ...servers, hq: { serverUrl: `${hqUrl(agent, cfg.project.hqPort)}/mcp`, headers: { Authorization: `Bearer ${token}`, "X-HQ-Agent": agent.id } } } };
}

/** An always-on rule: Antigravity reads every top-level .md in .agents/rules that has a `trigger`. */
export function antigravityRule(agent: AgentConfig, cfg: HqConfig, extras: RoleExtras): string {
  const body = roleMd(agent, cfg, extras);
  const bytes = Buffer.from(body);
  const text = bytes.length > ANTIGRAVITY_RULE_LIMIT ? bytes.subarray(0, ANTIGRAVITY_RULE_LIMIT).toString("utf8") + "\n" : body;
  return `---\ntrigger: always_on\n---\n${text}`;
}

function readJson(dir: string, file: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(agentRead(dir, file) ?? "{}"); // a symlink reads as missing
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {}; // a broken file is replaced
  }
}

const antigravity: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    // A repo that commits any of these files can't take HQ's without changing a tracked file.
    for (const file of [ANTIGRAVITY_HOOKS, ANTIGRAVITY_MCP, ANTIGRAVITY_RULES]) {
      const tracked = await run("git", ["ls-files", "--error-unmatch", file], { cwd: dir });
      if (tracked.ok) throw new Error(`This repo commits ${file}, so HQ can't add its Antigravity settings without changing a tracked file. Use Claude Code for this agent, or remove that file from the repo.`);
    }
    // The role is an always-on rule. The repo's own AGENTS.md / GEMINI.md and ROLE.md are included, never overwritten.
    const ownRole = await adoptRoleFile(dir);
    agentWrite(dir, ANTIGRAVITY_RULES, antigravityRule(agent, cfg, { ...extras, ownRole }));
    agentWrite(dir, ANTIGRAVITY_HOOKS, JSON.stringify(antigravityHooks(readJson(dir, ANTIGRAVITY_HOOKS), agent, cfg, token, dir), null, 2) + "\n");
    agentWrite(dir, ANTIGRAVITY_MCP, JSON.stringify(antigravityMcp(readJson(dir, ANTIGRAVITY_MCP), agent, cfg, token), null, 2) + "\n", { mode: 0o600 });
    if (hookScriptFor(agent, dir)) writeHookScript(dir);
    excludeFromGit(dir, [ANTIGRAVITY_HOOKS, ANTIGRAVITY_MCP, ANTIGRAVITY_RULES, HOOK_SCRIPT]);
  },
  launch(agent) {
    // Models are named by label ("Gemini 3.8 Flash").
    const model = agent.model.trim() && !/^default$/i.test(agent.model.trim()) ? agent.model.trim() : null;
    // --settings applies to this session only and is never saved, so the user's own settings.json is
    // untouched. It lets the agent use HQ's tools without an approval prompt for each call.
    const args = ["--settings", JSON.stringify({ permissions: { allow: ["mcp(hq/*)"] } }), ...(model ? ["--model", model] : [])];
    // Docker Sandboxes has no Antigravity agent, so it runs in sbx's generic `shell` agent, which
    // takes bash's own arguments: install agy on the first start, then replace the shell with it.
    // Inside the sandbox it doesn't ask before each command, as the built-in sbx agents don't: the VM
    // and its network policy are the boundary. Local mode keeps its prompts (see `args`).
    return { sbxAgent: "shell", args, sbxArgs: ["-lc", ANTIGRAVITY_SANDBOX_START, "_", ...args, "--dangerously-skip-permissions"], policyHosts: ANTIGRAVITY_SANDBOX_HOSTS };
  },
};

export const adapters: Record<AgentCli, CliAdapter> = { claude, codex, gemini, antigravity };

/** The command a Local-mode agent runs on the host. */
export const localBinary: Record<AgentCli, string> = { claude: "claude", codex: "codex", gemini: "gemini", antigravity: "agy" };
