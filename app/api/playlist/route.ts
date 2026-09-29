import type { Video } from "@/lib/learning";
import {
  innertubeClientVersionFrom,
  isVideoOnlyYouTubeUrl,
  parsePlaylistContinuation,
  parsePlaylistFeed,
  parsePlaylistPage,
  playlistContinuationFrom,
  playlistIdFrom,
  readTextLimited,
  type PlaylistFeed,
} from "@/lib/youtube-playlist";

export const runtime = "edge";

// A safety cap on videos per playlist, and on `browse` calls per request: each returns about 100 videos,
// and Workers limit subrequests (50 on the free plan, counting the two page fetches).
const MAX_VIDEOS = 5000;
const MAX_CONTINUATIONS = 40;
// Used when the playlist page does not say which client version served it.
const CLIENT_VERSION = "2.20260925.08.00";

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; JevFeed/1.0)" };

async function browse(token: string, clientVersion: string) {
  const response = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion, hl: "en" } }, continuation: token }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`browse ${response.status}`);
  return JSON.parse(await readTextLimited(response, 5_000_000)) as unknown;
}

/**
 * Follows the playlist's continuation tokens after the first page, about 100 videos per call.
 * Returns whether the end of the playlist was reached; a failed call or the budget stops early.
 */
async function readRest(videos: Video[], token: string, clientVersion: string, limit: number, fallback: PlaylistFeed | null) {
  const seen = new Set(videos.map((video) => video.id));
  for (let calls = 0; token && videos.length < limit && calls < MAX_CONTINUATIONS; calls += 1) {
    const batch = await browse(token, clientVersion).then((json) => parsePlaylistContinuation(json, fallback)).catch(() => null);
    if (!batch) return false;
    for (const video of batch.videos) if (!seen.has(video.id) && seen.add(video.id)) videos.push(video);
    token = batch.continuation;
  }
  return !token && videos.length <= limit;
}

/**
 * GET /api/playlist?url=<playlist url or id>&limit=<n>
 * Reads a public playlist in full: the playlist page has the first ~100 videos and a continuation token for
 * the rest. The RSS feed (15 videos) adds publish dates and descriptions and stands in when the page cannot be read.
 * `complete` is false when the response stops short of the whole playlist.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("url") ?? "";
  const playlistId = playlistIdFrom(input);
  const requested = Math.floor(Number(url.searchParams.get("limit") ?? MAX_VIDEOS));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_VIDEOS) : MAX_VIDEOS;
  if (!playlistId) return Response.json({ error: isVideoOnlyYouTubeUrl(input)
    ? "That video link lost its playlist. Open it from the playlist and copy a URL that includes list=."
    : "Paste a public YouTube playlist link. The URL should include list=." }, { status: 400 });

  try {
    const [feedResponse, pageResponse] = await Promise.allSettled([
      fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, {
        headers: { "User-Agent": "Jev learning feed/1.0" }, signal: AbortSignal.timeout(8_000), cf: { cacheTtl: 900 },
      } as RequestInit),
      fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`, {
        headers: HEADERS, signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 900 },
      } as RequestInit),
    ]);

    let feed = null;
    if (feedResponse.status === "fulfilled" && feedResponse.value.ok) {
      feed = parsePlaylistFeed(await readTextLimited(feedResponse.value, 1_500_000), playlistId);
    }

    let result = feed;
    let complete = false;
    if (pageResponse.status === "fulfilled" && pageResponse.value.ok) {
      const html = await readTextLimited(pageResponse.value, 3_000_000);
      result = parsePlaylistPage(html, playlistId, limit, feed);
      // Without video renderers on the page the result is the RSS fallback, which may be missing videos.
      if (result && /"(?:lockupViewModel|playlistVideoRenderer)":/.test(html)) {
        const videos = [...result.videos];
        complete = await readRest(videos, playlistContinuationFrom(html), innertubeClientVersionFrom(html) || CLIENT_VERSION, limit, feed);
        result = { ...result, videos: videos.slice(0, limit) };
      }
    }

    if (!result?.videos.length) return Response.json({ error: "No public videos were found in that playlist." }, { status: 404 });
    return Response.json({ ...result, requestedLimit: limit, returnedCount: result.videos.length, complete }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=86400" },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return Response.json({ error: timedOut ? "YouTube took too long to respond. Try again." : "The playlist could not be reached. Try again shortly." }, { status: 502 });
  }
}
