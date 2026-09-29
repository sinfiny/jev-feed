import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/learning";
import {
  addBookmark, addPlaylist, emptyProgress, migrateLegacy, momentsFor, parseLibrary, parseProgress, queueOrder, savePosition, toggleChapterDone, toggleStatus, videoState,
} from "@/lib/library";

const video = (id: string, extra: Partial<Video> = {}): Video => ({ id, title: `Video ${id}`, channel: "c", description: "d", thumbnail: "", ...extra });

describe("migrating the username-era store", () => {
  it("keeps every owned playlist and turns completed videos into done", () => {
    const account = JSON.stringify({ username: "ana", playlists: {
      ana: [{ id: "u_1", title: "Calculus", videos: [video("a"), video("b")], createdAt: "2026-01-01" }],
      bo: [{ id: "u_2", title: "Graphs", videos: [video("c")] }, { id: "u_1", title: "Duplicate id", videos: [] }],
    } });
    const learning = JSON.stringify({ "u_1": { mastery: 70, completed: ["a"] }, PLx: { mastery: 50, completed: ["z"] } });
    const { playlists, progress } = migrateLegacy(account, learning);
    expect(playlists.map((playlist) => playlist.title)).toEqual(["Calculus", "Graphs"]);
    expect(progress.videos).toEqual({ a: { status: "done" }, z: { status: "done" } });
    expect(migrateLegacy(null, null)).toEqual({ playlists: [], progress: emptyProgress() });
    expect(migrateLegacy("not json", "{").playlists).toEqual([]);
  });

  it("drops chapters stored as bare titles and clears the description so they are read again", () => {
    const [playlist] = parseLibrary(JSON.stringify([{ id: "p", title: "P", videos: [video("a", { chapters: ["Intro", "Proof"] as never }), video("b", { chapters: [{ start: 0, title: "Intro" }] })] }]))!;
    expect(playlist.videos[0]).toMatchObject({ description: "" });
    expect(playlist.videos[0].chapters).toBeUndefined();
    expect(playlist.videos[1].chapters).toEqual([{ start: 0, title: "Intro" }]);
    expect(parseLibrary(null)).toBeNull();
  });

  it("parses progress defensively", () => {
    const progress = parseProgress(JSON.stringify({ rate: 3, videos: { a: { status: "gone", position: 12, bookmarks: [{ id: "b1", seconds: 4 }, { seconds: "x" }] } }, last: { playlistId: "p" } }))!;
    expect(progress.rate).toBe(1);
    expect(progress.last).toBeUndefined();
    expect(progress.videos.a).toMatchObject({ status: undefined, position: 12, bookmarks: [{ id: "b1", seconds: 4, label: "" }] });
  });
});

describe("playlists", () => {
  it("refreshes a copy of the same YouTube playlist instead of adding a second one", () => {
    const first = addPlaylist([], "Old title", [video("a", { chapters: [{ start: 0, title: "Intro" }, { start: 60, title: "Next" }] })], "PL1");
    const second = addPlaylist(first.playlists, "New title", [video("b"), video("a", { chapters: undefined })], "PL1");
    expect(second.playlists).toHaveLength(1);
    expect(second.playlist).toMatchObject({ id: first.playlist.id, title: "New title" });
    expect(second.playlist.videos.map((item) => item.id)).toEqual(["b", "a"]);
    expect(second.playlist.videos[1].chapters).toHaveLength(2);
  });
});

describe("queue state", () => {
  it("keeps playlist order but sinks snoozed and then done videos", () => {
    let progress = emptyProgress();
    progress = toggleStatus(progress, "a", "done");
    progress = toggleStatus(progress, "b", "snoozed");
    progress = savePosition(progress, "d", 120);
    const order = queueOrder([video("a"), video("b"), video("c"), video("d")], progress);
    expect(order.map((item) => [item.video.id, item.state])).toEqual([["c", "new"], ["d", "started"], ["b", "snoozed"], ["a", "done"]]);
    expect(videoState(toggleStatus(progress, "a", "done").videos.a)).toBe("new");
  });

  it("lists chapters with their end times and bookmarks in time order", () => {
    const lecture = video("a", { durationSeconds: 600, chapters: [{ start: 0, title: "Intro" }, { start: 200, title: "Proof" }] });
    let progress = toggleChapterDone(emptyProgress(), "a", 0);
    progress = addBookmark(progress, "a", 250.7).progress;
    expect(momentsFor(lecture, progress.videos.a).map((moment) => moment.kind === "chapter" ? [moment.title, moment.start, moment.end, moment.done] : ["bookmark", moment.start])).toEqual([
      ["Intro", 0, 200, true],
      ["Proof", 200, 600, false],
      ["bookmark", 250],
    ]);
  });
});
