import type { Video } from "@/lib/learning";

export type PlaylistFeed = {
  playlist: { id: string; title: string; channel: string };
  videos: Video[];
};

export const unescapeXml = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();

const tag = (xml: string, name: string) => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? unescapeXml(match[1]) : "";
};

export function playlistIdFrom(value: string) {
  const raw = value.trim();
  if (/^[A-Za-z0-9_-]{12,80}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) return "";
    const id = url.searchParams.get("list") ?? "";
    return /^[A-Za-z0-9_-]{12,80}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

export function parsePlaylistFeed(xml: string, playlistId: string): PlaylistFeed | null {
  const feedHeader = xml.split("<entry>", 1)[0];
  const seen = new Set<string>();
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => {
      const entry = match[1];
      const id = tag(entry, "yt:videoId");
      const thumbnail = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1] ?? "";
      return {
        id,
        title: tag(entry, "title"),
        channel: tag(entry, "name") || "YouTube",
        description: tag(entry, "media:description").slice(0, 1200),
        thumbnail: unescapeXml(thumbnail),
        published: tag(entry, "published"),
      };
    })
    .filter((video) => {
      if (!video.id || !video.title || seen.has(video.id)) return false;
      seen.add(video.id);
      return true;
    })
    .slice(0, 100);

  if (!videos.length) return null;

  return {
    playlist: {
      id: playlistId,
      title: tag(feedHeader, "title") || "YouTube playlist",
      channel: tag(feedHeader, "name") || "YouTube",
    },
    videos,
  };
}
