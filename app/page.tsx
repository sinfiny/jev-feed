"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Brain, Check, ChevronDown, Copy, ExternalLink, Flame, Link2, LoaderCircle, Play, Rocket, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { DEFAULT_MASTERY, LEARNING_STATE_KEY, progressForPlaylist, rankVideos, readLearningState, templateDefinitions, type FeedTemplate, type RankedVideo, type Video } from "@/lib/learning";

type Playlist = { id: string; title: string; channel: string };
type ImportResult = { playlist: Playlist; videos: Video[]; error?: string; returnedCount?: number };
type Feedback = "easy" | "right" | "hard";

declare global { interface Document { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

const samplePlaylist: Playlist = { id: "PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr", title: "Essence of calculus", channel: "3Blue1Brown" };
const sampleVideos: Video[] = [
  { id: "WUvTyaaNkzM", title: "The essence of calculus", channel: "3Blue1Brown", description: "A visual introduction to integrals, derivatives, and the fundamental theorem of calculus.", thumbnail: "https://i.ytimg.com/vi/WUvTyaaNkzM/hqdefault.jpg" },
  { id: "9vKqVkMQHKk", title: "The paradox of the derivative", channel: "3Blue1Brown", description: "What derivatives really measure, and why instantaneous rate of change makes sense.", thumbnail: "https://i.ytimg.com/vi/9vKqVkMQHKk/hqdefault.jpg" },
  { id: "kfF40MiS7zA", title: "Derivative formulas through geometry", channel: "3Blue1Brown", description: "Deriving familiar rules visually through geometry and first principles.", thumbnail: "https://i.ytimg.com/vi/kfF40MiS7zA/hqdefault.jpg" },
];

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div><div className="mb-1 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-white/40"><span>{label}</span><span className={accent ? "text-[var(--acid)]" : "text-white/65"}>{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${accent ? "bg-[var(--acid)]" : "bg-[var(--violet)]"}`} style={{ width: `${value}%` }} /></div></div>;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [playlist, setPlaylist] = useState(samplePlaylist);
  const [videos, setVideos] = useState<Video[]>(sampleVideos);
  const [mastery, setMastery] = useState(DEFAULT_MASTERY);
  const [completed, setCompleted] = useState<string[]>([]);
  const [selected, setSelected] = useState<RankedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showLogic, setShowLogic] = useState(false);
  const [hasLoadedProgress, setHasLoadedProgress] = useState(false);
  const [template, setTemplate] = useState<FeedTemplate>("stretch");
  const [videoLimit, setVideoLimit] = useState<10 | 50 | 100>(10);
  const [publishedUrl, setPublishedUrl] = useState("");

  useEffect(() => {
    const saved = progressForPlaylist(readLearningState(), samplePlaylist.id, sampleVideos.map((video) => video.id));
    queueMicrotask(() => { setMastery(saved.mastery); setCompleted(saved.completed); setHasLoadedProgress(true); });
  }, []);

  useEffect(() => {
    if (!hasLoadedProgress) return;
    const state = readLearningState();
    localStorage.setItem(LEARNING_STATE_KEY, JSON.stringify({ ...state, [playlist.id]: { mastery, completed } }));
  }, [mastery, completed, hasLoadedProgress, playlist.id]);

  const ranked = useMemo(() => rankVideos(videos, mastery, completed, template), [videos, mastery, completed, template]);
  const top = ranked[0];

  const importPlaylist = useCallback(async (playlistUrl: string, requestedLimit: 10 | 50 | 100 = videoLimit) => {
    setLoading(true); setError(""); setPublishedUrl("");
    try {
      const response = await fetch(`/api/playlist?url=${encodeURIComponent(playlistUrl)}&limit=${requestedLimit}`);
      const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as ImportResult;
      if (!response.ok) throw new Error(result.error || "Could not import that playlist.");
      if (!result.playlist?.id || !result.videos?.length) throw new Error("That playlist did not contain any public videos.");
      const saved = progressForPlaylist(readLearningState(), result.playlist.id, result.videos.map((video) => video.id));
      setPlaylist(result.playlist); setVideos(result.videos); setMastery(saved.mastery); setCompleted(saved.completed); setSelected(null); setUrl(playlistUrl); setVideoLimit(requestedLimit);
      return { title: result.playlist.title, videoCount: result.videos.length };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not import that playlist.";
      setError(message); throw new Error(message);
    } finally { setLoading(false); }
  }, [videoLimit]);

  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(document.modelContext.registerTool({
      name: "build_jev_feed", title: "Build a Jev feed", description: "Import and analyze a public YouTube playlist in the visible Jev builder.",
      inputSchema: { type: "object", properties: { url: { type: "string" }, limit: { type: "number", enum: [10, 50, 100] } }, required: ["url"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => { const value = input as { url?: unknown; limit?: unknown }; if (typeof value.url !== "string") throw new Error("A playlist URL is required."); return importPlaylist(value.url, value.limit === 50 || value.limit === 100 ? value.limit : 10); },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [importPlaylist]);

  async function submit(event: FormEvent) { event.preventDefault(); if (!url.trim()) { setError("Paste a YouTube playlist link first."); return; } try { await importPlaylist(url); } catch { /* visible error is already set */ } }
  function respond(video: RankedVideo, feedback: Feedback) { const delta = feedback === "easy" ? 8 : feedback === "right" ? 4 : -7; setMastery((value) => Math.max(30, Math.min(92, value + delta))); setCompleted((items) => items.includes(video.id) ? items : [...items, video.id]); setSelected(null); }
  async function publish() {
    const share = `${window.location.origin}/feed?playlist=${encodeURIComponent(playlist.id)}&template=${template}&limit=${videoLimit}`;
    setPublishedUrl(share);
    try { await navigator.clipboard.writeText(share); } catch { /* Link remains visible for manual copying. */ }
  }

  const completedCount = videos.filter((video) => completed.includes(video.id)).length;
  const progress = videos.length ? Math.round((completedCount / videos.length) * 100) : 0;

  return <main className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
      <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full bg-[var(--acid)] text-[var(--ink)]"><Brain className="size-5" /></div><div><p className="font-display text-xl leading-none">Jev</p><p className="mt-1 text-xs text-white/45">Reorder and share a playlist</p></div></div>
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/55"><Flame className="size-4 text-orange-400" /> Learning level {mastery}</div>
    </header>

    <section className="mx-auto max-w-7xl px-5 pb-24 pt-5 sm:px-8 lg:px-12">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
        <div><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--acid)]"><Sparkles className="size-4" /> Feed builder</div><h1 className="font-display text-[clamp(3rem,6vw,6rem)] leading-[.9] tracking-[-.055em]">Turn a YouTube playlist into<br /><span className="text-white/35">a learning feed.</span></h1></div>
        <p className="max-w-xl text-base leading-7 text-white/55 sm:text-lg">Paste a public playlist, choose how to order the videos, and share the result with one link.</p>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-3 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35" /><Input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="YouTube playlist link" placeholder="Paste a public YouTube playlist" className="h-12 border-0 bg-transparent pl-10 text-base text-white shadow-none placeholder:text-white/30 focus-visible:ring-0" /></div>
          <Button disabled={loading} type="submit" className="h-12 rounded-xl bg-[var(--acid)] px-5 text-[var(--ink)] hover:bg-[var(--acid-bright)]">{loading ? <LoaderCircle className="animate-spin" /> : <>Build feed <ArrowRight /></>}</Button>
        </form>
        <Button onClick={publish} className="h-full min-h-14 rounded-2xl bg-[var(--violet)] text-white hover:bg-violet-500"><Rocket /> Create public feed link</Button>
      </div>
      <div aria-live="polite" className="min-h-7 px-1 pt-2 text-sm">{error ? <p className="text-red-300">{error}</p> : publishedUrl ? <p className="flex flex-wrap items-center gap-2 text-[var(--acid)]"><Check className="size-4" /> Feed link copied <a className="underline" href={publishedUrl} target="_blank" rel="noreferrer">Open feed <ExternalLink className="inline size-3" /></a><button onClick={() => navigator.clipboard.writeText(publishedUrl)} aria-label="Copy published link"><Copy className="size-4" /></button></p> : <p className="text-white/35">Use a public playlist. A video link works only if its URL still includes <code>list=</code>.</p>}</div>

      <section className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-white/35">Choose an order</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{(Object.keys(templateDefinitions) as FeedTemplate[]).map((key) => <button key={key} onClick={() => setTemplate(key)} className={`rounded-xl border p-3 text-left transition ${template === key ? "border-[var(--acid)] bg-[var(--acid)]/10" : "border-white/10 bg-black/10 hover:border-white/25"}`}><span className="font-display text-lg">{templateDefinitions[key].name}</span><span className="mt-1 block text-xs leading-5 text-white/45">{templateDefinitions[key].description}</span></button>)}</div></div>
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-white/35">Videos to include</p><div className="mt-3 flex gap-2">{([10, 50, 100] as const).map((count) => <button key={count} onClick={() => { setVideoLimit(count); if (url) void importPlaylist(url, count).catch(() => undefined); }} className={`h-12 min-w-16 rounded-xl border px-4 font-display text-lg ${videoLimit === count ? "border-[var(--acid)] bg-[var(--acid)] text-[var(--ink)]" : "border-white/10 bg-white/5"}`}>{count}</button>)}</div></div>
        </div>
      </section>

      {selected && <section className="mt-8 overflow-hidden rounded-[1.5rem] border border-[var(--acid)]/35 bg-black"><div className="aspect-video"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=1&rel=0`} title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div><div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-[.14em] text-[var(--acid)]">Focus mode</p><h2 className="mt-1 font-display text-xl">{selected.title}</h2></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => respond(selected, "hard")} className="border-white/15 bg-white/5 text-white">Too hard</Button><Button variant="outline" onClick={() => respond(selected, "right")} className="border-white/15 bg-white/5 text-white">Just right</Button><Button onClick={() => respond(selected, "easy")} className="bg-[var(--acid)] text-[var(--ink)]">Too easy</Button><Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Close player"><X /></Button></div></div></section>}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <div><div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-white/35">{playlist.title} · {videos.length} ranked from metadata</p><h2 className="mt-2 font-display text-3xl">The ranked feed</h2></div><p className="hidden text-sm text-white/40 sm:block">{ranked.length} remaining</p></div>
          <div className="space-y-3">{ranked.map((video, index) => <article key={video.id} className={`group grid gap-4 rounded-2xl border p-3 transition sm:grid-cols-[170px_1fr_auto] sm:items-center ${index === 0 ? "border-[var(--acid)]/45 bg-[var(--acid)]/[0.07]" : "border-white/10 bg-white/[0.035] hover:border-white/20"}`}>
            <div className="relative aspect-video overflow-hidden rounded-xl bg-white/10"><Image src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" fill sizes="170px" unoptimized className="object-cover opacity-85 transition group-hover:scale-[1.03]" /><div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" /><span className="absolute bottom-2 left-3 font-display text-2xl">{String(index + 1).padStart(2, "0")}</span>{index === 0 && <span className="absolute right-2 top-2 rounded-full bg-[var(--acid)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--ink)]">Best next</span>}</div>
            <div className="min-w-0"><div className="mb-1 flex flex-wrap gap-2 text-xs text-white/40"><span>{video.channel}</span><span>·</span><span className="text-violet-300">{video.classification}</span></div><h3 className="font-display text-xl leading-tight sm:text-2xl">{video.title}</h3><p className="mt-2 text-sm text-white/45">{video.reason}</p><div className="mt-3 flex flex-wrap gap-1.5">{video.signals.map((signal) => <span key={signal} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/45">{signal}</span>)}</div></div>
            <div className="flex items-center justify-between gap-4 sm:flex-col"><div className="text-center"><p className="font-display text-2xl text-[var(--acid)]">{video.score}</p><p className="text-[10px] uppercase tracking-wider text-white/35">Jev score</p></div><button onClick={() => setSelected(video)} className="grid size-11 place-items-center rounded-full bg-white text-[var(--ink)]" aria-label={`Play ${video.title}`}><Play className="ml-0.5 size-4 fill-current" /></button></div>
          </article>)}</div>
        </div>

        <aside><div className="sticky top-6 space-y-4">{top && <section className="overflow-hidden rounded-[1.75rem] bg-[var(--paper)] p-6 text-[var(--ink)]"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.16em] text-black/40">Why Jev chose it</p><span className="rounded-full bg-[var(--ink)] px-3 py-1 text-xs text-white">{templateDefinitions[template].shortName}</span></div><p className="mt-7 font-display text-4xl leading-none">Why this video is first.</p><p className="mt-3 text-sm leading-6 text-black/55">{top.reason}. Signals: {top.signals.map((item) => item.toLowerCase()).join(", ")}.</p><div className="mt-6 grid gap-3 rounded-2xl bg-[var(--ink)] p-4 text-white">{template === "stretch" ? <><Metric label="Explores the topic deeply" value={top.depth} accent /><Metric label="Leads to related ideas" value={top.curiosity} /><Metric label="Prior knowledge needed" value={top.difficulty} /><Metric label="Low distraction" value={top.focus} /></> : template === "balanced" ? <><Metric label="Practical examples" value={top.buildValue} accent /><Metric label="Easy to start" value={top.learnability} /><Metric label="Explains clearly" value={top.clarity} /><Metric label="Low distraction" value={top.focus} /></> : <><Metric label="Low distraction" value={top.focus} accent /><Metric label="Explores the topic deeply" value={top.depth} /><Metric label="Explains clearly" value={top.clarity} /><Metric label="Practical examples" value={top.buildValue} /></>}</div><div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs"><div><p className="font-display text-xl">{top.difficulty}</p><p className="text-black/40">Prior knowledge</p></div><div><p className="font-display text-xl">{top.curiosity}</p><p className="text-black/40">Related ideas</p></div><div><p className="font-display text-xl">{top.score}</p><p className="text-black/40">Rank</p></div></div><Button onClick={() => setSelected(top)} className="mt-6 h-12 w-full rounded-xl bg-[var(--ink)] text-white"><Play className="fill-current" /> Watch this video</Button></section>}
          <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6"><button onClick={() => setShowLogic((value) => !value)} className="flex w-full items-start gap-3 text-left"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--violet)]/25 text-violet-300"><ShieldCheck className="size-5" /></div><div className="flex-1"><h3 className="font-display text-xl">How the three options work</h3><p className="mt-1 text-sm leading-6 text-white/45">Each option changes the order of the same playlist.</p></div><ChevronDown className={`mt-2 size-4 text-white/35 transition ${showLogic ? "rotate-180" : ""}`} /></button>{showLogic && <div className="mt-5 space-y-3 border-t border-white/10 pt-5 text-sm leading-6 text-white/50"><p><strong className="text-white/80">Deepest first:</strong> Theory, internals, and first principles come first.</p><p><strong className="text-white/80">Practical first:</strong> Tutorials, demonstrations, and implementation come first.</p><p><strong className="text-white/80">Low-distraction first:</strong> Clickbait and low-substance videos move down.</p></div>}<div className="mt-5"><div className="mb-2 flex justify-between text-xs"><span>Playlist completed</span><span>{progress}%</span></div><Progress value={progress} className="h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[var(--acid)]" /></div></section>
        </div></aside>
      </div>
    </section>
  </main>;
}
