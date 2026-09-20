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

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a bare 11-character id or any youtube.com / youtu.be video link. Returns "" when nothing usable is found. */
export function videoIdFrom(value: string) {
  const raw = value.trim();
  if (VIDEO_ID.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) return "";
    const fromQuery = url.searchParams.get("v") ?? "";
    if (VIDEO_ID.test(fromQuery)) return fromQuery;
    const fromPath = url.pathname.match(/^\/(?:shorts|live|embed|v)?\/?([A-Za-z0-9_-]{11})(?:[/?]|$)/)?.[1] ?? "";
    return VIDEO_ID.test(fromPath) ? fromPath : "";
  } catch { return ""; }
}

/** "17:05" or "1:02:33" to seconds. Returns undefined for anything else, such as "LIVE". */
export function durationToSeconds(text: string) {
  const parts = text.trim().split(":").map(Number);
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** "11M views", "4,465,289 views", "No views" to a number. */
export function viewsToNumber(text: string) {
  const match = text.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return text.toLowerCase().startsWith("no") ? 0 : undefined;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() ?? ""] ?? 1;
  return Math.round(Number(match[1]) * scale);
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
    const lengthSeconds = Number(renderer.lengthSeconds);
    const viewsText = textFrom(renderer.videoInfo).match(/[\d.,]+\s*[KMB]?\s*views?|no views/i)?.[0] ?? "";
    return [{
      id,
      title: textFrom(renderer.title) || known?.title || "Untitled video",
      channel: textFrom(renderer.shortBylineText) || known?.channel || fallback?.playlist.channel || "YouTube",
      description: textFrom(renderer.descriptionSnippet) || known?.description || "",
      thumbnail: thumbnails.at(-1)?.url || known?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: known?.published,
      durationSeconds: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? lengthSeconds : known?.durationSeconds,
      views: viewsText ? viewsToNumber(viewsText) : known?.views,
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
    // The duration is a thumbnail badge such as "17:05"; the view count is the first metadata part.
    const badge = serialized.match(/"thumbnailBadgeViewModel":\{"text":"(\d{1,2}(?::\d{2}){1,2})"/)?.[1];
    const viewsText = serialized.match(/"metadataParts":\[\{"text":\{"content":"([^"]*views?)"/i)?.[1] ?? "";
    return [{
      id,
      title: title ? JSON.parse(`"${title}"`) as string : known?.title || "Untitled video",
      channel: channel ? JSON.parse(`"${channel}"`) as string : known?.channel || fallback?.playlist.channel || "YouTube",
      description: known?.description || "",
      thumbnail: thumbnail || known?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: known?.published,
      durationSeconds: badge ? durationToSeconds(badge) : known?.durationSeconds,
      views: viewsText ? viewsToNumber(viewsText) : known?.views,
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

type PlayerResponse = { videoDetails?: Record<string, unknown>; microformat?: { playerMicroformatRenderer?: Record<string, unknown> } };

/**
 * Builds a Video from YouTube's player response, which carries the full description, exact length,
 * YouTube's category, view count, publish date, and uploader keywords. The same JSON is embedded in
 * watch pages and returned by the innertube player endpoint; metadata is present even when playback
 * is reported as unplayable. Chapter titles come from the description's timestamp lines.
 */
export function videoFromPlayerResponse(value: unknown, videoId: string): Video | null {
  if (!value || typeof value !== "object") return null;
  const response = value as PlayerResponse;
  const details = response.videoDetails ?? {};
  const micro = response.microformat?.playerMicroformatRenderer ?? {};
  const id = typeof details.videoId === "string" ? details.videoId : videoId;
  const title = typeof details.title === "string" ? details.title : "";
  if (!title) return null;
  const description = textFrom(micro.description) || (typeof details.shortDescription === "string" ? details.shortDescription : "");
  const lengthSeconds = Number(details.lengthSeconds ?? micro.lengthSeconds);
  const views = Number(details.viewCount ?? micro.viewCount);
  const thumbnails = (details.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails ?? [];
  const chapters = [...description.matchAll(/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*[-–—|:]?\s*(.+)$/gm)].map((line) => line[1].trim()).filter(Boolean);
  return {
    id,
    title,
    channel: typeof details.author === "string" ? details.author : typeof micro.ownerChannelName === "string" ? micro.ownerChannelName : "YouTube",
    description: description.slice(0, 2000),
    thumbnail: thumbnails.at(-1)?.url?.split("?")[0] || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    published: typeof micro.publishDate === "string" ? micro.publishDate : undefined,
    durationSeconds: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? lengthSeconds : undefined,
    views: Number.isFinite(views) ? views : undefined,
    category: typeof micro.category === "string" ? micro.category : undefined,
    chapters: chapters.length >= 2 ? chapters.slice(0, 40) : undefined,
    keywords: Array.isArray(details.keywords) ? details.keywords.filter((word): word is string => typeof word === "string").slice(0, 30) : undefined,
  };
}

/** Reads the player response embedded in a public watch page. */
export function parseWatchPage(html: string, videoId: string): Video | null {
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});(?:\s*<\/script>|\s*var\s)/);
  if (!match) return null;
  try { return videoFromPlayerResponse(JSON.parse(match[1]), videoId); } catch { return null; }
}

/** Last resort: YouTube's oEmbed endpoint only knows title, author, and thumbnail, but it answers from anywhere. */
export function videoFromOEmbed(value: unknown, videoId: string): Video | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
  if (typeof item.title !== "string" || !item.title) return null;
  return {
    id: videoId,
    title: item.title,
    channel: typeof item.author_name === "string" ? item.author_name : "YouTube",
    description: "",
    thumbnail: typeof item.thumbnail_url === "string" ? item.thumbnail_url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}
