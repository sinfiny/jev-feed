import { describe, expect, it } from "vitest";
import { judgePrompt, judgeSchema, readJudgments } from "@/lib/judge";

describe("judging with Claude", () => {
  it("asks for one integer per question per video", () => {
    const schema = judgeSchema(2) as { properties: { videos: { items: { required: string[] } } } };
    expect(schema.properties.videos.items.required).toEqual(["id", "q1", "q2"]);
    const prompt = judgePrompt([{ id: "aaaaaaaaaaa", title: "Limits", channel: "3b1b", description: "Epsilon", durationSeconds: 90 }], ["Real code?", "For kids?"]);
    expect(prompt).toContain("q2: For kids?");
    expect(prompt).toContain("Length: 1:30");
  });

  it("keeps only asked-about videos and clamps scores", () => {
    const json = { videos: [{ id: "a", q1: 12, q2: 3.4 }, { id: "stranger", q1: 5, q2: 5 }, { id: "b", q1: "x", q2: -1 }] };
    expect(readJudgments(json, ["a", "b"], ["Real code?", "For kids?"])).toEqual({ "real code?": { a: 10 }, "for kids?": { a: 3, b: 0 } });
    expect(readJudgments(null, ["a"], ["Q"])).toEqual({ q: {} });
  });
});
