"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookmarkPlus, Brain, Check, ChevronDown, Copy, ExternalLink, Link2, LoaderCircle, Play, Plus, Rocket, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { AccountBar } from "@/components/account-bar";
import { MyPlaylists } from "@/components/my-playlists";
import { DEFAULT_MASTERY, LEARNING_STATE_KEY, formatDuration, progressForPlaylist, rankVideos, readLearningState, templateDefinitions, type FeedTemplate, type RankedVideo, type Video } from "@/lib/learning";
import { addVideo, createPlaylist, deletePlaylist, emptyStore, mergeVideoDetails, playlistsFor, readAccountStore, removeVideo, signIn, signOut, writeAccountStore, type AccountStore, type UserPlaylist } from "@/lib/account";

type Playlist = { id: string; title: string; channel: string };
type ImportResult = { playlist: Playlist; videos: Video[]; error?: string; returnedCount?: number };
type VideoResult = { videos?: Video[]; error?: string };
type Feedback = "easy" | "right" | "hard";
/** What the builder is currently showing: a YouTube playlist fetched live, or one the signed-in person owns. */
type Source = { kind: "youtube"; playlist: Playlist; videos: Video[] } | { kind: "mine"; playlistId: string };

declare global { interface Document { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

const samplePlaylist: Playlist = { id: "PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr", title: "Essence of calculus", channel: "3Blue1Brown" };
const sampleVideos: Video[] = [
  { id: "WUvTyaaNkzM", title: "The essence of calculus", channel: "3Blue1Brown", description: "A visual introduction to integrals, derivatives, and the fundamental theorem of calculus.", thumbnail: "https://i.ytimg.com/vi/WUvTyaaNkzM/hqdefault.jpg", durationSeconds: 1025 },
  { id: "9vKqVkMQHKk", title: "The paradox of the derivative", channel: "3Blue1Brown", description: "What derivatives really measure, and why instantaneous rate of change makes sense.", thumbnail: "https://i.ytimg.com/vi/9vKqVkMQHKk/hqdefault.jpg", durationSeconds: 1010 },
  { id: "kfF40MiS7zA", title: "Derivative formulas through geometry", channel: "3Blue1Brown", description: "Deriving familiar rules visually through geometry and first principles.", thumbnail: "https://i.ytimg.com/vi/kfF40MiS7zA/hqdefault.jpg", durationSeconds: 1106 },
];

const ENRICH_CHUNK = 10;
const ENRICH_MAX = 40;

async function fetchVideoDetails(ids: string[]) {
  const response = await fetch(`/api/video?ids=${encodeURIComponent(ids.join(","))}`);
  const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as VideoResult;
  if (!response.ok) throw new Error(result.error || "That video could not be read.");
  return result.videos ?? [];
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [source, setSource] = useState<Source>({ kind: "youtube", playlist: samplePlaylist, videos: sampleVideos });
  const [store, setStore] = useState<AccountStore>(emptyStore);
  const [mastery, setMastery] = useState(DEFAULT_MASTERY);
  const [completed, setCompleted] = useState<string[]>([]);
  const [selected, setSelected] = useState<RankedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingVideo, setAddingVideo] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showLogic, setShowLogic] = useState(false);
  const [hasLoadedProgress, setHasLoadedProgress] = useState(false);
  const [template, setTemplate] = useState<FeedTemplate>("stretch");
  const [videoLimit, setVideoLimit] = useState<10 | 50 | 100>(10);
  const [publishedUrl, setPublishedUrl] = useState("");
  const enrichAttempted = useRef(new Set<string>());

  const myPlaylists = playlistsFor(store, store.username);
  const minePlaylist = source.kind === "mine" ? myPlaylists.find((playlist) => playlist.id === source.playlistId) ?? null : null;
  const playlist: Playlist = source.kind === "youtube" ? source.playlist : { id: source.playlistId, title: minePlaylist?.title ?? "Deleted playlist", channel: store.username ?? "you" };
  const mineVideos = minePlaylist?.videos;
  const videos = useMemo(() => source.kind === "youtube" ? source.videos : mineVideos ?? [], [source, mineVideos]);
  const canEdit = source.kind === "mine" && !!minePlaylist;

  useEffect(() => {
    const account = readAccountStore();
    const saved = progressForPlaylist(readLearningState(), samplePlaylist.id, sampleVideos.map((video) => video.id));
    queueMicrotask(() => { setStore(account); setMastery(saved.mastery); setCompleted(saved.completed); setHasLoadedProgress(true); });
  }, []);

  useEffect(() => {
    if (!hasLoadedProgress) return;
    const state = readLearningState();
    localStorage.setItem(LEARNING_STATE_KEY, JSON.stringify({ ...state, [playlist.id]: { mastery, completed } }));
  }, [mastery, completed, hasLoadedProgress, playlist.id]);

  useEffect(() => { if (hasLoadedProgress) writeAccountStore(store); }, [store, hasLoadedProgress]);

  // Enrich videos that arrived without a description or duration by reading their watch pages in small batches.
  useEffect(() => {
    const missing = videos.filter((video) => (!video.description || !video.durationSeconds) && !video.category && !enrichAttempted.current.has(video.id)).slice(0, ENRICH_MAX);
    if (!missing.length) return;
    missing.forEach((video) => enrichAttempted.current.add(video.id));
    let cancelled = false;
    (async () => {
      for (let start = 0; start < missing.length && !cancelled; start += ENRICH_CHUNK) {
        const details = await fetchVideoDetails(missing.slice(start, start + ENRICH_CHUNK).map((video) => video.id)).catch(() => [] as Video[]);
        if (cancelled || !details.length) continue;
        const byId = new Map(details.map((video) => [video.id, video]));
        setSource((current) => current.kind === "youtube" ? { ...current, videos: current.videos.map((video) => byId.has(video.id) ? { ...video, ...byId.get(video.id) } : video) } : current);
        setStore((current) => mergeVideoDetails(current, details));
      }
    })();
    return () => { cancelled = true; };
  }, [videos]);

  const ranked = useMemo(() => rankVideos(videos, mastery, completed, template), [videos, mastery, completed, template]);

  const switchTo = useCallback((next: Source, nextVideos: Video[]) => {
    const id = next.kind === "youtube" ? next.playlist.id : next.playlistId;
    const saved = progressForPlaylist(readLearningState(), id, nextVideos.map((video) => video.id));
    setSource(next); setMastery(saved.mastery); setCompleted(saved.completed); setSelected(null); setPublishedUrl(""); setError(""); setNotice("");
  }, []);

  const importPlaylist = useCallback(async (playlistUrl: string, requestedLimit: 10 | 50 | 100 = videoLimit) => {
    setLoading(true); setError(""); setPublishedUrl("");
    try {
      const response = await fetch(`/api/playlist?url=${encodeURIComponent(playlistUrl)}&limit=${requestedLimit}`);
      const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as ImportResult;
      if (!response.ok) throw new Error(result.error || "Could not import that playlist.");
      if (!result.playlist?.id || !result.videos?.length) throw new Error("That playlist did not contain any public videos.");
      switchTo({ kind: "youtube", playlist: result.playlist, videos: result.videos }, result.videos);
      setUrl(playlistUrl); setVideoLimit(requestedLimit);
      return { title: result.playlist.title, videoCount: result.videos.length };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not import that playlist.";
      setError(message); throw new Error(message);
    } finally { setLoading(false); }
  }, [videoLimit, switchTo]);

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

  /** Runs an account mutation, surfacing its error message instead of throwing. Returns true on success. */
  function mutate(change: (current: AccountStore) => AccountStore) {
    try { setStore(change(store)); setError(""); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong."); return false; }
  }

  async function submit(event: FormEvent) { event.preventDefault(); if (!url.trim()) { setError("Paste a YouTube playlist link first."); return; } try { await importPlaylist(url); } catch { /* visible error is already set */ } }

  async function submitVideo(event: FormEvent) {
    event.preventDefault();
    if (!videoUrl.trim()) { setError("Paste a YouTube video link first."); return; }
    if (!canEdit) { setError("Open one of your playlists first, or save this one as yours."); return; }
    setAddingVideo(true); setError("");
    try {
      const [video] = await fetchVideoDetails([videoUrl]);
      if (!video) throw new Error("That video could not be read.");
      if (mutate((current) => addVideo(current, source.kind === "mine" ? source.playlistId : "", video))) { setVideoUrl(""); setNotice(`Added “${video.title}”.`); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That video could not be added."); }
    finally { setAddingVideo(false); }
  }

  function saveAsMine() {
    if (source.kind !== "youtube") return;
    if (!store.username) { setError("Sign in with a username to save playlists."); return; }
    try {
      const { store: next, playlist: created } = createPlaylist(store, source.playlist.title, source.videos, source.playlist.id);
      setStore(next); switchTo({ kind: "mine", playlistId: created.id }, created.videos); setNotice(`Saved a copy you can edit: ${created.title}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the playlist."); }
  }

  function createEmpty(title: string) {
    try { const { store: next, playlist: created } = createPlaylist(store, title); setStore(next); switchTo({ kind: "mine", playlistId: created.id }, []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the playlist."); }
  }

  function remove(playlistToDelete: UserPlaylist) {
    if (!mutate((current) => deletePlaylist(current, playlistToDelete.id))) return;
    if (source.kind === "mine" && source.playlistId === playlistToDelete.id) switchTo({ kind: "youtube", playlist: samplePlaylist, videos: sampleVideos }, sampleVideos);
  }

  function respond(video: RankedVideo, feedback: Feedback) { const delta = feedback === "easy" ? 8 : feedback === "right" ? 4 : -7; setMastery((value) => Math.max(30, Math.min(92, value + delta))); setCompleted((items) => items.includes(video.id) ? items : [...items, video.id]); setSelected(null); }

  async function publish() {
    const params = new URLSearchParams({ template });
    if (source.kind === "youtube") { params.set("playlist", playlist.id); params.set("limit", String(videoLimit)); }
    else { if (!videos.length) { setError("Add at least one video before publishing."); return; } params.set("videos", videos.map((video) => video.id).join(",")); params.set("title", playlist.title); }
    const share = `${window.location.origin}/feed?${params.toString()}`;
    setPublishedUrl(share);
    try { await navigator.clipboard.writeText(share); } catch { /* Link remains visible for manual copying. */ }
  }

  const completedCount = videos.filter((video) => completed.includes(video.id)).length;
  const progress = videos.length ? Math.round((completedCount / videos.length) * 100) : 0;
  const totalSeconds = videos.reduce((sum, video) => sum + (video.durationSeconds ?? 0), 0);
  const isExample = source.kind === "youtube" && source.playlist.id === samplePlaylist.id && !url;

  return <main className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5">
      <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-[var(--acid)] text-[var(--ink)] sm:size-10"><Brain className="size-5" /></div><div><p className="font-display text-xl leading-none">Jev</p><p className="mt-1 hidden text-xs text-white/45 sm:block">A better order for YouTube</p></div></div>
      <AccountBar username={store.username} onSignIn={(name) => { try { setStore(signIn(store, name)); return ""; } catch (cause) { return cause instanceof Error ? cause.message : "Try another name."; } }} onSignOut={() => { setStore(signOut(store)); if (source.kind === "mine") switchTo({ kind: "youtube", playlist: samplePlaylist, videos: sampleVideos }, sampleVideos); }} />
    </header>

    <section className="mx-auto max-w-6xl px-4 pb-20 pt-7 sm:px-8 sm:pt-12">
      <div className="grid gap-5 lg:grid-cols-[1fr_.72fr] lg:items-end">
        <div><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--acid)]"><Sparkles className="size-4" /> Curate, then share</div><h1 className="max-w-3xl font-display text-[clamp(2.7rem,6vw,5rem)] leading-[.95] tracking-[-.05em]">Watch YouTube in a better order.</h1></div>
        <p className="max-w-xl text-base leading-7 text-white/55 sm:text-lg">Bring a playlist. Jev puts the most useful videos first and gives you one calm, shareable place to watch them.</p>
      </div>

      <section className="mt-8 rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-4 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><h2 className="font-display text-2xl">Start with a YouTube playlist</h2><p className="mt-1 text-sm text-white/45">Public playlists work. Nothing is added to your YouTube account.</p>
            <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1 rounded-xl bg-black/25"><Link2 className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35" /><Input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="YouTube playlist link" placeholder="Paste a YouTube playlist link" className="h-13 border-white/10 bg-transparent pl-11 text-base text-white shadow-none placeholder:text-white/30" /></div>
              <Button disabled={loading} type="submit" className="h-13 rounded-xl bg-[var(--acid)] px-6 text-[var(--ink)] hover:bg-[var(--acid-bright)]">{loading ? <LoaderCircle className="animate-spin" /> : <>Bring it in <ArrowRight /></>}</Button>
            </form>
          </div>
          <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-white/35">Import first</p><div className="mt-2 flex gap-1 rounded-xl bg-black/20 p-1">{([10, 50, 100] as const).map((count) => <button key={count} onClick={() => { setVideoLimit(count); if (url) void importPlaylist(url, count).catch(() => undefined); }} className={`h-10 min-w-14 rounded-lg px-3 text-sm font-semibold ${videoLimit === count ? "bg-white text-black" : "text-white/50 hover:text-white"}`}>{count}</button>)}</div></div>
        </div>
        <div aria-live="polite" className="min-h-6 pt-2 text-sm">{error ? <p className="text-red-300">{error}</p> : notice ? <p className="text-[var(--acid)]">{notice}</p> : null}</div>
      </section>

      <div className="mt-4"><MyPlaylists username={store.username} playlists={myPlaylists} activeId={source.kind === "mine" ? source.playlistId : null} onOpen={(item) => switchTo({ kind: "mine", playlistId: item.id }, item.videos)} onCreate={createEmpty} onDelete={remove} /></div>

      <section className="mt-10 border-t border-white/10 pt-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-white/40"><span>{isExample ? "Example" : canEdit ? "Your playlist" : "YouTube playlist"}</span><span>·</span><span>{videos.length} videos</span>{totalSeconds ? <><span>·</span><span>{formatDuration(totalSeconds)}</span></> : null}</div><h2 className="mt-2 font-display text-3xl sm:text-4xl">{playlist.title}</h2><p className="mt-1 text-sm text-white/45">{playlist.channel}</p></div>
          <div className="flex flex-col gap-2 sm:flex-row"><Button onClick={publish} disabled={!videos.length} className="h-11 rounded-xl bg-[var(--violet)] px-5 text-white hover:bg-violet-500"><Rocket /> Share this feed</Button>{source.kind === "youtube" && <Button onClick={saveAsMine} variant="outline" className="h-11 rounded-xl border-white/15 bg-white/5 px-5 text-white hover:bg-white/10"><BookmarkPlus /> Save a copy</Button>}</div></div>
        {publishedUrl && <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--acid)]"><Check className="size-4" /> Link copied <a className="underline" href={publishedUrl} target="_blank" rel="noreferrer">Open shared feed <ExternalLink className="inline size-3" /></a><button onClick={() => navigator.clipboard.writeText(publishedUrl)} aria-label="Copy shared link"><Copy className="size-4" /></button></p>}

        {canEdit && <form onSubmit={submitVideo} className="mt-5 flex flex-col gap-2 rounded-2xl border border-[var(--acid)]/25 bg-[var(--acid)]/[0.05] p-3 sm:flex-row"><div className="relative min-w-0 flex-1"><Plus className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35" /><Input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} aria-label="YouTube video link" placeholder="Paste a YouTube video link" className="h-11 border-0 bg-transparent pl-10 text-base text-white shadow-none placeholder:text-white/30 focus-visible:ring-0" /></div><Button disabled={addingVideo} type="submit" className="h-11 rounded-xl bg-[var(--acid)] px-5 text-[var(--ink)] hover:bg-[var(--acid-bright)]">{addingVideo ? <LoaderCircle className="animate-spin" /> : <>Add video <Plus /></>}</Button></form>}

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:p-4"><div className="flex items-center justify-between gap-3"><p className="font-display text-lg">What should come first?</p><button onClick={() => setShowLogic((value) => !value)} className="flex items-center gap-1 text-sm text-white/45">How it works <ChevronDown className={`size-4 transition ${showLogic ? "rotate-180" : ""}`} /></button></div><div className="mt-3 grid grid-cols-3 gap-1.5">{(Object.keys(templateDefinitions) as FeedTemplate[]).map((key) => <button key={key} onClick={() => setTemplate(key)} className={`rounded-xl border px-2 py-3 text-left transition sm:px-4 ${template === key ? "border-[var(--acid)] bg-[var(--acid)]/10" : "border-white/10 bg-black/10 hover:border-white/25"}`}><span className="block text-sm font-semibold sm:text-base">{templateDefinitions[key].name}</span><span className="mt-1 hidden text-xs leading-5 text-white/45 sm:block">{templateDefinitions[key].description}</span></button>)}</div>{showLogic && <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-6 text-white/50">Jev reads public details such as each video&apos;s title, description, length, category, and chapters. Your choice changes the order of the same videos; it never changes the playlist itself.</p>}<div className="mt-4 flex items-center gap-3"><Progress value={progress} aria-label={`${progress}% watched`} className="h-1.5 flex-1 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[var(--acid)]" /><span className="text-xs text-white/40">{completedCount}/{videos.length} watched</span></div></div>

        {selected && <section className="mt-6 overflow-hidden rounded-[1.5rem] border border-[var(--acid)]/35 bg-black"><div className="aspect-video"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=1&rel=0`} title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div><div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-[.14em] text-[var(--acid)]">Now watching</p><h2 className="mt-1 font-display text-xl">{selected.title}</h2></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => respond(selected, "hard")} className="border-white/15 bg-white/5 text-white">Too hard</Button><Button variant="outline" onClick={() => respond(selected, "right")} className="border-white/15 bg-white/5 text-white">Just right</Button><Button onClick={() => respond(selected, "easy")} className="bg-[var(--acid)] text-[var(--ink)]">Too easy</Button><Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Close player"><X /></Button></div></div></section>}

        <div className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="font-display text-2xl">Up next</h3><span className="text-sm text-white/40">{ranked.length} remaining</span></div>{!videos.length && <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45"><p className="font-display text-2xl text-white/70">This playlist is empty.</p><p className="mt-2 text-sm leading-6">Add a YouTube video link above. Jev will order the videos as you add them.</p></div>}<div className="space-y-2">{ranked.map((video, index) => <article key={video.id} className={`group grid grid-cols-[112px_1fr] gap-3 rounded-2xl border p-2.5 transition sm:grid-cols-[150px_1fr_auto] sm:items-center sm:gap-4 sm:p-3 ${index === 0 ? "border-[var(--acid)]/45 bg-[var(--acid)]/[0.07]" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}>
          <button onClick={() => setSelected(video)} className="relative aspect-video overflow-hidden rounded-xl bg-white/10 text-left"><Image src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" fill sizes="150px" unoptimized className="object-cover opacity-85 transition group-hover:scale-[1.03]" /><span className="absolute inset-0 grid place-items-center bg-black/15"><span className="grid size-9 place-items-center rounded-full bg-white text-black"><Play className="ml-0.5 size-4 fill-current" /></span></span>{video.durationSeconds ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 py-0.5 text-[10px] font-semibold text-white">{formatDuration(video.durationSeconds)}</span> : null}</button>
          <div className="min-w-0 self-center"><div className="mb-1 flex items-center gap-2 text-[11px] text-white/40"><span className={index === 0 ? "font-semibold text-[var(--acid)]" : ""}>{index === 0 ? "Start here" : `#${index + 1}`}</span><span>·</span><span className="truncate">{video.channel}</span></div><h4 className="line-clamp-2 font-display text-base leading-tight sm:text-xl">{video.title}</h4><p className="mt-1 hidden text-sm text-white/45 sm:line-clamp-1">{video.reason}</p>{index === 0 && <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45 sm:hidden">{video.reason}</p>}</div>
          <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">{canEdit && <button onClick={() => mutate((current) => removeVideo(current, source.kind === "mine" ? source.playlistId : "", video.id))} className="grid size-9 place-items-center rounded-full text-white/35 hover:bg-red-500/15 hover:text-red-300" aria-label={`Remove ${video.title} from playlist`}><Trash2 className="size-4" /></button>}<Button onClick={() => setSelected(video)} variant="outline" className="hidden rounded-full border-white/15 bg-white/5 text-white sm:inline-flex"><Play className="fill-current" /> Watch</Button></div>
        </article>)}</div></div>
      </section>
    </section>
  </main>;
}
