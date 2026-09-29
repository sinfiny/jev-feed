import { describe, expect, it } from "vitest";
import { isLiked, isoDurationSeconds, playlistVideoIdsFrom, playlistsFrom, videosFrom } from "@/lib/youtube-account";

describe("YouTube Data API responses", () => {
  it("reads ISO 8601 durations", () => {
    expect(isoDurationSeconds("PT1H2M3S")).toBe(3723);
    expect(isoDurationSeconds("PT45S")).toBe(45);
    expect(isoDurationSeconds("P1DT1M")).toBe(86_460);
    expect(isoDurationSeconds("P0D")).toBeUndefined();
    expect(isoDurationSeconds("nonsense")).toBeUndefined();
  });

  it("lists the viewer's playlists and leaves out empty ones", () => {
    const response = { items: [
      { id: "PL1", snippet: { title: "Calculus" }, contentDetails: { itemCount: 12 } },
      { id: "PL2", snippet: { title: "Empty" }, contentDetails: { itemCount: 0 } },
      { snippet: { title: "No id" }, contentDetails: { itemCount: 3 } },
    ] };
    expect(playlistsFrom(response)).toEqual([{ id: "PL1", title: "Calculus" }]);
    expect(playlistsFrom(null)).toEqual([]);
  });

  it("keeps playlist order and reads chapters from the full description", () => {
    expect(playlistVideoIdsFrom({ items: [{ contentDetails: { videoId: "b" } }, { contentDetails: {} }, { contentDetails: { videoId: "a" } }] })).toEqual(["b", "a"]);
    const [video] = videosFrom({ items: [
      { id: "aaaaaaaaaaa", snippet: { title: "Limits", channelTitle: "3Blue1Brown", description: "0:00 Intro\n4:10 Epsilon delta", publishedAt: "2017-05-01T00:00:00Z", thumbnails: { high: { url: "https://i.ytimg.com/x.jpg" } } }, contentDetails: { duration: "PT18M" } },
      { id: "bbbbbbbbbbb", snippet: {}, contentDetails: {} },
    ] });
    expect(video).toMatchObject({ id: "aaaaaaaaaaa", title: "Limits", channel: "3Blue1Brown", durationSeconds: 1080, thumbnail: "https://i.ytimg.com/x.jpg", chapters: [{ start: 0, title: "Intro" }, { start: 250, title: "Epsilon delta" }] });
    expect(videosFrom({ items: [{ id: "c", snippet: { title: "No chapters", description: "Plain" }, contentDetails: { duration: "PT1M" } }] })[0].chapters).toBeUndefined();
  });

  it("reads a like", () => {
    expect(isLiked({ items: [{ videoId: "a", rating: "like" }] })).toBe(true);
    expect(isLiked({ items: [{ videoId: "a", rating: "none" }] })).toBe(false);
    expect(isLiked({})).toBe(false);
  });
});
