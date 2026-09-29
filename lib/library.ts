import { LEARNING_STATE_KEY, parseLearningState, type Chapter, type Video } from "@/lib/learning";
import { mergeVideos } from "@/lib/youtube-playlist";
import { readStore, writeStore } from "@/lib/store";

/**
 * The viewer's playlists and what they have done with each video, both kept in the browser.
 * Playlists are local copies of the playlists in the viewer's YouTube account. A visit re-reads only playlists
 * whose first page changed, and fetches details only for videos it has not seen (see app/page.tsx).
 * Progress is keyed by video id, so a video marked done is done in every playlist that holds it.
 * Playlists (large, rarely written) live in IndexedDB; progress (small, written while watching) in localStorage.
 */
/** Where playlists lived before IndexedDB. Read once to migrate, then removed. */
export const LIBRARY_KEY = "jev-library-v1";
export const PROGRESS_KEY = "jev-progress-v1";
/** The username-era store. Read once to migrate, never written. */
const LEGACY_ACCOUNT_KEY = "jev-account-v1";
export const MAX_PLAYLISTS = 12;
/** Descriptions are kept this long. Chapters are read from the full text before it is cut. */
const DESCRIPTION_CHARS = 2000;
export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;

export type LibraryPlaylist = {
  id: string;
  title: string;
  videos: Video[];
  /** The YouTube playlist this copies. A sync from the account matches on it. Missing on playlists from before sign-in. */
  sourcePlaylistId?: string;
  /** The item count and first page of ids when last read. A visit whose first page matches skips the playlist. */
  signature?: string;
  /** The lens this playlist is ordered by in the sidebar. Playlist order when unset. */
  lensId?: string;
};

export type Bookmark = { id: string; seconds: number; label: string };

export type VideoProgress = {
  status?: "done" | "snoozed";
  /** Where playback last stopped, in seconds. */
  position?: number;
  bookmarks?: Bookmark[];
  /** Start times of chapters watched to their end. */
  doneChapters?: number[];
};

export type Progress = {
  videos: Record<string, VideoProgress>;
  rate: number;
  /** The video open when the viewer left, reopened paused on the next visit. */
  last?: { playlistId: string; videoId: string };
};

export type VideoState = "new" | "started" | "snoozed" | "done";

/** A place to start watching inside a video: a creator chapter, which ends where the next begins, or a bookmark. */
export type Moment =
  | { kind: "chapter"; start: number; end?: number; title: string; done: boolean }
  | { kind: "bookmark"; start: number; title: string; id: string };

export const emptyProgress = (): Progress => ({ videos: {}, rate: 1 });

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Validates one stored video. Chapters saved before they carried start times were plain strings;
 * those are dropped along with the description, so the next enrichment pass reads them again.
 */
function parseVideo(value: unknown): Video[] {
  const item = record(value);
  if (!item || typeof item.id !== "string" || typeof item.title !== "string") return [];
  const video = { ...item } as Video;
  if (typeof video.description !== "string") video.description = "";
  else video.description = video.description.slice(0, DESCRIPTION_CHARS);
  if (Array.isArray(item.chapters)) {
    const chapters = item.chapters.flatMap((chapter): Chapter[] => {
      const candidate = record(chapter);
      return candidate && finite(candidate.start) && typeof candidate.title === "string" ? [{ start: candidate.start, title: candidate.title }] : [];
    });
    if (chapters.length !== item.chapters.length) { delete video.chapters; video.description = ""; } else video.chapters = chapters;
  }
  return [video];
}

function parsePlaylist(value: unknown): LibraryPlaylist[] {
  const item = record(value);
  if (!item || typeof item.id !== "string" || typeof item.title !== "string") return [];
  const seen = new Set<string>();
  const videos = (Array.isArray(item.videos) ? item.videos.flatMap(parseVideo) : []).filter((video) => !seen.has(video.id) && !!seen.add(video.id));
  const text = (value: unknown) => typeof value === "string" ? value : undefined;
  return [{ id: item.id, title: item.title, videos, sourcePlaylistId: text(item.sourcePlaylistId), signature: text(item.signature), lensId: text(item.lensId) }];
}

/** Validates playlists read from IndexedDB or the older localStorage copy. */
export const parseLibraryValue = (value: unknown): LibraryPlaylist[] => Array.isArray(value) ? value.flatMap(parsePlaylist).slice(0, MAX_PLAYLISTS) : [];

/** Returns null when nothing is stored, which is the cue to migrate from the username-era store. */
export function parseLibrary(raw: string | null): LibraryPlaylist[] | null {
  if (!raw) return null;
  try { return parseLibraryValue(JSON.parse(raw)); } catch { return []; }
}

