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
  buildValue: number;
  curiosity: number;
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
  stretch: { name: "Deep Dive", shortName: "Deep", description: "Internals, first principles, proofs. The good 2 a.m. rabbit hole." },
  balanced: { name: "Ship Mode", shortName: "Build", description: "Code, demos, implementation. Leave with something working." },
  kids: { name: "No Slop", shortName: "Signal", description: "Maximum signal. Hype, reactions, and empty calories sink." },
};

const hardTerms = /advanced|proof|theorem|derive|derivation|architecture|internals|from scratch|deep dive|graduate|optimization|algorithm|geometry|paradox|formal/i;
const gentleTerms = /intro|introduction|beginner|basics|overview|explained|intuition|visual|essence|first|simple/i;
const practicalTerms = /tutorial|build|exercise|practice|project|example|how to|implementation|experiment/i;
const depthTerms = /why|how|history|science|mathematics|engineering|lesson|lecture|documentary|analysis|explained|course|chapter/i;
const curiosityTerms = /inside|internals|under the hood|from scratch|first principles|why|paradox|deep dive|architecture|history|design|trade-?offs?|behind/i;
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
      const hasCuriosity = curiosityTerms.test(text);
      const hasDistraction = distractionTerms.test(text);
      const titleWords = video.title.trim().split(/\s+/).length;
      const shoutiness = (video.title.match(/[!?]/g)?.length ?? 0) * 4 + (video.title === video.title.toUpperCase() ? 14 : 0);

      const difficulty = clamp(48 + (hasHard ? 20 : 0) - (hasGentle ? 11 : 0) + Math.min(index * 1.4, 16), 25, 96);
      const gap = Math.abs(difficulty - mastery);
      const learnability = clamp(100 - gap * 2.2, 20, 99);
      const depth = clamp(50 + (hasDepth ? 22 : 0) + (hasHard ? 10 : 0) + (video.description.length > 180 ? 8 : 0) - (hasDistraction ? 18 : 0), 18, 98);
      const clarity = clamp(68 + (hasGentle ? 18 : 0) + (hasPractical ? 8 : 0) - (titleWords > 15 ? 8 : 0) - shoutiness / 2, 22, 98);
      const focus = clamp(88 - (hasDistraction ? 38 : 0) - shoutiness + (hasDepth ? 6 : 0), 12, 99);
      const buildValue = clamp(42 + (hasPractical ? 38 : 0) + (hasGentle ? 8 : 0) + (video.description.length > 120 ? 6 : 0) - (hasDistraction ? 14 : 0), 14, 98);
      const curiosity = clamp(45 + (hasCuriosity ? 32 : 0) + (hasHard ? 12 : 0) + (hasDepth ? 8 : 0) - (hasDistraction ? 12 : 0), 18, 99);

      const tooHardPenalty = difficulty > mastery + 20 ? 22 : 0;
      const score = template === "kids"
        ? clamp(focus * 0.48 + depth * 0.26 + clarity * 0.16 + buildValue * 0.1)
        : template === "balanced"
          ? clamp(buildValue * 0.46 + clarity * 0.22 + learnability * 0.18 + focus * 0.14 - tooHardPenalty * 0.35)
          : clamp(depth * 0.34 + curiosity * 0.34 + difficulty * 0.2 + focus * 0.12 - tooHardPenalty * 0.3);

      const classification = template === "kids"
        ? focus >= 78 && depth >= 65 ? "High signal" : focus < 55 ? "Possible slop" : "Worth a look"
        : template === "balanced"
          ? buildValue >= 76 ? "Build this" : hasPractical ? "Code along" : "Useful context"
          : difficulty > mastery + 20 ? "Big-brain detour" : curiosity >= 76 ? "Rabbit-hole worthy" : "Core concept";

      const signals = [
        hasGentle ? "Easy entry" : hasHard ? "Concept dense" : "Some prerequisites",
        hasPractical ? "Hands-on" : hasCuriosity ? "Opens new tabs" : "Builds context",
        focus >= 78 ? "High signal" : focus < 55 ? "Hype detected" : "Mixed signal",
      ];

      const reason = template === "kids"
        ? `${classification} · ${focus >= 78 ? "substance beats packaging" : "some attention bait remains"}`
        : template === "balanced"
          ? `${classification} · ${hasPractical ? "concrete implementation and examples" : "useful before you start building"}`
          : difficulty > mastery + 20
            ? "Big-brain detour · dense, but worth saving"
            : hasCuriosity
              ? "Rabbit-hole worthy · follows the idea beneath the idea"
              : hasHard
                ? "Concept dense · rewards a slower watch"
                : "Core concept · unlocks the deeper videos";

      return { ...video, difficulty, learnability, depth, clarity, focus, buildValue, curiosity, score, classification, signals, reason };
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
