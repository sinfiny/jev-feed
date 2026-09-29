import { env } from "cloudflare:workers";
import { oldestFetch, parsePublishedFeed, staleIds, withFreshVideos, type PublishedFeed } from "@/lib/feed";
import { isStale } from "@/lib/learning";
import { googleTokenFor, videoDetails } from "../account/google";

/**
 * Published feeds in Workers KV. The value is the feed snapshot; the owner's Clerk user id rides in the key's
 * metadata so only they can republish or take it down. Nothing about viewers is stored.
 */

/** Beside each feed: who owns it, when its oldest video details were read, and when a refresh was last tried. */
export type FeedMeta = { owner?: string; oldest?: number; publishedAt?: number; triedAt?: number };

/** KV takes values up to 25 MiB; a feed of a few thousand videos is well under this. */
export const MAX_FEED_BYTES = 4_000_000;

export class FeedError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function feeds() {
  if (!env.FEEDS) throw new FeedError("Publishing is not switched on for this deployment.", 503);
  return env.FEEDS;
}

export async function readFeedBody(request: Request) {
  const text = await request.text();
  if (text.length > MAX_FEED_BYTES) throw new FeedError("That feed is too large to publish.", 413);
  const body = (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })();
  const feed = parsePublishedFeed((body as { feed?: unknown } | null)?.feed);
  if (!feed) throw new FeedError("A feed needs a title and at least one video.", 400);
  return feed;
}

export function saveFeed(id: string, feed: PublishedFeed, owner: string, refresh?: { publishedAt: number; triedAt: number }) {
  const publishedAt = refresh?.publishedAt ?? Date.now();
  const metadata: FeedMeta = { owner, oldest: oldestFetch(feed), publishedAt, triedAt: refresh?.triedAt };
  return feeds().put(id, JSON.stringify({ ...feed, publishedAt }), { metadata });
}

/** Videos read again in one pass: 20 calls of 50, each with a channels call, fits a Worker's subrequest allowance. */
const REFRESH_PASS = 1000;
const RETRY_AFTER = 24 * 60 * 60 * 1000;

/** True when a feed holds video details older than YouTube's API policy allows and no refresh was tried today. */
export const needsRefresh = (meta: FeedMeta, now: number) => !!meta.owner && isStale({ fetchedAt: meta.oldest }, now) && now - (meta.triedAt ?? 0) > RETRY_AFTER;

/**
 * Reads a feed's stale video details from YouTube again, as its owner, and stores the result. Runs after a
 * viewer's read has been answered, never before it. When the owner's YouTube access is gone or YouTube does
 * not answer, the feed stays as it is and the next try is a day away.
 */
export async function refreshFeed(id: string, value: string, meta: FeedMeta, now = Date.now()) {
  const stored = parsePublishedFeed((() => { try { return JSON.parse(value) as unknown; } catch { return null; } })());
  if (!stored || !meta.owner) return;
  let feed = stored;
  try {
    const token = await googleTokenFor(meta.owner);
    const ids = staleIds(stored, now).slice(0, REFRESH_PASS);
    const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, (index + 1) * 50));
    const answers = await Promise.all(chunks.map((chunk) => videoDetails(token, chunk).then((videos) => ({ chunk, videos })).catch(() => null)));
    for (const answer of answers) if (answer) feed = withFreshVideos(feed, answer.chunk, answer.videos);
  } catch { /* Tried; the stored feed stands. */ }
  if (!feed.items.length) feed = stored;
  // A republish while this ran is newer than anything read here.
  const latest = await feeds().getWithMetadata<FeedMeta>(id, "stream");
  await latest.value?.cancel();
  if (latest.value === null || latest.metadata?.publishedAt !== meta.publishedAt) return;
  await saveFeed(id, feed, meta.owner, { publishedAt: stored.publishedAt, triedAt: now });
}

export async function ownerOf(id: string) {
  const { value, metadata } = await feeds().getWithMetadata<FeedMeta>(id);
  if (value === null) throw new FeedError("That feed does not exist anymore.", 404);
  return metadata?.owner;
}

/** Short, unguessable enough to not be enumerated, readable enough to say aloud. */
export function feedId() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte % alphabet.length]).join("");
}

export const feedFailure = (error: unknown) => error instanceof FeedError
  ? Response.json({ error: error.message }, { status: error.status })
  : error instanceof Error && "status" in error && typeof error.status === "number"
    ? Response.json({ error: error.message }, { status: error.status })
    : Response.json({ error: "The feed could not be saved. Try again shortly." }, { status: 502 });
