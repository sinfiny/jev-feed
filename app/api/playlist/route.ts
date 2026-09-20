import { isVideoOnlyYouTubeUrl, parsePlaylistFeed, parsePlaylistPage, playlistIdFrom, readTextLimited } from "@/lib/youtube-playlist";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("url") ?? "";
  const playlistId = playlistIdFrom(input);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 10);
  const limit = requestedLimit === 50 || requestedLimit === 100 ? requestedLimit : 10;
  if (!playlistId) return Response.json({ error: isVideoOnlyYouTubeUrl(input)
    ? "That video link lost its playlist. Open it from the playlist and copy a URL that includes list=."
    : "Paste a public YouTube playlist link. The URL should include list=." }, { status: 400 });

  try {
    const [feedResponse, pageResponse] = await Promise.allSettled([
      fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, {
        headers: { "User-Agent": "Jev learning feed/1.0" }, signal: AbortSignal.timeout(8_000), cf: { cacheTtl: 900 },
      } as RequestInit),
      fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JevFeed/1.0)" }, signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 900 },
      } as RequestInit),
    ]);

    let feed = null;
    if (feedResponse.status === "fulfilled" && feedResponse.value.ok) {
      feed = parsePlaylistFeed(await readTextLimited(feedResponse.value, 1_500_000), playlistId);
    }

    let result = feed;
    if (pageResponse.status === "fulfilled" && pageResponse.value.ok) {
      result = parsePlaylistPage(await readTextLimited(pageResponse.value, 3_000_000), playlistId, limit, feed);
    }

    if (!result?.videos.length) return Response.json({ error: "No public videos were found in that playlist." }, { status: 404 });
    return Response.json({ ...result, requestedLimit: limit, returnedCount: result.videos.length }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=86400" },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return Response.json({ error: timedOut ? "YouTube took too long to respond. Try again." : "The playlist could not be reached. Try again shortly." }, { status: 502 });
  }
}
