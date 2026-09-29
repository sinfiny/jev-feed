import { heuristics, type Video } from "@/lib/learning";

/**
 * A lens is a viewer-written schema for judging and ordering videos. It has three kinds of judges:
 *
 * - dials: signals Jev reads from each video's own metadata (title, description, length, views, likes, subscribers),
 * - words: terms that lift or sink a video when they appear in its title, description or tags,
 * - questions: plain-language questions ("Does it show real code?") that Claude answers once per video, cached.
 *
 * Every judge has a weight from -2 (avoid) to +2 (seek). Ranking is a pure weighted sum, so it stays in the
 * browser and reorders hundreds of videos in a few milliseconds while a dial is dragged.
 */

export const DIALS = {
  depth: { label: "Depth", seek: "Goes deep", avoid: "Light", hint: "Lectures, explanations, the why behind things" },
  focus: { label: "Calm", seek: "No clickbait", avoid: "Loud", hint: "Few shouty titles, reactions, compilations" },
  handsOn: { label: "Hands-on", seek: "Hands-on", avoid: "Theory", hint: "Tutorials, builds, worked examples" },
  gentle: { label: "Beginner", seek: "Beginner-friendly", avoid: "Advanced", hint: "Intros and overviews before proofs" },
  curious: { label: "Big ideas", seek: "Big ideas", avoid: "Surface", hint: "First principles, internals, history" },
  quick: { label: "Quick", seek: "Quick watch", avoid: "Long watch", hint: "Short videos first; drag left for long ones" },
  fresh: { label: "Fresh", seek: "Fresh", avoid: "Classic", hint: "Recently published" },
  popular: { label: "Popular", seek: "Widely watched", avoid: "Under the radar", hint: "Lots of views" },
  loved: { label: "Loved", seek: "Crowd loved", avoid: "Divisive", hint: "High like-to-view ratio" },
  indie: { label: "Small creators", seek: "Small creator", avoid: "Big channel", hint: "Channels with fewer subscribers" },
  chapters: { label: "Chapters", seek: "Has chapters", avoid: "One piece", hint: "Split into chapters you can jump between" },
} as const;

export type Dial = keyof typeof DIALS;
export const DIAL_KEYS = Object.keys(DIALS) as Dial[];
export type Weight = -2 | -1 | 0 | 1 | 2;
export type Question = { id: string; text: string; weight: Weight };

export type Lens = {
  id: string;
  name: string;
  emoji: string;
  dials: Partial<Record<Dial, Weight>>;
  boost: string[];
  bury: string[];
  questions: Question[];
  /** Leave out videos shorter than a minute and a half. */
  hideShorts?: boolean;
  /** Leave out videos longer than this. */
  maxMinutes?: number;
};

/** Claude's answers, 0 to 10, keyed by question then video id. Cached so a video is only ever judged once per question. */
export type Judgments = Record<string, Record<string, number>>;

export const questionKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

const preset = (id: string, name: string, emoji: string, dials: Lens["dials"], extra: Partial<Lens> = {}): Lens =>
  ({ id, name, emoji, dials, boost: [], bury: [], questions: [], ...extra });

export const PRESETS: Lens[] = [
  preset("deep-dive", "Deep dive", "🌊", { depth: 2, curious: 2, focus: 1 }),
  preset("hands-on", "Hands-on", "🛠️", { handsOn: 2, gentle: 1, focus: 1 }),
  preset("calm-kids", "Calm for kids", "🧸", { focus: 2, depth: 1, gentle: 1 }, { hideShorts: true }),
  preset("quick-wins", "Quick wins", "⚡", { quick: 2, gentle: 1, focus: 1 }),
  preset("crowd-love", "Crowd favorites", "💖", { loved: 2, popular: 1 }),
  preset("hidden-gems", "Hidden gems", "💎", { indie: 2, loved: 2, focus: 1 }),
];

/** Ranking templates carried by /feed links from before lenses. */
export function lensFromTemplate(template: string | null) {
  const id = { stretch: "deep-dive", balanced: "hands-on", kids: "calm-kids" }[template ?? ""];
  return PRESETS.find((lens) => lens.id === id) ?? null;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));
const DAY = 86_400_000;

/** Every dial's reading for one video, 0 to 1. Unknown metadata reads 0.5, which a weight cannot move. */
export function analyze(video: Video, now = Date.now()): Record<Dial, number> {
  const guess = heuristics(video);
  const published = video.published ? Date.parse(video.published) : NaN;
  const seconds = video.durationSeconds;
  return {
    ...guess,
    quick: seconds ? unit(1 - Math.log(Math.max(seconds, 180) / 180) / Math.log(20)) : 0.5,
    fresh: Number.isFinite(published) ? unit(Math.exp(-Math.max(0, now - published) / DAY / 400)) : 0.5,
    popular: video.views !== undefined ? unit((Math.log10(video.views + 1) - 2) / 6) : 0.5,
    loved: video.likes !== undefined && video.views ? unit((video.likes / video.views) / 0.05) : 0.5,
    indie: video.subscribers !== undefined ? unit(1 - (Math.log10(video.subscribers + 1) - 3) / 4) : 0.5,
    chapters: video.chapters ? unit((video.chapters.length - 1) / 4) : 0,
  };
}

export type Reason = { label: string; tone: "good" | "bad" };
export type Ranked = { video: Video; score: number; reasons: Reason[] };

/** A word matches whole words in the title, description or tags, ignoring case. */
const mentions = (video: Video, word: string) => {
  const term = word.trim().toLowerCase();
  if (!term) return false;
  const haystack = `${video.title} ${video.description} ${(video.keywords ?? []).join(" ")}`.toLowerCase();
  return new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
};

