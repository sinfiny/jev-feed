"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Brain, ExternalLink, LoaderCircle, Play, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rankVideos, templateDefinitions, type FeedTemplate, type RankedVideo, type Video } from "@/lib/learning";

type Playlist = { id: string; title: string; channel: string };
type ImportResult = { playlist?: Playlist; videos?: Video[]; error?: string };

const isTemplate = (value: string | null): value is FeedTemplate => value === "stretch" || value === "balanced" || value === "kids";

function Insight({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="flex items-end justify-between"><span className="text-xs text-white/45">{label}</span><strong className="font-display text-xl text-white">{value}</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[var(--acid)]" style={{ width: `${value}%` }} /></div></div>;
}

export default function PublishedFeed() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [template] = useState<FeedTemplate>(() => {
    if (typeof window === "undefined") return "stretch";
    const value = new URLSearchParams(window.location.search).get("template");
    return isTemplate(value) ? value : "stretch";
  });
  const [selected, setSelected] = useState<RankedVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const playlistId = params.get("playlist") ?? "";
    const requestedLimit = params.get("limit");
    const limit = requestedLimit === "50" || requestedLimit === "100" ? requestedLimit : "10";
    if (!playlistId) { queueMicrotask(() => { setError("This published feed is missing its playlist."); setLoading(false); }); return; }
    const controller = new AbortController();
    void fetch(`/api/playlist?url=${encodeURIComponent(playlistId)}&limit=${limit}`, { signal: controller.signal })
      .then(async (response) => { const result = await response.json() as ImportResult; if (!response.ok || !result.playlist || !result.videos) throw new Error(result.error || "This feed could not be loaded."); setPlaylist(result.playlist); setVideos(result.videos); })
      .catch((cause) => { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "This feed could not be loaded."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const ranked = useMemo(() => rankVideos(videos, 64, [], template), [videos, template]);
  const top = ranked[0];

  if (loading) return <main className="grid min-h-screen place-items-center bg-[var(--ink)] text-white"><div className="text-center"><LoaderCircle className="mx-auto size-8 animate-spin text-[var(--acid)]" /><p className="mt-3 text-white/45">Jev is reading the playlist…</p></div></main>;
  if (error || !playlist) return <main className="grid min-h-screen place-items-center bg-[var(--ink)] px-5 text-white"><div className="max-w-md text-center"><Brain className="mx-auto size-10 text-[var(--acid)]" /><h1 className="mt-4 font-display text-3xl">Feed unavailable</h1><p className="mt-3 text-white/50">{error}</p></div></main>;

  return <main className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
    <header className="border-b border-white/10"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full bg-[var(--acid)] text-[var(--ink)]"><Brain className="size-5" /></div><div><p className="font-display text-xl leading-none">Jev</p><p className="mt-1 text-xs text-white/45">Published feed · no login</p></div></div><span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/50">{templateDefinitions[template].name}</span></div></header>

    <section className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 lg:px-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_.78fr] lg:items-end"><div><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--acid)]"><Sparkles className="size-4" /> Sorted by Jev</div><h1 className="font-display text-[clamp(3rem,6vw,5.5rem)] leading-[.9] tracking-[-.05em]">{playlist.title}</h1><p className="mt-4 text-white/45">{playlist.channel} · {videos.length} ranked from playlist metadata</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-white/35">This feed’s point of view</p><p className="mt-2 font-display text-2xl">{templateDefinitions[template].name}</p><p className="mt-2 text-sm leading-6 text-white/45">{templateDefinitions[template].description}</p></div></div>

      {selected && <section className="mt-8 overflow-hidden rounded-[1.5rem] border border-[var(--acid)]/35 bg-black"><div className="aspect-video"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=1&rel=0`} title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div><div className="flex items-center justify-between gap-4 p-4"><div><p className="text-xs uppercase tracking-wider text-[var(--acid)]">Now watching</p><h2 className="mt-1 font-display text-xl">{selected.title}</h2></div><Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Close player"><X /></Button></div></section>}

      {top && <section className="mt-8 grid overflow-hidden rounded-[1.75rem] border border-[var(--acid)]/30 bg-[var(--acid)]/[0.07] lg:grid-cols-[.9fr_1.1fr]"><div className="relative min-h-64"><Image src={top.thumbnail} alt="" fill sizes="(min-width: 1024px) 45vw, 100vw" unoptimized className="object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" /><div className="absolute bottom-5 left-5"><span className="rounded-full bg-[var(--acid)] px-3 py-1 text-xs font-bold uppercase text-[var(--ink)]">Start here</span></div></div><div className="p-6 sm:p-8"><div className="flex items-center gap-2 text-xs uppercase tracking-[.16em] text-violet-300"><ShieldCheck className="size-4" /> {templateDefinitions[template].name} · {top.score} rank</div><h2 className="mt-3 font-display text-3xl leading-tight">{top.title}</h2><p className="mt-3 text-sm leading-6 text-white/50">{top.reason}. Signals: {top.signals.map((item) => item.toLowerCase()).join(", ")}.</p><div className="mt-5 grid grid-cols-2 gap-2">{template === "stretch" ? <><Insight label="Concept density" value={top.depth} /><Insight label="Rabbit-hole pull" value={top.curiosity} /><Insight label="Prerequisite load" value={top.difficulty} /><Insight label="Signal / noise" value={top.focus} /></> : template === "balanced" ? <><Insight label="Build payoff" value={top.buildValue} /><Insight label="Entry speed" value={top.learnability} /><Insight label="Explanation signal" value={top.clarity} /><Insight label="Signal / noise" value={top.focus} /></> : <><Insight label="Signal / noise" value={top.focus} /><Insight label="Concept density" value={top.depth} /><Insight label="Explanation signal" value={top.clarity} /><Insight label="Build payoff" value={top.buildValue} /></>}</div><Button onClick={() => setSelected(top)} className="mt-6 h-12 w-full rounded-xl bg-[var(--acid)] text-[var(--ink)] hover:bg-[var(--acid-bright)]"><Play className="fill-current" /> Watch top pick</Button></div></section>}

      <div className="mt-8"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-white/35">Full feed</p><h2 className="mt-2 font-display text-3xl">Ranked with reasons</h2></div><a href={`https://www.youtube.com/playlist?list=${playlist.id}`} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-sm text-white/40 hover:text-white sm:flex">Original playlist <ExternalLink className="size-4" /></a></div><div className="grid gap-3 lg:grid-cols-2">{ranked.map((video, index) => <article key={video.id} className="grid grid-cols-[120px_1fr] gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:grid-cols-[150px_1fr]"><button onClick={() => setSelected(video)} className="relative aspect-video overflow-hidden rounded-xl bg-white/10"><Image src={video.thumbnail} alt="" fill sizes="150px" unoptimized className="object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/20"><span className="grid size-10 place-items-center rounded-full bg-white text-black"><Play className="size-4 fill-current" /></span></span></button><div className="min-w-0"><div className="flex items-center justify-between gap-2"><span className="text-xs text-[var(--acid)]">#{index + 1} · {video.classification}</span><span className="font-display text-lg text-[var(--acid)]">{video.score}</span></div><h3 className="mt-1 line-clamp-2 font-display text-lg leading-tight">{video.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-white/45">{video.reason}</p><div className="mt-2 flex gap-2 text-[11px] text-white/35"><span>Density {video.depth}</span><span>Build {video.buildValue}</span><span>Signal {video.focus}</span></div></div></article>)}</div></div>
    </section>
  </main>;
}
