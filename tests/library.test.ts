import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/learning";
import {
  addBookmark, emptyProgress, migrateLegacy, parseLibraryValue, playlistSignature, videosById, momentsFor, parseLibrary, parseProgress, queueOrder, savePosition, setMembership, syncPlaylists, toggleChapterDone, toggleStatus, videoState, withoutStale } from "@/lib/library";

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

describe("syncing from the YouTube account", () => {
  it("follows the account's playlists, keeping local ids and chapters already read", () => {
    const chapters = [{ start: 0, title: "Intro" }, { start: 60, title: "Next" }];
    const current = [
      { id: "p_1", title: "Old title", sourcePlaylistId: "PL1", videos: [video("a", { chapters })] },
      { id: "p_2", title: "Pasted before sign-in", videos: [video("z")] },
    ];
    const synced = syncPlaylists(current, [
      { id: "LL", title: "Liked videos", videos: [video("c")] },
      { id: "PL1", title: "New title", videos: [video("b"), video("a", { chapters: undefined }), video("b")] },
    ]);
    expect(synced.map((playlist) => playlist.title)).toEqual(["Liked videos", "New title"]);
    expect(synced[1]).toMatchObject({ id: "p_1", sourcePlaylistId: "PL1" });
    expect(synced[1].videos.map((item) => item.id)).toEqual(["b", "a"]);
    expect(synced[1].videos[1].chapters).toEqual(chapters);
    expect(synced[0].id).not.toBe("LL");
  });

  it("keeps an unchanged playlist as it was, with its lens, and has no video limit", () => {
    const many = Array.from({ length: 1500 }, (_, index) => video(`v${index}`));
    const current = [{ id: "p_1", title: "Liked videos", sourcePlaylistId: "LL", videos: many, signature: "1500:v0", lensId: "deep-dive" }];
    const kept = syncPlaylists(current, [{ id: "LL", title: "Liked videos" }, { id: "PLnew", title: "Brand new" }]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ id: "p_1", signature: "1500:v0", lensId: "deep-dive" });
    expect(kept[0].videos).toHaveLength(1500);
    const changed = syncPlaylists(current, [{ id: "LL", title: "Liked videos", videos: [video("new"), ...many], signature: "1501:new" }]);
    expect(changed[0]).toMatchObject({ id: "p_1", signature: "1501:new", lensId: "deep-dive" });
    expect(changed[0].videos).toHaveLength(1501);
    expect(playlistSignature(2, ["a", "b"])).toBe("2:a,b");
    expect([...videosById(current).keys()]).toHaveLength(1500);
    expect(parseLibraryValue(JSON.parse(JSON.stringify(changed)))[0].videos).toHaveLength(1501);
  });

  it("puts a liked video at the top of Liked and takes it out again", () => {
    const playlists = [{ id: "p_1", title: "Liked videos", sourcePlaylistId: "LL", videos: [video("a"), video("b")] }];
    expect(setMembership(playlists, "LL", video("b"), true)[0].videos.map((item) => item.id)).toEqual(["b", "a"]);
    expect(setMembership(playlists, "LL", video("a"), false)[0].videos.map((item) => item.id)).toEqual(["b"]);
    expect(setMembership(playlists, "PL9", video("c"), true)).toEqual(playlists);
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

describe("when YouTube access is gone", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2027, 0, 31);
  const stored = (id: string, age: number) => ({ id, title: id, channel: "c", description: "", thumbnail: "", complete: true, fetchedAt: now - age * day });

  it("removes copies read more than 29 days ago, and a playlist left with nothing", () => {
    const playlists = [
      { id: "p1", title: "Mixed", sourcePlaylistId: "PL1", signature: "2:a,b", videos: [stored("a", 40), stored("b", 3)] },
      { id: "p2", title: "All old", sourcePlaylistId: "PL2", signature: "1:c", videos: [stored("c", 31)] },
      { id: "p3", title: "All recent", sourcePlaylistId: "PL3", signature: "1:d", videos: [stored("d", 29)] },
    ];
    const kept = withoutStale(playlists, now);
    expect(kept.map((playlist) => [playlist.id, playlist.videos.map((video) => video.id)])).toEqual([["p1", ["b"]], ["p3", ["d"]]]);
    // The shortened playlist is read in full once access returns; the untouched one is the same object.
    expect(kept[0].signature).toBeUndefined();
    expect(kept[1]).toBe(playlists[2]);
  });
});
