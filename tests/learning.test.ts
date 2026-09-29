import { describe, expect, it } from "vitest";
import { DEFAULT_MASTERY, formatCount, formatDuration, heuristics, parseLearningState, type Video } from "@/lib/learning";

const video = (id: string, title: string, description = ""): Video => ({
  id,
  title,
  channel: "Test channel",
  description,
  thumbnail: "",
});

describe("heuristics", () => {
  it("reads depth, calm and hands-on signals from titles, length and category", () => {
    const lecture = heuristics(video("l", "Graph algorithms from scratch: a deep dive into the internals", "Why the architecture works."));
    const bait = heuristics(video("b", "INSANE graph hack you MUST WATCH!!! (shocking)", "Viral compilation."));
    const tutorial = heuristics(video("t", "Tutorial: build a graph search project step by step", "Implementation with examples."));
    expect(lecture.depth).toBeGreaterThan(bait.depth);
    expect(bait.focus).toBeLessThan(0.5);
    expect(tutorial.handsOn).toBeGreaterThan(lecture.handsOn);
    const clip = heuristics({ ...video("c", "Graphs"), durationSeconds: 40 });
    const edu = heuristics({ ...video("e", "Graphs"), durationSeconds: 1800, category: "Education" });
    expect(edu.depth).toBeGreaterThan(clip.depth);
    for (const value of Object.values(bait)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
  });
});

describe("parseLearningState", () => {
  it("returns an empty state for missing or malformed input", () => {
    expect(parseLearningState(null)).toEqual({});
    expect(parseLearningState("not json")).toEqual({});
    expect(parseLearningState("[]")).toEqual({});
    expect(parseLearningState('{"p":"nope"}')).toEqual({});
  });

  it("clamps mastery, dedupes completed ids and drops non-string ids", () => {
    const state = parseLearningState(JSON.stringify({
      low: { mastery: 5, completed: ["a", "a", 3, "b"] },
      high: { mastery: 200 },
      missing: { completed: "x" },
    }));
    expect(state.low).toEqual({ mastery: 30, completed: ["a", "b"] });
    expect(state.high).toEqual({ mastery: 92, completed: [] });
    expect(state.missing).toEqual({ mastery: DEFAULT_MASTERY, completed: [] });
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3753)).toBe("1:02:33");
    expect(formatDuration(undefined)).toBe("");
  });

  it("formats counts", () => {
    expect([formatCount(999), formatCount(1234), formatCount(3_400_000), formatCount(250_000), formatCount(undefined)]).toEqual(["999", "1.2K", "3.4M", "250K", ""]);
  });
});
