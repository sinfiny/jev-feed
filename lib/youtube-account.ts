import type { Video } from "@/lib/learning";
import { chaptersFrom } from "@/lib/youtube-playlist";

/**
 * Parsers for the YouTube Data API responses behind a signed-in library: the viewer's playlists,
 * the videos in one of them, and the like on a video. Pure functions over parsed JSON.
 */

/** YouTube's id for the signed-in viewer's Liked videos. playlistItems.list accepts it for the owner only. */
export const LIKED_PLAYLIST_ID = "LL";

/** The one Google scope Jev asks for beyond sign-in: read playlists and likes, and like videos. */
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";

export type AccountPlaylist = { id: string; title: string };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = (value: unknown) => { const list = record(value).items; return Array.isArray(list) ? list.map(record) : []; };
const text = (value: unknown) => typeof value === "string" ? value : "";

/** "PT1H2M3S" to 3723. */
export function isoDurationSeconds(value: string) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds) || undefined;
}

/** playlists.list?mine=true. Empty playlists are left out, since there is nothing in them to watch. */
export const playlistsFrom = (value: unknown): AccountPlaylist[] => items(value).flatMap((item) => {
  const id = text(item.id);
  const count = Number(record(item.contentDetails).itemCount ?? 0);
  return id && count > 0 ? [{ id, title: text(record(item.snippet).title) || "Untitled playlist" }] : [];
});

/** playlistItems.list. Video ids in playlist order. */
export const playlistVideoIdsFrom = (value: unknown) =>
  items(value).map((item) => text(record(item.contentDetails).videoId)).filter(Boolean);

/** videos.list with snippet and contentDetails. Private and deleted videos are simply absent from the response. */
export const videosFrom = (value: unknown): Video[] => items(value).flatMap((item) => {
  const id = text(item.id);
  const snippet = record(item.snippet);
  if (!id || !text(snippet.title)) return [];
  const description = text(snippet.description);
  const thumbnails = record(snippet.thumbnails);
  const chapters = chaptersFrom(description);
  return [{
    id,
    title: text(snippet.title),
    channel: text(snippet.channelTitle),
    description,
    thumbnail: text(record(thumbnails.high).url) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    published: text(snippet.publishedAt) || undefined,
    durationSeconds: isoDurationSeconds(text(record(item.contentDetails).duration)),
    chapters: chapters.length ? chapters : undefined,
  }];
});

/** videos.getRating. */
export const isLiked = (value: unknown) => items(value)[0]?.rating === "like";
