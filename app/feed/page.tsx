"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Brain, ExternalLink, LoaderCircle, Play, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration, rankVideos, templateDefinitions, type FeedTemplate, type RankedVideo, type Video } from "@/lib/learning";
import { videoIdFrom } from "@/lib/youtube-playlist";

type Playlist = { id: string; title: string; channel: string };
type ImportResult = { playlist?: Playlist; videos?: Video[]; error?: string };

const CHUNK = 10;

/** A feed built from individual video ids (`?videos=a,b,c&title=…`) hydrates through /api/video in small batches. */
async function loadVideoList(ids: string[], title: string, signal: AbortSignal): Promise<ImportResult> {
  const videos: Video[] = [];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const response = await fetch(`/api/video?ids=${encodeURIComponent(ids.slice(start, start + CHUNK).join(","))}`, { signal });
    const result = await response.json() as { videos?: Video[]; error?: string };
    if (!response.ok && !videos.length && start + CHUNK >= ids.length) throw new Error(result.error || "These videos could not be loaded.");
    videos.push(...(result.videos ?? []));
  }
  const byId = new Map(videos.map((video) => [video.id, video]));
  const ordered = ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  return { playlist: { id: `videos:${ids.join(",")}`, title: title || "Shared feed", channel: ordered[0]?.channel ?? "YouTube" }, videos: ordered };
}

