// The HQ Team MCP. Agents connect over Streamable HTTP (stateless) at /mcp,
// identified by the agent token + X-HQ-Agent header that HQ writes into their
// .mcp.json. The lead manages the plan; everyone can message everyone.

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Hub } from "./hub";
import { requestAccess } from "./access";
import { applyProfile, PROFILE_PROPOSAL_FIELDS } from "./commands";
import type { Planner } from "./planner";
import { cleanProjectRoom, setRoom } from "./room";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): Result => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (msg: string): Result => ({ content: [{ type: "text", text: msg }], isError: true });

/** Wraps a tool body: thrown errors become tool errors the agent can read. */
function guard<A>(fn: (args: A) => Result | Promise<Result>) {
  return async (args: A): Promise<Result> => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

function buildServer(hub: Hub, planner: Planner, me: string, syncFiles: (agentId: string) => Promise<void>): McpServer {
  const server = new McpServer({ name: "hq", version: "0.1.0" });
  const isLead = !!hub.cfg(me)?.isLead;
  const leadOnly = () => {
    if (!isLead) throw new Error("Only the lead can do this. Ask the lead with send_message.");
  };
  const taskView = (id: string) => {
    const t = planner.task(id);
    return t && { ...t, owner: t.ownerId ? hub.name(t.ownerId) : null };
  };

  server.registerTool(
    "list_workers",
    { description: "The team: each agent's id, name, role, whether they are running, and what they are doing now." },
    guard(() =>
      ok(
        hub.snap.config.team.map((a) => {
          const st = hub.status(a.id);
          return {
            id: a.id, name: a.name, role: a.role, lead: a.isLead, you: a.id === me,
            running: st?.session.state === "running", state: st?.state, task: st?.currentTaskId ?? null,
            free: st?.session.state === "running" && !a.isLead && !planner.currentTask(a.id),
          };
        }),
      ),
    ),
  );

  server.registerTool(
    "get_status",
    { description: "Live status of every agent (state, note, current task) plus the active boards with task counts." },
    guard(() =>
      ok({
        agents: hub.snap.agents.map((s) => ({ id: s.agentId, name: hub.name(s.agentId), state: s.state, note: s.note, task: s.currentTaskId, session: s.session.state })),
        boards: hub.snap.boards.map((b) => {
          const ts = hub.snap.tasks.filter((t) => t.boardId === b.id);
          const n = (st: string) => ts.filter((t) => t.status === st).length;
          return { id: b.id, title: b.title, status: b.status, todo: n("todo"), inProgress: n("in-progress"), inReview: n("in-review"), blocked: n("blocked"), done: n("done") };
        }),
      }),
    ),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Tasks, optionally filtered by board, status or owner.",
      inputSchema: {
        boardId: z.string().optional().describe("Board id, e.g. P3"),
        status: z.enum(["todo", "in-progress", "in-review", "done", "blocked"]).optional(),
        owner: z.string().optional().describe("Agent id or name"),
      },
    },
    guard(({ boardId, status, owner }: { boardId?: string; status?: string; owner?: string }) => {
      const ownerId = owner ? planner.agentId(owner) : undefined;
      const list = hub.snap.tasks.filter((t) => (!boardId || t.boardId === boardId) && (!status || t.status === status) && (!owner || t.ownerId === ownerId));
      return ok(list.map((t) => ({ id: t.id, board: t.boardId, title: t.title, status: t.status, owner: t.ownerId ? hub.name(t.ownerId) : null, needs: t.needs })));
    }),
  );

  server.registerTool(
    "create_board",
    { description: "Lead only. Create a board (a phase or an area of work).", inputSchema: { title: z.string(), active: z.boolean().optional().describe("Agents only pick tasks from active boards") } },
    guard(({ title, active }: { title: string; active?: boolean }) => {
      leadOnly();
      return ok(planner.createBoard(title, active ? "active" : "planned"));
    }),
  );

  server.registerTool(
    "create_task",
    {
      description: "Lead only. Add a task. Keep tasks small: one task = one branch = one PR.",
      inputSchema: {
        title: z.string(),
        boardId: z.string().optional().describe("Defaults to the first active board"),
        description: z.string().optional().describe("What to build and why"),
        files: z.array(z.string()).optional().describe("The only files/folders this task may edit"),
        doneWhen: z.string().optional().describe("Acceptance criteria"),
        needs: z.array(z.string()).optional().describe("Task ids that must be done first"),
      },
    },
    guard((args: { title: string; boardId?: string; description?: string; files?: string[]; doneWhen?: string; needs?: string[] }) => {
      leadOnly();
      return ok(planner.createTask(args, me));
    }),
  );

  server.registerTool(
    "update_task",
    {
      description: "Lead only. Edit a task's details or status.",
      inputSchema: {
        taskId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        files: z.array(z.string()).optional(),
        doneWhen: z.string().optional(),
        needs: z.array(z.string()).optional(),
        status: z.enum(["todo", "in-progress", "in-review", "done", "blocked"]).optional(),
      },
    },
    guard(({ taskId, ...patch }: { taskId: string; title?: string; description?: string; files?: string[]; doneWhen?: string; needs?: string[]; status?: "todo" | "in-progress" | "in-review" | "done" | "blocked" }) => {
      leadOnly();
      return ok(planner.updateTask(taskId, patch));
    }),
  );

  server.registerTool(
    "assign_task",
    {
      description: "Lead only. Give a task to an agent. HQ tells them to pull main and start it (right away if idle, otherwise when their current turn ends).",
      inputSchema: { taskId: z.string(), agent: z.string().describe("Agent id or name") },
    },
    guard(({ taskId, agent }: { taskId: string; agent: string }) => {
      leadOnly();
      const t = planner.assign(taskId, agent, me);
      return ok(`Assigned ${t.id} to ${hub.name(t.ownerId)}. They have been told to start.`);
    }),
  );

  server.registerTool(
    "get_my_task",
    { description: "Your current task: title, description, the files you may edit, done-when, and what it needs. Marks it in progress." },
    guard(() => {
      const t = planner.currentTask(me);
      if (!t) return ok("You have no task right now. Wait for the lead, or ask with send_message.");
      if (t.status === "todo") planner.setStatus(me, "in-progress");
      const blockedBy = t.needs.filter((n) => planner.task(n)?.status !== "done");
      return ok({ ...taskView(t.id), waitingOn: blockedBy, rules: "Work only on this task, on its own branch. Edit only the listed files. Title the PR `[" + t.id + "] " + t.title + "`. When the PR is open, call set_my_status with in-review and the PR number (plus prRepo, as owner/name, if the PR is in a different repo than the project's main one)." });
    }),
  );

  server.registerTool(
    "set_my_status",
    {
      description: "Update your current task: in-progress, blocked (say why), in-review (PR opened), or done. The lead is told automatically.",
      inputSchema: {
        status: z.enum(["in-progress", "blocked", "in-review", "done"]),
        note: z.string().optional().describe("Why you are blocked, or a short summary"),
        prNumber: z.number().int().optional(),
        prRepo: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .optional()
          .describe("owner/name of the PR's repo, if it isn't this project's main repo"),
      },
    },
    guard(({ status, note, prNumber, prRepo }: { status: "in-progress" | "blocked" | "in-review" | "done"; note?: string; prNumber?: number; prRepo?: string }) => {
      const t = planner.setStatus(me, status, note, prNumber, prRepo);
      return ok(`${t.id} is now ${t.status}.`);
    }),
  );

  server.registerTool(
    "ask_user",
    {
      description:
        "Ask the user to do something you can't do from your sandbox: create an account, database or API key, change a setting in a dashboard (Vercel, Supabase…), or put a value in your env file. It goes to their Action items list. Give a short title and clear steps. Never include secret values; name the variable instead. HQ messages you when they've done it. For a variable you need, write: add NAME to <your name>'s App variables in HQ (Settings → Sandbox → App variables), then restart <your name>. For a site you need, use request_access instead.",
      inputSchema: {
        title: z.string().describe("What to do, in a few words"),
        details: z.string().describe("The exact steps: where to go, what to create, which variable name, where to put it, and whether you need a restart. No secret values."),
        waiting: z.boolean().optional().describe("True if you can't continue without it"),
      },
    },
    guard(({ title, details, waiting }: { title: string; details: string; waiting?: boolean }) => {
      if (!planner.actions) throw new Error("Action items aren't available.");
      if (!details.trim()) throw new Error("Add the steps in details, so the user knows exactly what to do.");
      const item = planner.actions.add(me, title, details, !!waiting);
      return ok(`Added to the user's Action items (${item.id}). ${waiting ? "Wait for HQ's message, or work on something else meanwhile." : "Keep working; HQ will message you when it's done."}`);
    }),
  );

  // Profile changes. Safe fields apply right away; the rest can only be proposed to the user.
  const proposalSchema = z
    .object({ field: z.enum(PROFILE_PROPOSAL_FIELDS), value: z.string(), reason: z.string() })
    .optional()
    .describe("Ask the user for a change you can't make yourself (workspacePath, mode, cli, provider, ollamaModel, model, sandbox, mcp, isLead). They get an action item and apply it in Settings → Team.");
  const profileShape = {
    role: z.string().optional().describe("Short role title, e.g. QA"),
    roleMd: z.string().optional().describe("Your instructions (the ROLE text)"),
    skills: z.array(z.string()).optional(),
    color: z.string().optional().describe("One of HQ's palette colors, as hex"),
    proposal: proposalSchema,
  };
  // Named so a call that tries them directly gets a clear answer instead of having them silently dropped.
  const blockedShape = Object.fromEntries(PROFILE_PROPOSAL_FIELDS.map((f) => [f, z.unknown().optional()]));
  type ProfileArgs = { role?: string; roleMd?: string; skills?: string[]; color?: string; proposal?: { field: string; value: string; reason: string } } & Record<string, unknown>;

  const changeProfile = async (targetId: string, args: ProfileArgs) => {
    const agent = hub.cfg(targetId);
    if (!agent) throw new Error("No such agent.");
    const blocked = PROFILE_PROPOSAL_FIELDS.filter((f) => args[f] !== undefined);
    const changed = applyProfile(agent, { role: args.role, roleMd: args.roleMd, skills: args.skills, color: args.color }, true);
    if (changed.length) {
      hub.configChanged();
      const status = hub.status(targetId);
      if (status) hub.emit({ type: "agent.updated", agent: structuredClone(status) });
      hub.activity("config", me, `${hub.name(me)} updated ${targetId === me ? "their" : `${agent.name}'s`} profile (${changed.join(", ")})`);
      await syncFiles(targetId);
      if (targetId !== me) planner.notify(targetId, `${hub.name(me)} updated your profile (${changed.join(", ")}). HQ rewrote your role file; re-read it.`);
    }
    const parts: string[] = [changed.length ? `Updated ${changed.join(", ")}. HQ rewrote the role file in ${targetId === me ? "your" : `${agent.name}'s`} folder${changed.includes("roleMd") || changed.includes("role") ? "; the new instructions are read when the session next starts" : ""}.` : "Nothing changed."];
    if (blocked.length) parts.push(`${blocked.join(", ")} can't be changed directly: they need the user's approval. Use the proposal parameter ({ field, value, reason }).`);
    if (args.proposal) {
      if (!planner.actions) throw new Error("Action items aren't available.");
      planner.actions.propose(me, targetId, args.proposal.field, args.proposal.value, args.proposal.reason);
      parts.push(`Asked the user to change ${args.proposal.field}; it's in their Action items. Dangerous fields are never applied without them.`);
    }
    return ok(parts.join(" "));
  };

  server.registerTool(
    "update_my_profile",
    {
      description:
        "Change your own role, roleMd (instructions), skills or color. Applied right away and your role file is rewritten. Settings that change what you can reach or run (workspacePath, mode, cli, provider, ollamaModel, model, sandbox, mcp, isLead) need the user: pass proposal { field, value, reason }.",
      inputSchema: { ...profileShape, ...blockedShape },
    },
    guard((args: ProfileArgs) => changeProfile(me, args)),
  );

  server.registerTool(
    "update_agent",
    {
      description:
        "Lead only. Re-scope a teammate: change their role, roleMd, skills or color. Same rules as update_my_profile: dangerous settings can only be proposed to the user (proposal), never applied.",
      inputSchema: { agent: z.string().describe("Their id or name"), ...profileShape, ...blockedShape },
    },
    guard((args: ProfileArgs & { agent: string }) => {
      leadOnly();
      const id = planner.agentId(args.agent);
      if (!id) throw new Error(`No agent "${args.agent}". Team: ${hub.snap.config.team.map((a) => a.id).join(", ")}`);
      return changeProfile(id, args);
    }),
  );

  server.registerTool(
    "setup_project_room",
    {
      description:
        "Lead only. Give a project its own room in the office, for the project's non-AI workers (a mail fetcher, a writer on a local model, a sender…), and get what the project needs to report to it. Call it again to change the workers (it replaces the room). It returns the endpoint, the env var names, and a tiny client to copy into the project; have a worker add that client and the calls to the project's code (or do it from the task). The room token is NOT in this result and must never be written into code or committed: the project reads it from the HQ_ROOM_TOKEN env var, which the user sets (Settings → Team → Project room → copy), so ask the user for that with ask_user.",
      inputSchema: {
        name: z.string().describe("The project's name, shown on the room's sign"),
        workers: z
          .array(z.object({ id: z.string().optional(), name: z.string(), kind: z.enum(["fetcher", "writer", "sender", "custom"]).optional() }))
          .min(1)
          .describe("The project's workers. kind gives the desk its look: fetcher (gets data in), writer (produces text), sender (sends it out), custom"),
        client: z.enum(["python", "node", "http"]).optional().describe("Which client to return (default python). http returns curl examples instead of a file."),
      },
    },
    guard(({ name, workers, client }: { name: string; workers: { id?: string; name: string; kind?: "fetcher" | "writer" | "sender" | "custom" }[]; client?: "python" | "node" | "http" }) => {
      leadOnly();
      const api = hub.snap.roomApi;
      if (!api) throw new Error("The project-room API isn't running.");
      const room = cleanProjectRoom({ name, workers });
      if (!room?.workers.length) throw new Error("Give the room at least one worker.");
      setRoom(hub, room);
      const first = room.workers[0].id;
      const which = client ?? "python";
      const file = which === "node" ? "sdk/node/jsmhq-room.mjs" : "sdk/python/jsmhq_room.py";
      let source: string | undefined;
      if (which !== "http") {
        try {
          source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
        } catch {
          throw new Error(`The ${which} client file wasn't found in this HQ install; use client: "http".`);
        }
      }
      const sandbox = api.url.replace("127.0.0.1", "host.docker.internal");
      return ok({
        room,
        endpoint: api.url,
        endpointFromASandbox: sandbox,
        env: { HQ_ROOM_URL: api.url, HQ_ROOM_TOKEN: "<the user sets this; never commit it>" },
        calls: {
          "report work": `POST ${api.url}/room/event  { "worker": "${first}", "state": "working", "note": "Fetching 12 emails" }  (state: idle | working | error | done)`,
          "hand over": `POST ${api.url}/room/event  { "worker": "${first}", "handoff": { "to": "${room.workers[1]?.id ?? "out"}" } }  (to/from "in" and "out" are the room's trays)`,
          auth: "Authorization: Bearer $HQ_ROOM_TOKEN",
        },
        ...(source ? { copyThisFileInto: file.split("/").pop(), file: source } : {}),
        next: "You don't write code: create a task for a free worker (a builder) with create_task and assign_task, telling them to copy the client file into the project and add the calls where each step runs. Reports are fire-and-forget and never raise, so the project works with HQ off. Then ask the user (ask_user) to set HQ_ROOM_TOKEN in the project's env, naming it and not the value.",
      });
    }),
  );

  server.registerTool(
    "request_access",
    {
      description:
        "Your sandbox blocks most websites and APIs. When a request you need is blocked (docs or an API), ask the user to allow that domain. Pass the host (e.g. docs.example.com) and why you need it. The user answers in HQ; you'll get a message.",
      inputSchema: { domain: z.string(), reason: z.string() },
    },
    guard(({ domain, reason }: { domain: string; reason: string }) => ok(requestAccess(hub, me, domain, reason))),
  );

  server.registerTool(
    "send_message",
    {
      description: "Send a message to another agent (id, name, or \"lead\"). HQ delivers it: right away if they are idle, otherwise when their current turn ends.",
      inputSchema: { to: z.string(), text: z.string() },
    },
    guard(({ to, text }: { to: string; text: string }) => {
      const toId = planner.agentId(to);
      if (toId === me) throw new Error("That's you.");
      planner.message(me, to, text);
      return ok(`Sent to ${hub.name(toId)}.`);
    }),
  );

  return server;
}

/** Handles one MCP HTTP request for an already-authenticated agent. */
export async function handleMcp(hub: Hub, planner: Planner, agentId: string, req: IncomingMessage, res: ServerResponse, body: unknown, syncFiles: (agentId: string) => Promise<void> = async () => {}) {
  const server = buildServer(hub, planner, agentId, syncFiles);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
