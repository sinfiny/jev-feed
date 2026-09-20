import type { Video } from "@/lib/learning";
import { parseWatchPage, readTextLimited, videoIdFrom } from "@/lib/youtube-playlist";

export const runtime = "edge";

// Watch pages are ~1.4 MB each, so one request resolves at most this many videos.
const MAX_IDS = 10;

async function fetchVideo(id: string): Promise<Video | null> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JevFeed/1.0)" }, signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 86_400 },
    } as RequestInit);
    if (!response.ok) return null;
    return parseWatchPage(await readTextLimited(response, 3_000_000), id);
  } catch { return null; }
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