const isTemplate = (value: string | null): value is FeedTemplate => value === "stretch" || value === "balanced" || value === "kids";

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
    const videoIds = (params.get("videos") ?? "").split(",").map(videoIdFrom).filter(Boolean).slice(0, 100);
    const requestedLimit = params.get("limit");
    const limit = requestedLimit === "50" || requestedLimit === "100" ? requestedLimit : "10";
    if (!playlistId && !videoIds.length) { queueMicrotask(() => { setError("This published feed is missing its playlist."); setLoading(false); }); return; }
    const controller = new AbortController();
    const load = videoIds.length
      ? loadVideoList(videoIds, params.get("title") ?? "", controller.signal)
      : fetch(`/api/playlist?url=${encodeURIComponent(playlistId)}&limit=${limit}`, { signal: controller.signal }).then(async (response) => { const result = await response.json() as ImportResult; if (!response.ok) throw new Error(result.error || "This feed could not be loaded."); return result; });
    void load
      .then((result) => { if (!result.playlist || !result.videos?.length) throw new Error(result.error || "This feed could not be loaded."); setPlaylist(result.playlist); setVideos(result.videos); })
      .catch((cause) => { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "This feed could not be loaded."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const ranked = useMemo(() => rankVideos(videos, 64, [], template), [videos, template]);
  const top = ranked[0];

  if (loading) return <main className="grid min-h-screen place-items-center bg-[var(--ink)] text-white"><div className="text-center"><LoaderCircle className="mx-auto size-8 animate-spin text-[var(--acid)]" /><p className="mt-3 text-white/45">Jev is reading the playlist…</p></div></main>;
  if (error || !playlist) return <main className="grid min-h-screen place-items-center bg-[var(--ink)] px-5 text-white"><div className="max-w-md text-center"><Brain className="mx-auto size-10 text-[var(--acid)]" /><h1 className="mt-4 font-display text-3xl">Feed unavailable</h1><p className="mt-3 text-white/50">{error}</p></div></main>;

  return <main className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
    <header className="border-b border-white/10"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-8"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-[var(--acid)] text-[var(--ink)] sm:size-10"><Brain className="size-5" /></div><div><p className="font-display text-xl leading-none">Jev</p><p className="mt-1 hidden text-xs text-white/45 sm:block">A shared video feed</p></div></div><span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55">{templateDefinitions[template].name}</span></div></header>

    <section className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-8 sm:pt-12">
      <div className="max-w-4xl"><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--acid)]"><Sparkles className="size-4" /> Ready to watch</div><h1 className="font-display text-[clamp(2.7rem,6vw,5rem)] leading-[.95] tracking-[-.05em]">{playlist.title}</h1><p className="mt-3 text-sm text-white/45 sm:text-base">{playlist.channel} · {videos.length} videos · {templateDefinitions[template].description}</p></div>

      {selected && <section className="mt-8 overflow-hidden rounded-[1.5rem] border border-[var(--acid)]/35 bg-black"><div className="aspect-video"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=1&rel=0`} title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div><div className="flex items-center justify-between gap-4 p-4"><div><p className="text-xs uppercase tracking-wider text-[var(--acid)]">Now watching</p><h2 className="mt-1 font-display text-xl">{selected.title}</h2></div><Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Close player"><X /></Button></div></section>}

      {top && <section className="mt-8 grid overflow-hidden rounded-[1.5rem] border border-[var(--acid)]/30 bg-[var(--acid)]/[0.07] md:grid-cols-[1fr_1fr]"><button onClick={() => setSelected(top)} className="relative aspect-video min-h-52 text-left md:aspect-auto"><Image src={top.thumbnail} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" unoptimized className="object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/15"><span className="grid size-14 place-items-center rounded-full bg-white text-black"><Play className="ml-1 size-5 fill-current" /></span></span><span className="absolute bottom-4 left-4 rounded-full bg-[var(--acid)] px-3 py-1 text-xs font-bold uppercase text-[var(--ink)]">Start here</span></button><div className="p-5 sm:p-7"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--acid)]">First in this order</p><h2 className="mt-2 font-display text-2xl leading-tight sm:text-3xl">{top.title}</h2><p className="mt-3 text-sm leading-6 text-white/55">{top.reason}.</p><div className="mt-4 flex flex-wrap gap-1.5">{top.signals.slice(0, 3).map((signal) => <span key={signal} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/50">{signal}</span>)}</div><Button onClick={() => setSelected(top)} className="mt-5 h-11 w-full rounded-xl bg-[var(--acid)] text-[var(--ink)] hover:bg-[var(--acid-bright)]"><Play className="fill-current" /> Play first video</Button></div></section>}

      <div className="mt-8"><div className="mb-4 flex items-end justify-between"><h2 className="font-display text-2xl sm:text-3xl">All videos</h2>{!playlist.id.startsWith("videos:") && <a href={`https://www.youtube.com/playlist?list=${playlist.id}`} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-sm text-white/40 hover:text-white sm:flex">View on YouTube <ExternalLink className="size-4" /></a>}</div><div className="space-y-2">{ranked.map((video, index) => <article key={video.id} className="grid grid-cols-[112px_1fr] gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 sm:grid-cols-[145px_1fr_auto] sm:items-center sm:gap-4 sm:p-3"><button onClick={() => setSelected(video)} className="relative aspect-video overflow-hidden rounded-xl bg-white/10"><Image src={video.thumbnail} alt="" fill sizes="145px" unoptimized className="object-cover" />{video.durationSeconds ? <span className="absolute bottom-1.5 right-1.5 z-10 rounded bg-black/75 px-1 py-0.5 text-[10px] font-semibold text-white">{formatDuration(video.durationSeconds)}</span> : null}<span className="absolute inset-0 grid place-items-center bg-black/15"><span className="grid size-9 place-items-center rounded-full bg-white text-black"><Play className="size-4 fill-current" /></span></span></button><div className="min-w-0 self-center"><p className="text-[11px] text-[var(--acid)]">{index === 0 ? "Start here" : `#${index + 1}`} · {video.classification}</p><h3 className="mt-1 line-clamp-2 font-display text-base leading-tight sm:text-xl">{video.title}</h3><p className="mt-1 hidden line-clamp-1 text-sm text-white/45 sm:block">{video.reason}</p></div><Button onClick={() => setSelected(video)} variant="outline" className="col-span-2 hidden rounded-full border-white/15 bg-white/5 text-white sm:col-span-1 sm:inline-flex"><Play className="fill-current" /> Watch</Button></article>)}</div>{!playlist.id.startsWith("videos:") && <a href={`https://www.youtube.com/playlist?list=${playlist.id}`} target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-center gap-1 text-sm text-white/40 sm:hidden">View on YouTube <ExternalLink className="size-4" /></a>}</div>
    </section>
  </main>;
}
