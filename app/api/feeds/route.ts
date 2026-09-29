import { viewerId } from "../account/google";
import { feedFailure, feedId, readFeedBody, saveFeed } from "./store";

export const runtime = "edge";

/** POST /api/feeds {feed} — publishes a feed snapshot under a new short id. Signed-in organizers only. */
export async function POST(request: Request) {
  try {
    const owner = await viewerId(request);
    const feed = await readFeedBody(request);
    const id = feedId();
    await saveFeed(id, feed, owner);
    return Response.json({ id }, { status: 201 });
  } catch (error) { return feedFailure(error); }
}
