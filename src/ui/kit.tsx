// Small shared HUD pieces.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentState, ReviewState } from "../data/types";
import { robotCanvases } from "../office/draw/robots";
import { mergedChip, reviewChip, stateChip } from "../theme/tokens";

export function StateChip({ state, blink = true }: { state: AgentState; blink?: boolean }) {
  const st = stateChip[state];
  return (
    <span className={`chip chip-dot ${blink && state === "needs-input" ? "blink" : ""}`} style={{ ["--c" as string]: st.fill, ["--m" as string]: st.mark }}>
      {st.label}
    </span>
  );
}

export function ReviewChip({ review, merged }: { review: ReviewState; merged?: boolean }) {
  const st = merged ? mergedChip : reviewChip[review];
  return (
    <span className="chip chip-dot" style={{ ["--c" as string]: st.fill, ["--m" as string]: st.mark }}>
      {st.label}
    </span>
  );
}

/** Classic Mac window title bar: pinstripes, optional close box on the left, title plate in the middle. */
export function TitleBar({ title, onClose, right }: { title: ReactNode; onClose?: () => void; right?: ReactNode }) {
  return (
    <div className="titlebar">
      {onClose ? <button className="titlebar-box" aria-label="Close" onClick={onClose} /> : <span className="titlebar-spacer" />}
      <span className="titlebar-title">{title}</span>
      {right ?? <span className="titlebar-spacer" />}
    </div>
  );
}

/** Pixel robot portrait drawn from the same sprite as the office. */
export function Portrait({ color, lead, size = 40 }: { color: string; lead: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const src = robotCanvases(color, lead).front;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 16, 16);
    g.drawImage(src, 2, 1);
  }, [color, lead]);
  return (
    <canvas
      ref={ref}
      width={16}
      height={16}
      className="shrink-0 border border-ink bg-platinum"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <i className="inline-block shrink-0 border border-ink" style={{ width: size, height: size, background: color }} />;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 border-b border-ink pb-1 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-2">{children}</h3>;
}

/** One-line empty state: short sentence, no icons. */
export function Empty({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[13px] text-ink-2 ${className}`}>{children}</p>;
}

/** Busy: a label over a flat striped bar. */
export function Busy({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">{children}</span>
      <div className="progress" aria-hidden>
        <i />
      </div>
    </div>
  );
}

/** A plain, original 16px "something went wrong" face: square, two x eyes, a flat frown. */
export function ErrorFace({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="14" height="14" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M4 5l2 2M6 5l-2 2M10 5l2 2M12 5l-2 2" stroke="#000" strokeWidth="1" />
      <path d="M5 12h6M4 11v1M11 11v1" stroke="#000" strokeWidth="1" fill="none" />
    </svg>
  );
}

/** Gentle error callout: face, bold title, one or two plain lines. */
export function ErrorNote({ title, children, role = "alert" }: { title: ReactNode; children?: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className="callout">
      <ErrorFace />
      <div className="min-w-0 text-[13px] leading-snug">
        <b className="block text-[14px]">{title}</b>
        {children}
      </div>
    </div>
  );
}

/** Classic group box: a fieldset whose legend breaks the 1px top rule. */
export function GroupBox({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`group ${className}`}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[14px] font-semibold">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} aria-pressed={value === t.id} className="btn text-[14px]" onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
