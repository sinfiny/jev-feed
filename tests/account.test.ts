import { describe, expect, it } from "vitest";
import {
  MAX_PLAYLISTS,
  addVideo,
  createPlaylist,
  deletePlaylist,
  emptyStore,
  mergeVideoDetails,
  normalizeUsername,
  parseAccountStore,
  playlistsFor,
  removeVideo,
  signIn,
  signOut,
} from "@/lib/account";
import type { Video } from "@/lib/learning";

const video = (id: string): Video => ({ id, title: `Video ${id}`, channel: "c", description: "", thumbnail: "" });

describe("normalizeUsername", () => {
  it("lowercases and validates", () => {
    expect(normalizeUsername("  Ana_B ")).toBe("ana_b");
    expect(normalizeUsername("a")).toBe("");
    expect(normalizeUsername("has space")).toBe("");
    expect(normalizeUsername("_leading")).toBe("");
  });
});

describe("accounts and playlists", () => {
  it("signs in, owns playlists per username, and signs out without losing them", () => {
    let store = signIn(emptyStore(), "Ana");
    ({ store } = createPlaylist(store, "Calculus", [video("a"), video("a"), video("b")]));
    expect(playlistsFor(store, "ana")[0].videos.map((item) => item.id)).toEqual(["a", "b"]);
    store = signOut(store);
    expect(store.username).toBeNull();
    expect(playlistsFor(store, "ana")).toHaveLength(1);
    expect(playlistsFor(store, null)).toHaveLength(0);
    store = signIn(store, "bo");
    expect(playlistsFor(store, "bo")).toHaveLength(0);
  });

  it("caps ownership at five playlists", () => {
    let store = signIn(emptyStore(), "ana");
    for (let index = 0; index < MAX_PLAYLISTS; index += 1) ({ store } = createPlaylist(store, `P${index}`));
    expect(() => createPlaylist(store, "one more")).toThrow(/up to 5/);
    store = deletePlaylist(store, playlistsFor(store, "ana")[0].id);
    expect(createPlaylist(store, "fits now").playlist.title).toBe("fits now");
  });

  it("adds and removes single videos, rejecting duplicates", () => {
    let store = signIn(emptyStore(), "ana");
    const { store: next, playlist } = createPlaylist(store, "Mine");
    store = addVideo(next, playlist.id, video("x"));
    expect(() => addVideo(store, playlist.id, video("x"))).toThrow(/already/);
    store = addVideo(store, playlist.id, video("y"));
    store = removeVideo(store, playlist.id, "x");
    expect(playlistsFor(store, "ana")[0].videos.map((item) => item.id)).toEqual(["y"]);
  });

  it("merges enriched details without reordering", () => {
    let store = signIn(emptyStore(), "ana");
    const { store: next } = createPlaylist(store, "Mine", [video("x"), video("y")]);
    store = mergeVideoDetails(next, [{ ...video("y"), durationSeconds: 300, category: "Education" }]);
    expect(playlistsFor(store, "ana")[0].videos.map((item) => [item.id, item.durationSeconds])).toEqual([["x", undefined], ["y", 300]]);
  });

  it("requires a signed-in user for writes", () => {
    expect(() => createPlaylist(emptyStore(), "nope")).toThrow(/Sign in/);
  });
});

describe("parseAccountStore", () => {
  it("drops garbage and keeps valid playlists", () => {
    expect(parseAccountStore(null)).toEqual(emptyStore());
    expect(parseAccountStore("{bad json")).toEqual(emptyStore());
    const store = parseAccountStore(JSON.stringify({
      username: "Ana",
      playlists: { ana: [{ id: "p1", title: "Keep", videos: [video("a"), { nope: true }] }, "junk"], "bad name!": [] },
    }));
    expect(store.username).toBe("ana");
    expect(Object.keys(store.playlists)).toEqual(["ana"]);
    expect(store.playlists.ana[0].videos).toHaveLength(1);
  });
});
