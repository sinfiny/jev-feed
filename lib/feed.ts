import type { Video } from "@/lib/learning";
import { parseJudgments, parseLens, questionKey, rank, type Judgments, type Lens, type Reason } from "@/lib/lens";

/**
 * Feeds are what an organizer designs in the Studio and shares. A draft lives in the organizer's browser
 * (IndexedDB). Publishing stores a snapshot in Workers KV under a short id, so a /feed/<id> link opens instantly,
 * carries any number of videos, notes and the lens, and can be republished or taken down by its owner.
 */

export const FEED_COLORS = ["pink", "lime", "sky", "sun", "grape", "tomato"] as const;
export type FeedColor = (typeof FEED_COLORS)[number];
export const FEED_EMOJI = ["✨", "🚀", "🧠", "🎨", "🔬", "🌱", "🎧", "🧸", "🏗️", "📐", "🌍", "🍳"];

export type FeedItem = { video: Video; note?: string; pinned?: boolean; hidden?: boolean };

export type FeedDraft = {
  id: string;
  title: string;
  blurb: string;
  emoji: string;
  color: FeedColor;
  /** In the organizer's own order. Hidden items stay in the draft and are left out when published. */
  items: FeedItem[];
  /** How unpinned videos are ordered. Null keeps the organizer's order. */
  lens: Lens | null;
  published?: { id: string; at: number; fingerprint: string };
  updatedAt: number;
};

export type PublishedFeed = {
  v: 1;
  title: string;
  blurb: string;
  emoji: string;
  color: FeedColor;
  author?: string;
  lens: Lens | null;
  items: Array<{ video: Video; note?: string; pinned?: boolean }>;
  /** Claude's answers for the lens's questions, so viewers never trigger judging. */
  judgments: Judgments;
  publishedAt: number;
};

export const MAX_FEED_ITEMS = 5000;
const newId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function createDraft(title: string, videos: Video[], lens: Lens | null = null): FeedDraft {
  const color = FEED_COLORS[Math.floor(Math.random() * FEED_COLORS.length)];
  return { id: newId(), title: title.slice(0, 80), blurb: "", emoji: FEED_EMOJI[Math.floor(Math.random() * FEED_EMOJI.length)], color, lens, updatedAt: Date.now(), items: addVideos({ items: [] }, videos).items };
}

const touch = (draft: FeedDraft, change: Partial<FeedDraft>): FeedDraft => ({ ...draft, ...change, updatedAt: Date.now() });

/** Appends videos not already in the feed. A video that was hidden comes back. */
export function addVideos<T extends Pick<FeedDraft, "items">>(draft: T, videos: Video[]): T {
  const index = new Map(draft.items.map((item, position) => [item.video.id, position]));
  const items = draft.items.map((item) => videos.some((video) => video.id === item.video.id) ? { ...item, hidden: false } : item);
  for (const video of videos) if (!index.has(video.id)) { index.set(video.id, items.length); items.push({ video }); }
  return { ...draft, items: items.slice(0, MAX_FEED_ITEMS) };
}

const updateItem = (draft: FeedDraft, id: string, change: (item: FeedItem) => FeedItem) =>
  touch(draft, { items: draft.items.map((item) => item.video.id === id ? change(item) : item) });

export const togglePinned = (draft: FeedDraft, id: string) => updateItem(draft, id, (item) => ({ ...item, pinned: !item.pinned }));
export const toggleHidden = (draft: FeedDraft, id: string) => updateItem(draft, id, (item) => ({ ...item, hidden: !item.hidden, pinned: item.hidden ? item.pinned : false }));
export const setNote = (draft: FeedDraft, id: string, note: string) => updateItem(draft, id, (item) => ({ ...item, note: note.slice(0, 280) }));
export const editDraft = (draft: FeedDraft, change: Partial<Pick<FeedDraft, "title" | "blurb" | "emoji" | "color" | "lens">>) => touch(draft, change);

/** Moves a video to another place in the organizer's order. */
export function moveItem(draft: FeedDraft, id: string, to: number) {
  const from = draft.items.findIndex((item) => item.video.id === id);
  if (from < 0) return draft;
  const items = [...draft.items];
  const [item] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, item);
  return touch(draft, { items });
}

/** Pinned videos first in the organizer's order, then the rest by the lens (or the organizer's order). Hidden ones are left out. */
export function feedOrder(items: Array<Pick<FeedItem, "video" | "pinned" | "hidden">>, lens: Lens | null, judgments: Judgments = {}) {
  const shown = items.filter((item) => !item.hidden);
  const pinned = shown.filter((item) => item.pinned).map((item) => ({ video: item.video, reasons: [{ label: "Pinned", tone: "good" }] as Reason[] }));
  const rest = shown.filter((item) => !item.pinned).map((item) => item.video);
  if (!lens) return { order: [...pinned, ...rest.map((video) => ({ video, reasons: [] as Reason[] }))], aside: [] };
  const { ranked, aside } = rank(rest, lens, judgments);
  return { order: [...pinned, ...ranked.map(({ video, reasons }) => ({ video, reasons }))], aside };
}

/** A video as stored in a published feed: enough to list, rank and play it, without the long description. */
const snapshotVideo = (video: Video): Video => ({
  ...video,
  description: video.description.slice(0, 400),
  keywords: video.keywords?.slice(0, 12),
  complete: undefined,
});

