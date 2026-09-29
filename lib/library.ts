import { LEARNING_STATE_KEY, parseLearningState, type Chapter, type Video } from "@/lib/learning";
import { mergeVideos } from "@/lib/youtube-playlist";

/**
 * The viewer's playlists and what they have done with each video, both kept in the browser.
 * Playlists are local copies, imported from a YouTube playlist link or built one video link at a time.
 * Progress is keyed by video id, so a video marked done is done in every playlist that holds it.
 * Playlists (large, rarely written) and progress (small, written while watching) use separate keys.
 */
export const LIBRARY_KEY = "jev-library-v1";
export const PROGRESS_KEY = "jev-progress-v1";
/** The username-era store. Read once to migrate, never written. */
const LEGACY_ACCOUNT_KEY = "jev-account-v1";
export const MAX_PLAYLISTS = 12;
export const MAX_PLAYLIST_VIDEOS = 100;
export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;

export type LibraryPlaylist = {
  id: string;
  title: string;
  videos: Video[];
  /** Set when the playlist is a copy of a YouTube playlist, so importing it again refreshes the copy. */
  sourcePlaylistId?: string;
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
  return [{ id: item.id, title: item.title, videos: videos.slice(0, MAX_PLAYLIST_VIDEOS), sourcePlaylistId: typeof item.sourcePlaylistId === "string" ? item.sourcePlaylistId : undefined }];
}

/** Returns null when nothing is stored, which is the cue to migrate from the username-era store. */
export function parseLibrary(raw: string | null): LibraryPlaylist[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.flatMap(parsePlaylist).slice(0, MAX_PLAYLISTS) : [];
  } catch { return []; }
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

export function readLibrary(): { playlists: LibraryPlaylist[]; progress: Progress } {
  if (typeof window === "undefined") return { playlists: [], progress: emptyProgress() };
  const storage = window.localStorage;
  const playlists = parseLibrary(storage.getItem(LIBRARY_KEY));
  const progress = parseProgress(storage.getItem(PROGRESS_KEY));
  if (playlists && progress) return { playlists, progress };
  const legacy = migrateLegacy(storage.getItem(LEGACY_ACCOUNT_KEY), storage.getItem(LEARNING_STATE_KEY));
  return { playlists: playlists ?? legacy.playlists, progress: progress ?? legacy.progress };
}

export function writeLibrary(playlists: LibraryPlaylist[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(playlists));
}

export function writeProgress(progress: Progress) {
  if (typeof window !== "undefined") window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Adds a playlist, or refreshes the videos of an existing copy of the same YouTube playlist. */
export function addPlaylist(playlists: LibraryPlaylist[], title: string, videos: Video[], sourcePlaylistId?: string) {
  const seen = new Set<string>();
  const unique = videos.filter((video) => !seen.has(video.id) && !!seen.add(video.id)).slice(0, MAX_PLAYLIST_VIDEOS);
  const existing = sourcePlaylistId ? playlists.find((playlist) => playlist.sourcePlaylistId === sourcePlaylistId) : undefined;
  if (existing) {
    const known = new Map(existing.videos.map((video) => [video.id, video]));
    // Fresh fields win, but a fresh import lacks the descriptions and chapters enrichment already found.
    const playlist = { ...existing, title, videos: unique.map((video) => mergeVideos(video.id, video, known.get(video.id) ?? null)!) };
    return { playlists: playlists.map((item) => item.id === existing.id ? playlist : item), playlist };
  }
  if (playlists.length >= MAX_PLAYLISTS) throw new Error(`Jev keeps up to ${MAX_PLAYLISTS} playlists. Remove one to make room.`);
  const playlist: LibraryPlaylist = { id: newId("p"), title: title.trim().slice(0, 80) || "Saved videos", videos: unique, sourcePlaylistId };
  return { playlists: [...playlists, playlist], playlist };
}

export const removePlaylist = (playlists: LibraryPlaylist[], playlistId: string) => playlists.filter((playlist) => playlist.id !== playlistId);

export function addVideo(playlists: LibraryPlaylist[], playlistId: string, video: Video) {
  return playlists.map((playlist) => {
    if (playlist.id !== playlistId) return playlist;
    if (playlist.videos.some((item) => item.id === video.id)) throw new Error("That video is already in this playlist.");
    if (playlist.videos.length >= MAX_PLAYLIST_VIDEOS) throw new Error(`A playlist holds up to ${MAX_PLAYLIST_VIDEOS} videos.`);
    return { ...playlist, videos: [...playlist.videos, video] };
  });
}

export const removeVideo = (playlists: LibraryPlaylist[], playlistId: string, videoId: string) =>
  playlists.map((playlist) => playlist.id === playlistId ? { ...playlist, videos: playlist.videos.filter((video) => video.id !== videoId) } : playlist);

/** Merges enriched metadata into every copy of a video, without changing order or membership. */
export function mergeVideoDetails(playlists: LibraryPlaylist[], details: Video[]) {
  if (!details.length) return playlists;
  const byId = new Map(details.map((video) => [video.id, video]));
  return playlists.map((playlist) => ({ ...playlist, videos: playlist.videos.map((video) => byId.has(video.id) ? mergeVideos(video.id, byId.get(video.id)!, video)! : video) }));
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
