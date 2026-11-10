// Battery-style model usage: a top-bar gauge of what's left of today's token budget, and a small panel with each agent's numbers.
// Numbers are never invented: no budget, local models and CLIs HQ can't measure show a dash, not a guess.

import { useEffect, useRef, useState } from "react";
import { USAGE_PROVIDER_LABEL, type AgentUsage, type UsageSnapshot } from "../../data/types";
import { formatTokens, levelOf, summarizeBattery, type Battery, type BatteryLevel } from "./usageLevel";
import { useOffice } from "../../store/office";

const LEVEL_TEXT: Record<BatteryLevel, string> = { plenty: "Plenty left", low: "Running low", critical: "Almost out", empty: "Empty: charging", unknown: "Not measured" };
// Marks (never text on light surfaces): calm green, muted amber, muted red, gray.
const LEVEL_MARK: Record<BatteryLevel, string> = { plenty: "#1d7a3a", low: "#946000", critical: "#b3261e", empty: "#b3261e", unknown: "#5c5c5c" };

/** 28×14 battery. The fill is proportional; low levels also get a dither so state never rests on colour alone. */
function BatteryIcon({ percent, level }: Battery) {
  const w = percent === null ? 0 : Math.max(percent > 0 ? 1 : 0, Math.round((percent / 100) * 22));
  return (
    <svg width="30" height="14" viewBox="0 0 30 14" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      <defs>
        <pattern id="batt-dither" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#fff" />
          <rect x="1" y="1" width="1" height="1" fill="#fff" />
        </pattern>
      </defs>
      <rect x="0.5" y="0.5" width="26" height="13" fill="#fff" stroke="#000" />
      <rect x="27" y="4" width="2" height="6" fill="#000" />
      {percent !== null && w > 0 && <rect x="2" y="2" width={w} height="10" fill={LEVEL_MARK[level]} />}
      {(level === "low" || level === "critical") && w > 0 && <rect x="2" y="2" width={w} height="10" fill="url(#batt-dither)" />}
      {percent === null && <rect x="9" y="6.5" width="10" height="1" fill="#000" />}
    </svg>
  );
}

function resetText(a: AgentUsage, usage: UsageSnapshot): string {
  const limit = a.rateLimits?.find((r) => r.resetsAt);
  if (limit?.resetsAt) return `resets ${new Date(limit.resetsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  const midnight = new Date(new Date(usage.since).getTime() + 24 * 3600_000);
  return `resets ${midnight.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

const SOURCE_TEXT: Record<AgentUsage["source"], string> = { "claude-transcripts": "Claude transcripts", "codex-sessions": "Codex sessions", none: "no usage source" };

function Row({ a, name, usage }: { a: AgentUsage; name: string; usage: UsageSnapshot }) {
  const lvl = levelOf(a.remainingPercent);
  let main: string;
  if (a.unlimited) main = a.tokens ? `${formatTokens(a.tokens.total)} tokens · unlimited` : "unlimited";
  else if (!a.tokens) main = "Not measurable";
  else if (a.budget) main = `${formatTokens(a.tokens.total)} / ${formatTokens(a.budget)}`;
  else main = `${formatTokens(a.tokens.total)} tokens · no budget set`;
  return (
    <li className="border-b border-ink px-3 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <b className="text-[14px]">{name}</b>
        <span className="text-[12px] text-ink-2">{USAGE_PROVIDER_LABEL[a.provider].split(" (")[0]}</span>
        <span className="ml-auto text-[13px] font-semibold">{a.remainingPercent === null ? "—" : `${Math.round(a.remainingPercent)}%`}</span>
      </div>
      <div className="text-[13px]">{main}</div>
      <div className="text-[12px] text-ink-2">
        {SOURCE_TEXT[a.source]}
        {!a.unlimited && a.budget ? ` · ${resetText(a, usage)}` : ""}
        {a.remainingPercent !== null ? ` · ${LEVEL_TEXT[lvl]}` : ""}
      </div>
      {a.error && <div className="text-[12px] text-ink-2">Last read failed: counts may be out of date.</div>}
    </li>
  );
}

/** Top-bar battery; click for the per-agent breakdown. */
export function UsageBattery() {
  const usage = useOffice((s) => s.snap?.usage);
  const team = useOffice((s) => s.snap?.config.team);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!usage) return null;
  const b = summarizeBattery(usage);
  const label = b.percent === null ? "Usage not measured" : `${Math.round(b.percent)}% of today's budget left: ${LEVEL_TEXT[b.level]}`;
  const nameOf = (id: string) => team?.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="relative" ref={ref}>
      <button className="menu-item flex items-center gap-2" aria-haspopup="dialog" aria-expanded={open} aria-pressed={open} aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>
        <BatteryIcon {...b} />
        <span className="min-w-[2.5ch] text-[13px] font-semibold tabular-nums">{b.percent === null ? "—" : `${Math.round(b.percent)}%`}</span>
      </button>
      {open && (
        <div className="menu-pop w-[340px] !p-0" role="dialog" aria-label="Model usage today">
          <div className="border-b border-ink bg-platinum px-3 py-2">
            <b className="text-[13px]">Model usage today</b>
            <div className="text-[12px] text-ink-2">{b.percent === null ? "Set a daily token budget in Settings → Project to see a battery." : `${LEVEL_TEXT[b.level]} on the tightest budget.`}</div>
          </div>
          <ul className="m-0 max-h-[360px] list-none overflow-y-auto p-0">
            {usage.agents.map((a) => (
              <Row key={a.agentId} a={a} name={nameOf(a.agentId)} usage={usage} />
            ))}
          </ul>
          <div className="border-t border-ink bg-platinum px-3 py-1 text-[12px] text-ink-2">Counted on this machine from each CLI's own files. Never sent anywhere.</div>
        </div>
      )}
    </div>
  );
}
