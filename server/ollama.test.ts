import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_SERVER_URL, supportsLocalServer, type AgentConfig, type HqConfig } from "../src/data/types";
import { adapters, codexConfig } from "./adapters";
import {
  claudeLocalEnv,
  LOCAL_SERVER_KEY_ENV,
  localServerApiKey,
  localServerBaseUrl,
  localServerModels,
  localServerPolicyTargets,
  localServerUrlFor,
  parseLocalServerUrl,
  parseModelsResponse,
  probeLocalWire,
  usesLocalServer,
  usesOllama,
} from "./ollama";

const agent = (over: Partial<AgentConfig> = {}): AgentConfig =>
  ({
    id: "dwight", name: "Dwight", role: "Developer", isLead: false, cli: "claude", model: "", mode: "sandbox", color: "#fff",
    skills: [], roleMd: "", sandbox: { allow: [], deny: [], resources: { cpus: null, memoryGb: null } }, workspacePath: null,
    provider: "local", localModel: "q2_0", ...over,
  }) as unknown as AgentConfig;

const config = (a: AgentConfig, localServerUrl?: string): HqConfig =>
  ({
    project: { id: "p", name: "P", repo: "o/p", path: "/p", hqPort: 7420, ...(localServerUrl ? { localServerUrl } : {}) },
    team: [a],
    workflow: { review: { enabled: true, tool: "human", command: "" }, merge: { by: "human" }, deploy: { enabled: false, tool: "instacloud", command: "", perAgentEnvironments: false } },
  }) as unknown as HqConfig;

describe("local server provider config", () => {
  it("applies to Claude Code and Codex agents set to local, and not to Ollama", () => {
    expect(usesLocalServer(agent())).toBe(true);
    expect(usesLocalServer(agent({ cli: "codex" }))).toBe(true);
    expect(usesLocalServer(agent({ provider: "default" }))).toBe(false);
    expect(usesLocalServer(agent({ provider: undefined }))).toBe(false);
    expect(usesLocalServer(agent({ cli: "gemini" }))).toBe(false);
    expect(supportsLocalServer("antigravity")).toBe(false);
    expect(usesOllama(agent())).toBe(false);
  });

  it("normalizes the address: http(s) only, no trailing slash, no /v1", () => {
    expect(parseLocalServerUrl("http://127.0.0.1:47831/")).toBe("http://127.0.0.1:47831");
    expect(parseLocalServerUrl(" http://127.0.0.1:47831/v1/ ")).toBe("http://127.0.0.1:47831");
    expect(parseLocalServerUrl("https://models.lan/api")).toBe("https://models.lan/api");
    for (const bad of ["", "   ", "ftp://x", "not a url", undefined, 5]) expect(parseLocalServerUrl(bad)).toBeNull();
  });

  it("defaults to Strata's address", () => {
    expect(localServerBaseUrl(config(agent()))).toBe(DEFAULT_LOCAL_SERVER_URL);
    expect(DEFAULT_LOCAL_SERVER_URL).toBe("http://127.0.0.1:47831");
    expect(localServerBaseUrl(config(agent(), "http://10.0.0.5:9000/v1"))).toBe("http://10.0.0.5:9000");
  });

  it("reads the API key from HQ's environment only", () => {
    expect(localServerApiKey({})).toBeUndefined();
    expect(localServerApiKey({ [LOCAL_SERVER_KEY_ENV]: "  " })).toBeUndefined();
    expect(localServerApiKey({ [LOCAL_SERVER_KEY_ENV]: " sk-1 " })).toBe("sk-1");
  });
});

describe("URL translation for sandboxes", () => {
  const cfg = config(agent());
  it("sends loopback addresses through host.docker.internal in a sandbox, not in Local mode", () => {
    expect(localServerUrlFor(agent({ mode: "sandbox" }), cfg)).toBe("http://host.docker.internal:47831");
    expect(localServerUrlFor(agent({ mode: "local" }), cfg)).toBe("http://127.0.0.1:47831");
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0"])
      expect(localServerUrlFor(agent(), config(agent(), `http://${host}:8080`))).toBe("http://host.docker.internal:8080");
  });

  it("leaves other hosts alone", () => {
    expect(localServerUrlFor(agent(), config(agent(), "http://gpu-box.lan:8080"))).toBe("http://gpu-box.lan:8080");
  });

  it("opens the right sandbox policy rules", () => {
    expect(localServerPolicyTargets(cfg)).toEqual(["host.docker.internal:47831", "localhost:47831"]);
    expect(localServerPolicyTargets(config(agent(), "https://models.lan"))).toEqual(["models.lan:443"]);
  });
});

describe("models endpoint parsing", () => {
  it("reads { data: [{ id }] }", () => {
    expect(parseModelsResponse({ object: "list", data: [{ id: "q2_0", object: "model" }, { id: "other" }] })).toEqual(["q2_0", "other"]);
  });
  it("accepts a bare array, drops blanks and duplicates, and ignores junk", () => {
    expect(parseModelsResponse([{ id: "a" }, "b", { id: " a " }, { id: "" }, { name: "x" }, null])).toEqual(["a", "b"]);
    for (const junk of [null, undefined, "x", 3, {}, { data: "no" }]) expect(parseModelsResponse(junk)).toEqual([]);
  });
});

