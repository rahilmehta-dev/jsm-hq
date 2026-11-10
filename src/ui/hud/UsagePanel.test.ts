import { describe, expect, it } from "vitest";
import type { UsageSnapshot } from "../../data/types";
import { exhaustedAgentIds, formatTokens, levelOf, summarizeBattery } from "./usageLevel";

const base = { day: "2026-11-10", since: "2026-11-10T08:00:00.000Z", checkedAt: "2026-11-10T20:00:00.000Z", total: { tokens: 0, measured: 0, unmeasured: 0 } };
const provider = (remainingPercent: number | null) => ({ provider: "anthropic" as const, tokens: 0, unmeasured: 0, budget: 1000, remainingPercent, unlimited: false });
const agent = (agentId: string, remainingPercent: number | null) => ({
  agentId, provider: "anthropic" as const, source: "claude-transcripts" as const, tokens: null, unlimited: false, budget: 1000, remainingPercent, error: null,
});

describe("levelOf", () => {
  it("maps percentages to the calm levels", () => {
    expect(levelOf(100)).toBe("plenty");
    expect(levelOf(30)).toBe("plenty");
    expect(levelOf(29.9)).toBe("low");
    expect(levelOf(10)).toBe("low");
    expect(levelOf(9.9)).toBe("critical");
    expect(levelOf(0)).toBe("empty");
  });
  it("never turns unknown into a number", () => {
    expect(levelOf(null)).toBe("unknown");
  });
});

describe("summarizeBattery", () => {
  it("is unknown without usage or without any known percentage", () => {
    expect(summarizeBattery(undefined)).toEqual({ percent: null, level: "unknown" });
    expect(summarizeBattery({ ...base, agents: [], providers: [provider(null)] } as UsageSnapshot)).toEqual({ percent: null, level: "unknown" });
  });
  it("shows the tightest known budget and ignores unknown providers", () => {
    const usage = { ...base, agents: [], providers: [provider(72), { ...provider(null), provider: "google" as const }, { ...provider(18), provider: "openai" as const }] } as UsageSnapshot;
    expect(summarizeBattery(usage)).toEqual({ percent: 18, level: "low" });
  });
});

describe("exhaustedAgentIds", () => {
  it("lists only agents at 0%, not unknown ones", () => {
    const usage = { ...base, providers: [], agents: [agent("a", 0), agent("b", null), agent("c", 12)] } as UsageSnapshot;
    expect([...exhaustedAgentIds(usage)]).toEqual(["a"]);
  });
});

describe("formatTokens", () => {
  it("abbreviates", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(182_400)).toBe("182k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(12_000_000)).toBe("12M");
  });
});
