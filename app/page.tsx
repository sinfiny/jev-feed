"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, Brain, Check, ChevronDown, Clock3, Flame, Link2, LoaderCircle, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

type Video = { id: string; title: string; channel: string; description: string; thumbnail: string; published?: string };
type RankedVideo = Video & { difficulty: number; learnability: number; score: number; reason: string };
type Playlist = { id: string; title: string; channel: string };
type ImportResult = { playlist: Playlist; videos: Video[]; error?: string };
type Feedback = "easy" | "right" | "hard";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: object;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => Promise<unknown>;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const samplePlaylist: Playlist = { id: "PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr", title: "Essence of calculus", channel: "3Blue1Brown" };
const sampleVideos: Video[] = [
  { id: "WUvTyaaNkzM", title: "The essence of calculus", channel: "3Blue1Brown", description: "A visual introduction to integrals, derivatives, and the fundamental theorem of calculus.", thumbnail: "https://i.ytimg.com/vi/WUvTyaaNkzM/hqdefault.jpg" },
  { id: "9vKqVkMQHKk", title: "The paradox of the derivative", channel: "3Blue1Brown", description: "What derivatives really measure, and why instantaneous rate of change makes sense.", thumbnail: "https://i.ytimg.com/vi/9vKqVkMQHKk/hqdefault.jpg" },
  { id: "kfF40MiS7zA", title: "Derivative formulas through geometry", channel: "3Blue1Brown", description: "Deriving familiar rules visually through geometry and first principles.", thumbnail: "https://i.ytimg.com/vi/kfF40MiS7zA/hqdefault.jpg" },
];

const hardTerms = /advanced|proof|theorem|derive|derivation|architecture|internals|from scratch|deep dive|graduate|optimization|algorithm|geometry|paradox|formal/i;
const gentleTerms = /intro|introduction|beginner|basics|overview|explained|intuition|visual|essence|first/i;
const practicalTerms = /tutorial|build|exercise|practice|project|example|how to|implementation/i;

