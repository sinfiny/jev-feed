import { describe, expect, it } from "vitest";
import {
  isVideoOnlyYouTubeUrl,
  parsePlaylistFeed,
  parsePlaylistPage,
  playlistIdFrom,
  readTextLimited,
  unescapeXml,
} from "@/lib/youtube-playlist";

const LIST = "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf";

describe("playlistIdFrom", () => {
  it("accepts bare ids and youtube playlist urls", () => {
    expect(playlistIdFrom(LIST)).toBe(LIST);
    expect(playlistIdFrom(`https://www.youtube.com/playlist?list=${LIST}`)).toBe(LIST);
    expect(playlistIdFrom(`https://m.youtube.com/watch?v=abc&list=${LIST}`)).toBe(LIST);
    expect(playlistIdFrom(`  https://youtu.be/abc?list=${LIST}  `)).toBe(LIST);
  });

  it("rejects other hosts, missing lists and malformed ids", () => {
    expect(playlistIdFrom(`https://example.com/playlist?list=${LIST}`)).toBe("");
    expect(playlistIdFrom("https://www.youtube.com/watch?v=abc")).toBe("");
    expect(playlistIdFrom("short")).toBe("");
    expect(playlistIdFrom("not a url at all!")).toBe("");
  });
});

describe("isVideoOnlyYouTubeUrl", () => {
  it("detects single-video links", () => {
    expect(isVideoOnlyYouTubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isVideoOnlyYouTubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isVideoOnlyYouTubeUrl("https://youtube.com/shorts/abc")).toBe(true);
  });

  it("returns false for playlists and non-youtube links", () => {
    expect(isVideoOnlyYouTubeUrl(`https://www.youtube.com/watch?v=abc&list=${LIST}`)).toBe(false);
    expect(isVideoOnlyYouTubeUrl("https://vimeo.com/123")).toBe(false);
    expect(isVideoOnlyYouTubeUrl("garbage")).toBe(false);
  });
});

describe("unescapeXml", () => {
  it("decodes entities and cdata", () => {
    expect(unescapeXml("<![CDATA[ Tom &amp; Jerry ]]>")).toBe("Tom & Jerry");
    expect(unescapeXml("&lt;b&gt; &quot;hi&quot; &#39;x&#39; &#x41;&#66;")).toBe('<b> "hi" \'x\' AB');
  });
});

describe("readTextLimited", () => {
  it("reads small bodies and rejects oversized ones", async () => {
    await expect(readTextLimited(new Response("hello"))).resolves.toBe("hello");
    await expect(readTextLimited(new Response("x".repeat(20)), 10)).rejects.toThrow("Response too large");
    await expect(readTextLimited(new Response("x", { headers: { "content-length": "999" } }), 10)).rejects.toThrow("Response too large");
  });
});

const feedXml = `<?xml version="1.0"?>
<feed>
  <title>Learning graphs</title>
  <author><name>Graph Channel</name></author>
  <entry>
    <yt:videoId>vid00000001</yt:videoId>
    <title>Intro &amp; overview</title>
    <author><name>Graph Channel</name></author>
    <published>2024-01-01T00:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/vid00000001/hqdefault.jpg"/>
      <media:description>First video.</media:description>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>vid00000001</yt:videoId>
    <title>Duplicate entry</title>
  </entry>
  <entry>
    <yt:videoId>vid00000002</yt:videoId>
    <title>Second</title>
  </entry>
  <entry>
    <yt:videoId></yt:videoId>
    <title>No id</title>
  </entry>
</feed>`;

describe("parsePlaylistFeed", () => {
  it("extracts playlist metadata and deduplicated videos", () => {
    const feed = parsePlaylistFeed(feedXml, LIST);
    expect(feed?.playlist).toEqual({ id: LIST, title: "Learning graphs", channel: "Graph Channel" });
    expect(feed?.videos.map((video) => video.id)).toEqual(["vid00000001", "vid00000002"]);
    expect(feed?.videos[0]).toMatchObject({
      title: "Intro & overview",
      description: "First video.",
      thumbnail: "https://i.ytimg.com/vi/vid00000001/hqdefault.jpg",
      published: "2024-01-01T00:00:00+00:00",
    });
    expect(feed?.videos[1].channel).toBe("YouTube");
  });

  it("returns null when there are no usable entries", () => {
    expect(parsePlaylistFeed("<feed><title>Empty</title></feed>", LIST)).toBeNull();
  });
});

const renderer = (videoId: string, title: string) => JSON.stringify({
  playlistVideoRenderer: {
    videoId,
    title: { runs: [{ text: title }] },
    shortBylineText: { simpleText: "Page Channel" },
    thumbnail: { thumbnails: [{ url: "small.jpg" }, { url: `https://i.ytimg.com/vi/${videoId}/maxres.jpg` }] },
  },
}).slice(1, -1);

describe("parsePlaylistPage", () => {
  it("parses classic renderers, respects the limit and merges fallback details", () => {
    const html = `<html><head><meta name="title" content="Page &amp; title"></head><body>
      var data = {${renderer("aaaaaaaaaaa", "First from page")}, ${renderer("bbbbbbbbbbb", "Second")}, ${renderer("ccccccccccc", "Third")}};
    </body></html>`;
    const fallback = {
      playlist: { id: LIST, title: "Feed title", channel: "Feed Channel" },
      videos: [{ id: "aaaaaaaaaaa", title: "From feed", channel: "Feed Channel", description: "Feed description", thumbnail: "", published: "2024-02-02" }],
    };
    const page = parsePlaylistPage(html, LIST, 2, fallback);
    expect(page?.playlist).toEqual({ id: LIST, title: "Page & title", channel: "Feed Channel" });
    expect(page?.videos.map((video) => video.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(page?.videos[0]).toMatchObject({
      title: "First from page",
      channel: "Page Channel",
      description: "Feed description",
      thumbnail: "https://i.ytimg.com/vi/aaaaaaaaaaa/maxres.jpg",
      published: "2024-02-02",
    });
  });

  it("falls back to the feed when the page has no renderers", () => {
    const fallback = {
      playlist: { id: LIST, title: "Feed title", channel: "Feed Channel" },
      videos: [1, 2, 3].map((n) => ({ id: `v${n}`, title: `V${n}`, channel: "c", description: "", thumbnail: "" })),
    };
    expect(parsePlaylistPage("<html></html>", LIST, 2, fallback)?.videos).toHaveLength(2);
    expect(parsePlaylistPage("<html></html>", LIST, 2)).toBeNull();
  });
});
