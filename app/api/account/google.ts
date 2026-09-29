import { createClerkClient } from "@clerk/backend";
import { channelIdsFrom, channelsFrom, videosFrom } from "@/lib/youtube-account";

/**
 * Calls the YouTube Data API as the signed-in viewer. The browser sends its Clerk session token;
 * the viewer's Google access token is fetched from Clerk here and never reaches the browser.
 */

const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });

export class AccountError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const RECONNECT = "Jev needs access to your YouTube account. Use Allow YouTube access in the list.";

/** The signed-in viewer's Clerk user id, from the session token the browser sends. */
export async function viewerId(request: Request) {
  const { userId } = (await clerk().authenticateRequest(request, { acceptsToken: "session_token" })).toAuth() ?? {};
  if (!userId) throw new AccountError("Sign in with Google first.", 401);
  return userId;
}

/** A Google access token for a Clerk user. Clerk renews it as needed, so this works without that user present. */
export async function googleTokenFor(userId: string) {
  const { data } = await clerk().users.getUserOauthAccessToken(userId, "google");
  if (!data[0]?.token) throw new AccountError(RECONNECT, 403);
  return data[0].token;
}

export const googleToken = async (request: Request) => googleTokenFor(await viewerId(request));

/** videos.list for up to 50 ids, with each channel's subscriber count and avatar. Two quota units. */
export async function videoDetails(token: string, ids: string[]) {
  const response = await youtube(token, "videos", { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: "50" });
  const channelIds = channelIdsFrom(response);
  const channels = channelIds.length ? channelsFrom(await youtube(token, "channels", { part: "statistics,snippet", id: channelIds.join(","), maxResults: "50" }).catch(() => null)) : undefined;
  const fetchedAt = Date.now();
  return videosFrom(response, channels).map((video) => ({ ...video, fetchedAt }));
}

export async function youtube(token: string, path: string, params: Record<string, string>, method = "GET") {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`, {
    method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 401) throw new AccountError(RECONNECT, 403);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "insufficientPermissions") throw new AccountError(RECONNECT, 403);
    if (reason === "quotaExceeded") throw new AccountError("Jev has used up today's YouTube allowance. Try again tomorrow.", 429);
    throw new AccountError("YouTube did not answer. Try again shortly.", 502);
  }
  return response.status === 204 ? null : response.json() as Promise<unknown>;
}

/** Turns a thrown AccountError into its JSON response. Anything else is an unexpected 502. */
export const failure = (error: unknown) => error instanceof AccountError
  ? Response.json({ error: error.message }, { status: error.status })
  : Response.json({ error: "Your YouTube account could not be reached. Try again shortly." }, { status: 502 });
