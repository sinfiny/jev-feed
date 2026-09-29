import { videoIdFrom } from "@/lib/youtube-playlist";
import { channelIdsFrom, channelsFrom, videosFrom } from "@/lib/youtube-account";
import { failure, googleToken, youtube } from "../google";

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
    const token = await googleToken(request);
    const response = await youtube(token, "videos", { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: String(MAX_IDS) });
    const channelIds = channelIdsFrom(response);
    const channels = channelIds.length ? channelsFrom(await youtube(token, "channels", { part: "statistics,snippet", id: channelIds.join(","), maxResults: String(MAX_IDS) }).catch(() => null)) : undefined;
    return Response.json({ videos: videosFrom(response, channels) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
