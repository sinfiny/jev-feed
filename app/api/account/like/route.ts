import { videoIdFrom } from "@/lib/youtube-playlist";
import { isLiked } from "@/lib/youtube-account";
import { failure, googleToken, youtube } from "../google";

export const runtime = "edge";

const headers = { "Cache-Control": "private, no-store" };

/** GET /api/account/like?id=<video id> — whether the viewer has liked the video on YouTube. */
export async function GET(request: Request) {
  const id = videoIdFrom(new URL(request.url).searchParams.get("id") ?? "");
  if (!id) return Response.json({ error: "That video id is not valid." }, { status: 400 });
  try {
    const token = await googleToken(request);
    return Response.json({ liked: isLiked(await youtube(token, "videos/getRating", { id })) }, { headers });
  } catch (error) { return failure(error); }
}

/** POST /api/account/like {id, liked} — likes the video on YouTube, or takes the like back. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { id?: unknown; liked?: unknown } | null;
  const id = typeof body?.id === "string" ? videoIdFrom(body.id) : "";
  if (!id || typeof body?.liked !== "boolean") return Response.json({ error: "Send a video id and whether it is liked." }, { status: 400 });
  try {
    const token = await googleToken(request);
    await youtube(token, "videos/rate", { id, rating: body.liked ? "like" : "none" }, "POST");
    return Response.json({ liked: body.liked }, { headers });
  } catch (error) { return failure(error); }
}
