import { describe, expect, it } from "vitest";
import {
  durationToSeconds,
  isVideoOnlyYouTubeUrl,
  parsePlaylistFeed,
  parsePlaylistPage,
  parseWatchPage,
  playlistIdFrom,
  readTextLimited,
  unescapeXml,
  videoFromOEmbed,
  videoFromPlayerResponse,
  videoIdFrom,
  viewsToNumber,
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

describe("videoIdFrom", () => {
  it("accepts bare ids and every common video url shape", () => {
    expect(videoIdFrom("WUvTyaaNkzM")).toBe("WUvTyaaNkzM");
    expect(videoIdFrom("https://www.youtube.com/watch?v=WUvTyaaNkzM&t=10s")).toBe("WUvTyaaNkzM");
    expect(videoIdFrom("https://youtu.be/WUvTyaaNkzM?si=abc")).toBe("WUvTyaaNkzM");
    expect(videoIdFrom("https://youtube.com/shorts/WUvTyaaNkzM")).toBe("WUvTyaaNkzM");
    expect(videoIdFrom("https://www.youtube.com/live/WUvTyaaNkzM")).toBe("WUvTyaaNkzM");
    expect(videoIdFrom(`https://m.youtube.com/watch?v=WUvTyaaNkzM&list=${LIST}`)).toBe("WUvTyaaNkzM");
  });

  it("rejects other hosts, playlists without a video, and short ids", () => {
    expect(videoIdFrom("https://vimeo.com/WUvTyaaNkzM")).toBe("");
    expect(videoIdFrom(`https://www.youtube.com/playlist?list=${LIST}`)).toBe("");
    expect(videoIdFrom("abc")).toBe("");
  });
});

describe("durationToSeconds and viewsToNumber", () => {
  it("converts badge and metadata text", () => {
    expect(durationToSeconds("17:05")).toBe(1025);
    expect(durationToSeconds("1:02:33")).toBe(3753);
    expect(durationToSeconds("LIVE")).toBeUndefined();
    expect(viewsToNumber("11M views")).toBe(11_000_000);
    expect(viewsToNumber("4,465,289 views")).toBe(4_465_289);
    expect(viewsToNumber("2.5K views")).toBe(2500);
    expect(viewsToNumber("No views")).toBe(0);
  });
});

const lockup = (contentId: string, title: string, badge: string, views: string) => JSON.stringify({
  lockupViewModel: {
    contentId,
    contentImage: { thumbnailViewModel: {
      image: { sources: [{ url: `https://i.ytimg.com/vi/${contentId}/hqdefault.jpg?sqp=x` }] },
      overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: badge, badgeStyle: "DEFAULT" } }] } }],
    } },
    metadata: { lockupMetadataViewModel: {
      title: { content: title },
      image: { decoratedAvatarViewModel: { a11yLabel: "Go to channel Lockup Channel" } },
      metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: views } }, { text: { content: "9 years ago" } }] }] } },
    } },
  },
}).slice(1, -1);

describe("parsePlaylistPage with lockup view models", () => {
  it("reads title, channel, duration and views from the lockup payload", () => {
    const html = `<html>{${lockup("ddddddddddd", "Lockup lecture", "17:05", "11M views")}, ${lockup("eeeeeeeeeee", "A short", "0:45", "No views")}}</html>`;
    const page = parsePlaylistPage(html, LIST, 10);
    expect(page?.videos.map((video) => video.id)).toEqual(["ddddddddddd", "eeeeeeeeeee"]);
    expect(page?.videos[0]).toMatchObject({ title: "Lockup lecture", channel: "Lockup Channel", durationSeconds: 1025, views: 11_000_000 });
    expect(page?.videos[1]).toMatchObject({ durationSeconds: 45, views: 0 });
  });
});

describe("parseWatchPage", () => {
  const player = {
    videoDetails: { videoId: "fffffffffff", title: "Limits explained", author: "Watch Channel", lengthSeconds: "1106", viewCount: "2598365", keywords: ["calculus", "limits"], shortDescription: "short" },
    microformat: { playerMicroformatRenderer: {
      category: "Education", publishDate: "2017-05-05T08:00:00-07:00",
      description: { simpleText: "Full description.\n0:00 Intro\n2:15 The idea of a limit\n7:40 Epsilon and delta\n\nMore text." },
    } },
  };
  const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {};</script></html>`;

  it("extracts rich metadata and chapter titles", () => {
    expect(parseWatchPage(html, "fffffffffff")).toMatchObject({
      id: "fffffffffff", title: "Limits explained", channel: "Watch Channel", durationSeconds: 1106, views: 2_598_365,
      category: "Education", published: "2017-05-05T08:00:00-07:00", keywords: ["calculus", "limits"],
      chapters: ["Intro", "The idea of a limit", "Epsilon and delta"],
    });
    expect(parseWatchPage(html, "fffffffffff")?.description).toContain("Full description.");
  });

  it("returns null when the page has no player response", () => {
    expect(parseWatchPage("<html>nothing</html>", "fffffffffff")).toBeNull();
  });
});

describe("videoFromPlayerResponse and videoFromOEmbed", () => {
  it("keeps metadata from an unplayable innertube response", () => {
    const response = {
      playabilityStatus: { status: "UNPLAYABLE" },
      videoDetails: { videoId: "ggggggggggg", title: "Still described", author: "Chan", lengthSeconds: "90", viewCount: "10" },
      microformat: { playerMicroformatRenderer: { category: "Science & Technology", description: { simpleText: "Body" } } },
    };
    expect(videoFromPlayerResponse(response, "ggggggggggg")).toMatchObject({ title: "Still described", durationSeconds: 90, category: "Science & Technology", description: "Body" });
    expect(videoFromPlayerResponse({ playabilityStatus: { status: "ERROR" } }, "ggggggggggg")).toBeNull();
  });

  it("builds a minimal video from oEmbed", () => {
    expect(videoFromOEmbed({ title: "Only a title", author_name: "Chan", thumbnail_url: "https://i.ytimg.com/vi/hhhhhhhhhhh/hqdefault.jpg" }, "hhhhhhhhhhh"))
      .toEqual({ id: "hhhhhhhhhhh", title: "Only a title", channel: "Chan", description: "", thumbnail: "https://i.ytimg.com/vi/hhhhhhhhhhh/hqdefault.jpg" });
    expect(videoFromOEmbed({ error: "nope" }, "hhhhhhhhhhh")).toBeNull();
  });
});
