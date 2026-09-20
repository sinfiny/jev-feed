export const runtime = "edge";

const unescapeXml = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();

const tag = (xml: string, name: string) => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? unescapeXml(match[1]) : "";
};

function playlistIdFrom(value: string) {
  const raw = value.trim();
  if (/^[A-Za-z0-9_-]{12,}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.searchParams.get("list") ?? "";
  } catch {
    return "";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playlistId = playlistIdFrom(url.searchParams.get("url") ?? "");
  if (!playlistId) {
    return Response.json({ error: "Paste a valid YouTube playlist link." }, { status: 400 });
  }

  const response = await fetch(
    `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
    { headers: { "User-Agent": "Keen learning feed/1.0" }, cf: { cacheTtl: 900 } } as RequestInit,
  );

  if (!response.ok) {
    return Response.json({ error: "That playlist could not be read. Make sure it is public." }, { status: 502 });
  }

  const xml = await response.text();
  const feedHeader = xml.split("<entry>")[0];
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  const videos = entries.map((entry) => {
    const videoId = tag(entry, "yt:videoId");
    const thumbnail = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1] ?? "";
    return {
      id: videoId,
      title: tag(entry, "title"),
      channel: tag(entry, "name"),
      description: tag(entry, "media:description").slice(0, 1200),
      thumbnail: unescapeXml(thumbnail),
      published: tag(entry, "published"),
    };
  }).filter((video) => video.id && video.title);

  if (!videos.length) {
    return Response.json({ error: "No public videos were found in that playlist." }, { status: 404 });
  }

  return Response.json({
    playlist: {
      id: playlistId,
      title: tag(feedHeader, "title") || "YouTube playlist",
      channel: tag(feedHeader, "name") || "YouTube",
    },
    videos,
  });
}
