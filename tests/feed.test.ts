import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/learning";
import { PRESETS } from "@/lib/lens";
import { addVideos, createDraft, feedOrder, moveItem, parseDrafts, parsePublishedFeed, toPublished, toggleHidden, togglePinned, setNote } from "@/lib/feed";

const video = (id: string, title = `Video ${id}`, extra: Partial<Video> = {}): Video => ({ id: id.padEnd(11, "x"), title, channel: "c", description: "d".repeat(1000), thumbnail: "", ...extra });
const ids = (list: Array<{ video: Video }>) => list.map((item) => item.video.id[0]);

describe("designing a feed", () => {
  it("adds videos once, moves, pins and hides them, and hiding is undone by adding again", () => {
    let draft = createDraft("Graphs", [video("a"), video("b"), video("c")]);
    draft = { ...draft, ...addVideos(draft, [video("b"), video("d")]) };
    expect(ids(draft.items)).toEqual(["a", "b", "c", "d"]);
    draft = moveItem(draft, video("d").id, 0);
    draft = togglePinned(draft, video("c").id);
    draft = toggleHidden(draft, video("a").id);
    expect(ids(feedOrder(draft.items, null).order)).toEqual(["c", "d", "b"]);
    draft = { ...draft, ...addVideos(draft, [video("a")]) };
    expect(draft.items.find((item) => item.video.id === video("a").id)?.hidden).toBe(false);
  });

  it("orders unpinned videos by the lens and keeps pinned ones on top", () => {
    const deep = video("d", "Graph algorithms from scratch: a deep dive into the internals");
    const bait = video("b", "INSANE graph hack you MUST WATCH!!! (shocking)");
    const draft = togglePinned(createDraft("x", [bait, video("p", "Pinned"), deep]), video("p").id);
    const { order } = feedOrder(draft.items, PRESETS.find((lens) => lens.id === "deep-dive")!);
    expect(ids(order)).toEqual(["p", "d", "b"]);
    expect(order[0].reasons[0].label).toBe("Pinned");
  });

  it("publishes a snapshot without hidden videos or long descriptions, keeping notes and only the judgments it needs", () => {
    let draft = createDraft("Graphs", [video("a"), video("b")], { ...PRESETS[0], questions: [{ id: "q", text: "Real code?", weight: 2 }] });
    draft = setNote(toggleHidden(draft, video("b").id), video("a").id, "  Start with this one  ");
    const feed = toPublished(draft, { "real code?": { [video("a").id]: 8, [video("b").id]: 2 }, "other": { [video("a").id]: 1 } }, "Ana");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ note: "Start with this one" });
    expect(feed.items[0].video.description).toHaveLength(400);
    expect(feed.judgments).toEqual({ "real code?": { [video("a").id]: 8 } });
    expect(parsePublishedFeed(JSON.parse(JSON.stringify(feed)))).toMatchObject({ title: "Graphs", author: "Ana", items: [{ note: "Start with this one" }] });
  });

  it("rejects or cleans what a client should not be able to store", () => {
    expect(parsePublishedFeed({ title: "x", items: [] })).toBeNull();
    expect(parsePublishedFeed({ items: [{ video: { id: "bad", title: "x" } }] })).toBeNull();
    const feed = parsePublishedFeed({ title: "t".repeat(500), color: "black", items: [
      { video: { id: "aaaaaaaaaaa", title: "A", thumbnail: "https://evil.example/x.png", extra: "dropped", views: "12" }, note: 5 },
      { video: { id: "aaaaaaaaaaa", title: "Duplicate" } },
    ] })!;
    expect(feed.title).toHaveLength(80);
    expect(feed.color).toBe("pink");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].video.thumbnail).toBe("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg");
    expect(feed.items[0].video).not.toHaveProperty("extra");
    expect(feed.items[0].video.views).toBeUndefined();
  });

  it("reads drafts back from storage defensively", () => {
    const draft = createDraft("Graphs", [video("a")]);
    expect(parseDrafts([draft, { id: 3 }, null])).toEqual([{ ...draft, items: [{ video: draft.items[0].video, note: undefined, pinned: undefined, hidden: undefined }] }]);
    expect(parseDrafts("nope")).toEqual([]);
  });
});
