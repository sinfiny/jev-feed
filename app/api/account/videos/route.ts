import { videoIdFrom } from "@/lib/youtube-playlist";
import { failure, googleToken, videoDetails } from "../google";

export const runtime = "edge";

/** The Data API answers up to 50 ids per call. */
const MAX_IDS = 50;

/**
 * GET /api/account/videos?ids=<id>,<id> — full details for up to 50 videos: description, length, views, likes, tags,
 * and the channel's subscriber count and avatar. Two quota units per call, whatever the count.
 */
export async function GET(request: Request) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map(videoIdFrom).filter(Boolean))];
  if (!ids.length || ids.length > MAX_IDS) return Response.json({ error: `Send between 1 and ${MAX_IDS} video ids.` }, { status: 400 });
  try {
    return Response.json({ videos: await videoDetails(await googleToken(request), ids) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
