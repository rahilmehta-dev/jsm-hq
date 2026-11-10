import { describe, expect, it } from "vitest";
import { sandboxList } from "./json";

describe("sandboxList", () => {
  it("reads the wrapped form (sbx <= 0.47)", () => {
    const text = JSON.stringify({ sandboxes: [{ name: "a" }, { name: "b" }] });
    expect(sandboxList(text)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("reads the bare array form (newer sbx)", () => {
    expect(sandboxList('[{"name":"a"}]')).toEqual([{ name: "a" }]);
  });

  it("returns an empty list for an empty array", () => {
    expect(sandboxList("[]")).toEqual([]);
  });

  it("returns an empty list when the wrapper has no sandboxes key", () => {
    expect(sandboxList("{}")).toEqual([]);
  });

  it("ignores notices printed before and after the JSON", () => {
    const text = 'A new version is available\n[{"name":"a"}]\nRun sbx update to upgrade\n';
    expect(sandboxList(text)).toEqual([{ name: "a" }]);
  });

  it("returns null for empty output", () => {
    expect(sandboxList("")).toBeNull();
    expect(sandboxList("   \n")).toBeNull();
  });

  it("returns null when there is no JSON at all", () => {
    expect(sandboxList("no sandboxes found")).toBeNull();
  });

  it("returns null for malformed or truncated JSON", () => {
    expect(sandboxList('{"sandboxes": [{"name": "a"')).toBeNull();
    expect(sandboxList("[{name: a}]")).toBeNull();
    expect(sandboxList("}{")).toBeNull();
  });
});