export function parseProgress(raw: string | null): Progress | null {
  if (!raw) return null;
  try {
    const value = record(JSON.parse(raw));
    if (!value) return emptyProgress();
    const videos: Record<string, VideoProgress> = {};
    for (const [id, entry] of Object.entries(record(value.videos) ?? {})) {
      const item = record(entry);
      if (!item) continue;
      const bookmarks = Array.isArray(item.bookmarks) ? item.bookmarks.flatMap((bookmark): Bookmark[] => {
        const candidate = record(bookmark);
        return candidate && typeof candidate.id === "string" && finite(candidate.seconds) ? [{ id: candidate.id, seconds: candidate.seconds, label: typeof candidate.label === "string" ? candidate.label : "" }] : [];
      }) : [];
      videos[id] = {
        status: item.status === "done" || item.status === "snoozed" ? item.status : undefined,
        position: finite(item.position) ? item.position : undefined,
        bookmarks: bookmarks.length ? bookmarks : undefined,
        doneChapters: Array.isArray(item.doneChapters) ? item.doneChapters.filter(finite) : undefined,
      };
    }
    const last = record(value.last);
    return {
      videos,
      rate: SPEEDS.some((speed) => speed === value.rate) ? value.rate as number : 1,
      last: last && typeof last.playlistId === "string" && typeof last.videoId === "string" ? { playlistId: last.playlistId, videoId: last.videoId } : undefined,
    };
  } catch { return emptyProgress(); }
}

/**
 * Carries the username-era data forward: every username's owned playlists become the viewer's playlists,
 * and every video once marked complete in any playlist becomes done. Mastery has no successor and is dropped.
 */
export function migrateLegacy(accountRaw: string | null, learningRaw: string | null): { playlists: LibraryPlaylist[]; progress: Progress } {
  const progress = emptyProgress();
  for (const { completed } of Object.values(parseLearningState(learningRaw))) {
    for (const id of completed) progress.videos[id] = { status: "done" };
  }
  let playlists: LibraryPlaylist[] = [];
  try {
    const owned = record(record(JSON.parse(accountRaw ?? "null"))?.playlists);
    const seen = new Set<string>();
    playlists = Object.values(owned ?? {}).flatMap((list) => Array.isArray(list) ? list.flatMap(parsePlaylist) : [])
      .filter((playlist) => !seen.has(playlist.id) && !!seen.add(playlist.id)).slice(0, MAX_PLAYLISTS);
  } catch { /* An unreadable legacy store has nothing to carry forward. */ }
  return { playlists, progress };
}

/**
 * Playlists from IndexedDB, else the localStorage copy from before IndexedDB (moved over and removed),
 * else the username-era store. Progress from localStorage, else the username-era store.
 */
export async function readLibrary(): Promise<{ playlists: LibraryPlaylist[]; progress: Progress }> {
  if (typeof window === "undefined") return { playlists: [], progress: emptyProgress() };
  const storage = window.localStorage;
  const stored = await readStore("library");
  let playlists = stored === undefined ? parseLibrary(storage.getItem(LIBRARY_KEY)) : parseLibraryValue(stored);
  if (stored === undefined && playlists) { await writeStore("library", playlists); storage.removeItem(LIBRARY_KEY); }
  const progress = parseProgress(storage.getItem(PROGRESS_KEY));
  if (playlists && progress) return { playlists, progress };
  const legacy = migrateLegacy(storage.getItem(LEGACY_ACCOUNT_KEY), storage.getItem(LEARNING_STATE_KEY));
  playlists ??= legacy.playlists;
  return { playlists, progress: progress ?? legacy.progress };
}

export const writeLibrary = (playlists: LibraryPlaylist[]) => writeStore("library", playlists);