describe("talking to a server", () => {
  let server: Server;
  let url: string;
  const seen: { path: string; auth?: string; body?: string }[] = [];
  const start = async (handler: (path: string, method: string) => { code: number; body: unknown }) => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
        const r = handler(req.url ?? "", req.method ?? "GET");
        res.writeHead(r.code, { "Content-Type": "application/json" }).end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  afterEach(() => new Promise<void>((r) => (seen.length = 0, server ? server.close(() => r()) : r())));

  it("lists models from GET /v1/models, sending the key when there is one", async () => {
    await start(() => ({ code: 200, body: { data: [{ id: "q2_0" }] } }));
    expect(await localServerModels(url, "sk-1")).toEqual(["q2_0"]);
    expect(seen[0]).toMatchObject({ path: "/v1/models", auth: "Bearer sk-1" });
    await localServerModels(url, undefined);
    expect(seen[1].auth).toBeUndefined();
  });

  it("returns null when the server is down or answers an error", async () => {
    await start(() => ({ code: 500, body: {} }));
    expect(await localServerModels(url, undefined)).toBeNull();
    expect(await localServerModels("http://127.0.0.1:1", undefined)).toBeNull();
  });

  it("picks the Responses API when POST /v1/responses works, else chat completions", async () => {
    await start(() => ({ code: 200, body: { object: "response" } }));
    expect(await probeLocalWire(url, "q2_0", undefined)).toBe("responses");
    expect(JSON.parse(seen[0].body ?? "{}")).toMatchObject({ model: "q2_0", max_output_tokens: 1 });
    await new Promise<void>((r) => server.close(() => r()));
    await start(() => ({ code: 404, body: {} }));
    expect(await probeLocalWire(url, "q2_0", undefined)).toBe("chat");
    expect(await probeLocalWire("http://127.0.0.1:1", "q2_0", undefined)).toBe("chat");
  });
});

describe("adapter generation", () => {
  it("Claude Code: ANTHROPIC_BASE_URL without /v1, the local model for every model name", () => {
    const a = agent();
    const launch = adapters.claude.launch(a, config(a));
    expect(launch.args).toEqual(["--mcp-config", ".claude/hq-mcp.json", "--model", "q2_0"]);
    expect(launch.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://host.docker.internal:47831",
      ANTHROPIC_AUTH_TOKEN: "local",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "q2_0",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "q2_0",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "q2_0",
    });
    expect(launch.env?.ANTHROPIC_BASE_URL).not.toMatch(/\/v1$/);
  });

  it("Claude Code: uses the key as the token, and blanks the user's own key in Local mode", () => {
    const a = agent({ mode: "local" });
    const env = claudeLocalEnv(a, config(a), "sk-1");
    expect(env).toMatchObject({ ANTHROPIC_BASE_URL: "http://127.0.0.1:47831", ANTHROPIC_AUTH_TOKEN: "sk-1", ANTHROPIC_API_KEY: "" });
    expect(adapters.claude.launch(a, config(a)).args).toContain("default");
  });

  it("Claude Code on its own account is unchanged", () => {
    const a = agent({ provider: undefined, model: "opus" });
    const launch = adapters.claude.launch(a, config(a));
    expect(launch.env).toBeUndefined();
    expect(launch.args).toEqual(["--mcp-config", ".claude/hq-mcp.json", "--model", "opus"]);
  });

  it("Codex: a provider with /v1 base_url, the Responses API by default, chat when told", () => {
    const a = agent({ cli: "codex" });
    const toml = codexConfig(a, config(a), "tok", "/tmp/none");
    expect(toml).toContain('model = "q2_0"');
    expect(toml).toContain('model_provider = "hq-local"');
    expect(toml).toContain("[model_providers.hq-local]");
    expect(toml).toContain('base_url = "http://host.docker.internal:47831/v1"');
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).not.toContain("env_key");
    expect(codexConfig(a, config(a), "tok", "/tmp/none", { localWire: "chat" })).toContain('wire_api = "chat"');
    expect(adapters.codex.launch(a, config(a))).toEqual({ sbxAgent: "codex", args: [] });
  });

  it("Codex: a key goes by environment variable name, never into the file", () => {
    process.env[LOCAL_SERVER_KEY_ENV] = "sk-secret";
    try {
      const a = agent({ cli: "codex" });
      const toml = codexConfig(a, config(a), "tok", "/tmp/none");
      expect(toml).toContain(`env_key = "${LOCAL_SERVER_KEY_ENV}"`);
      expect(toml).not.toContain("sk-secret");
      expect(adapters.codex.launch(a, config(a)).env).toEqual({ [LOCAL_SERVER_KEY_ENV]: "sk-secret" });
    } finally {
      delete process.env[LOCAL_SERVER_KEY_ENV];
    }
  });

  it("Codex on its own account has no local provider", () => {
    const a = agent({ cli: "codex", provider: undefined });
    expect(codexConfig(a, config(a), "tok", "/tmp/none")).not.toContain("hq-local");
  });
});
