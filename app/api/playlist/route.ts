import { parsePlaylistFeed, playlistIdFrom } from "@/lib/youtube-playlist";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playlistId = playlistIdFrom(url.searchParams.get("url") ?? "");
  if (!playlistId) {
    return Response.json({ error: "Paste a valid YouTube playlist link." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
      {
        headers: { "User-Agent": "Keen learning feed/1.0" },
        signal: AbortSignal.timeout(8_000),
        cf: { cacheTtl: 900 },
      } as RequestInit,
    );

    if (!response.ok) {
      return Response.json(
        { error: response.status === 404 ? "That playlist was not found or is private." : "YouTube did not return that playlist. Try again shortly." },
        { status: response.status === 404 ? 404 : 502 },
      );
    }

    const result = parsePlaylistFeed(await response.text(), playlistId);
    if (!result) {
      return Response.json({ error: "No public videos were found in that playlist." }, { status: 404 });
    }

    return Response.json(result, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=86400" },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return Response.json(
      { error: timedOut ? "YouTube took too long to respond. Try again." : "The playlist could not be reached. Check your connection and try again." },
      { status: 502 },
    );
  }
}
