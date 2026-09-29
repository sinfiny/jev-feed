import { viewerId } from "../../account/google";
import { FeedError, feedFailure, feeds, ownerOf, readFeedBody, saveFeed } from "../store";

export const runtime = "edge";

const validId = (id: string) => /^[a-z0-9]{6,12}$/.test(id);
type Context = { params: Promise<{ id: string }> };

/** GET /api/feeds/<id> — a published feed, for anyone with the link. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    if (!validId(id)) throw new FeedError("That feed link is not valid.", 400);
    const value = await feeds().get(id);
    if (value === null) throw new FeedError("This feed was taken down, or the link is mistyped.", 404);
    return new Response(value, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30, s-maxage=30" } });
  } catch (error) { return feedFailure(error); }
}

async function asOwner(request: Request, id: string) {
  if (!validId(id)) throw new FeedError("That feed link is not valid.", 400);
  const [viewer, owner] = await Promise.all([viewerId(request), ownerOf(id)]);
  if (viewer !== owner) throw new FeedError("Only the person who published this feed can change it.", 403);
  return viewer;
}

/** PUT /api/feeds/<id> {feed} — republishes under the same link. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  try {
    const owner = await asOwner(request, id);
    await saveFeed(id, await readFeedBody(request), owner);
    return Response.json({ id });
  } catch (error) { return feedFailure(error); }
}

/** DELETE /api/feeds/<id> — takes the feed down. The draft stays in the organizer's browser. */
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  try {
    await asOwner(request, id);
    await feeds().delete(id);
    return new Response(null, { status: 204 });
  } catch (error) { return feedFailure(error); }
}