export function toPublished(draft: FeedDraft, judgments: Judgments, author?: string): PublishedFeed {
  const items = draft.items.filter((item) => !item.hidden).map((item) => ({ video: snapshotVideo(item.video), ...item.note?.trim() ? { note: item.note.trim() } : {}, ...item.pinned ? { pinned: true } : {} }));
  const ids = new Set(items.map((item) => item.video.id));
  const kept = Object.fromEntries((draft.lens?.questions ?? []).map((question) => {
    const key = questionKey(question.text);
    return [key, Object.fromEntries(Object.entries(judgments[key] ?? {}).filter(([id]) => ids.has(id)))];
  }));
  return { v: 1, title: draft.title.trim() || "Untitled feed", blurb: draft.blurb.trim(), emoji: draft.emoji, color: draft.color, ...author ? { author } : {}, lens: draft.lens, items, judgments: kept, publishedAt: Date.now() };
}

/** Changes whenever what viewers would see changes, to tell the organizer their link is behind the draft. */
export const fingerprint = (feed: PublishedFeed) => {
  const text = JSON.stringify({ ...feed, publishedAt: 0 });
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  return hash.toString(36);
};

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const color = (value: unknown): FeedColor => FEED_COLORS.includes(value as FeedColor) ? value as FeedColor : "pink";

/** Only the fields a feed shows. Anything else a client sends is dropped before it is stored. */
function parseVideo(value: unknown): Video | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || !/^[\w-]{11}$/.test(item.id) || typeof item.title !== "string") return null;
  const number = (key: string) => typeof item[key] === "number" && Number.isFinite(item[key]) ? item[key] as number : undefined;
  const chapters = Array.isArray(item.chapters) ? item.chapters.flatMap((chapter) => {
    const candidate = record(chapter);
    return candidate && typeof candidate.start === "number" && typeof candidate.title === "string" ? [{ start: candidate.start, title: candidate.title.slice(0, 120) }] : [];
  }).slice(0, 40) : [];
  const keywords = Array.isArray(item.keywords) ? item.keywords.filter((word): word is string => typeof word === "string").slice(0, 12) : [];
  const thumbnail = string(item.thumbnail, 300);
  const avatar = string(item.channelAvatar, 300);
  return {
    id: item.id, title: item.title.slice(0, 200), channel: string(item.channel, 100) || "YouTube", description: string(item.description, 400),
    thumbnail: /^https:\/\/[\w.-]*(ytimg|ggpht|googleusercontent)\.com\//.test(thumbnail) ? thumbnail : `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    published: string(item.published, 40) || undefined, durationSeconds: number("durationSeconds"), views: number("views"), likes: number("likes"),
    subscribers: number("subscribers"), channelAvatar: /^https:\/\/[\w.-]*(ggpht|googleusercontent|ytimg)\.com\//.test(avatar) ? avatar : undefined,
    category: string(item.category, 40) || undefined, chapters: chapters.length ? chapters : undefined, keywords: keywords.length ? keywords : undefined,
  };
}

/** Validates a published feed, both when the Worker stores one and when a viewer's browser reads one. */
export function parsePublishedFeed(value: unknown): PublishedFeed | null {
  const item = record(value);
  if (!item || !Array.isArray(item.items)) return null;
  const seen = new Set<string>();
  const items = item.items.flatMap((entry) => {
    const candidate = record(entry);
    const video = parseVideo(candidate?.video);
    if (!video || seen.has(video.id)) return [];
    seen.add(video.id);
    const note = string(candidate?.note, 280).trim();
    return [{ video, ...note ? { note } : {}, ...candidate?.pinned === true ? { pinned: true } : {} }];
  }).slice(0, MAX_FEED_ITEMS);
  if (!items.length) return null;
  const author = string(item.author, 60).trim();
  return {
    v: 1, title: string(item.title, 80).trim() || "Untitled feed", blurb: string(item.blurb, 400).trim(), emoji: string(item.emoji, 8) || "✨", color: color(item.color),
    ...author ? { author } : {}, lens: parseLens(item.lens), items, judgments: parseJudgments(item.judgments),
    publishedAt: typeof item.publishedAt === "number" ? item.publishedAt : Date.now(),
  };
}

/** Validates drafts read back from IndexedDB. */
export function parseDrafts(value: unknown): FeedDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): FeedDraft[] => {
    const item = record(entry);
    if (!item || typeof item.id !== "string" || !Array.isArray(item.items)) return [];
    const items = item.items.flatMap((raw): FeedItem[] => {
      const candidate = record(raw);
      const video = candidate && record(candidate.video) && typeof record(candidate.video)!.id === "string" ? candidate.video as Video : null;
      return video ? [{ video, note: string(candidate!.note, 280) || undefined, pinned: candidate!.pinned === true || undefined, hidden: candidate!.hidden === true || undefined }] : [];
    });
    const published = record(item.published);
    return [{
      id: item.id, title: string(item.title, 80), blurb: string(item.blurb, 400), emoji: string(item.emoji, 8) || "✨", color: color(item.color), items, lens: parseLens(item.lens),
      published: published && typeof published.id === "string" ? { id: published.id, at: Number(published.at) || 0, fingerprint: string(published.fingerprint, 40) } : undefined,
      updatedAt: Number(item.updatedAt) || 0,
    }];
  });
}
