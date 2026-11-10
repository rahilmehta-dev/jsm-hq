// Pure battery logic for the usage gauge (kept free of UI and stores so it is easy to test).

import type { UsageSnapshot } from "../../data/types";

export type BatteryLevel = "plenty" | "low" | "critical" | "empty" | "unknown";

export interface Battery {
  /** What's left, 0–100, of the tightest known budget. null = unknown. */
  percent: number | null;
  level: BatteryLevel;
}

export function levelOf(percent: number | null): BatteryLevel {
  if (percent === null) return "unknown";
  if (percent <= 0) return "empty";
  if (percent < 10) return "critical";
  if (percent < 30) return "low";
  return "plenty";
}

/** The team's battery is its tightest known budget: the lowest percentage left on any provider. */
export function summarizeBattery(usage: UsageSnapshot | undefined): Battery {
  const known = (usage?.providers ?? []).map((p) => p.remainingPercent).filter((v): v is number => v !== null);
  const percent = known.length ? Math.min(...known) : null;
  return { percent, level: levelOf(percent) };
}

/** Agents whose provider budget is spent (0% left): they rest in the lounge until it resets. */
export function exhaustedAgentIds(usage: UsageSnapshot | undefined): Set<string> {
  return new Set((usage?.agents ?? []).filter((a) => a.remainingPercent !== null && a.remainingPercent <= 0).map((a) => a.agentId));
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
