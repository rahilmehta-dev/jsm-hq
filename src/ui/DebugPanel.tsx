import { useState } from "react";
import type { OfficeEvent } from "../data/source";
import { projectRoomsOf, roomWorkerKey } from "../data/types";
import { officeActions, useOffice } from "../store/office";
import { ui, useUi } from "../store/ui";

function JsonNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  if (value === null || typeof value !== "object") {
    const color = typeof value === "string" ? "#6cf08a" : typeof value === "number" ? "#ffc14d" : "#ff77a8";
    return (
      <div className="truncate pl-3">
        <span className="text-[#9aa6d1]">{name}: </span>
        <span style={{ color }}>{JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  return (
    <details open={depth < 1} className="pl-3">
      <summary className="cursor-pointer text-[#dfe6ff]">
        {name} <span className="text-[#9aa6d1]">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </summary>
      {entries.map(([k, v]) => (
        <JsonNode key={k} name={k} value={v} depth={depth + 1} />
      ))}
    </details>
  );
}

function summary(e: OfficeEvent): string {
  switch (e.type) {
    case "snapshot": return "full snapshot";
    case "workspace.info": return `${e.info.agentId} ${e.info.path}`;
    case "sbx.updated": return `base ${e.sbx.basePolicy}, ${Object.keys(e.sbx.agents).length} sandboxes`;
    case "setup.updated": return `sandbox ${e.setup.sandboxReady ? "ready" : "not ready"}`;
    case "config.updated": return `team ${e.config.team.length}`;
    case "agent.updated": return `${e.agent.agentId} → ${e.agent.state}`;
    case "agent.removed": return e.agentId;
    case "board.updated": return `${e.board.id} ${e.board.status}`;
    case "task.updated": return `${e.task.id} ${e.task.status}`;
    case "task.removed": return e.taskId;
    case "pr.updated": return `#${e.pr.number} ${e.pr.merged ? "merged" : e.pr.review}`;
    case "env.updated": return `${e.env.name} ${e.env.status}`;
    case "env.removed": return e.name;
    case "message": return `${e.message.fromId} → ${e.message.toId}`;
    case "activity": return e.event.text;
    case "terminal.output": return `${e.agentId} +${e.data.length}`;
    case "action.updated": return `${e.item.fromId} ${e.item.status}: ${e.item.title}`;
    case "mcp.updated": return `${e.mcp.servers.length} MCP servers`;
    case "access.updated": return `${e.request.agentId} ${e.request.domain} ${e.request.status}`;
    case "room.worker": return `${e.workerId} ${e.status.state}${e.status.note ? `: ${e.status.note}` : ""}`;
    case "room.handoff": return `${e.handoff.from ?? "in"} → ${e.handoff.to ?? "out"}`;
    case "usage.updated": return `${e.usage.total.tokens} tokens today (${e.usage.total.unmeasured} unmeasured)`;
  }
}

/** Every project room: its workers' latest reports (key, state, note, age, ttl) and the recent hand-offs. */
function Rooms({ snap }: { snap: import("../data/types").OfficeSnapshot }) {
  const rooms = projectRoomsOf(snap.config);
  const scoped = rooms.length > 1;
  if (!rooms.length) return <div className="text-[#9aa6d1]">No project rooms.</div>;
  return (
    <>
      {rooms.map((r) => (
        <div key={r.id} className="mb-2">
          <div className="text-[#dfe6ff]">
            {r.name} <span className="text-[#9aa6d1]">#{r.id} · demo {r.demo === false ? "off" : "on"}</span>
          </div>
          {r.workers.map((w) => {
            const key = roomWorkerKey(r.id, w.id, scoped);
            const st = snap.roomWorkers?.[key];
            const age = st ? Math.max(0, Math.round((Date.now() - Date.parse(st.at)) / 1000)) : null;
            return (
              <div key={key} className="truncate pl-3">
                <span className="text-[#9aa6d1]">{key}</span>{" "}
                {st ? (
                  <span className={age !== null && age > st.ttl ? "text-[#9aa6d1]" : "text-yellow"}>
                    {st.state}
                    {st.note ? `: ${st.note}` : ""} · {age}s ago · ttl {st.ttl}s{age !== null && age > st.ttl ? " (expired)" : ""}
                  </span>
                ) : (
                  <span className="text-[#9aa6d1]">no report</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className="text-[#9aa6d1]">Recent hand-offs</div>
      {(snap.roomHandoffs ?? []).slice(0, 8).map((h) => (
        <div key={h.id} className="truncate pl-3 text-[#dfe6ff]">
          {h.from ?? "in-tray"} → {h.to ?? "out-tray"}
        </div>
      ))}
      {!snap.roomHandoffs?.length && <div className="pl-3 text-[#9aa6d1]">none yet</div>}
    </>
  );
}

export function DebugPanel() {
  const open = useUi((s) => s.debugOpen);
  const snap = useOffice((s) => s.snap);
  const events = useOffice((s) => s.events);
  const chunks = useOffice((s) => s.terminalChunks);
  const presets = useOffice((s) => s.presets);
  const [tab, setTab] = useState<"events" | "rooms" | "snapshot">("events");
  if (!open) return null;

  return (
    <section aria-label="Debug" className="panel-dark fixed bottom-4 left-[312px] z-30 flex h-[360px] w-[560px] flex-col font-term text-[16px] leading-tight">
      <div className="flex items-center gap-2 border-b border-white/15 px-3 py-2 font-ui text-[13px]">
        <b className="uppercase tracking-[0.12em]">Debug</b>
        {(["events", "rooms", "snapshot"] as const).map((t) => (
          <button key={t} className="btn px-2 text-[12px] text-ink" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        {presets && (
          <select
            className="field ml-auto w-[190px] py-0 text-[12px] text-ink"
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              ui.closeDrawer();
              officeActions.loadPreset(e.target.value);
              e.target.value = "";
            }}
            aria-label="Load mock preset"
          >
            <option value="">Load preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {presets && (
          <button className="btn px-2 text-[12px] text-ink" onClick={() => officeActions.simulateAccessRequest()} title="A random worker asks for a blocked domain">
            Access request
          </button>
        )}
        <button className="btn px-2 text-[12px] text-ink" aria-label="Close debug" onClick={() => ui.toggleDebug()}>
          ✕
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-2">
        {tab === "events" ? (
          <>
            <div className="mb-1 text-[#9aa6d1]">Last 20 events · {chunks} terminal chunks streamed</div>
            <ul>
              {events.map((x) => (
                <li key={x.n} className="truncate">
                  <span className="text-[#9aa6d1]">{new Date(x.at).toLocaleTimeString()} </span>
                  <span className="text-yellow">{x.event.type}</span> <span className="text-[#dfe6ff]">{summary(x.event)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : tab === "rooms" ? (
          snap && <Rooms snap={snap} />
        ) : (
          snap && <JsonNode name="OfficeSnapshot" value={snap} depth={0} />
        )}
      </div>
    </section>
  );
}
