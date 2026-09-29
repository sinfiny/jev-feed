import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/learning";
import { PRESETS } from "@/lib/lens";
import { addVideos, createDraft, feedOrder, fingerprint, moveItem, oldestFetch, parseDrafts, parsePublishedFeed, staleIds, toPublished, toggleHidden, togglePinned, setNote, withFreshVideos, withLibraryDetails } from "@/lib/feed";

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

  it("fingerprints what viewers would see, so an edit after publishing is noticed", () => {
    const draft = createDraft("Graphs", [video("a"), video("b")]);
    const published = fingerprint(toPublished(draft, {}, "Ana"));
    expect(fingerprint(toPublished(draft, {}))).toBe(published);
    expect(fingerprint(toPublished(setNote(draft, video("a").id, "Watch this"), {}))).not.toBe(published);
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

describe("keeping YouTube details under 30 days old", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2027, 0, 31);
  const old = video("o", "Old title", { fetchedAt: now - 40 * day, chapters: [{ start: 0, title: "Intro" }], category: "Education" });
  const recent = video("r", "Recent", { fetchedAt: now - 5 * day });
  const gone = video("g", "Made private", { fetchedAt: now - 40 * day });
  const feed = () => toPublished(setNote(togglePinned(createDraft("x", [old, recent, gone]), old.id), old.id, "Start here"), {});

  it("asks again only about videos read more than 29 days ago", () => {
    expect(staleIds(feed(), now)).toEqual([old.id, gone.id]);
    expect(oldestFetch(feed())).toBe(now - 40 * day);
  });

  it("treats a video with no read date as read when published feeds shipped", () => {
    const undated = toPublished(createDraft("x", [video("u")]), {});
    expect(staleIds(undated, Date.UTC(2026, 9, 20))).toEqual([]);
    expect(staleIds(undated, Date.UTC(2026, 10, 5))).toEqual([video("u").id]);
  });

  it("takes fresh details, keeps the note, pin and what only the older copy knew, and drops a video YouTube no longer returns", () => {
    const fresh = video("o", "New title", { fetchedAt: now, views: 9 });
    const next = withFreshVideos(feed(), [old.id, gone.id], [fresh]);
    expect(ids(next.items)).toEqual(["o", "r"]);
    expect(next.items[0]).toMatchObject({ note: "Start here", pinned: true, video: { title: "New title", views: 9, fetchedAt: now, category: "Education", chapters: [{ start: 0, title: "Intro" }] } });
    expect(next.items[0].video.description).toHaveLength(400);
    expect(staleIds(next, now)).toEqual([]);
  });

  it("keeps the read date through storing and reading a published feed", () => {
    expect(parsePublishedFeed(JSON.parse(JSON.stringify(feed())))?.items[1].video.fetchedAt).toBe(now - 5 * day);
  });

  it("does not call a link behind its draft because details were read again", () => {
    const published = feed();
    expect(fingerprint(withFreshVideos(published, [recent.id], [{ ...recent, fetchedAt: now }]))).toBe(fingerprint(published));
  });

  it("gives drafts the library's copy when it was read more recently, and leaves them alone otherwise", () => {
    const drafts = [createDraft("x", [old, recent])];
    expect(withLibraryDetails(drafts, new Map([[recent.id, recent]]))).toBe(drafts);
    const next = withLibraryDetails(drafts, new Map([[old.id, { ...old, title: "New title", fetchedAt: now }]]));
    expect(next[0].items[0].video).toMatchObject({ title: "New title", fetchedAt: now });
    expect(next[0].updatedAt).toBe(drafts[0].updatedAt);
  });
});
