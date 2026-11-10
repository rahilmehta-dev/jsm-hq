import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { DRAWER_DEFAULT, ui, useUi } from "../../store/ui";
import { TitleBar } from "../kit";
import { AgentDrawer } from "./AgentDrawer";
import { BoardsDrawer } from "./BoardsDrawer";
import { EnvironmentDrawer } from "./EnvironmentDrawer";
import { PrDrawer } from "./PrDrawer";
import { ActionItemsDrawer } from "./ActionItemsDrawer";
import { TerminalDrawer } from "./TerminalDrawer";

/** The classic zoom-box rule: a 1px outline that grows from the top-right corner as the window opens. */
function ZoomRule() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 border border-ink"
      style={{ transformOrigin: "top right" }}
      initial={{ scale: 0.3, opacity: 1 }}
      animate={{ scale: 1, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    />
  );
}

const DEFAULT_TITLE = { prs: "Pull requests", actions: "Action items", boards: "Boards", terminal: "Terminal", env: "Environment", agent: "Agent" } as const;

/** Title bar (close box left, zoom box right) over an optional sub-header row for the drawer's own summary. */
export function DrawerHeader({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  const kind = useUi((s) => s.drawer?.kind);
  return (
    <div className="shrink-0">
      <TitleBar title={title ?? (kind ? DEFAULT_TITLE[kind] : "")} onClose={() => ui.closeDrawer()} right={<MaximizeButton />} />
      {children && <div className="flex items-center gap-2.5 border-b border-ink px-3 py-2">{children}</div>}
    </div>
  );
}

function MaximizeButton() {
  const max = useUi((s) => s.drawerMaximized);
  const label = max ? "Restore size" : "Maximize";
  return (
    <button className="titlebar-box" aria-label={label} title={label} aria-pressed={max} onClick={() => ui.toggleDrawerMaximized()}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
        {max ? <rect x="2" y="2" width="4" height="4" /> : <rect x="0.5" y="0.5" width="7" height="7" />}
      </svg>
    </button>
  );
}

/**
 * The drawer's left edge: drag to resize (the width is remembered in this browser), double-click
 * for the default width. Pointer capture keeps the drag going over the terminal's canvas.
 */
function ResizeHandle() {
  const start = useRef<{ x: number; width: number } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const aside = e.currentTarget.parentElement;
    if (!aside) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: aside.getBoundingClientRect().width };
    document.body.style.userSelect = "none";
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) ui.setDrawerWidth(start.current.width + (start.current.x - e.clientX));
  };
  const up = () => {
    start.current = null;
    document.body.style.userSelect = "";
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      title="Drag to resize. Double-click to reset."
      className="group absolute -left-[9px] top-0 z-10 flex h-full w-[12px] cursor-col-resize justify-center"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => ui.setDrawerWidth(DRAWER_DEFAULT)}
    >
      <div className="my-auto h-12 w-[4px] bg-ink opacity-0 transition-opacity group-hover:opacity-60" />
    </div>
  );
}

export function DrawerHost() {
  const drawer = useUi((s) => s.drawer);
  const reduce = useReducedMotion();
  const width = useUi((s) => s.drawerWidth);
  const maximized = useUi((s) => s.drawerMaximized);
  const key = drawer ? (drawer.kind === "agent" ? `agent:${drawer.id}` : drawer.kind === "env" ? `env:${drawer.name}` : drawer.kind) : null;

  // The task board needs room for its columns: it opens as a large centered modal, not a side drawer.
  if (drawer?.kind === "boards")
    return (
      <div
        className="fixed inset-0 z-30 grid place-items-center backdrop p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Boards"
        onMouseDown={(e) => e.target === e.currentTarget && ui.closeDrawer()}
      >
        <motion.div
          initial={reduce ? false : { y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="panel flex h-[90vh] w-[90vw] flex-col"
        >
          <BoardsDrawer initialBoardId={drawer.boardId} />
        </motion.div>
      </div>
    );

  return (
    <AnimatePresence mode="wait">
      {drawer && (
        <motion.aside
          key={key}
          initial={reduce ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
          className={`panel fixed bottom-4 right-4 top-[44px] z-20 flex flex-col ${maximized ? "left-4" : ""}`}
          style={maximized ? { transformOrigin: "top right" } : { transformOrigin: "top right", width: `min(${width}px, calc(100vw - 32px))` }}
          aria-label="Details"
        >
          {!reduce && <ZoomRule />}
          {!maximized && <ResizeHandle />}
          {drawer.kind === "agent" && <AgentDrawer id={drawer.id} initialTab={drawer.tab} />}
          {drawer.kind === "prs" && <PrDrawer />}
          {drawer.kind === "actions" && <ActionItemsDrawer />}
          {drawer.kind === "env" && <EnvironmentDrawer name={drawer.name} />}
          {drawer.kind === "terminal" && <TerminalDrawer />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