export function writeProgress(progress: Progress) {
  if (typeof window !== "undefined") window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Every video in the library by id, for knowing which ids a sync still has to fetch. */
export const videosById = (playlists: LibraryPlaylist[]) => new Map(playlists.flatMap((playlist) => playlist.videos.map((video) => [video.id, video] as const)));

/** Cheap fingerprint of a YouTube playlist: its item count and the ids on its first page. */
export const playlistSignature = (total: number, firstPage: string[]) => `${total}:${firstPage.join(",")}`;

/** Cuts a video down to what is stored: the description is capped once chapters have been read from it. */
export const storedVideo = (video: Video): Video => video.description.length > DESCRIPTION_CHARS ? { ...video, description: video.description.slice(0, DESCRIPTION_CHARS) } : video;

/**
 * Replaces the library with the playlists from the viewer's YouTube account, in the account's order.
 * A playlist already in the library keeps its id, so the last open video still reopens, its lens, and the
 * descriptions and chapters enrichment already found. An incoming playlist without videos is unchanged
 * since the last visit and is kept as it was. Playlists no longer in the account drop out; their progress stays.
 */
export function syncPlaylists(current: LibraryPlaylist[], incoming: Array<{ id: string; title: string; videos?: Video[]; signature?: string }>): LibraryPlaylist[] {
  return incoming.slice(0, MAX_PLAYLISTS).flatMap((source) => {
    const existing = current.find((playlist) => playlist.sourcePlaylistId === source.id);
    if (!source.videos) return existing ? [{ ...existing, title: source.title }] : [];
    const known = new Map(existing?.videos.map((video) => [video.id, video]));
    const seen = new Set<string>();
    const videos = source.videos.filter((video) => !seen.has(video.id) && !!seen.add(video.id))
      .map((video) => storedVideo(mergeVideos(video.id, video, known.get(video.id) ?? null)!));
    return [{ id: existing?.id ?? newId("p"), title: source.title, videos, sourcePlaylistId: source.id, signature: source.signature ?? existing?.signature, lensId: existing?.lensId }];
  });
}

/** Puts a video at the top of a playlist, or takes it out. Used to mirror a like into the Liked playlist. */
export const setMembership = (playlists: LibraryPlaylist[], sourcePlaylistId: string, video: Video, member: boolean) =>
  playlists.map((playlist) => playlist.sourcePlaylistId !== sourcePlaylistId ? playlist
    : { ...playlist, videos: [...member ? [video] : [], ...playlist.videos.filter((item) => item.id !== video.id)] });

export const setPlaylistLens = (playlists: LibraryPlaylist[], playlistId: string, lensId: string | undefined) =>
  playlists.map((playlist) => playlist.id === playlistId ? { ...playlist, lensId } : playlist);

/** Merges enriched metadata into every copy of a video, without changing order or membership. */
export function mergeVideoDetails(playlists: LibraryPlaylist[], details: Video[]) {
  if (!details.length) return playlists;
  const byId = new Map(details.map((video) => [video.id, video]));
  return playlists.map((playlist) => ({ ...playlist, videos: playlist.videos.map((video) => byId.has(video.id) ? storedVideo(mergeVideos(video.id, byId.get(video.id)!, video)!) : video) }));
}

const updateVideo = (progress: Progress, videoId: string, change: (current: VideoProgress) => VideoProgress): Progress =>
  ({ ...progress, videos: { ...progress.videos, [videoId]: change(progress.videos[videoId] ?? {}) } });

/** Sets or clears done/snoozed. Passing the current status clears it, so the same control is its own undo. */
export const toggleStatus = (progress: Progress, videoId: string, status: "done" | "snoozed") =>
  updateVideo(progress, videoId, (current) => ({ ...current, status: current.status === status ? undefined : status }));

export const savePosition = (progress: Progress, videoId: string, seconds: number) =>
  updateVideo(progress, videoId, (current) => ({ ...current, position: Math.max(0, Math.floor(seconds)) }));

export function addBookmark(progress: Progress, videoId: string, seconds: number) {
  const bookmark: Bookmark = { id: newId("b"), seconds: Math.max(0, Math.floor(seconds)), label: "" };
  return { progress: updateVideo(progress, videoId, (current) => ({ ...current, bookmarks: [...current.bookmarks ?? [], bookmark].sort((a, b) => a.seconds - b.seconds) })), bookmark };
}

export const labelBookmark = (progress: Progress, videoId: string, bookmarkId: string, label: string) =>
  updateVideo(progress, videoId, (current) => ({ ...current, bookmarks: current.bookmarks?.map((bookmark) => bookmark.id === bookmarkId ? { ...bookmark, label: label.slice(0, 200) } : bookmark) }));

export const removeBookmark = (progress: Progress, videoId: string, bookmarkId: string) =>
  updateVideo(progress, videoId, (current) => ({ ...current, bookmarks: current.bookmarks?.filter((bookmark) => bookmark.id !== bookmarkId) }));

export const toggleChapterDone = (progress: Progress, videoId: string, start: number) =>
  updateVideo(progress, videoId, (current) => {
    const done = current.doneChapters ?? [];
    return { ...current, doneChapters: done.includes(start) ? done.filter((item) => item !== start) : [...done, start] };
  });

export function videoState(progress: VideoProgress | undefined): VideoState {
  if (progress?.status) return progress.status;
  return (progress?.position ?? 0) > 5 || progress?.doneChapters?.length ? "started" : "new";
}

const stateOrder: Record<VideoState, number> = { started: 0, new: 0, snoozed: 1, done: 2 };

/** Playlist order, except snoozed videos sink below the rest and done videos sink to the bottom. */
export const queueOrder = (videos: Video[], progress: Progress) => videos
  .map((video, index) => ({ video, index, state: videoState(progress.videos[video.id]) }))
  .sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || a.index - b.index);

/** Chapters and bookmarks in time order. A chapter ends where the next chapter starts, or at the end of the video. */
export function momentsFor(video: Video, progress: VideoProgress | undefined): Moment[] {
  const chapters = video.chapters ?? [];
  const done = new Set(progress?.doneChapters ?? []);
  return [
    ...chapters.map((chapter, index): Moment => ({ kind: "chapter", start: chapter.start, end: chapters[index + 1]?.start ?? video.durationSeconds, title: chapter.title, done: done.has(chapter.start) })),
    ...(progress?.bookmarks ?? []).map((bookmark): Moment => ({ kind: "bookmark", start: bookmark.seconds, title: bookmark.label, id: bookmark.id })),
  ].sort((a, b) => a.start - b.start || (a.kind === "chapter" ? -1 : 1));
}

/** The chapter playing at `seconds`, if the video has chapters. */
export const chapterAt = (video: Video, seconds: number) => (video.chapters ?? []).findLast((chapter) => chapter.start <= seconds);
