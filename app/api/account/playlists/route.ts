import { MAX_PLAYLISTS } from "@/lib/library";
import { LIKED_PLAYLIST_ID, playlistsFrom } from "@/lib/youtube-account";
import { failure, googleToken, youtube } from "../google";

export const runtime = "edge";

/** GET /api/account/playlists — Liked videos, then the viewer's own playlists, up to the library limit. */
export async function GET(request: Request) {
  try {
    const token = await googleToken(request);
    const owned = playlistsFrom(await youtube(token, "playlists", { part: "snippet,contentDetails", mine: "true", maxResults: "50" }));
    const playlists = [{ id: LIKED_PLAYLIST_ID, title: "Liked videos" }, ...owned].slice(0, MAX_PLAYLISTS);
    return Response.json({ playlists }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