function rankVideos(videos: Video[], mastery: number, completed: string[]): RankedVideo[] {
  return videos
    .filter((video) => !completed.includes(video.id))
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

export default function Home() {
  const [url, setUrl] = useState("");
  const [playlist, setPlaylist] = useState(samplePlaylist);
  const [videos, setVideos] = useState<Video[]>(sampleVideos);
  const [mastery, setMastery] = useState(64);
  const [completed, setCompleted] = useState<string[]>([]);
  const [selected, setSelected] = useState<RankedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showLogic, setShowLogic] = useState(false);
  const [hasLoadedProgress, setHasLoadedProgress] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("keen-learning-state") ?? "null");
      if (typeof saved?.mastery === "number") setMastery(saved.mastery);
      if (Array.isArray(saved?.completed)) setCompleted(saved.completed);
    } catch { /* Device-local learning state is optional. */ }
    setHasLoadedProgress(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedProgress) return;
    localStorage.setItem("keen-learning-state", JSON.stringify({ mastery, completed }));
  }, [mastery, completed, hasLoadedProgress]);

  const ranked = useMemo(() => rankVideos(videos, mastery, completed), [videos, mastery, completed]);

  const importPlaylist = useCallback(async (playlistUrl: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/playlist?url=${encodeURIComponent(playlistUrl)}`);
      const result = await response.json() as ImportResult;
      if (!response.ok) throw new Error(result.error || "Could not import that playlist.");
      setPlaylist(result.playlist);
      setVideos(result.videos);
      setCompleted([]);
      setSelected(null);
      setUrl(playlistUrl);
      return { title: result.playlist.title, videoCount: result.videos.length };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not import that playlist.";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(document.modelContext.registerTool({
      name: "import_youtube_playlist",
      title: "Import YouTube playlist",
      description: "Import a public YouTube playlist into the visible Keen learning queue and rank its videos.",
      inputSchema: { type: "object", properties: { url: { type: "string", description: "A public YouTube playlist URL." } }, required: ["url"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        if (!input || typeof input !== "object" || typeof (input as { url?: unknown }).url !== "string") throw new Error("A playlist URL is required.");
        return importPlaylist((input as { url: string }).url);
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [importPlaylist]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) { setError("Paste a YouTube playlist link first."); return; }
    try { await importPlaylist(url); } catch { /* The visible error is set by importPlaylist. */ }
  }

  function respond(video: RankedVideo, feedback: Feedback) {
    const delta = feedback === "easy" ? 8 : feedback === "right" ? 4 : -7;
    setMastery((value) => Math.max(30, Math.min(92, value + delta)));
    setCompleted((items) => items.includes(video.id) ? items : [...items, video.id]);
    setSelected(null);
  }

  const top = ranked[0];
  const progress = videos.length ? Math.round((completed.length / videos.length) * 100) : 0;

  return (
    <main className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full bg-[var(--acid)] text-[var(--ink)]"><Brain className="size-5" strokeWidth={2.4} /></div><div><p className="font-display text-xl leading-none tracking-tight">Keen</p><p className="mt-1 text-xs text-white/45">Your intentional YouTube feed</p></div></div>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 text-sm text-white/55 sm:flex"><Flame className="size-4 text-orange-400" /> Learning edge {mastery}</div><button className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold" aria-label="Profile">SB</button></div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 pb-28 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)] lg:px-12 lg:pt-12">
        <div>
          <div className="mb-9 max-w-2xl"><div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-[var(--acid)]"><Sparkles className="size-4" /> Today’s learning edge</div><h1 className="font-display text-[clamp(3.1rem,7vw,6.7rem)] leading-[.88] tracking-[-.055em]">Watch less.<br /><span className="text-white/35">Learn deeper.</span></h1><p className="mt-6 max-w-xl text-base leading-7 text-white/55 sm:text-lg">Paste a YouTube playlist. Keen keeps you at the edge of what you can understand—not the edge of your attention.</p></div>

          <form onSubmit={submit} className="mb-3 flex max-w-2xl flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-3 sm:flex-row">
            <div className="relative min-w-0 flex-1"><Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35" /><Input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="YouTube playlist link" placeholder="Paste a YouTube playlist link" className="h-12 border-0 bg-transparent pl-10 text-base text-white shadow-none placeholder:text-white/30 focus-visible:ring-0" /></div>
            <Button disabled={loading} type="submit" className="h-12 rounded-xl bg-[var(--acid)] px-5 text-[var(--ink)] hover:bg-[var(--acid-bright)]">{loading ? <LoaderCircle className="animate-spin" /> : <>Build my feed <ArrowRight /></>}</Button>
          </form>
          <div aria-live="polite" className="mb-10 min-h-6 max-w-2xl px-1 text-sm">{error ? <p className="text-red-300">{error}</p> : <p className="text-white/35">Public playlists work without a Google login. Progress stays on this device.</p>}</div>

          {selected && (
            <section className="mb-8 overflow-hidden rounded-[1.5rem] border border-[var(--acid)]/35 bg-black">
              <div className="aspect-video"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=1&rel=0`} title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><p className="text-xs uppercase tracking-[.14em] text-[var(--acid)]">Focus mode</p><h2 className="mt-1 font-display text-xl">{selected.title}</h2></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => respond(selected, "hard")} className="border-white/15 bg-white/5 text-white">Too hard</Button><Button variant="outline" onClick={() => respond(selected, "right")} className="border-white/15 bg-white/5 text-white">Just right</Button><Button onClick={() => respond(selected, "easy")} className="bg-[var(--acid)] text-[var(--ink)]">Too easy</Button><Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Close player"><X /></Button></div></div>
            </section>
          )}

          <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-white/35">{playlist.title}</p><h2 className="mt-2 font-display text-3xl tracking-tight">Optimized for effort</h2></div><p className="hidden text-sm text-white/40 sm:block">{ranked.length} of {videos.length} remaining</p></div>

          <div className="space-y-3">
            {ranked.map((video, index) => (
              <article key={video.id} className={`group grid gap-4 rounded-2xl border p-3 transition sm:grid-cols-[170px_1fr_auto] sm:items-center ${index === 0 ? "border-[var(--acid)]/45 bg-[var(--acid)]/[0.07]" : "border-white/10 bg-white/[0.035] hover:border-white/20"}`}>
                <div className="relative aspect-video overflow-hidden rounded-xl bg-white/10"><img src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-85 transition group-hover:scale-[1.03]" /><div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" /><span className="absolute bottom-2.5 left-3 font-display text-2xl text-white/90">{String(index + 1).padStart(2, "0")}</span>{index === 0 && <span className="absolute right-2.5 top-2.5 rounded-full bg-[var(--acid)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink)]">Best next</span>}</div>
                <div className="min-w-0 py-1"><div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40"><span>{video.channel}</span><span>Difficulty {video.difficulty}</span><span>Learnability {video.learnability}</span></div><h3 className="font-display text-xl leading-tight tracking-tight sm:text-2xl">{video.title}</h3><p className="mt-2 text-sm text-white/45">{video.reason}</p></div>
                <div className="flex items-center justify-between gap-4 sm:flex-col sm:justify-center sm:px-3"><div className="text-left sm:text-center"><p className="font-display text-2xl text-[var(--acid)]">{video.score}</p><p className="text-[10px] uppercase tracking-wider text-white/35">Fit score</p></div><button onClick={() => setSelected(video)} className="grid size-11 place-items-center rounded-full bg-white text-[var(--ink)] transition group-hover:scale-105" aria-label={`Play ${video.title}`}><Play className="ml-0.5 size-4 fill-current" /></button></div>
              </article>
            ))}
            {!ranked.length && <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center"><Check className="mx-auto size-8 text-[var(--acid)]" /><h3 className="mt-3 font-display text-2xl">Playlist complete</h3><p className="mt-2 text-sm text-white/45">You finished every video in this learning queue.</p><Button onClick={() => setCompleted([])} variant="outline" className="mt-5 border-white/15 bg-white/5 text-white"><RotateCcw /> Study it again</Button></div>}
          </div>
        </div>

        <aside className="lg:pt-28"><div className="sticky top-6 space-y-4">
          <section className="overflow-hidden rounded-[1.75rem] bg-[var(--paper)] p-6 text-[var(--ink)] sm:p-7"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.16em] text-black/40">Today’s session</p><span className="rounded-full bg-[var(--ink)] px-2.5 py-1 text-xs text-white">1 hard thing</span></div><p className="mt-8 font-display text-5xl leading-none tracking-[-.05em]">{top ? "Ready to stretch?" : "Nicely done."}</p><p className="mt-3 text-sm leading-6 text-black/55">{top ? `“${top.title}” is the strongest match for your current learning edge.` : "Import another playlist or reset this one when you are ready."}</p><div className="mt-8"><div className="mb-2 flex justify-between text-xs font-semibold"><span>Playlist depth</span><span>{progress}%</span></div><Progress value={progress} className="h-2.5 bg-black/10 [&_[data-slot=progress-indicator]]:bg-[var(--violet)]" /></div><Button disabled={!top} onClick={() => top && setSelected(top)} className="mt-7 h-12 w-full rounded-xl bg-[var(--ink)] text-white hover:bg-black"><Play className="fill-current" /> Start focus session</Button></section>
          <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6"><button onClick={() => setShowLogic((value) => !value)} className="flex w-full items-start gap-3 text-left"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--violet)]/25 text-violet-300"><BookOpen className="size-5" /></div><div className="flex-1"><h3 className="font-display text-xl">How ranking works</h3><p className="mt-1 text-sm leading-6 text-white/45">Difficulty × learnability × relevance, adjusted after every video.</p></div><ChevronDown className={`mt-2 size-4 text-white/35 transition ${showLogic ? "rotate-180" : ""}`} /></button>{showLogic && <div className="mt-5 space-y-3 border-t border-white/10 pt-5 text-sm leading-6 text-white/50"><p><strong className="text-white/80">Difficulty</strong> is estimated from the title, description, and position in the playlist.</p><p><strong className="text-white/80">Learnability</strong> peaks near your current edge and drops when a video is far too easy or too hard.</p><p><strong className="text-white/80">Feedback</strong> moves that edge: “too easy” raises it, “too hard” lowers it.</p></div>}<div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">{["Challenging", "Learnable", "Relevant"].map((label) => <div key={label} className="rounded-xl border border-white/10 px-2 py-3 text-white/55"><Check className="mx-auto mb-1.5 size-4 text-[var(--acid)]" />{label}</div>)}</div></section>
          <div className="flex items-center gap-2 px-2 text-xs text-white/30"><Clock3 className="size-3.5" /> {playlist.channel} · progress saved locally</div>
        </div></aside>
      </section>
    </main>
  );
}
