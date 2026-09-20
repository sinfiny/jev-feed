import type { Video } from "@/lib/learning";
import { parseWatchPage, readTextLimited, videoFromOEmbed, videoFromPlayerResponse, videoIdFrom } from "@/lib/youtube-playlist";

export const runtime = "edge";

// Watch pages are ~1.4 MB each, so one request resolves at most this many videos.
const MAX_IDS = 10;

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; JevFeed/1.0)" };
const cached = (ttl: number, init: RequestInit = {}) => ({ ...init, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(8_000), cf: { cacheTtl: ttl } }) as RequestInit;

/**
 * Three sources, richest first. The innertube player endpoint is a 10 KB JSON that works from
 * Cloudflare's network. The watch page is the same data inside 1.4 MB of HTML and is sometimes gated
 * for datacenter addresses. oEmbed always answers but only knows title, author, and thumbnail.
 */
async function fetchVideo(id: string): Promise<Video | null> {
  const fromPlayer = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", cached(86_400, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en" } } }),
  })).then(async (response) => response.ok ? videoFromPlayerResponse(await response.json(), id) : null).catch(() => null);
  if (fromPlayer) return fromPlayer;

  const fromPage = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, cached(86_400))
    .then(async (response) => response.ok ? parseWatchPage(await readTextLimited(response, 3_000_000), id) : null).catch(() => null);
  if (fromPage) return fromPage;

  return fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, cached(86_400))
    .then(async (response) => response.ok ? videoFromOEmbed(await response.json(), id) : null).catch(() => null);
}

/**
 * GET /api/video?ids=<id or url>,<id or url>
 * Resolves single videos from their public watch pages. Used to add one video to a playlist,
 * to enrich playlist videos that arrived without a description, and to hydrate /feed links built from video ids.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map(videoIdFrom).filter(Boolean))];
  if (!ids.length) return Response.json({ error: "Paste a YouTube video link, such as youtube.com/watch?v=… or youtu.be/…" }, { status: 400 });
  if (ids.length > MAX_IDS) return Response.json({ error: `Send at most ${MAX_IDS} videos per request.` }, { status: 400 });

  const videos = (await Promise.all(ids.map(fetchVideo))).filter((video): video is Video => video !== null);
  if (!videos.length) return Response.json({ error: "That video could not be read. It may be private or removed." }, { status: 404 });
  return Response.json({ videos }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } });
}
