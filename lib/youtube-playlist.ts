import type { Video } from "@/lib/learning";

export type PlaylistFeed = {
  playlist: { id: string; title: string; channel: string };
  videos: Video[];
};

export const unescapeXml = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).trim();

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
  } catch { return ""; }
}

export function isVideoOnlyYouTubeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host) || url.searchParams.has("list")) return false;
    return host === "youtu.be" || url.pathname === "/watch" || url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/");
  } catch { return false; }
}

export async function readTextLimited(response: Response, maxBytes = 3_000_000) {
  if (!response.body) return "";
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Response too large");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("Response too large"); }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

export function parsePlaylistFeed(xml: string, playlistId: string): PlaylistFeed | null {
  const feedHeader = xml.split("<entry>", 1)[0];
  const seen = new Set<string>();
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const id = tag(entry, "yt:videoId");
    return {
      id,
      title: tag(entry, "title"),
      channel: tag(entry, "name") || "YouTube",
      description: tag(entry, "media:description").slice(0, 1200),
      thumbnail: unescapeXml(entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1] ?? ""),
      published: tag(entry, "published"),
    };
  }).filter((video) => video.id && video.title && !seen.has(video.id) && !!seen.add(video.id));

  if (!videos.length) return null;
  return { playlist: { id: playlistId, title: tag(feedHeader, "title") || "YouTube playlist", channel: tag(feedHeader, "name") || "YouTube" }, videos };
}

function rendererObjects(html: string, marker: string, limit: number) {
  const values: Record<string, unknown>[] = [];
  let cursor = 0;
  while (values.length < limit) {
    const markerAt = html.indexOf(marker, cursor);
    if (markerAt < 0) break;
    const start = html.indexOf("{", markerAt + marker.length);
    if (start < 0) break;
    let depth = 0, end = start, inString = false, escaped = false;
    for (; end < html.length; end += 1) {
      const char = html[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) { end += 1; break; }
    }
    try { values.push(JSON.parse(html.slice(start, end)) as Record<string, unknown>); } catch { /* Skip malformed renderers. */ }
    cursor = Math.max(end, markerAt + marker.length);
  }
  return values;
}

const textFrom = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const item = value as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
  if (typeof item.simpleText === "string") return item.simpleText;
  return item.runs?.map((run) => typeof run.text === "string" ? run.text : "").join("") ?? "";
};

export function parsePlaylistPage(html: string, playlistId: string, limit: number, fallback?: PlaylistFeed | null): PlaylistFeed | null {
  const details = new Map(fallback?.videos.map((video) => [video.id, video]));
  const seen = new Set<string>();
  const classicVideos = rendererObjects(html, '"playlistVideoRenderer":', Math.min(limit * 3, 300)).flatMap((renderer) => {
    const id = typeof renderer.videoId === "string" ? renderer.videoId : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const known = details.get(id);
    const thumbnails = (renderer.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails ?? [];
    return [{
      id,
      title: textFrom(renderer.title) || known?.title || "Untitled video",
      channel: textFrom(renderer.shortBylineText) || known?.channel || fallback?.playlist.channel || "YouTube",
      description: textFrom(renderer.descriptionSnippet) || known?.description || "",
      thumbnail: thumbnails.at(-1)?.url || known?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: known?.published,
    } satisfies Video];
  });

  const lockupVideos = rendererObjects(html, '"lockupViewModel":', Math.min(limit * 3, 300)).flatMap((renderer) => {
    const serialized = JSON.stringify(renderer);
    const id = serialized.match(/"contentId":"([A-Za-z0-9_-]{11})"/)?.[1] ?? "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const known = details.get(id);
    const title = serialized.match(/"title":\{"content":"((?:\\.|[^"])*)"/)?.[1] ?? "";
    const thumbnail = serialized.match(/"url":"(https:\/\/i\.ytimg\.com\/vi\/[^"]+)"/)?.[1]?.replace(/\\u0026/g, "&") ?? "";
    const channel = serialized.match(/"a11yLabel":"Go to channel ((?:\\.|[^"])*)"/)?.[1] ?? "";
    return [{
      id,
      title: title ? JSON.parse(`"${title}"`) as string : known?.title || "Untitled video",
      channel: channel ? JSON.parse(`"${channel}"`) as string : known?.channel || fallback?.playlist.channel || "YouTube",
      description: known?.description || "",
      thumbnail: thumbnail || known?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: known?.published,
    } satisfies Video];
  });

  const videos = [...classicVideos, ...lockupVideos].slice(0, limit);

  if (!videos.length) return fallback ? { ...fallback, videos: fallback.videos.slice(0, limit) } : null;
  const title = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1];
  return {
    playlist: { id: playlistId, title: title ? unescapeXml(title) : fallback?.playlist.title || "YouTube playlist", channel: fallback?.playlist.channel || videos[0].channel },
    videos,
  };
}
