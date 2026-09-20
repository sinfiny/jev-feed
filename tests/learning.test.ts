import { describe, expect, it } from "vitest";
import {
  DEFAULT_MASTERY,
  parseLearningState,
  progressForPlaylist,
  rankVideos,
  type Video,
} from "@/lib/learning";

const video = (id: string, title: string, description = ""): Video => ({
  id,
  title,
  channel: "Test channel",
  description,
  thumbnail: "",
});

const playlist: Video[] = [
  video("intro", "Introduction to graphs for beginners", "A gentle overview of graph basics."),
  video("build", "Tutorial: build a graph search project step by step", "Implementation with examples and exercises."),
  video("deep", "Graph algorithms from scratch: a deep dive into the internals", "Why the architecture works, first principles and trade-offs."),
  video("bait", "INSANE graph hack you MUST WATCH!!! (shocking)", "Viral compilation."),
];

describe("rankVideos", () => {
  it("excludes completed videos", () => {
    const ranked = rankVideos(playlist, DEFAULT_MASTERY, ["intro", "bait"]);
    expect(ranked.map((item) => item.id).sort()).toEqual(["build", "deep"]);
  });

  it("returns metrics inside the 1-99 range and a stable sort by score", () => {
    const ranked = rankVideos(playlist, DEFAULT_MASTERY, []);
    for (const item of ranked) {
      for (const metric of [item.difficulty, item.learnability, item.depth, item.clarity, item.focus, item.buildValue, item.curiosity, item.score]) {
        expect(metric).toBeGreaterThanOrEqual(1);
        expect(metric).toBeLessThanOrEqual(99);
      }
      expect(item.signals).toHaveLength(3);
      expect(item.reason).not.toBe("");
    }
    const scores = ranked.map((item) => item.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("puts the deep explanation first in the stretch template", () => {
    const ranked = rankVideos(playlist, DEFAULT_MASTERY, [], "stretch");
    expect(ranked[0].id).toBe("deep");
  });

  it("puts the practical tutorial first in the balanced template", () => {
    const ranked = rankVideos(playlist, DEFAULT_MASTERY, [], "balanced");
    expect(ranked[0].id).toBe("build");
    expect(ranked[0].classification).toBe("Practical");
  });

  it("pushes clickbait to the bottom in the kids template", () => {
    const ranked = rankVideos(playlist, DEFAULT_MASTERY, [], "kids");
    expect(ranked.at(-1)?.id).toBe("bait");
    expect(ranked.at(-1)?.classification).toBe("Low signal");
  });

  it("marks hard videos as advanced for low-mastery viewers", () => {
    const [deep] = rankVideos([playlist[2]], 30, [], "stretch");
    expect(deep.classification).toBe("Advanced");
    expect(deep.reason).toMatch(/^Advanced/);
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

describe("progressForPlaylist", () => {
  it("falls back to defaults for unknown playlists", () => {
    expect(progressForPlaylist({}, "unknown")).toEqual({ mastery: DEFAULT_MASTERY, completed: [] });
  });

  it("drops completed ids that are no longer in the playlist", () => {
    const state = { p: { mastery: 70, completed: ["a", "gone"] } };
    expect(progressForPlaylist(state, "p", ["a", "b"])).toEqual({ mastery: 70, completed: ["a"] });
    expect(progressForPlaylist(state, "p")).toEqual({ mastery: 70, completed: ["a", "gone"] });
  });
});
