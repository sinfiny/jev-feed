export type Chapter = { start: number; title: string };

export type Video = {
  id: string;
  title: string;
  channel: string;
  description: string;
  thumbnail: string;
  published?: string;
  /** Length in seconds, read from the playlist page badge or the watch page. */
  durationSeconds?: number;
  views?: number;
  likes?: number;
  /** The channel's subscriber count, copied onto each of its videos. */
  subscribers?: number;
  channelAvatar?: string;
  /** YouTube's own category, e.g. "Education". Only known after watch-page enrichment. */
  category?: string;
  /** Creator chapters (or YouTube's auto-generated ones), each with its start time in seconds. */
  chapters?: Chapter[];
  keywords?: string[];
  /** Set once a source with the full description (Data API or /api/video) has been read, so enrichment never repeats. */
  complete?: boolean;
  /** When these details were read from YouTube. Stamped by the API routes that read them. */
  fetchedAt?: number;
};

/** YouTube's API policy lets details be kept for 30 days before they are read again or removed. A day of slack. */
const DETAILS_MAX_AGE = 29 * 24 * 60 * 60 * 1000;
/** Copies saved before videos carried `fetchedAt` count as read on the day signed-in libraries and published feeds shipped. */
const FETCHED_BEFORE_STAMPS = Date.UTC(2026, 8, 29);

export const fetchedAt = (video: Pick<Video, "fetchedAt">) => video.fetchedAt ?? FETCHED_BEFORE_STAMPS;
export const isStale = (video: Pick<Video, "fetchedAt">, now: number) => now - fetchedAt(video) > DETAILS_MAX_AGE;

export type PlaylistProgress = { mastery: number; completed: string[] };
export type LearningState = Record<string, PlaylistProgress>;

/** The username-era progress store. Read once by lib/library.ts to migrate, never written. */
export const LEARNING_STATE_KEY = "keen-learning-state-v2";
export const DEFAULT_MASTERY = 64;

const hardTerms = /advanced|proof|theorem|derive|derivation|architecture|internals|from scratch|deep dive|graduate|optimization|algorithm|geometry|paradox|formal/i;
const gentleTerms = /intro|introduction|beginner|basics|overview|explained|intuition|visual|essence|first|simple/i;
const practicalTerms = /tutorial|build|exercise|practice|project|example|how to|implementation|experiment/i;
const depthTerms = /why|how|history|science|mathematics|engineering|lesson|lecture|documentary|analysis|explained|course|chapter/i;
const curiosityTerms = /inside|internals|under the hood|from scratch|first principles|why|paradox|deep dive|architecture|history|design|trade-?offs?|behind/i;
const distractionTerms = /shocking|insane|crazy|unbelievable|must watch|viral|secret|hack|prank|reaction|challenge|vs\.?|shorts?|satisfying|compilation/i;

const studiousCategories = /education|science|howto|how-to/i;
const entertainmentCategories = /entertainment|gaming|comedy|music|sports/i;

export const SHORT_VIDEO_SECONDS = 90;
export const LONG_VIDEO_SECONDS = 25 * 60;

export function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** 1234 → "1.2K", 3_400_000 → "3.4M". */
export function formatCount(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "";
  if (value < 1000) return String(value);
  const [scale, suffix] = value >= 1e9 ? [1e9, "B"] : value >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const short = value / scale;
  return `${short >= 100 ? Math.round(short) : Number(short.toFixed(1))}${suffix}`;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));

/**
 * What the title, description, length, category and chapters suggest about a video, each from 0 to 1.
 * Regex-and-weights on purpose: it needs no key and ranks a few hundred videos in milliseconds.
 */
export function heuristics(video: Video) {
  const text = `${video.title} ${video.description} ${(video.keywords ?? []).join(" ")}`;
  const hard = hardTerms.test(text);
  const gentle = gentleTerms.test(text);
  const practical = practicalTerms.test(text);
  const deep = depthTerms.test(text);
  const curious = curiosityTerms.test(text);
  const distracting = distractionTerms.test(text);
  const titleWords = video.title.trim().split(/\s+/).length;
  const shoutiness = (video.title.match(/[!?]/g)?.length ?? 0) * 4 + (video.title.length > 8 && video.title === video.title.toUpperCase() ? 14 : 0);
  const seconds = video.durationSeconds ?? 0;
  const short = seconds > 0 && seconds < SHORT_VIDEO_SECONDS;
  const long = seconds >= LONG_VIDEO_SECONDS;
  const studious = !!video.category && studiousCategories.test(video.category);
  const entertainment = !!video.category && entertainmentCategories.test(video.category);
  const chaptered = (video.chapters?.length ?? 0) >= 3;
  const described = video.description.length;

  return {
    depth: unit((50 + (deep ? 22 : 0) + (hard ? 10 : 0) + (described > 180 ? 8 : 0) + (long ? 10 : 0) - (short ? 22 : 0) + (studious ? 8 : 0) - (entertainment ? 8 : 0) - (distracting ? 18 : 0)) / 100),
    focus: unit((88 - (distracting ? 38 : 0) - shoutiness + (deep ? 6 : 0) - (short ? 25 : 0) - (entertainment ? 10 : 0) + (studious ? 4 : 0)) / 100),
    handsOn: unit((42 + (practical ? 38 : 0) + (gentle ? 8 : 0) + (chaptered ? 6 : 0) + (described > 120 ? 6 : 0) - (short ? 10 : 0) - (distracting ? 14 : 0)) / 100),
    gentle: unit((58 + (gentle ? 26 : 0) + (practical ? 6 : 0) + (chaptered ? 6 : 0) - (hard ? 22 : 0) - (titleWords > 15 ? 8 : 0) - shoutiness / 2) / 100),
    curious: unit((45 + (curious ? 32 : 0) + (hard ? 12 : 0) + (deep ? 8 : 0) + (long ? 4 : 0) - (short ? 10 : 0) - (distracting ? 12 : 0)) / 100),
  };
}

export function parseLearningState(raw: string | null): LearningState {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([playlistId, progress]) => {
      if (!progress || typeof progress !== "object" || Array.isArray(progress)) return [];
      const candidate = progress as { mastery?: unknown; completed?: unknown };
      const mastery = typeof candidate.mastery === "number" && Number.isFinite(candidate.mastery)
        ? Math.max(30, Math.min(92, candidate.mastery)) : DEFAULT_MASTERY;
      const completed = Array.isArray(candidate.completed)
        ? [...new Set(candidate.completed.filter((id): id is string => typeof id === "string"))] : [];
      return [[playlistId, { mastery, completed }]];
    }));
  } catch { return {}; }
}
