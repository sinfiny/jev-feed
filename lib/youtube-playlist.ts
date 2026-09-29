import type { Chapter, Video } from "@/lib/learning";

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

/** "11M views", "4,465,289 views", "No views", "8.66M subscribers" to a number. */
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
    const description = tag(entry, "media:description");
    const chapters = chaptersFrom(description);
    return {
      id,
      title: tag(entry, "title"),
      channel: tag(entry, "name") || "YouTube",
      description: description.slice(0, 1200),
      thumbnail: unescapeXml(entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1] ?? ""),
      published: tag(entry, "published"),
      ...(chapters.length ? { chapters } : {}),
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

type Known = { details: Map<string, Video>; channel?: string };

const knownFrom = (fallback?: PlaylistFeed | null): Known => ({ details: new Map(fallback?.videos.map((video) => [video.id, video])), channel: fallback?.playlist.channel });

function videoFromPlaylistVideoRenderer(renderer: Record<string, unknown>, { details, channel }: Known): Video | null {
  const id = typeof renderer.videoId === "string" ? renderer.videoId : "";
  if (!id) return null;
  const known = details.get(id);
  const thumbnails = (renderer.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails ?? [];
  const lengthSeconds = Number(renderer.lengthSeconds);
  const viewsText = textFrom(renderer.videoInfo).match(/[\d.,]+\s*[KMB]?\s*views?|no views/i)?.[0] ?? "";
  return {
    id,
    title: textFrom(renderer.title) || known?.title || "Untitled video",
    channel: textFrom(renderer.shortBylineText) || known?.channel || channel || "YouTube",
    description: textFrom(renderer.descriptionSnippet) || known?.description || "",
    thumbnail: thumbnails.at(-1)?.url || known?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    published: known?.published,
    durationSeconds: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? lengthSeconds : known?.durationSeconds,
    views: viewsText ? viewsToNumber(viewsText) : known?.views,
    chapters: known?.chapters,
  };
}

function videoFromLockup(renderer: Record<string, unknown>, { details, channel }: Known): Video | null {
  const serialized = JSON.stringify(renderer);
  // Video ids are exactly 11 characters, which skips playlist and channel lockups.
  const id = serialized.match(/"contentId":"([A-Za-z0-9_-]{11})"/)?.[1] ?? "";
  if (!id) return null;
  const known = details.get(id);
  const title = serialized.match(/"title":\{"content":"((?:\\.|[^"])*)"/)?.[1] ?? "";
  const thumbnail = serialized.match(/"url":"(https:\/\/i\.ytimg\.com\/vi\/[^"]+)"/)?.[1]?.replace(/\\u0026/g, "&") ?? "";
  const owner = serialized.match(/"a11yLabel":"Go to channel ((?:\\.|[^"])*)"/)?.[1] ?? "";
  const avatar = serialized.match(/"decoratedAvatarViewModel":\{"avatar":\{"avatarViewModel":\{"image":\{"sources":\[\{"url":"([^"]+)"/)?.[1];
  // The duration is a thumbnail badge such as "17:05". The view count is a metadata part reading "2.2M views",
  // or, in the compact layout, "2.2M" with an accessibility label of "2.2 million views".
  const badge = serialized.match(/"thumbnailBadgeViewModel":\{"text":"(\d{1,2}(?::\d{2}){1,2})"/)?.[1];
  const viewsText = serialized.match(/"metadataParts":\[\{"text":\{"content":"([^"]*views?)"/i)?.[1]
    ?? serialized.match(/"text":\{"content":"([\d.,]+\s*[KMB]?)"\},"accessibilityLabel":"[^"]*views?"/i)?.[1] ?? "";
  return {
    id,
    title: title ? JSON.parse(`"${title}"`) as string : known?.title || "Untitled video",
    channel: owner ? JSON.parse(`"${owner}"`) as string : known?.channel || channel || "YouTube",
    channelAvatar: avatar ? absoluteUrl(avatar) : known?.channelAvatar,
    description: known?.description || "",
    thumbnail: thumbnail || known?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    published: known?.published,
    durationSeconds: badge ? durationToSeconds(badge) : known?.durationSeconds,
    views: viewsText ? viewsToNumber(viewsText) : known?.views,
    chapters: known?.chapters,
  };
}

const absoluteUrl = (url: string) => url.startsWith("//") ? `https:${url}` : url;

/** Reads the first page of a playlist (about 100 videos). `playlistContinuationFrom` and `parsePlaylistContinuation` read the rest. */
export function parsePlaylistPage(html: string, playlistId: string, limit: number, fallback?: PlaylistFeed | null): PlaylistFeed | null {
  const known = knownFrom(fallback);
  const scan = Math.min(limit * 3, 300);
  const videos = unique([
    ...rendererObjects(html, '"playlistVideoRenderer":', scan).map((renderer) => videoFromPlaylistVideoRenderer(renderer, known)),
    ...rendererObjects(html, '"lockupViewModel":', scan).map((renderer) => videoFromLockup(renderer, known)),
  ]).slice(0, limit);

  if (!videos.length) return fallback ? { ...fallback, videos: fallback.videos.slice(0, limit) } : null;
  const title = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1];
  return {
    playlist: { id: playlistId, title: title ? unescapeXml(title) : fallback?.playlist.title || "YouTube playlist", channel: fallback?.playlist.channel || videos[0].channel },
    videos,
  };
}

const unique = (videos: Array<Video | null>) => {
  const seen = new Set<string>();
  return videos.filter((video): video is Video => video !== null && !seen.has(video.id) && !!seen.add(video.id));
};

const isPlaylistItem = (item: unknown) => !!item && typeof item === "object" && ("lockupViewModel" in item || "playlistVideoRenderer" in item);

/** The token behind the "load more" item that closes a list of playlist videos, or "" when the list is complete. */
function listContinuation(value: unknown, depth = 0): string {
  if (!value || typeof value !== "object" || depth > 40) return "";
  if (Array.isArray(value)) {
    const last: unknown = value.at(-1);
    if (last && typeof last === "object" && ("continuationItemViewModel" in last || "continuationItemRenderer" in last) && value.some(isPlaylistItem)) {
      const token = findKey(findKey(last, "continuationCommand"), "token");
      if (typeof token === "string" && token) return token;
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const token = listContinuation(child, depth + 1);
    if (token) return token;
  }
  return "";
}

/**
 * Finds the continuation token for the next batch of playlist videos, given a playlist page's HTML
 * (its embedded ytInitialData) or a parsed `browse` continuation response. Only a continuation that
 * closes a list of videos counts; the page carries others, such as one for related playlists.
 * Returns "" when the playlist has no more videos.
 */
export function playlistContinuationFrom(source: unknown): string {
  const data = typeof source === "string" ? rendererObjects(source, "ytInitialData", 1)[0] : source;
  return listContinuation(data);
}

/** The web client version a playlist page was served with. Continuation calls made with an old version stop after one batch. */
export function innertubeClientVersionFrom(html: string) {
  return html.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/)?.[1] ?? "";
}

/**
 * Reads one `browse` continuation response for a playlist: the next batch of videos (lockups or classic
 * playlistVideoRenderers, whichever YouTube sends) and the token for the batch after it ("" at the end).
 */
export function parsePlaylistContinuation(value: unknown, fallback?: PlaylistFeed | null): { videos: Video[]; continuation: string } {
  const known = knownFrom(fallback);
  const items = collectKey(value, "continuationItems").flatMap((list) => Array.isArray(list) ? list : []) as Array<Record<string, unknown>>;
  const videos = unique(items.map((item) => {
    if (item.playlistVideoRenderer && typeof item.playlistVideoRenderer === "object") return videoFromPlaylistVideoRenderer(item.playlistVideoRenderer as Record<string, unknown>, known);
    if (item.lockupViewModel && typeof item.lockupViewModel === "object") return videoFromLockup(item.lockupViewModel as Record<string, unknown>, known);
    return null;
  }));
  return { videos, continuation: listContinuation(value) };
}

type PlayerResponse = { videoDetails?: Record<string, unknown>; microformat?: { playerMicroformatRenderer?: Record<string, unknown> } };

/**
 * Builds a Video from YouTube's player response, which carries the full description, exact length,
 * YouTube's category, view count, publish date, and uploader keywords. The same JSON is embedded in
 * watch pages and returned by the innertube player endpoint; metadata is present even when playback
 * is reported as unplayable. Chapters come from the description's timestamp lines.
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
  const chapters = chaptersFrom(description);
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
    chapters: chapters.length ? chapters : undefined,
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

/** Depth-first search for the first object stored under `key`. Innertube responses nest renderers unpredictably. */
function findKey(value: unknown, key: string, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 40) return undefined;
  if (!Array.isArray(value) && key in (value as Record<string, unknown>)) return (value as Record<string, unknown>)[key];
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = findKey(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectKey(value: unknown, key: string, out: unknown[] = [], depth = 0): unknown[] {
  if (!value || typeof value !== "object" || depth > 40) return out;
  if (!Array.isArray(value) && key in (value as Record<string, unknown>)) out.push((value as Record<string, unknown>)[key]);
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) collectKey(child, key, out, depth + 1);
  return out;
}

/** Keeps chapters that start strictly later than the one before, the way YouTube itself requires, capped at 40. */
function inOrder(candidates: Array<{ start?: number; title: string }>): Chapter[] {
  const chapters: Chapter[] = [];
  for (const { start, title } of candidates) {
    if (start === undefined || !title || (chapters.length && start <= chapters.at(-1)!.start)) continue;
    chapters.push({ start, title });
  }
  return chapters.length >= 2 ? chapters.slice(0, 40) : [];
}

/** Chapters from description lines such as "0:00 Intro" or "1:02:03 - Proof". */
export const chaptersFrom = (description: string) =>
  inOrder([...description.matchAll(/^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—|:]?\s*(.+)$/gm)].map((line) => ({ start: durationToSeconds(line[1]), title: line[2].trim() })));

/**
 * Like count from the `next` response's like button. The button's accessibility text has the exact count
 * ("like this video along with 563,461 other people"); its title only the rounded one ("563K"). When the
 * creator hides likes the title is just "Like" and this returns undefined.
 */
function likesFrom(primary: unknown): number | undefined {
  const button = JSON.stringify(findKey(primary, "likeButtonViewModel") ?? findKey(primary, "segmentedLikeDislikeButtonRenderer") ?? {});
  const exact = button.match(/along with ([\d,]+) other/)?.[1] ?? button.match(/"label":"([\d,]+) likes?"/)?.[1];
  if (exact) return Number(exact.replace(/,/g, ""));
  const rounded = button.match(/"title":"([\d.,]+\s*[KMB]?)"/i)?.[1];
  return rounded ? viewsToNumber(rounded) : undefined;
}

const largestThumbnail = (value: unknown) => {
  const thumbnails = findKey(value, "thumbnails");
  const url = Array.isArray(thumbnails) ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url : undefined;
  return typeof url === "string" && url ? absoluteUrl(url) : undefined;
};

/**
 * Builds a Video from the innertube `next` response, the JSON behind the watch page's info panel.
 * It carries title, full description, owner (name, avatar, subscribers), views, likes, publish date, and
 * chapter markers, but not the length. YouTube serves it to datacenter addresses that the `player` endpoint turns away.
 */
export function videoFromNextResponse(value: unknown, videoId: string): Video | null {
  const primary = findKey(value, "videoPrimaryInfoRenderer") as Record<string, unknown> | undefined;
  const secondary = findKey(value, "videoSecondaryInfoRenderer") as Record<string, unknown> | undefined;
  const title = textFrom(primary?.title);
  if (!title) return null;
  const owner = findKey(secondary?.owner, "videoOwnerRenderer") as Record<string, unknown> | undefined;
  const attributed = findKey(secondary, "attributedDescription") as { content?: unknown } | undefined;
  const description = typeof attributed?.content === "string" ? attributed.content : textFrom(secondary?.description);
  const viewsText = textFrom((findKey(primary?.viewCount, "videoViewCountRenderer") as Record<string, unknown> | undefined)?.viewCount);
  // Chapter markers carry their own start time; YouTube also lists auto-generated chapters here.
  const markers = inOrder(collectKey(value, "macroMarkersListItemRenderer").map((marker) => {
    const item = marker as Record<string, unknown>;
    return { start: durationToSeconds(textFrom(item.timeDescription) || "x"), title: textFrom(item.title) };
  }));
  const chapters = markers.length ? markers : chaptersFrom(description);
  const subscribersText = textFrom(owner?.subscriberCountText);
  return {
    id: videoId,
    title,
    channel: textFrom(owner?.title) || "YouTube",
    channelAvatar: largestThumbnail(owner?.thumbnail),
    description: description.slice(0, 2000),
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    published: textFrom(primary?.dateText) || undefined,
    views: viewsText ? viewsToNumber(viewsText) : undefined,
    likes: likesFrom(primary),
    subscribers: subscribersText ? viewsToNumber(subscribersText) : undefined,
    chapters: chapters.length ? chapters : undefined,
  };
}

/**
 * Finds one video's `videoRenderer` on a search results page for its own id. This is the cheapest
 * datacenter-friendly source of the video's length; it also has a description snippet, view count and channel avatar.
 */
export function videoFromSearchPage(html: string, videoId: string): Video | null {
  const renderer = rendererObjects(html, '"videoRenderer":', 40).find((item) => item.videoId === videoId);
  if (!renderer) return null;
  const title = textFrom(renderer.title);
  if (!title) return null;
  const snippet = (renderer.detailedMetadataSnippets as Array<{ snippetText?: unknown }> | undefined)?.[0]?.snippetText;
  const viewsText = textFrom(renderer.viewCountText);
  return {
    id: videoId,
    title,
    channel: textFrom(renderer.ownerText) || textFrom(renderer.shortBylineText) || "YouTube",
    channelAvatar: largestThumbnail(renderer.channelThumbnailSupportedRenderers),
    description: textFrom(snippet),
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSeconds: durationToSeconds(textFrom(renderer.lengthText) || "x"),
    views: viewsText ? viewsToNumber(viewsText) : undefined,
  };
}

/** Merges partial videos in priority order: earlier entries win, later ones fill gaps. */
export function mergeVideos(videoId: string, ...parts: Array<Video | null>): Video | null {
  const present = parts.filter((part): part is Video => part !== null);
  if (!present.length) return null;
  const merged = { ...present[0] };
  for (const part of present.slice(1)) {
    for (const [key, value] of Object.entries(part) as Array<[keyof Video, Video[keyof Video]]>) {
      const current = merged[key];
      if (value !== undefined && value !== "" && (current === undefined || current === "")) (merged as Record<string, unknown>)[key] = value;
    }
  }
  return { ...merged, id: videoId };
}
