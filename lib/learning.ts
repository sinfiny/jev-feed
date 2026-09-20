export type Video = {
  id: string;
  title: string;
  channel: string;
  description: string;
  thumbnail: string;
  published?: string;
};

export type FeedTemplate = "stretch" | "balanced" | "kids";

export type VideoMetrics = {
  difficulty: number;
  learnability: number;
  depth: number;
  clarity: number;
  focus: number;
};

export type RankedVideo = Video & VideoMetrics & {
  score: number;
  reason: string;
  classification: string;
  signals: string[];
};

export type PlaylistProgress = { mastery: number; completed: string[] };
export type LearningState = Record<string, PlaylistProgress>;

export const LEARNING_STATE_KEY = "keen-learning-state-v2";
export const DEFAULT_MASTERY = 64;

export const templateDefinitions: Record<FeedTemplate, { name: string; shortName: string; description: string }> = {
  stretch: { name: "Learning edge", shortName: "Stretch", description: "Prioritizes the hardest video you can probably understand next." },
  balanced: { name: "Strong foundations", shortName: "Balanced", description: "Balances clarity, depth, relevance, and a steady rise in difficulty." },
  kids: { name: "Brain-rot rescue", shortName: "For kids", description: "Rewards substance and clarity while pushing clickbait and distraction down." },
};

const hardTerms = /advanced|proof|theorem|derive|derivation|architecture|internals|from scratch|deep dive|graduate|optimization|algorithm|geometry|paradox|formal/i;
const gentleTerms = /intro|introduction|beginner|basics|overview|explained|intuition|visual|essence|first|simple/i;
const practicalTerms = /tutorial|build|exercise|practice|project|example|how to|implementation|experiment/i;
const depthTerms = /why|how|history|science|mathematics|engineering|lesson|lecture|documentary|analysis|explained|course|chapter/i;
const distractionTerms = /shocking|insane|crazy|unbelievable|must watch|viral|secret|hack|prank|reaction|challenge|vs\.?|shorts?|satisfying|compilation/i;

const clamp = (value: number, min = 1, max = 99) => Math.max(min, Math.min(max, Math.round(value)));

export function rankVideos(videos: Video[], mastery: number, completed: string[], template: FeedTemplate = "stretch"): RankedVideo[] {
  const completedIds = new Set(completed);

  return videos
    .filter((video) => !completedIds.has(video.id))
    .map((video, index) => {
      const text = `${video.title} ${video.description}`;
      const hasHard = hardTerms.test(text);
      const hasGentle = gentleTerms.test(text);
      const hasPractical = practicalTerms.test(text);
      const hasDepth = depthTerms.test(text);
      const hasDistraction = distractionTerms.test(text);
      const titleWords = video.title.trim().split(/\s+/).length;
      const shoutiness = (video.title.match(/[!?]/g)?.length ?? 0) * 4 + (video.title === video.title.toUpperCase() ? 14 : 0);

      const difficulty = clamp(48 + (hasHard ? 20 : 0) - (hasGentle ? 11 : 0) + Math.min(index * 1.4, 16), 25, 96);
      const gap = Math.abs(difficulty - mastery);
      const learnability = clamp(100 - gap * 2.2, 20, 99);
      const depth = clamp(50 + (hasDepth ? 22 : 0) + (hasHard ? 10 : 0) + (video.description.length > 180 ? 8 : 0) - (hasDistraction ? 18 : 0), 18, 98);
      const clarity = clamp(68 + (hasGentle ? 18 : 0) + (hasPractical ? 8 : 0) - (titleWords > 15 ? 8 : 0) - shoutiness / 2, 22, 98);
      const focus = clamp(88 - (hasDistraction ? 38 : 0) - shoutiness + (hasDepth ? 6 : 0), 12, 99);

      const relevance = 86 + (hasPractical ? 8 : 0);
      const tooHardPenalty = difficulty > mastery + 20 ? 22 : 0;
      const score = template === "kids"
        ? clamp(depth * 0.31 + clarity * 0.27 + focus * 0.34 + learnability * 0.08)
        : template === "balanced"
          ? clamp(depth * 0.28 + clarity * 0.24 + learnability * 0.3 + relevance * 0.18 - tooHardPenalty * 0.45)
          : clamp(difficulty * 0.34 + learnability * 0.42 + depth * 0.12 + relevance * 0.12 - tooHardPenalty);

      const classification = template === "kids"
        ? focus >= 78 && depth >= 65 ? "Substance-first" : focus < 55 ? "High distraction risk" : "Kid-friendly watch"
        : difficulty > mastery + 20 ? "Save for later" : difficulty >= mastery - 4 ? "At your learning edge" : hasPractical ? "Practice and apply" : "Build the foundation";

      const signals = [
        hasGentle ? "Clear entry point" : hasHard ? "Concept dense" : "Moderate ramp",
        hasPractical ? "Practical examples" : hasDepth ? "Explains the why" : "Topic building",
        focus >= 78 ? "Low distraction" : focus < 55 ? "Clickbait signals" : "Mixed pacing",
      ];

      const reason = template === "kids"
        ? `${classification} · ${depth >= 70 ? "meaningful depth" : "accessible substance"} with ${focus >= 78 ? "few distraction signals" : "some attention-grabbing signals"}`
        : template === "balanced"
          ? `${classification} · balances ${clarity >= depth ? "clarity" : "depth"} with your current level`
          : difficulty > mastery + 20
            ? "Save for later · beyond your current edge"
            : difficulty >= mastery - 4
              ? "High concept density · right edge of your level"
              : hasPractical
                ? "Practice-heavy · reinforces current knowledge"
                : "Builds the foundation for harder videos";

      return { ...video, difficulty, learnability, depth, clarity, focus, score, classification, signals, reason };
    })
    .sort((a, b) => b.score - a.score || b.depth - a.depth);
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