/** Whether a lens's filters set the video aside. Set-aside videos are listed separately, never deleted. */
export function setAside(video: Video, lens: Lens) {
  const seconds = video.durationSeconds ?? 0;
  if (lens.hideShorts && seconds > 0 && seconds < 90) return "Short";
  if (lens.maxMinutes && seconds > lens.maxMinutes * 60) return `Over ${lens.maxMinutes} min`;
  return "";
}

/**
 * Orders videos by a lens. Each judge contributes weight × (reading − 0.5) × 2, so a +2 dial moves a
 * video at most two points either way; a matched boost or bury word counts 1.5; a question counts like a dial.
 * Ties keep the original order. Reasons are the strongest contributions, for showing why a video is where it is.
 */
export function rank(videos: Video[], lens: Lens, judgments: Judgments = {}, now = Date.now()): { ranked: Ranked[]; aside: Array<{ video: Video; why: string }> } {
  const aside: Array<{ video: Video; why: string }> = [];
  const scored = videos.flatMap((video, index) => {
    const why = setAside(video, lens);
    if (why) { aside.push({ video, why }); return []; }
    const readings = analyze(video, now);
    const parts: Array<{ value: number; label: string }> = [];
    for (const dial of DIAL_KEYS) {
      const weight = lens.dials[dial] ?? 0;
      if (!weight) continue;
      const value = weight * (readings[dial] - 0.5) * 2;
      parts.push({ value, label: value > 0 === weight > 0 ? DIALS[dial].seek : DIALS[dial].avoid });
    }
    for (const word of lens.boost) if (mentions(video, word)) parts.push({ value: 1.5, label: `Mentions “${word.trim()}”` });
    for (const word of lens.bury) if (mentions(video, word)) parts.push({ value: -1.5, label: `Mentions “${word.trim()}”` });
    for (const question of lens.questions) {
      const answer = judgments[questionKey(question.text)]?.[video.id];
      if (answer === undefined || !question.weight) continue;
      const value = question.weight * (answer / 10 - 0.5) * 2;
      parts.push({ value, label: `${answer >= 5 === question.weight > 0 ? "Yes" : "No"}: ${question.text.trim().replace(/\?$/, "")}` });
    }
    const score = parts.reduce((sum, part) => sum + part.value, 0);
    const strongest = [...parts].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).filter((part) => Math.abs(part.value) >= 0.25);
    const reasons: Reason[] = [
      ...strongest.filter((part) => part.value > 0).slice(0, 2).map((part) => ({ label: part.label, tone: "good" as const })),
      ...strongest.filter((part) => part.value < 0).slice(0, 1).map((part) => ({ label: part.label, tone: "bad" as const })),
    ];
    return [{ video, score, reasons, index }];
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return { ranked: scored.map(({ video, score, reasons }) => ({ video, score, reasons })), aside };
}

/** Questions in a lens that still lack an answer for some of these videos. */
export function unjudged(videos: Video[], lens: Lens, judgments: Judgments) {
  return lens.questions.filter((question) => question.text.trim() && question.weight)
    .map((question) => ({ question, videos: videos.filter((video) => judgments[questionKey(question.text)]?.[video.id] === undefined) }))
    .filter((item) => item.videos.length);
}

const WEIGHTS = new Set([-2, -1, 0, 1, 2]);
const weight = (value: unknown): Weight => (typeof value === "number" && WEIGHTS.has(value) ? value : 0) as Weight;
const words = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.slice(0, 40)).slice(0, 20) : [];

/** Validates a lens from storage or a published feed. Unknown dials and bad weights are dropped. */
export function parseLens(value: unknown): Lens | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string") return null;
  const rawDials = item.dials && typeof item.dials === "object" ? item.dials as Record<string, unknown> : {};
  const dials: Lens["dials"] = {};
  for (const dial of DIAL_KEYS) { const value = weight(rawDials[dial]); if (value) dials[dial] = value; }
  const questions = Array.isArray(item.questions) ? item.questions.flatMap((question): Question[] => {
    const candidate = question && typeof question === "object" ? question as Record<string, unknown> : {};
    return typeof candidate.text === "string" && candidate.text.trim()
      ? [{ id: typeof candidate.id === "string" ? candidate.id : questionKey(candidate.text), text: candidate.text.slice(0, 160), weight: weight(candidate.weight) }] : [];
  }).slice(0, 5) : [];
  const maxMinutes = typeof item.maxMinutes === "number" && item.maxMinutes > 0 ? Math.round(item.maxMinutes) : undefined;
  return {
    id: typeof item.id === "string" ? item.id : "custom",
    name: item.name.slice(0, 40) || "My lens",
    emoji: typeof item.emoji === "string" ? item.emoji.slice(0, 8) : "🔭",
    dials, boost: words(item.boost), bury: words(item.bury), questions,
    ...(item.hideShorts === true ? { hideShorts: true } : {}),
    ...(maxMinutes ? { maxMinutes } : {}),
  };
}

export function parseJudgments(value: unknown): Judgments {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Judgments = {};
  for (const [key, answers] of Object.entries(value as Record<string, unknown>)) {
    if (!answers || typeof answers !== "object") continue;
    const clean = Object.fromEntries(Object.entries(answers as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= 0 && entry[1] <= 10));
    if (Object.keys(clean).length) result[key] = clean;
  }
  return result;
}

/** Adds fresh answers without dropping cached ones. */
export const mergeJudgments = (current: Judgments, fresh: Judgments): Judgments =>
  Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(fresh)])].map((key) => [key, { ...current[key], ...fresh[key] }]));
