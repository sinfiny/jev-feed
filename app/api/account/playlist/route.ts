import { MAX_PLAYLIST_VIDEOS } from "@/lib/library";
import { playlistVideoIdsFrom, videosFrom } from "@/lib/youtube-account";
import { failure, googleToken, youtube } from "../google";

export const runtime = "edge";

/** The Data API pages at 50, so a playlist costs two list calls and two detail calls at most. */
const PAGE = 50;

/** GET /api/account/playlist?id=<playlist id> — the first 100 playable videos of one of the viewer's playlists, in order. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[\w-]{2,64}$/.test(id)) return Response.json({ error: "That playlist id is not valid." }, { status: 400 });
  try {
    const token = await googleToken(request);
    const ids: string[] = [];
    let pageToken = "";
    do {
      const page = await youtube(token, "playlistItems", { part: "contentDetails", playlistId: id, maxResults: String(PAGE), ...pageToken ? { pageToken } : {} });
      ids.push(...playlistVideoIdsFrom(page));
      pageToken = typeof (page as { nextPageToken?: unknown })?.nextPageToken === "string" ? (page as { nextPageToken: string }).nextPageToken : "";
    } while (pageToken && ids.length < MAX_PLAYLIST_VIDEOS);

    const wanted = [...new Set(ids)].slice(0, MAX_PLAYLIST_VIDEOS);
    const chunks = Array.from({ length: Math.ceil(wanted.length / PAGE) }, (_, index) => wanted.slice(index * PAGE, (index + 1) * PAGE));
    const details = (await Promise.all(chunks.map((chunk) => youtube(token, "videos", { part: "snippet,contentDetails", id: chunk.join(","), maxResults: String(PAGE) })))).flatMap(videosFrom);
    const byId = new Map(details.map((video) => [video.id, video]));
    const videos = wanted.flatMap((videoId) => byId.get(videoId) ?? []);
    return Response.json({ videos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
