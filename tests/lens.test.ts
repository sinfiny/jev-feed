import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/learning";
import { PRESETS, analyze, lensFromTemplate, mergeJudgments, parseLens, questionKey, rank, unjudged, type Lens } from "@/lib/lens";

const video = (id: string, title: string, extra: Partial<Video> = {}): Video => ({ id, title, channel: "c", description: "", thumbnail: "", ...extra });
const lens = (change: Partial<Lens>): Lens => ({ id: "t", name: "Test", emoji: "🔭", dials: {}, boost: [], bury: [], questions: [], ...change });
const ids = (list: Array<{ video: Video }>) => list.map((item) => item.video.id);
const preset = (id: string) => PRESETS.find((item) => item.id === id)!;

const playlist = [
  video("intro", "Introduction to graphs for beginners", { description: "A gentle overview of graph basics." }),
  video("build", "Tutorial: build a graph search project step by step", { description: "Implementation with examples and exercises." }),
  video("deep", "Graph algorithms from scratch: a deep dive into the internals", { description: "Why the architecture works, first principles and trade-offs." }),
  video("bait", "INSANE graph hack you MUST WATCH!!! (shocking)", { description: "Viral compilation." }),
];

describe("ranking with a lens", () => {
  it("each preset puts its kind of video first and clickbait last", () => {
    expect(ids(rank(playlist, preset("deep-dive")).ranked)[0]).toBe("deep");
    expect(ids(rank(playlist, preset("hands-on")).ranked)[0]).toBe("build");
    expect(ids(rank(playlist, preset("calm-kids")).ranked).at(-1)).toBe("bait");
  });

  it("maps templates from older /feed links onto presets", () => {
    expect(lensFromTemplate("stretch")?.id).toBe("deep-dive");
    expect(lensFromTemplate("kids")?.id).toBe("calm-kids");
    expect(lensFromTemplate(null)).toBeNull();
  });

  it("an empty lens keeps the playlist order", () => {
    expect(ids(rank(playlist, lens({})).ranked)).toEqual(["intro", "build", "deep", "bait"]);
  });

  it("reads views, likes and subscribers, and a negative weight flips a dial", () => {
    const big = video("big", "Same", { views: 5_000_000, likes: 50_000, subscribers: 8_000_000 });
    const small = video("small", "Same", { views: 20_000, likes: 1_400, subscribers: 9_000 });
    expect(ids(rank([big, small], lens({ dials: { popular: 2 } })).ranked)).toEqual(["big", "small"]);
    expect(ids(rank([big, small], lens({ dials: { popular: -2 } })).ranked)).toEqual(["small", "big"]);
    expect(ids(rank([big, small], lens({ dials: { indie: 2, loved: 2 } })).ranked)).toEqual(["small", "big"]);
    expect(rank([big, small], lens({ dials: { loved: 2 } })).ranked[0].reasons[0]).toEqual({ label: "Crowd loved", tone: "good" });
  });

  it("unknown metadata stays neutral instead of counting against a video", () => {
    expect(analyze(video("x", "x"))).toMatchObject({ popular: 0.5, loved: 0.5, indie: 0.5, fresh: 0.5, quick: 0.5 });
  });

  it("prefers short or long videos by the quick dial", () => {
    const short = video("short", "a", { durationSeconds: 240 });
    const long = video("long", "a", { durationSeconds: 3 * 3600 });
    expect(ids(rank([long, short], lens({ dials: { quick: 1 } })).ranked)).toEqual(["short", "long"]);
    expect(ids(rank([short, long], lens({ dials: { quick: -1 } })).ranked)).toEqual(["long", "short"]);
  });

  it("boost and bury words match whole words and explain themselves", () => {
    const list = [video("a", "Rust ownership explained"), video("b", "Trusting your gut"), video("c", "Python in 10 minutes")];
    const { ranked } = rank(list, lens({ boost: ["rust"], bury: ["python"] }));
    expect(ids(ranked)).toEqual(["a", "b", "c"]);
    expect(ranked[0].reasons).toEqual([{ label: "Mentions “rust”", tone: "good" }]);
    expect(ranked[2].reasons).toEqual([{ label: "Mentions “python”", tone: "bad" }]);
  });

  it("sets aside shorts and over-long videos without losing them", () => {
    const list = [video("s", "clip", { durationSeconds: 45 }), video("m", "talk", { durationSeconds: 1200 }), video("l", "course", { durationSeconds: 4 * 3600 })];
    const { ranked, aside } = rank(list, lens({ hideShorts: true, maxMinutes: 60 }));
    expect(ids(ranked)).toEqual(["m"]);
    expect(aside.map((item) => [item.video.id, item.why])).toEqual([["s", "Short"], ["l", "Over 60 min"]]);
  });

  it("uses Claude's cached answers to a question, and knows which are still missing", () => {
    const question = { id: "q", text: "Does it show real code?", weight: 2 as const };
    const withQuestion = lens({ questions: [question] });
    const judgments = { [questionKey(question.text)]: { intro: 2, build: 9 } };
    const { ranked } = rank(playlist.slice(0, 2), withQuestion, judgments);
    expect(ids(ranked)).toEqual(["build", "intro"]);
    expect(ranked[0].reasons[0]).toEqual({ label: "Yes: Does it show real code", tone: "good" });
    expect(unjudged(playlist, withQuestion, judgments).map((item) => item.videos.map((entry) => entry.id))).toEqual([["deep", "bait"]]);
    expect(mergeJudgments(judgments, { [questionKey(question.text)]: { deep: 7 } })[questionKey(question.text)]).toEqual({ intro: 2, build: 9, deep: 7 });
  });

  it("ranks a few hundred videos in milliseconds", () => {
    const many = Array.from({ length: 500 }, (_, index) => video(`v${index}`, `${playlist[index % 4].title} ${index}`, { views: index * 1000, likes: index * 30, durationSeconds: 60 + index * 7 }));
    const started = performance.now();
    rank(many, lens({ dials: { depth: 2, loved: 1, quick: -1 }, boost: ["graph"], bury: ["hack"] }));
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("validates lenses from storage and links", () => {
    expect(parseLens({ name: "Mine", dials: { depth: 2, focus: 7, nope: 1 }, boost: ["a", 3, " "], questions: [{ text: "Q?", weight: 1 }, { text: "" }], maxMinutes: -3 }))
      .toEqual({ id: "custom", name: "Mine", emoji: "🔭", dials: { depth: 2 }, boost: ["a"], bury: [], questions: [{ id: "q?", text: "Q?", weight: 1 }] });
    expect(parseLens(null)).toBeNull();
    expect(parseLens({ dials: {} })).toBeNull();
  });
});
