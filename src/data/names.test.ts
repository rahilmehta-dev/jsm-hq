import { describe, expect, it } from "vitest";
import { WORKER_NAMES, nextAgentName } from "./names";

describe("nextAgentName", () => {
  it("picks the first default name when none are taken", () => {
    expect(nextAgentName([])).toBe(WORKER_NAMES[0]);
  });

  it("skips names already used", () => {
    expect(nextAgentName([WORKER_NAMES[0]])).toBe(WORKER_NAMES[1]);
    expect(nextAgentName([WORKER_NAMES[0], WORKER_NAMES[1]])).toBe(WORKER_NAMES[2]);
  });

  it("fills a gap rather than taking the next after the last used", () => {
    expect(nextAgentName([WORKER_NAMES[1]])).toBe(WORKER_NAMES[0]);
  });

  it("ignores case and surrounding whitespace when matching", () => {
    expect(nextAgentName([` ${WORKER_NAMES[0].toUpperCase()} `])).toBe(WORKER_NAMES[1]);
  });

  it("ignores taken names that aren't defaults", () => {
    expect(nextAgentName(["Michael", "Someone"])).toBe(WORKER_NAMES[0]);
  });

  it("falls back to a numbered name when every default is used", () => {
    expect(nextAgentName([...WORKER_NAMES])).toBe(`Agent ${WORKER_NAMES.length + 1}`);
  });
});
