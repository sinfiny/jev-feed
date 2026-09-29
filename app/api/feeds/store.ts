import { env } from "cloudflare:workers";
import { parsePublishedFeed, type PublishedFeed } from "@/lib/feed";

/**
 * Published feeds in Workers KV. The value is the feed snapshot; the owner's Clerk user id rides in the key's
 * metadata so only they can republish or take it down. Nothing about viewers is stored.
 */

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

export const saveFeed = (id: string, feed: PublishedFeed, owner: string) =>
  feeds().put(id, JSON.stringify({ ...feed, publishedAt: Date.now() }), { metadata: { owner } });

export async function ownerOf(id: string) {
  const { value, metadata } = await feeds().getWithMetadata<{ owner?: string }>(id);
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
