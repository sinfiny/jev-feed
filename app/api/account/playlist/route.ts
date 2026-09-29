import { playlistPageFrom } from "@/lib/youtube-account";
import { failure, googleToken, youtube } from "../google";

export const runtime = "edge";

/**
 * GET /api/account/playlist?id=<playlist id>[&page=<token>] — one page of ids (50) from one of the viewer's playlists,
 * in order, with the playlist's item count and the next page's token. Ids only: the browser compares them with the
 * videos it already has and asks /api/account/videos only for new ones, so a visit costs one call per unchanged playlist.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const page = params.get("page") ?? "";
  if (!/^[\w-]{2,64}$/.test(id) || !/^[\w-]{0,200}$/.test(page)) return Response.json({ error: "That playlist id is not valid." }, { status: 400 });
  try {
    const token = await googleToken(request);
    const response = await youtube(token, "playlistItems", { part: "contentDetails", playlistId: id, maxResults: "50", ...page ? { pageToken: page } : {} });
    return Response.json(playlistPageFrom(response), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
