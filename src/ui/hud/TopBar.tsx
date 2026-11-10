import { useEffect, useRef, useState } from "react";
import type { SimSpeed } from "../../data/source";
import { officeActions, selectAttention, useOffice } from "../../store/office";
import { ui, useUi } from "../../store/ui";

const SPEEDS: SimSpeed[] = [1, 2, 4];

/** Flat, monochrome Happy-Mac face. */
function Logo() {
  return (
    <svg className="h-[20px] w-[20px] shrink-0" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      <rect x="1" y="0" width="10" height="11" fill="#000" />
      <rect x="2" y="1" width="8" height="6" fill="#fff" />
      <rect x="4" y="2" width="1" height="2" fill="#000" />
      <rect x="7" y="2" width="1" height="2" fill="#000" />
      <rect x="4" y="5" width="1" height="1" fill="#000" />
      <rect x="5" y="6" width="2" height="1" fill="#000" />
      <rect x="7" y="5" width="1" height="1" fill="#000" />
      <rect x="3" y="8" width="6" height="1" fill="#fff" />
    </svg>
  );
}

export function TopBar() {
  const snap = useOffice((s) => s.snap);
  const speed = useOffice((s) => s.speed);
  const hasDev = useOffice((s) => s.presets !== null);
  const planBoardId = useUi((s) => s.planBoardId);
  const attention = selectAttention(snap).total;
  const debugOpen = useUi((s) => s.debugOpen);
  const live = useOffice((s) => s.live);
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewOpen) return;
    const away = (e: MouseEvent) => viewRef.current && !viewRef.current.contains(e.target as Node) && setViewOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setViewOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [viewOpen]);
  if (!snap) return null;
  const setupIssues = snap.setup.checks.filter((c) => c.status !== "ok").length;
  const stopped = snap.agents.filter((a) => a.session.state === "stopped" || a.session.state === "failed");

  // Live: count real running sessions. Mock: every agent counts as running.
  const runningIds = new Set(snap.agents.filter((a) => a.session.state === "running").map((a) => a.agentId));
  const sandboxes = snap.config.team.filter((a) => a.mode === "sandbox" && runningIds.has(a.id)).length;
  const local = snap.config.team.filter((a) => a.mode === "local" && runningIds.has(a.id)).length;
  const boards = [...snap.boards].sort((a, b) => a.order - b.order);
  const active = boards.filter((b) => b.status === "active");
  const openPrs = snap.pullRequests.filter((p) => !p.merged && !p.closed).length;

  return (
    <header className="menubar fixed left-0 right-0 top-0 z-10 flex h-[28px] items-center gap-3 px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo />
        <b className="whitespace-nowrap text-[14px] font-bold">My HQ</b>
        {!live && (
          <span className="chip shrink-0 text-[12px]" style={{ ["--c" as string]: "#f5e2b8" }} title="Running on mock data. Start the real HQ with `pnpm dev:hq`.">
            Demo data
          </span>
        )}
        <span className="truncate text-[13px] text-muted">
          — <em className="font-semibold not-italic text-ink">{snap.config.project.name}</em>{" "}
          <span className="font-term text-[12px]">{snap.config.project.repo}</span>
        </span>
      </div>
      <div className="flex-1" />

      <div
        className="flex items-center gap-2 whitespace-nowrap border border-ink bg-cream-2 px-2 py-0 text-[12px] text-ink"
        title="Each agent runs in its own isolated Docker Sandbox (microVM)"
      >
        <span>
          Sandbox · <b>{sandboxes}</b> running{local ? ` · ${local} local` : ""}
        </span>
        <i className="led" style={runningIds.size ? undefined : { background: "#fff", animation: "none" }} />
      </div>

      {live && stopped.length > 0 && (
        <button className="menu-item" onClick={() => stopped.forEach((a) => officeActions.startAgent(a.agentId))}>
          Start {stopped.length === snap.agents.length ? "team" : `${stopped.length} stopped`}
        </button>
      )}
      {live && (
        <button className="menu-item" onClick={() => ui.openSetup()} title="Setup checklist">
          Setup{setupIssues ? ` · ${setupIssues}` : " ✓"}
        </button>
      )}
      <div className="flex gap-1.5">
        <button
          className="menu-item"
          style={attention ? { background: "#f5e2b8", color: "#000" } : undefined}
          onClick={() => ui.openActions()}
          title="Everything waiting on you"
        >
          Action items{attention ? ` · ${attention}` : ""}
        </button>
        <button className="menu-item" onClick={() => ui.openBoards(planBoardId ?? undefined)}>
          Boards
        </button>
        <button className="menu-item" onClick={() => ui.openPrs()}>
          PRs{openPrs ? ` · ${openPrs}` : ""}
        </button>
        <button className="menu-item" onClick={() => ui.openTerminal()} title="Your own shell on this machine: the repo, an agent's folder or any folder">
          Terminal
        </button>
      </div>
      <button className="menu-item" onClick={() => ui.openSettings("team")}>
        Settings
      </button>
      <div className="relative" ref={viewRef}>
        <button className="menu-item" aria-haspopup="menu" aria-expanded={viewOpen} aria-pressed={viewOpen} onClick={() => setViewOpen((v) => !v)}>
          View ▾
        </button>
        {viewOpen && (
          <div className="menu-pop flex flex-col gap-3 text-[13px]" role="menu" aria-label="View">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Plan wall</span>
              <select className="field !h-[28px] py-0 text-[13px]" value={planBoardId ?? ""} onChange={(e) => ui.showBoardOnWall(e.target.value || null)} aria-label="Board shown on the plan wall">
                <option value="">First active ({active[0]?.title ?? "none"})</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} · {b.status}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Zoom</span>
              <span className="flex gap-1.5">
                <button className="btn !w-8 !px-0 text-[16px] leading-none" aria-label="Zoom out" onClick={() => ui.zoom(-1)}>
                  −
                </button>
                <button className="btn !w-8 !px-0 text-[16px] leading-none" aria-label="Zoom in" onClick={() => ui.zoom(1)}>
                  +
                </button>
              </span>
            </div>
            {hasDev && (
              <div className="flex items-center justify-between gap-2" role="group" aria-label="Simulation speed">
                <span className="font-semibold">Speed</span>
                <span className="flex gap-1.5">
                  {SPEEDS.map((sp) => (
                    <button key={sp} className="btn !px-2" aria-pressed={speed === sp} onClick={() => officeActions.setSpeed(sp)}>
                      {sp}x
                    </button>
                  ))}
                </span>
              </div>
            )}
            <button className="btn" aria-pressed={debugOpen} onClick={() => ui.toggleDebug()} title="Debug panel (D)">
              Debug panel
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
