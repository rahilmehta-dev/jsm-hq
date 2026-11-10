import { useState } from "react";
import { nextAgentName } from "../../data/names";
import { CLI_LABEL, DEFAULT_OLLAMA_URL, supportsOllama, WORKER_KIND_LABEL, type AgentCli, type AgentConfig, type AgentMode, type ModelProvider, type ProjectRoomConfig, type ProjectWorkerKind } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { agentPalette } from "../../theme/tokens";
import { Field, Portrait, SectionTitle } from "../kit";
import { CommitInput } from "./controls";
import { RemoveAgentDialog } from "./RemoveAgentDialog";

export function CliSelect({ value, onChange }: { value: AgentCli; onChange: (v: AgentCli) => void }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value as AgentCli)} aria-label="Coding agent">
      {(Object.keys(CLI_LABEL) as AgentCli[]).map((c) => (
        <option key={c} value={c}>
          {CLI_LABEL[c]}
        </option>
      ))}
    </select>
  );
}
export const ROLE_SUGGESTIONS = ["Developer", "QA", "Designer", "Docs", "DevOps", "Security"];

export function TeamSettings() {
  const team = useOffice((s) => s.snap?.config.team);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AgentConfig | null>(null);
  if (!team) return null;
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>Team · {team.length} agents</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          Changes to model, mode or folder apply the next time the agent starts. One lead plans and assigns work. Every other agent gets its own desk, sandbox and (optionally) environment. The office grows as you add agents.
        </p>
        <div className="flex flex-col gap-2">
          {team.map((a) => (
            <AgentRow key={a.id} agent={a} expanded={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onRemove={() => setRemoving(a)} />
          ))}
        </div>
      </section>
      <AddAgent />
      <ProjectRoomSettings />
      {removing && <RemoveAgentDialog agent={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function AgentRow({ agent, expanded, onToggle, onRemove }: { agent: AgentConfig; expanded: boolean; onToggle: () => void; onRemove: () => void }) {
  const set = (patch: Parameters<typeof officeActions.updateAgent>[1]) => officeActions.updateAgent(agent.id, patch);
  const ollamaUrl = useOffice((s) => s.snap?.config.project.ollamaUrl);
  const onOllama = agent.provider === "ollama" && supportsOllama(agent.cli);
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="grid grid-cols-[40px_1fr_1fr_150px_130px_auto] items-end gap-2.5 p-2.5">
        <Portrait color={agent.color} lead={agent.isLead} />
        <Field label="Name">
          <CommitInput className="field" value={agent.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} />
        </Field>
        <Field label="Role">
          {agent.isLead ? (
            <div className="field flex h-9 items-center bg-cream-2">Lead</div>
          ) : (
            <CommitInput className="field" value={agent.role} list="role-suggestions" onCommit={(v) => v.trim() && set({ role: v.trim() })} />
          )}
        </Field>
        <Field label="Agent">
          <CliSelect value={agent.cli} onChange={(cli) => set({ cli })} />
        </Field>
        <Field label="Runs in">
          <select className="field" value={agent.mode} onChange={(e) => set({ mode: e.target.value as AgentMode })}>
            <option value="sandbox">Sandbox</option>
            <option value="local">Local</option>
          </select>
        </Field>
        <div className="flex gap-1.5">
          <button className="btn px-2 text-[13px]" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? "Less" : "More"}
          </button>
          {!agent.isLead && (
            <button
              className="btn px-2 text-[13px] text-red"
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {agent.mode === "local" && (
        <div className="border-t-2 border-dashed border-cream-3 px-3 py-1 text-[12px] text-muted">
          Local mode runs plain <code>{agent.cli}</code> in the agent's own folder. Permission prompts stay on.
        </div>
      )}
      {expanded && (
        <div className="grid grid-cols-2 gap-3 border-t border-line bg-cream p-3">
          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5">
              {agentPalette.map((c) => (
                <button
                  key={c}
                  className="h-6 w-6 rounded-full border border-line"
                  style={{ background: c, outline: c === agent.color ? "2px solid #1f2421" : undefined, outlineOffset: 1 }}
                  aria-label={`Colour ${c}`}
                  onClick={() => set({ color: c })}
                />
              ))}
            </div>
          </Field>
          {supportsOllama(agent.cli) && (
            <Field label="Model provider" hint={`${CLI_LABEL[agent.cli]}'s own account, or a model running on your machine (or another machine) with Ollama.`}>
              <select className="field" value={agent.provider ?? "default"} onChange={(e) => set({ provider: e.target.value as ModelProvider })}>
                <option value="default">{CLI_LABEL[agent.cli]} account</option>
                <option value="ollama">Ollama (local model)</option>
              </select>
            </Field>
          )}
          {onOllama && (
            <>
              <Field label="Ollama model" hint="Pull it first: ollama pull <model>. Tool-calling quality varies a lot between local models, and agents need tools. Use a model that lists tools, with a context window of 64k or more.">
                <CommitInput className="field" value={agent.ollamaModel ?? ""} placeholder="qwen3-coder" list="ollama-models" onCommit={(v) => set({ ollamaModel: v.trim() })} />
              </Field>
              <Field label="Ollama address (all agents)" hint="Where Ollama runs. Sandboxes reach http://localhost:11434 through host.docker.internal. Use another machine's address to run models on a LAN box.">
                <CommitInput className="field font-term text-[17px]" value={ollamaUrl ?? ""} placeholder={DEFAULT_OLLAMA_URL} onCommit={(v) => officeActions.updateProject({ ollamaUrl: v.trim() })} />
              </Field>
            </>
          )}
          {!onOllama && <Field label="Start with model" hint="Optional. Leave empty to use the CLI's default — you can always switch with /model in the terminal. Set it to keep a choice across restarts (e.g. Opus for the lead).">
            <CommitInput
              className="field"
              value={agent.model}
              placeholder={`${CLI_LABEL[agent.cli]} default`}
              list={`${agent.cli}-models`}
              onCommit={(v) => set({ model: v.trim() })}
            />
          </Field>}
          <Field label="Skills" hint="Comma separated. Copied into the agent's .claude/skills.">
            <CommitInput
              className="field"
              value={agent.skills.join(", ")}
              onCommit={(v) => set({ skills: v.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Folder" hint="Leave empty and HQ keeps its own clone of the repo for this agent. Or enter an existing git folder.">
              <CommitInput
                className="field font-term text-[17px]"
                value={agent.workspacePath ?? ""}
                placeholder={`HQ-managed: ~/.jsmhq/…/${agent.id}`}
                onCommit={(v) => set({ workspacePath: v.trim() || null })}
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="ROLE.md" hint="Who this agent is. HQ adds the team, rules and tools, writes it to .jsmhq-role.md in the agent's folder (never committed) and loads it when the session starts. A ROLE.md the folder already has is included too, never overwritten.">
              <CommitInput multiline className="field h-[120px] resize-y font-term text-[17px] leading-tight" value={agent.roleMd} onCommit={(v) => set({ roleMd: v })} />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

/** The project room: a separate room in the office for the project's own workers (scripts, bots, a model), not coding agents. */
function ProjectRoomSettings() {
  const room = useOffice((s) => s.snap?.config.projectRoom);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectWorkerKind>("fetcher");
  const workers = room?.workers ?? [];
  const api = useOffice((s) => s.snap?.roomApi);
  const [shown, setShown] = useState(false);
  const save = (next: ProjectRoomConfig | null) => officeActions.setProjectRoom(next);
  const rename = (v: string) => save({ name: v.trim() || "Project room", workers });
  const change = (i: number, patch: Partial<ProjectRoomConfig["workers"][number]>) => save({ name: room?.name ?? "Project room", workers: workers.map((w, k) => (k === i ? { ...w, ...patch } : w)) });
  const add = () => {
    const label = name.trim() || WORKER_KIND_LABEL[kind].split(" ")[0];
    save({ name: room?.name ?? "Project room", workers: [...workers, { id: "", name: label, kind, color: agentPalette[(workers.length + 3) % agentPalette.length] }] });
    setName("");
  };
  return (
    <section className="rounded-xl border border-dashed border-line p-3">
      <SectionTitle>Project room</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">
        A separate room in the office for your project's own workers: a script that fetches emails, a local model that writes them, a bot that sends them. They aren't coding agents. A project reports what they do through a local API (see Connect a project below); until then they play a demo animation.
      </p>
      <div className="mb-3 max-w-[360px]">
        <Field label="Room name">
          <CommitInput className="field" value={room?.name ?? ""} placeholder="Job referrals" onCommit={rename} />
        </Field>
      </div>
      {workers.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {workers.map((w, i) => (
            <div key={`${w.id}-${i}`} className="grid grid-cols-[28px_1fr_220px_auto] items-center gap-2.5 rounded-xl border border-line bg-white p-2">
              <span className="h-5 w-5 rounded-full border border-line" style={{ background: w.color }} aria-hidden />
              <CommitInput className="field" value={w.name} onCommit={(v) => v.trim() && change(i, { name: v.trim() })} />
              <select className="field" value={w.kind} aria-label="What it does" onChange={(e) => change(i, { kind: e.target.value as ProjectWorkerKind })}>
                {(Object.keys(WORKER_KIND_LABEL) as ProjectWorkerKind[]).map((k) => (
                  <option key={k} value={k}>
                    {WORKER_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <button className="btn px-2 text-[13px] text-red" onClick={() => save({ name: room?.name ?? "Project room", workers: workers.filter((_, k) => k !== i) })}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="grid grid-cols-[1fr_220px_auto] items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Worker name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mailbot" />
        </Field>
        <Field label="What it does">
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as ProjectWorkerKind)}>
            {(Object.keys(WORKER_KIND_LABEL) as ProjectWorkerKind[]).map((k) => (
              <option key={k} value={k}>
                {WORKER_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn" type="submit">
          Add worker
        </button>
      </form>
      {workers.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={room?.demo !== false} onChange={(e) => save({ name: room?.name ?? "Project room", workers, ...(e.target.checked ? {} : { demo: false }) })} />
          Play the demo animation until a project connects
        </label>
      )}
      <div className="mt-3 rounded-xl border border-line bg-cream p-3">
        <div className="mb-1 text-[13px] font-bold">Connect a project</div>
        <p className="mb-2 text-[12px] text-muted">
          Any project can create this room and show what its workers do, through a small local HTTP API. Set these two variables in the project, then use the Python or Node helper in <code>sdk/</code> (see <code>docs/project-rooms.md</code>).
        </p>
        {api ? (
          <>
            <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-white p-2 font-term text-[15px]">{`export HQ_ROOM_URL=${api.url}\nexport HQ_ROOM_TOKEN=${shown ? api.token : "•".repeat(16)}`}</pre>
            <div className="flex gap-2">
              <button className="btn px-2 text-[13px]" onClick={() => setShown(!shown)}>
                {shown ? "Hide token" : "Show token"}
              </button>
              <button className="btn px-2 text-[13px]" onClick={() => void navigator.clipboard?.writeText(`export HQ_ROOM_URL=${api.url}\nexport HQ_ROOM_TOKEN=${api.token}`)}>
                Copy
              </button>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-muted">Available when you run My HQ on a repo (not in the demo).</p>
        )}
      </div>
      {workers.length > 0 && (
        <p className="mt-2 text-[12px] text-muted">
          Removing every worker removes the room.{" "}
          <button className="underline" onClick={() => save(null)}>
            Remove the room
          </button>
        </p>
      )}
    </section>
  );
}

function AddAgent() {
  const [name, setName] = useState("");
  const [role, setRole] = useState("Developer");
  const [cli, setCli] = useState<AgentCli>("claude");
  const [mode, setMode] = useState<AgentMode>("sandbox");
  const team = useOffice((s) => s.snap?.config.team) ?? [];
  const suggested = nextAgentName(team.map((a) => a.name));
  const add = () => {
    officeActions.addAgent({ name: name.trim() || suggested, role, cli, mode });
    setName("");
  };
  return (
    <section className="rounded-xl border border-dashed border-line p-3">
      <SectionTitle>Add an agent</SectionTitle>
      <form
        className="grid grid-cols-[1fr_1fr_150px_130px_auto] items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} />
        </Field>
        <Field label="Role">
          <input className="field" value={role} list="role-suggestions" onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="Agent">
          <CliSelect value={cli} onChange={setCli} />
        </Field>
        <Field label="Runs in">
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value as AgentMode)}>
            <option value="sandbox">Sandbox</option>
            <option value="local">Local</option>
          </select>
        </Field>
        <button className="btn" type="submit">
          Add
        </button>
      </form>
      <p className="mt-2 text-[12px] text-muted">
        HQ starts a new sandbox with the lead's network policy and allows it to reach HQ at host.docker.internal.
      </p>
      <datalist id="codex-models">
        <option value="gpt-5.6-sol" />
      </datalist>
      <datalist id="ollama-models">
        <option value="qwen3-coder" />
        <option value="gpt-oss:20b" />
      </datalist>
      <datalist id="gemini-models">
        <option value="gemini-2.5-pro" />
        <option value="gemini-2.5-flash" />
      </datalist>
      <datalist id="claude-models">
        <option value="opus" />
        <option value="sonnet" />
        <option value="haiku" />
      </datalist>
      <datalist id="role-suggestions">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </section>
  );
}
