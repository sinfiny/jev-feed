import type { Video } from "@/lib/learning";

/**
 * Username-only accounts and the playlists each one owns.
 * Everything lives in the browser under ACCOUNT_KEY. There is no password and no server:
 * this is the shape of the feature, not a security boundary. A rebuild with D1 replaces the storage.
 */
export const ACCOUNT_KEY = "jev-account-v1";
export const MAX_PLAYLISTS = 5;
export const MAX_PLAYLIST_VIDEOS = 100;

export type UserPlaylist = {
  id: string;
  title: string;
  videos: Video[];
  createdAt: string;
  /** Set when the playlist started as a copy of a YouTube playlist. */
  sourcePlaylistId?: string;
};

export type AccountStore = {
  /** The signed-in username, or null when signed out. */
  username: string | null;
  playlists: Record<string, UserPlaylist[]>;
};

export const emptyStore = (): AccountStore => ({ username: null, playlists: {} });

/** Lowercase, 2-24 chars of letters, digits, dot, dash, underscore. Returns "" when invalid. */
export function normalizeUsername(raw: string) {
  const name = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,23}$/.test(name) ? name : "";
}

const isVideo = (value: unknown): value is Video => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string";
};

export function parseAccountStore(raw: string | null): AccountStore {
  if (!raw) return emptyStore();
  try {
    const value = JSON.parse(raw) as { username?: unknown; playlists?: unknown };
    const username = typeof value.username === "string" ? normalizeUsername(value.username) || null : null;
    const playlists: Record<string, UserPlaylist[]> = {};
    if (value.playlists && typeof value.playlists === "object") {
      for (const [owner, list] of Object.entries(value.playlists)) {
        if (!normalizeUsername(owner) || !Array.isArray(list)) continue;
        playlists[owner] = list.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const candidate = item as Record<string, unknown>;
          if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return [];
          return [{
            id: candidate.id,
            title: candidate.title,
            videos: Array.isArray(candidate.videos) ? candidate.videos.filter(isVideo).slice(0, MAX_PLAYLIST_VIDEOS) : [],
            createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
            sourcePlaylistId: typeof candidate.sourcePlaylistId === "string" ? candidate.sourcePlaylistId : undefined,
          }];
        }).slice(0, MAX_PLAYLISTS);
      }
    }
    return { username, playlists };
  } catch { return emptyStore(); }
}

export function readAccountStore(): AccountStore {
  if (typeof window === "undefined") return emptyStore();
  return parseAccountStore(window.localStorage.getItem(ACCOUNT_KEY));
}

export function writeAccountStore(store: AccountStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(store));
}

export const playlistsFor = (store: AccountStore, username: string | null) => (username && store.playlists[username]) || [];

export function signIn(store: AccountStore, raw: string): AccountStore {
  const username = normalizeUsername(raw);
  if (!username) throw new Error("Pick a username of 2-24 letters, numbers, dots, dashes, or underscores.");
  return { ...store, username, playlists: { ...store.playlists, [username]: store.playlists[username] ?? [] } };
}

export const signOut = (store: AccountStore): AccountStore => ({ ...store, username: null });

const requireUser = (store: AccountStore) => {
  if (!store.username) throw new Error("Sign in with a username first.");
  return store.username;
};

const replacePlaylists = (store: AccountStore, username: string, playlists: UserPlaylist[]): AccountStore =>
  ({ ...store, playlists: { ...store.playlists, [username]: playlists } });

const newId = () => `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function createPlaylist(store: AccountStore, title: string, videos: Video[] = [], sourcePlaylistId?: string) {
  const username = requireUser(store);
  const owned = playlistsFor(store, username);
  if (owned.length >= MAX_PLAYLISTS) throw new Error(`You can own up to ${MAX_PLAYLISTS} playlists. Delete one to make room.`);
  const cleanTitle = title.trim().slice(0, 80) || `Playlist ${owned.length + 1}`;
  const seen = new Set<string>();
  const playlist: UserPlaylist = {
    id: newId(),
    title: cleanTitle,
    videos: videos.filter((video) => !seen.has(video.id) && !!seen.add(video.id)).slice(0, MAX_PLAYLIST_VIDEOS),
    createdAt: new Date().toISOString(),
    sourcePlaylistId,
  };
  return { store: replacePlaylists(store, username, [...owned, playlist]), playlist };
}

export function deletePlaylist(store: AccountStore, playlistId: string): AccountStore {
  const username = requireUser(store);
  return replacePlaylists(store, username, playlistsFor(store, username).filter((playlist) => playlist.id !== playlistId));
}

export function renamePlaylist(store: AccountStore, playlistId: string, title: string): AccountStore {
  const username = requireUser(store);
  const cleanTitle = title.trim().slice(0, 80);
  if (!cleanTitle) throw new Error("Give the playlist a name.");
  return replacePlaylists(store, username, playlistsFor(store, username).map((playlist) => playlist.id === playlistId ? { ...playlist, title: cleanTitle } : playlist));
}

export function addVideo(store: AccountStore, playlistId: string, video: Video): AccountStore {
  const username = requireUser(store);
  return replacePlaylists(store, username, playlistsFor(store, username).map((playlist) => {
    if (playlist.id !== playlistId) return playlist;
    if (playlist.videos.some((item) => item.id === video.id)) throw new Error("That video is already in this playlist.");
    if (playlist.videos.length >= MAX_PLAYLIST_VIDEOS) throw new Error(`A playlist holds up to ${MAX_PLAYLIST_VIDEOS} videos.`);
    return { ...playlist, videos: [...playlist.videos, video] };
  }));
}

export function removeVideo(store: AccountStore, playlistId: string, videoId: string): AccountStore {
  const username = requireUser(store);
  return replacePlaylists(store, username, playlistsFor(store, username).map((playlist) =>
    playlist.id === playlistId ? { ...playlist, videos: playlist.videos.filter((video) => video.id !== videoId) } : playlist));
}

/** Merges enriched metadata into every copy of a video the user owns, without changing order or membership. */
export function mergeVideoDetails(store: AccountStore, details: Video[]): AccountStore {
  if (!store.username || !details.length) return store;
  const byId = new Map(details.map((video) => [video.id, video]));
  return replacePlaylists(store, store.username, playlistsFor(store, store.username).map((playlist) => ({
    ...playlist,
    videos: playlist.videos.map((video) => byId.has(video.id) ? { ...video, ...byId.get(video.id) } : video),
  })));
}
