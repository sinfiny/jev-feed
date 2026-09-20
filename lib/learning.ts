export type Video = {
  id: string;
  title: string;
  channel: string;
  description: string;
  thumbnail: string;
  published?: string;
};

export type RankedVideo = Video & {
  difficulty: number;
  learnability: number;
  score: number;
  reason: string;
};

export type PlaylistProgress = {
  mastery: number;
  completed: string[];
};

export type LearningState = Record<string, PlaylistProgress>;

export const LEARNING_STATE_KEY = "keen-learning-state-v2";
export const DEFAULT_MASTERY = 64;

const hardTerms = /advanced|proof|theorem|derive|derivation|architecture|internals|from scratch|deep dive|graduate|optimization|algorithm|geometry|paradox|formal/i;
const gentleTerms = /intro|introduction|beginner|basics|overview|explained|intuition|visual|essence|first/i;
const practicalTerms = /tutorial|build|exercise|practice|project|example|how to|implementation/i;

export function rankVideos(videos: Video[], mastery: number, completed: string[]): RankedVideo[] {
  const completedIds = new Set(completed);

  return videos
    .filter((video) => !completedIds.has(video.id))
    .map((video, index) => {
      const text = `${video.title} ${video.description}`;
      const difficulty = Math.max(25, Math.min(96, 48 + (hardTerms.test(text) ? 20 : 0) - (gentleTerms.test(text) ? 11 : 0) + Math.min(index * 2, 14)));
      const gap = Math.abs(difficulty - mastery);
      const learnability = Math.max(20, Math.round(100 - gap * 2.25));
      const relevance = 88 + (practicalTerms.test(text) ? 7 : 0);
      const tooHardPenalty = difficulty > mastery + 20 ? 22 : 0;
      const score = Math.max(1, Math.min(99, Math.round(difficulty * 0.38 + learnability * 0.44 + relevance * 0.18 - tooHardPenalty)));
      const reason = difficulty > mastery + 20
        ? "Save for later · beyond your current edge"
        : difficulty >= mastery - 4
          ? "High concept density · right edge of your level"
          : practicalTerms.test(text)
            ? "Practice-heavy · reinforces current knowledge"
            : "Builds the foundation for harder videos";
      return { ...video, difficulty, learnability, score, reason };
    })
    .sort((a, b) => b.score - a.score || b.difficulty - a.difficulty);
}

export function parseLearningState(raw: string | null): LearningState {
  if (!raw) return {};

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    return Object.fromEntries(
      Object.entries(value).flatMap(([playlistId, progress]) => {
        if (!progress || typeof progress !== "object" || Array.isArray(progress)) return [];
        const candidate = progress as { mastery?: unknown; completed?: unknown };
        const mastery = typeof candidate.mastery === "number" && Number.isFinite(candidate.mastery)
          ? Math.max(30, Math.min(92, candidate.mastery))
          : DEFAULT_MASTERY;
        const completed = Array.isArray(candidate.completed)
          ? [...new Set(candidate.completed.filter((id): id is string => typeof id === "string"))]
          : [];
        return [[playlistId, { mastery, completed }]];
      }),
    );
  } catch {
    return {};
  }
}

export function readLearningState(): LearningState {
  if (typeof window === "undefined") return {};
  return parseLearningState(window.localStorage.getItem(LEARNING_STATE_KEY));
}

export function progressForPlaylist(state: LearningState, playlistId: string, videoIds?: string[]): PlaylistProgress {
  const saved = state[playlistId];
  const allowedIds = videoIds ? new Set(videoIds) : null;

  return {
    mastery: saved?.mastery ?? DEFAULT_MASTERY,
    completed: (saved?.completed ?? []).filter((id) => !allowedIds || allowedIds.has(id)),
  };
}
