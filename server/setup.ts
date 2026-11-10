// The setup checklist: what this machine has, and how to fix what's missing.

import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { DEFAULT_LOCAL_SERVER_URL, DEFAULT_OLLAMA_URL, type AgentConfig, type SetupCheck, type SetupFix, type SetupState } from "../src/data/types";
import { usesTmux } from "./backends";
import { parseCliJson, sandboxList } from "./lib/json";
import { has, run } from "./lib/exec";
import { findModel, localServerModels, OLLAMA_MIN_VERSION, olderThan, ollamaStatus, usesLocalServer, usesOllama } from "./ollama";
import type { RepoInfo } from "./repo";

const SBX_DOCS = "https://docs.docker.com/ai/sandboxes/install/";
const os = platform();

type Check = Omit<SetupCheck, "fix"> & { fix: SetupFix | null };

const fix = (command: string, runnable: boolean, docs: string | null): SetupFix => ({ command, runnable, docs });

async function checkOs(): Promise<Check> {
  const base = { id: "os" as const, label: "Machine supports sandboxes", neededFor: "sandbox" as const, fix: fix("", false, SBX_DOCS) };
  if (os === "darwin") {
    const v = (await run("sw_vers", ["-productVersion"])).stdout.trim();
    const major = Number(v.split(".")[0]);
    if (arch() !== "arm64") return { ...base, status: "unsupported", detail: `macOS ${v} on Intel. Sandboxes need Apple silicon — use Local mode.` };
    if (major < 14) return { ...base, status: "unsupported", detail: `macOS ${v}. Sandboxes need macOS 14 (Sonoma) or later.` };
    return { ...base, status: "ok", detail: `macOS ${v} · Apple silicon`, fix: null };
  }
  if (os === "win32") {
    const build = Number(release().split(".")[2] ?? 0);
    return build >= 22000
      ? { ...base, status: "ok", detail: "Windows 11 (needs Windows Hypervisor Platform enabled)", fix: null }
      : { ...base, status: "unsupported", detail: "Windows 10. Sandboxes need Windows 11 — use Local mode." };
  }
  const osRelease = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "";
  const id = osRelease.match(/^ID=(.*)$/m)?.[1]?.replace(/"/g, "");
  const ver = Number(osRelease.match(/^VERSION_ID="?([\d.]+)/m)?.[1] ?? 0);
  if (id === "ubuntu" && ver >= 24.04) return { ...base, status: "ok", detail: `Ubuntu ${ver} (needs KVM)`, fix: null };
  return { ...base, status: "warning", detail: `${id ?? "Linux"} ${ver || ""} — Docker documents Ubuntu 24.04+ with KVM.` };
}

async function checkSbx(brew: boolean): Promise<Check> {
  const base = { id: "sbx" as const, label: "Docker Sandboxes (sbx)", neededFor: "sandbox" as const };
  const v = await run("sbx", ["version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim().split(/\s+/)[2] ?? v.stdout.trim(), fix: null };
  const cmd =
    os === "darwin" ? "brew trust docker/tap && brew install docker/tap/sbx"
    : os === "win32" ? "winget install -h Docker.sbx"
    : "curl -fsSL https://get.docker.com | sudo SBX=1 sh";
  const runnable = os === "darwin" ? brew : os === "win32";
  return { ...base, status: "missing", detail: "Not installed.", fix: fix(cmd, runnable, SBX_DOCS) };
}

/** sbx's error when its base network policy was never chosen (fresh install). */
export const POLICY_NOT_INITIALIZED = /not been initialized|sbx policy init/i;

/**
 * `sbx policy check network <host>`: "allowed", "denied", or null when sbx gave no verdict.
 * Newer sbx (0.50+) may print the verdict on stderr and add terminal escape codes, so both
 * streams are read with the codes removed.
 */
export async function policyVerdict(host: string): Promise<{ verdict: "allowed" | "denied" | null; out: string }> {
  const r = await run("sbx", ["policy", "check", "network", host], { timeoutMs: 10_000 });
  // eslint-disable-next-line no-control-regex
  const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b(\[[0-9;?]*[ -\/]*[@-~]|\][^\x07\x1b]*(\x07|\x1b\\)|[@-_])/g, "");
  const m = out.match(/\b(Allowed|Denied):/);
  return { verdict: m ? (m[1] === "Allowed" ? "allowed" : "denied") : null, out };
}

/**
 * A fresh sbx needs a base network policy (`sbx policy init`) before any rule
 * can be added or a sandbox started. HQ suggests one but never picks it.
 */
async function checkSbxPolicy(loginOk: boolean): Promise<Check> {
  const base = { id: "sbx-policy" as const, label: "Sandbox network policy", neededFor: "sandbox" as const };
  if (!loginOk) return { ...base, status: "missing", detail: "Waiting for Docker sign-in.", fix: null };
  const { verdict, out } = await policyVerdict("registry.npmjs.org");
  if (POLICY_NOT_INITIALIZED.test(out))
    return {
      ...base,
      status: "missing",
      detail:
        "Not set yet. Choose what sandboxes can reach once: balanced (recommended: AI services, package registries, GitHub), allow-all, or deny-all. Change it later with sbx policy reset.",
      fix: fix("sbx policy init balanced", true, SBX_DOCS),
    };
  if (!verdict) return { ...base, status: "warning", detail: out.trim().split("\n")[0] || "sbx did not respond.", fix: fix("sbx diagnose", true, SBX_DOCS) };
  const open = (await policyVerdict("hq-probe.invalid")).verdict === "allowed";
  const name = open ? "Allow all" : verdict === "allowed" ? "Balanced" : "Deny all";
  return { ...base, status: "ok", detail: `${name}. HQ adds only the rule that lets sandboxes reach it.`, fix: null };
}

async function checkSbxLogin(sbxOk: boolean): Promise<Check> {
  const base = { id: "sbx-login" as const, label: "Signed in to Docker", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const r = await run("sbx", ["ls", "--json"], { timeoutMs: 10_000 });
  const list = r.ok ? sandboxList<unknown>(r.stdout) : null;
  // The command worked, so you're signed in; an unreadable list only loses the count (never block Start on it).
  if (r.ok) {
    const n = list?.length;
    return { ...base, status: "ok", detail: n === undefined ? "Signed in" : `Signed in · ${n} sandbox${n === 1 ? "" : "es"} on this machine`, fix: null };
  }
  const msg = (r.stderr || r.stdout).trim();
  const loggedOut = /log ?in|sign ?in|unauthori[sz]ed|not authenticated/i.test(msg);
  return {
    ...base,
    status: loggedOut ? "missing" : "warning",
    detail: loggedOut ? "Not signed in. Sign-in opens your browser." : msg.split("\n")[0] || "sbx did not respond.",
    fix: fix(loggedOut ? "sbx login" : "sbx diagnose", true, SBX_DOCS),
  };
}

async function checkTmux(brew: boolean): Promise<Check> {
  const base = { id: "tmux" as const, label: "tmux (keeps agents running if HQ closes)", neededFor: "all" as const };
  if (!usesTmux())
    return { ...base, label: "Agent sessions", status: "ok", detail: "HQ runs agents itself on Windows (no tmux needed). They stop when HQ stops; sandboxes and folders are kept.", fix: null };
  const v = await run("tmux", ["-V"], { timeoutMs: 5000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim(), fix: null };
  if (os === "win32") return { ...base, status: "unsupported", detail: "tmux needs WSL on Windows. Run HQ inside WSL.", fix: fix("wsl --install", false, "https://learn.microsoft.com/windows/wsl/install") };
  return {
    ...base,
    status: "missing",
    detail: "Not installed.",
    fix: os === "darwin" ? fix("brew install tmux", brew, "https://github.com/tmux/tmux/wiki/Installing") : fix("sudo apt install tmux", false, "https://github.com/tmux/tmux/wiki/Installing"),
  };
}

async function checkClaude(): Promise<Check> {
  const base = { id: "claude" as const, label: "Claude Code (for Local mode)", neededFor: "local" as const };
  const v = await run("claude", ["--version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim(), fix: null };
  return {
    ...base,
    status: "missing",
    detail: "Not installed. Only needed for agents in Local mode.",
    fix: fix(os === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash", false, "https://docs.claude.com/en/docs/claude-code/setup"),
  };
}

async function checkGh(brew: boolean): Promise<Check> {
  const base = { id: "gh" as const, label: "GitHub CLI (reads PRs and reviews)", neededFor: "github" as const };
  if (!(await has("gh")))
    return {
      ...base,
      status: "missing",
      detail: "Not installed.",
      fix: fix(os === "darwin" ? "brew install gh" : os === "win32" ? "winget install --id GitHub.cli" : "sudo apt install gh", os === "darwin" ? brew : os === "win32", "https://cli.github.com"),
    };
  const r = await run("gh", ["auth", "status"], { timeoutMs: 10_000 });
  const out = r.stdout + r.stderr;
  if (r.ok) return { ...base, status: "ok", detail: `Signed in as ${out.match(/account (\S+)/)?.[1] ?? "you"}`, fix: null };
  return { ...base, status: "missing", detail: "Not signed in.", fix: fix("gh auth login", true, "https://cli.github.com/manual/gh_auth_login") };
}

function checkRemote(repo: RepoInfo): Check {
  const base = { id: "gh-remote" as const, label: "GitHub remote", neededFor: "github" as const };
  if (repo.github) return { ...base, status: "ok", detail: repo.github, fix: null };
  return {
    ...base,
    status: "warning",
    detail: repo.originUrl ? `origin is ${repo.originUrl} (not GitHub)` : "No origin remote. Agents can't push or open PRs.",
    fix: fix("gh repo create --source . --private --push", false, "https://cli.github.com/manual/gh_repo_create"),
  };
}

async function checkGithubSecret(sbxOk: boolean): Promise<Check> {
  const base = { id: "github-secret" as const, label: "GitHub access inside sandboxes", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const r = await run("sbx", ["secret", "ls"], { timeoutMs: 10_000 });
  if (r.ok && /\bgithub\b/.test(r.stdout)) return { ...base, status: "ok", detail: "Stored in Docker's secret store; injected by the proxy.", fix: null };
  return {
    ...base,
    status: "missing",
    detail: "Agents can't push or open PRs until this is set.",
    fix: fix("sbx secret set github --command 'gh auth token'", true, "https://docs.docker.com/ai/sandboxes/get-started/"),
  };
}

async function checkCodex(): Promise<Check> {
  const base = { id: "codex" as const, label: "Codex (for Codex agents in Local mode)", neededFor: "local" as const };
  const v = await run("codex", ["--version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim(), fix: null };
  return { ...base, status: "missing", detail: "Not installed. Only needed for Codex agents in Local mode (sandboxes have it).", fix: fix("npm install -g @openai/codex", false, "https://developers.openai.com/codex/cli") };
}

async function checkOpenAiSecret(sbxOk: boolean): Promise<Check> {
  const base = { id: "openai-secret" as const, label: "OpenAI sign-in for Codex agents", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const r = await run("sbx", ["secret", "ls", "--json"], { timeoutMs: 10_000 });
  let has = false;
  try {
    has = (parseCliJson<{ secrets?: { name: string; scope: string }[] }>(r.stdout)?.secrets ?? []).some((s) => s.name === "openai" && s.scope === "global");
  } catch {
    /* sbx down */
  }
  if (has) return { ...base, status: "ok", detail: "Stored in Docker's secret store.", fix: null };
  return { ...base, status: "missing", detail: "Codex agents can't sign in until this is set. Opens your browser to sign in with ChatGPT.", fix: fix("sbx secret set openai --oauth", true, "https://docs.docker.com/ai/sandboxes/") };
}

async function checkGemini(): Promise<Check> {
  const base = { id: "gemini" as const, label: "Gemini CLI (for Gemini agents in Local mode)", neededFor: "local" as const };
  const v = await run("gemini", ["--version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim().split("\n").pop() ?? "", fix: null };
  return { ...base, status: "missing", detail: "Not installed. Only needed for Gemini agents in Local mode (sandboxes have it).", fix: fix("npm install -g @google/gemini-cli", false, "https://github.com/google-gemini/gemini-cli") };
}

async function checkAntigravity(): Promise<Check> {
  const base = { id: "antigravity" as const, label: "Antigravity CLI (for Local mode)", neededFor: "local" as const };
  const v = await run("agy", ["--version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim().split("\n").pop() ?? "", fix: null };
  const cmd = os === "win32" ? "irm https://antigravity.google/cli/install.ps1 | iex" : "curl -fsSL https://antigravity.google/cli/install.sh | bash";
  return { ...base, status: "missing", detail: "Not installed. Docker Sandboxes has no Antigravity agent, so these agents run in Local mode.", fix: fix(cmd, false, "https://antigravity.google/docs/install?tab=cli") };
}

/** Gemini's OAuth sign-in is disabled in sandboxes, so they need a Gemini API key in sbx's secret store. */
async function checkGoogleSecret(sbxOk: boolean): Promise<Check> {
  const base = { id: "google-secret" as const, label: "Gemini API key for Gemini agents", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const r = await run("sbx", ["secret", "ls", "--json"], { timeoutMs: 10_000 });
  let found = false;
  try {
    found = (parseCliJson<{ secrets?: { name: string; scope: string }[] }>(r.stdout)?.secrets ?? []).some((s) => s.name === "google" && s.scope === "global");
  } catch {
    /* sbx down */
  }
  if (found) return { ...base, status: "ok", detail: "Stored in Docker's secret store; injected by the proxy.", fix: null };
  return { ...base, status: "missing", detail: "Gemini agents in a sandbox can't sign in until this is set. Paste a key from Google AI Studio when asked.", fix: fix("sbx secret set google", true, "https://docs.docker.com/ai/sandboxes/agents/gemini/") };
}

const OLLAMA_DOCS = "https://ollama.com/download";

/** Ollama answers at its address, and is new enough for Claude Code agents (they use its Anthropic API). */
async function checkOllama(url: string, team: AgentConfig[]): Promise<Check> {
  const base = { id: "ollama" as const, label: "Ollama (for agents on a local model)", neededFor: "all" as const };
  const status = await ollamaStatus(url);
  if (!status) {
    const local = url === DEFAULT_OLLAMA_URL || /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);
    const installed = local && (await has("ollama"));
    return {
      ...base,
      status: "missing",
      detail: installed ? `Installed, but not answering at ${url}.` : local ? "Not installed." : `Not answering at ${url}. Check the address in Settings → Team and that the server accepts connections from this machine (OLLAMA_HOST=0.0.0.0).`,
      fix: installed ? fix("ollama serve", false, OLLAMA_DOCS) : local ? fix(os === "darwin" ? "brew install ollama" : "curl -fsSL https://ollama.com/install.sh | sh", false, OLLAMA_DOCS) : null,
    };
  }
  if (team.some((a) => usesOllama(a) && a.cli === "claude") && olderThan(status.version, OLLAMA_MIN_VERSION))
    return { ...base, status: "warning", detail: `Ollama ${status.version} at ${url}. Claude Code agents need ${OLLAMA_MIN_VERSION} or newer (its Anthropic-compatible API).`, fix: fix("brew upgrade ollama", false, OLLAMA_DOCS) };
  return { ...base, status: "ok", detail: `${status.version ? `Ollama ${status.version}` : "Ollama"} at ${url} · ${status.models.length} model${status.models.length === 1 ? "" : "s"}`, fix: null };
}

/** Each Ollama agent's model is pulled. Warns when a model says it can't call tools (agents need that). */
async function checkOllamaModels(url: string, team: AgentConfig[]): Promise<Check> {
  const base = { id: "ollama-model" as const, label: "Models for agents on Ollama", neededFor: "all" as const };
  const status = await ollamaStatus(url);
  if (!status) return { ...base, status: "missing", detail: "Waiting for Ollama.", fix: null };
  const agents = team.filter(usesOllama);
  const unset = agents.filter((a) => !a.ollamaModel?.trim());
  if (unset.length) return { ...base, status: "missing", detail: `Pick a model for ${unset.map((a) => a.name).join(", ")} in Settings → Team.`, fix: null };
  const wanted = [...new Set(agents.map((a) => a.ollamaModel!.trim()))];
  const missing = wanted.filter((m) => !findModel(status, m));
  if (missing.length)
    return { ...base, status: "missing", detail: `Not pulled yet: ${missing.join(", ")}.`, fix: fix(missing.map((m) => `ollama pull ${m}`).join(" && "), true, "https://ollama.com/library") };
  const noTools = wanted.filter((m) => findModel(status, m)?.tools === false);
  if (noTools.length) return { ...base, status: "warning", detail: `${noTools.join(", ")} doesn't list tool calling, which agents depend on. Pick a model with tools (see ollama.com/search?c=tools).`, fix: null };
  return { ...base, status: "ok", detail: `${wanted.join(", ")} pulled. Tool-calling quality varies a lot between local models.`, fix: null };
}

/** The local server answers GET /v1/models at its address. */
function checkLocalServer(url: string, models: string[] | null): Check {
  const base = { id: "local-server" as const, label: "Local model server (for agents on a local server)", neededFor: "all" as const };
  if (!models) return { ...base, status: "missing", detail: `Not answering at ${url}/v1/models. Start the server, or change the address in Settings → Team. If it needs a key, start HQ with HQ_LOCAL_SERVER_API_KEY set.`, fix: null };
  return { ...base, status: "ok", detail: `${url} · ${models.length} model${models.length === 1 ? "" : "s"}`, fix: null };
}

/** Each local-server agent has a model, and the server lists it. */
function checkLocalModels(models: string[] | null, team: AgentConfig[]): Check {
  const base = { id: "local-model" as const, label: "Models for agents on a local server", neededFor: "all" as const };
  if (!models) return { ...base, status: "missing", detail: "Waiting for the local server.", fix: null };
  const agents = team.filter(usesLocalServer);
  const unset = agents.filter((a) => !a.localModel?.trim());
  if (unset.length) return { ...base, status: "missing", detail: `${unset.map((a) => a.name).join(", ")} ${unset.length === 1 ? "has" : "have"} no model. Pick one in Settings → Team.`, fix: null };
  const missing = [...new Set(agents.map((a) => a.localModel!.trim()))].filter((m) => !models.includes(m));
  if (missing.length) return { ...base, status: "missing", detail: `The server doesn't list: ${missing.join(", ")}. It has: ${models.join(", ") || "no models"}.`, fix: null };
  return { ...base, status: "ok", detail: "Listed by the server. Tool-calling quality varies a lot between local models.", fix: null };
}

/** `team` adds the Codex, Gemini, Antigravity and Ollama checks only when the team has such agents. */
export async function runSetupChecks(repo: RepoInfo, team: AgentConfig[] = [], ollamaUrl = DEFAULT_OLLAMA_URL, localServerUrl = DEFAULT_LOCAL_SERVER_URL): Promise<SetupState> {
  const brew = os === "darwin" && (await has("brew"));
  const [osCheck, sbx, tmux, claude, gh] = await Promise.all([checkOs(), checkSbx(brew), checkTmux(brew), checkClaude(), checkGh(brew)]);
  const sbxOk = sbx.status === "ok";
  const [login, secret] = await Promise.all([checkSbxLogin(sbxOk), checkGithubSecret(sbxOk)]);
  const policy = await checkSbxPolicy(login.status === "ok");
  const checks: SetupCheck[] = [osCheck, sbx, login, policy, secret, tmux, claude, gh, checkRemote(repo)];
  const codexAgents = team.filter((a) => a.cli === "codex");
  if (codexAgents.some((a) => a.mode === "sandbox")) checks.splice(5, 0, await checkOpenAiSecret(sbxOk));
  if (codexAgents.some((a) => a.mode === "local")) checks.push(await checkCodex());
  const geminiAgents = team.filter((a) => a.cli === "gemini");
  if (geminiAgents.some((a) => a.mode === "sandbox")) checks.splice(5, 0, await checkGoogleSecret(sbxOk));
  if (geminiAgents.some((a) => a.mode === "local")) checks.push(await checkGemini());
  if (team.some((a) => a.cli === "antigravity")) checks.push(await checkAntigravity());
  if (team.some(usesOllama)) checks.push(await checkOllama(ollamaUrl, team), await checkOllamaModels(ollamaUrl, team));
  let localModels: string[] | undefined;
  if (team.some(usesLocalServer)) {
    const listed = await localServerModels(localServerUrl);
    localModels = listed ?? undefined;
    checks.push(checkLocalServer(localServerUrl, listed), checkLocalModels(listed, team));
  }
  const ok = (c: SetupCheck) => c.status === "ok";
  return {
    machine: { cpus: cpus().length, memoryGb: Math.round(totalmem() / 1024 ** 3), persistentAgents: usesTmux() },
    checks,
    sandboxReady: osCheck.status !== "unsupported" && ok(sbx) && ok(login) && ok(policy) && ok(tmux),
    localReady: ok(tmux) && ok(claude),
    ...(localModels ? { localModels } : {}),
    checkedAt: new Date().toISOString(),
  };
}
