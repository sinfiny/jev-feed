"use client";

import { isTyping } from "@/lib/utils";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bookmark, Check, ChevronDown, ExternalLink, Moon, Play, RotateCcw, X } from "lucide-react";
import { Hint, Logo, Mascot, StatusGlyph, burstFrom, toneOf, useHints, type Mood } from "@/components/brand";
import { PlayerDeck } from "@/components/player-deck";
import type { Clip, PlayerHandle } from "@/components/youtube-player";
import { ChannelAvatar, LensSummary, ReasonChips, StatChips, Thumb, age } from "@/components/video-bits";
import { feedOrder, type PublishedFeed } from "@/lib/feed";
import { formatCount, formatDuration, type Video } from "@/lib/learning";
import type { Lens, Reason } from "@/lib/lens";
import {
  PROGRESS_KEY, SPEEDS, addBookmark, chapterAt, emptyProgress, labelBookmark, momentsFor, parseProgress, removeBookmark,
  savePosition, toggleChapterDone, toggleStatus, videoState, writeProgress, type Moment, type Progress, type VideoState,
} from "@/lib/library";
import { mergeVideos } from "@/lib/youtube-playlist";

export type FeedViewProps = {
  /** The feed to show. Null while it loads. Legacy links build one from a playlist or a list of video ids. */
  feed: PublishedFeed | null;
  /** Shown instead of the feed when it could not be loaded. */
  error?: string;
  /** Videos still on their way (links built from video ids arrive in batches). Drawn as placeholder rows. */
  pending?: number;
  /** Where the videos came from on YouTube, for an "Open on YouTube" link. */
  youtubeUrl?: string;
};

/**
 * The anonymous feed: what a viewer sees at /feed/<id> or an older /feed?playlist=… link. No sign-in. Progress
 * (done, snoozed, position, bookmarks, speed) goes into the same localStorage store as the signed-in app, keyed by
 * video id, so a video finished here is finished everywhere on this device.
 */
export function FeedView({ feed, error, pending = 0, youtubeUrl }: FeedViewProps) {
  if (error) return <FeedProblem message={error} />;
  if (!feed) return <FeedLoading />;
  return <Feed feed={feed} pending={pending} youtubeUrl={youtubeUrl} />;
}

/** Seconds between position saves while a video plays. */
const SAVE_EVERY_SECONDS = 5;

const time = (seconds: number) => formatDuration(Math.max(0, Math.floor(seconds))) || "0:00";
const hoursAndMinutes = (seconds: number) => {
  const hours = Math.floor(seconds / 3600), minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const isPressable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("button, a, [role=slider]");
const tint = (tone: string) => ({ "--tone": tone }) as CSSProperties;

/** Progress in this browser, shared with the signed-in app and with other open tabs. */
function useDeviceProgress() {
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const loaded = useRef(false);
  const fromStorage = useRef(false);
  useEffect(() => {
    const read = () => { fromStorage.current = true; setProgress(parseProgress(window.localStorage.getItem(PROGRESS_KEY)) ?? emptyProgress()); };
    queueMicrotask(() => { read(); loaded.current = true; });
    const onStorage = (event: StorageEvent) => { if (event.key === PROGRESS_KEY) read(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    // A change read from another tab is already stored; writing it back would only echo it.
    if (fromStorage.current) { fromStorage.current = false; return; }
    writeProgress(progress);
  }, [progress]);
  return [progress, setProgress] as const;
}

function Feed({ feed, pending, youtubeUrl }: { feed: PublishedFeed; pending: number; youtubeUrl?: string }) {
  const tone = toneOf(feed.color);
  const [progress, setProgress] = useDeviceProgress();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [ended, setEnded] = useState(false);
  const [chapterNow, setChapterNow] = useState<number | undefined>();
  /** Fuller copies of videos opened here, read from their watch page for chapters. Null when nothing more was found. */
  const [fuller, setFuller] = useState<Record<string, Video | null>>({});
  const [flash, setFlash] = useState<Mood | null>(null);
  const [popped, setPopped] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const player = useRef<PlayerHandle>(null);
  const deck = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hints = useHints();

  useEffect(() => { document.title = `${feed.emoji} ${feed.title} · Jev`; }, [feed.emoji, feed.title]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 2400); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // The order is computed from the feed as published. Details read later (chapters) never reshuffle it.
  const { order, aside } = useMemo(() => feedOrder(feed.items, feed.lens, feed.judgments), [feed.items, feed.lens, feed.judgments]);
  const notes = useMemo(() => new Map(feed.items.flatMap((item) => item.note ? [[item.video.id, item.note] as const] : [])), [feed.items]);
  const lanes = useMemo(() => [order.map((entry) => entry.video), aside.map((entry) => entry.video)], [order, aside]);
  const stateOf = useCallback((id: string) => videoState(progress.videos[id]), [progress.videos]);

  // Prev and next move through the lens's order, or through the set-aside videos when one of those is playing.
  const lane = lanes.find((videos) => videos.some((item) => item.id === playingId)) ?? [];
  const position = lane.findIndex((item) => item.id === playingId);
  const base = lane[position];
  const video = base && (fuller[base.id] ?? base);
  const next = position >= 0 ? lane[position + 1] : undefined;
  const previous = position > 0 ? lane[position - 1] : undefined;

  const total = order.length;
  const done = order.filter((entry) => stateOf(entry.video.id) === "done").length;
  const seconds = order.reduce((sum, entry) => sum + (entry.video.durationSeconds ?? 0), 0);
  const allDone = total > 0 && done === total && !pending;
  const startHere = order.find((entry) => !["done", "snoozed"].includes(stateOf(entry.video.id))) ?? order.find((entry) => stateOf(entry.video.id) !== "done");
  const mood: Mood = flash ?? (allDone ? "happy" : "calm");

  const cheer = useCallback((next: Mood) => {
    clearTimeout(flashTimer.current);
    setFlash(next);
    flashTimer.current = setTimeout(() => setFlash(null), 1800);
  }, []);

  const resumeAt = useCallback((target: Video) => {
    const saved = progress.videos[target.id];
    return saved?.status !== "done" && saved?.position && (!target.durationSeconds || saved.position < target.durationSeconds - 15) ? saved.position : 0;
  }, [progress.videos]);

  const open = useCallback((target: Video, autoplay = true) => {
    const leaving = playingId;
    if (leaving === target.id && !ended) return;
    const at = player.current?.time() ?? 0;
    if (leaving && leaving !== target.id && at > 0) setProgress((current) => savePosition(current, leaving, at));
    const start = resumeAt(target);
    // The first open changes the layout, so it starts from the top where the player is.
    if (!leaving) window.scrollTo({ top: 0 });
    setPlayingId(target.id);
    setEnded(false);
    setClip({ videoId: target.id, start, autoplay, nonce: Date.now() });
    setChapterNow(chapterAt(target, start)?.start);
    lastSaved.current = start;
  }, [playingId, ended, resumeAt, setProgress]);

  const close = useCallback(() => {
    const at = player.current?.time() ?? 0;
    if (playingId && at > 0 && !ended) setProgress((current) => savePosition(current, playingId, at));
    setPlayingId(null);
    setClip(null);
    setEnded(false);
  }, [playingId, ended, setProgress]);

  const toggleDone = useCallback((id: string, from: Element | null) => {
    const finishing = stateOf(id) !== "done";
    setProgress((current) => toggleStatus(current, id, "done"));
    hints.done("feed-done");
    if (!finishing) return;
    setPopped(id);
    burstFrom(from);
    cheer("happy");
  }, [stateOf, setProgress, hints, cheer]);

  const toggleSnooze = useCallback((id: string) => {
    const snoozing = stateOf(id) !== "snoozed";
    setProgress((current) => toggleStatus(current, id, "snoozed"));
    if (snoozing) cheer("sleepy");
  }, [stateOf, setProgress, cheer]);

  // Videos from a playlist page or a published snapshot may lack chapters; the open one is read from its watch page once.
  useEffect(() => {
    if (!base || base.chapters?.length || base.complete || base.id in fuller) return;
    const target = base;
    fetch(`/api/video?ids=${target.id}`)
      .then((response) => response.ok ? response.json() as Promise<{ videos?: Video[] }> : null)
      .catch(() => null)
      .then((result) => {
        const found = result?.videos?.find((item) => item.id === target.id);
        setFuller((current) => ({ ...current, [target.id]: found ? mergeVideos(target.id, found, target) : null }));
      });
  }, [base, fuller]);

  const onTick = useCallback((at: number) => {
    if (!video) return;
    const chapter = chapterAt(video, at)?.start;
    setChapterNow(chapter);
    if (Math.abs(at - lastSaved.current) >= SAVE_EVERY_SECONDS) { lastSaved.current = at; setProgress((current) => savePosition(current, video.id, at)); }
  }, [video, setProgress]);

  const seek = useCallback((at: number) => {
    player.current?.seek(at);
    if (video) setChapterNow(chapterAt(video, at)?.start);
  }, [video]);

  const onEnded = useCallback(() => {
    if (!playingId) return;
    const id = playingId;
    const finishing = stateOf(id) !== "done";
    setProgress((current) => { const reset = savePosition(current, id, 0); return current.videos[id]?.status === "done" ? reset : toggleStatus(reset, id, "done"); });
    lastSaved.current = 0;
    setEnded(true);
    if (finishing) { burstFrom(deck.current); cheer("happy"); }
  }, [playingId, stateOf, setProgress, cheer]);

  const bookmark = useCallback(() => {
    if (!playingId) return;
    const at = player.current?.time() ?? 0;
    setProgress((current) => addBookmark(current, playingId, at).progress);
    setToast(`Bookmarked ${time(at)}. Add a note below.`);
    hints.done("feed-keys");
  }, [playingId, setProgress, hints]);

  const setRate = useCallback((rate: number) => setProgress((current) => ({ ...current, rate })), [setProgress]);
  const stepRate = useCallback((direction: 1 | -1) => setProgress((current) => {
    const index = SPEEDS.indexOf(current.rate as (typeof SPEEDS)[number]);
    return { ...current, rate: SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, index + direction))] };
  }), [setProgress]);

  // YouTube's keys, while the page (not a text field) has focus. Space only when it would not press a focused button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!playingId || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === " " && isPressable(event.target)) return;
      const actions: Record<string, () => void> = {
        b: bookmark,
        j: () => seek((player.current?.time() ?? 0) - 10),
        l: () => seek((player.current?.time() ?? 0) + 10),
        k: () => player.current?.togglePlay(),
        " ": () => player.current?.togglePlay(),
        n: () => { if (next) open(next); },
        p: () => { if (previous) open(previous); },
        "<": () => stepRate(-1),
        ">": () => stepRate(1),
      };
      const action = actions[event.key.toLowerCase()];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playingId, bookmark, seek, next, previous, open, stepRate]);

  const counts = !total && pending ? `Loading ${pending} video${pending === 1 ? "" : "s"}…` : [
    `${total} video${total === 1 ? "" : "s"}`,
    seconds > 0 && hoursAndMinutes(seconds),
    done > 0 && (allDone ? "all done" : `${done} done`),
    pending > 0 && `${pending} still loading`,
  ].filter(Boolean).join(" · ");

  const list = <FeedList feed={feed} tone={tone} order={order} aside={aside} notes={notes} progress={progress} pending={pending} playingId={playingId} popped={popped}
    youtubeUrl={youtubeUrl} hint={hints.showing("feed-done") && !playingId ? <Hint onClose={() => hints.done("feed-done")} className="mb-3">Tap a circle to mark a video done. Your progress stays in this browser, no account needed.</Hint> : null}
    onPlay={open} onToggleDone={toggleDone} />;

  const hero = <Hero feed={feed} tone={tone} counts={counts} done={done} total={total} mood={mood} allDone={allDone} compact={!!video} onPoke={() => cheer("wink")} />;

  return <main className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
    {video && clip ? <div className="lg:mx-auto lg:grid lg:max-w-[1400px] lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:gap-6 lg:px-6 lg:pt-6">
      {/* On phones the deck sticks to the top while the list scrolls under it; on desktop the whole left column stays put. */}
      <div className="max-lg:contents lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-6 scroll-thin">
        <div ref={deck} className="max-lg:sticky max-lg:top-0 max-lg:z-40 max-lg:bg-[var(--ink-2)] max-lg:shadow-[0_4px_0_#000a]">
          <div className="flex items-center gap-2 px-3 py-1.5 lg:hidden">
            <span className="grid size-6 shrink-0 place-items-center rounded-md border-2 border-black/60 font-display text-[11px] text-[var(--ink)]" style={{ background: tone }}>{position + 1}</span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{video.title}</p>
            <button onClick={close} aria-label="Close the player" className="juicy-ghost size-8"><X className="size-4" /></button>
          </div>
          <PlayerDeck player={player} clip={clip} video={video} moments={momentsFor(video, progress.videos[video.id])} rate={progress.rate} onRate={setRate}
            onEnded={onEnded} onTick={onTick} onSeek={seek} onBookmark={bookmark} onPrev={previous ? () => open(previous) : undefined} onNext={next ? () => open(next) : undefined}
            hint={hints.showing("feed-keys") ? <Hint onClose={() => hints.done("feed-keys")} mood="wink">
              <span className="max-md:hidden">Keys work here too: <span className="kbd">K</span> play, <span className="kbd">J</span> <span className="kbd">L</span> 10 seconds, <span className="kbd">B</span> bookmark, <span className="kbd">N</span> next.</span>
              <span className="md:hidden">Tap <b>Bookmark</b> to save a moment. It shows up under the video with room for a note.</span>
            </Hint> : undefined} />
        </div>
        <NowPlaying video={video} tone={tone} number={position + 1} total={lane.length} note={notes.get(video.id)} author={feed.author} state={stateOf(video.id)}
          moments={momentsFor(video, progress.videos[video.id])} chapterNow={chapterNow} looking={!video.chapters?.length && !(video.id in fuller) && !video.complete}
          ended={ended} next={next} allDone={allDone} onClose={close} onSeek={seek} onPlay={open}
          onToggleDone={(from) => toggleDone(video.id, from)} onToggleSnooze={() => toggleSnooze(video.id)}
          onToggleChapter={(start) => setProgress((current) => toggleChapterDone(current, video.id, start))}
          onLabel={(id, label) => setProgress((current) => labelBookmark(current, video.id, id, label))}
          onRemove={(id) => setProgress((current) => removeBookmark(current, video.id, id))} />
      </div>
      <div className="mt-8 min-w-0 px-3 sm:px-4 lg:mt-0 lg:px-0">
        {hero}
        {feed.lens && <LensCard lens={feed.lens} settling={pending > 0} />}
        {list}
        <Footer />
      </div>
    </div> : <div className="mx-auto max-w-3xl">
      {hero}
      <div className="px-3 sm:px-4">
        {feed.lens && <LensCard lens={feed.lens} settling={pending > 0} />}
        {startHere ? <StartHere video={startHere.video} note={notes.get(startHere.video.id)} author={feed.author} tone={tone} resume={resumeAt(startHere.video)} state={stateOf(startHere.video.id)} onPlay={open} />
          : allDone ? <AllDone tone={tone} onRestart={() => order[0] && open(order[0].video)} /> : pending > 0 && <StartHereSkeleton />}
        {list}
      </div>
      <Footer />
    </div>}
    {toast && <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex justify-center px-4">
      <p role="status" className="animate-rise rounded-full border-2 border-black/70 bg-[var(--paper)] px-4 py-2 text-sm font-bold text-[var(--ink)] shadow-[0_4px_0_#000a]">{toast}</p>
    </div>}
  </main>;
}

/** The feed's cover, in its own color: emoji, title, who made it, how far along the viewer is. Jev reacts to what they do. */
function Hero({ feed, tone, counts, done, total, mood, allDone, compact, onPoke }: {
  feed: PublishedFeed; tone: string; counts: string; done: number; total: number; mood: Mood; allDone: boolean; compact: boolean; onPoke: () => void;
}) {
  const [pokes, setPokes] = useState(0);
  const say = mood === "happy" ? (allDone ? "You finished it all!" : "Nice one!") : mood === "sleepy" ? "Later, then." : mood === "wink" ? "Hi!" : done ? "Keep going!" : "Ready when you are.";
  return <header className={`relative overflow-hidden text-[var(--ink)] ${compact ? "rounded-[26px] border-2 border-black/70 shadow-[0_5px_0_#000c]" : "border-b-2 border-black/70 sm:mx-4 sm:mt-4 sm:rounded-[32px] sm:border-2 sm:shadow-[0_6px_0_#000c]"}`} style={{ background: tone }}>
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#0000001f_1.2px,transparent_1.2px)] [background-size:18px_18px]" />
    <div className={`relative ${compact ? "p-4" : "px-5 pb-6 pt-4 sm:px-8 sm:pb-8"}`}>
      {!compact && <nav className="flex items-center justify-between gap-3">
        <Link href="/" aria-label="Jev home" className="rounded-xl"><Logo size={26} /></Link>
        <span className="rounded-full border-2 border-black/15 bg-black/10 px-2.5 py-0.5 text-xs font-bold">A Jev feed</span>
      </nav>}
      <div className={`flex items-end justify-between gap-3 ${compact ? "" : "mt-6"}`}>
        <span aria-hidden className={`leading-none drop-shadow-[0_4px_0_#0003] ${compact ? "text-4xl" : "text-7xl sm:text-8xl"}`}>{feed.emoji}</span>
        <div className="flex items-end gap-1.5">
          {!compact && <span className="mb-10 max-w-[10rem] rounded-2xl rounded-br-[6px] border-2 border-black/70 bg-[var(--paper)] px-2.5 py-1 text-xs font-bold leading-tight shadow-[0_3px_0_#000a]">{say}</span>}
          <button key={pokes} onClick={() => { setPokes((count) => count + 1); onPoke(); }} aria-label="Poke Jev" className={`shrink-0 rounded-full ${pokes ? "animate-bounce-once" : ""}`}>
            <Mascot mood={mood} size={compact ? 44 : 76} />
          </button>
        </div>
      </div>
      <h1 className={`font-display ${compact ? "mt-2 text-2xl leading-tight" : "mt-3 text-[clamp(2.3rem,10vw,4.6rem)] leading-[.92]"}`}>{feed.title}</h1>
      {feed.blurb && <p className={`max-w-xl text-black/75 ${compact ? "mt-1 line-clamp-2 text-sm" : "mt-3 text-base leading-snug sm:text-lg"}`}>{feed.blurb}</p>}
      {feed.author && <p className={`font-bold ${compact ? "mt-1 text-xs" : "mt-3 text-sm"}`}>by {feed.author}</p>}
      <p className={`font-semibold tabular-nums text-black/80 ${compact ? "mt-2 text-xs" : "mt-5 text-sm"}`}>{counts}</p>
      <div role="progressbar" aria-label="Videos done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className={`mt-2 overflow-hidden rounded-full border-2 border-black/70 bg-[var(--ink)] ${compact ? "h-3" : "h-4"}`}>
        <div className="h-full rounded-full bg-[var(--lime)] transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  </header>;
}

/** Which lens ordered the feed, and on request, how it weighs things. */
function LensCard({ lens, settling }: { lens: Lens; settling: boolean }) {
  const [open, setOpen] = useState(false);
  return <section className="sticker mt-5 border-[var(--grape)]/35 p-3">
    <button onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-xl text-left">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--grape)]/20 text-xl">{lens.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-[.14em] text-[#c9b8ff]">Ordered by</span>
        <span className="block truncate font-display text-lg leading-tight">{lens.name}</span>
      </span>
      <span className="flex items-center gap-1 text-xs font-bold text-white/60">{open ? "Hide" : "Why this order?"}<ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></span>
    </button>
    {open && <div className="animate-rise mt-3 border-t border-white/10 pt-3"><LensSummary lens={lens} /></div>}
    {settling && <p className="mt-2 text-xs text-white/45">The order settles once every video has arrived.</p>}
  </section>;
}

function StartHere({ video, note, author, tone, resume, state, onPlay }: { video: Video; note?: string; author?: string; tone: string; resume: number; state: VideoState; onPlay: (video: Video) => void }) {
  return <section className="sticker-raised relative mt-8 p-3 sm:p-4">
    <span className="absolute -top-3.5 left-5 z-10 -rotate-3 rounded-xl border-2 border-black/70 bg-[var(--lime)] px-3 py-1 font-display text-sm text-[var(--ink)] shadow-[0_3px_0_#000a]">{resume ? "Pick up here" : "Start here"} ✨</span>
    <div className="sm:grid sm:grid-cols-[1.25fr_1fr] sm:items-center sm:gap-5">
      <button onClick={() => onPlay(video)} aria-label={`Play ${video.title}`} className="group block w-full rounded-xl">
        <Thumb video={video} className="w-full">
          <span className="absolute inset-0 grid place-items-center bg-black/10 transition group-hover:bg-black/25">
            <span className="juicy size-16 rounded-full transition-transform group-hover:scale-105 sm:size-[72px]" style={tint("var(--paper)")}><Play className="ml-1 size-7 fill-current" /></span>
          </span>
        </Thumb>
      </button>
      <div className="mt-3 min-w-0 sm:mt-0">
        <h2 className="font-display text-xl leading-tight sm:text-2xl">{video.title}</h2>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/60"><ChannelAvatar video={video} size={20} /><span className="truncate">{video.channel}</span></p>
        {note && <NoteBubble note={note} author={author} tone={tone} />}
        <button onClick={() => onPlay(video)} className="juicy mt-4 h-12 w-full px-5 text-base sm:w-auto" style={tint(tone)}>
          <Play className="size-4 fill-current" />{resume ? `Keep going from ${time(resume)}` : state === "snoozed" ? "Play (snoozed)" : "Play"}
        </button>
      </div>
    </div>
  </section>;
}

function StartHereSkeleton() {
  return <section aria-hidden className="sticker mt-8 p-3 sm:grid sm:grid-cols-[1.25fr_1fr] sm:items-center sm:gap-5 sm:p-4">
    <span className="block aspect-video rounded-xl bg-white/[0.06]" />
    <span className="mt-3 block space-y-2 sm:mt-0"><span className="block h-6 w-4/5 rounded-lg bg-white/[0.08]" /><span className="block h-4 w-1/2 rounded-lg bg-white/[0.06]" /><span className="mt-4 block h-12 w-full rounded-[14px] bg-white/[0.06] sm:w-32" /></span>
  </section>;
}

function AllDone({ tone, onRestart }: { tone: string; onRestart: () => void }) {
  return <section className="sticker-raised mt-8 flex items-center gap-4 p-4 sm:p-5">
    <Mascot mood="love" size={64} className="shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="font-display text-2xl leading-tight">You watched the whole feed 🎉</p>
      <p className="mt-1 text-sm text-white/60">Everything here is marked done. Tap any circle to undo one.</p>
    </div>
    <button onClick={onRestart} className="juicy h-11 shrink-0 px-4 max-sm:hidden" style={tint(tone)}><RotateCcw className="size-4" />From the top</button>
  </section>;
}

type Entry = { video: Video; reasons: Reason[] };

function FeedList({ feed, tone, order, aside, notes, progress, pending, playingId, popped, youtubeUrl, hint, onPlay, onToggleDone }: {
  feed: PublishedFeed; tone: string; order: Entry[]; aside: Array<{ video: Video; why: string }>; notes: Map<string, string>; progress: Progress; pending: number;
  playingId: string | null; popped: string | null; youtubeUrl?: string; hint: ReactNode; onPlay: (video: Video) => void; onToggleDone: (id: string, from: Element | null) => void;
}) {
  const [showAside, setShowAside] = useState(false);
  // Long feeds render in pages; the playing video is always inside the rendered part.
  const [limit, setLimit] = useState(60);
  const shown = Math.max(limit, order.findIndex((entry) => entry.video.id === playingId) + 10);
  const why = [...new Set(aside.map((entry) => entry.why === "Short" ? "shorts" : entry.why.toLowerCase()))].join(", ");
  const row = (entry: Entry, label: string) => {
    const saved = progress.videos[entry.video.id];
    return <Row key={entry.video.id} video={entry.video} label={label} reasons={entry.reasons} note={notes.get(entry.video.id)} author={feed.author} tone={tone}
      state={videoState(saved)} fraction={entry.video.durationSeconds && saved?.position ? saved.position / entry.video.durationSeconds : 0}
      playing={entry.video.id === playingId} popped={entry.video.id === popped} onPlay={onPlay} onToggleDone={onToggleDone} />;
  };
  return <section className="mt-8">
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <h2 className="font-display text-2xl">The list</h2>
      {youtubeUrl && <a href={youtubeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-white/45 hover:text-white">On YouTube <ExternalLink className="size-3.5" /></a>}
    </div>
    {hint}
    <ol className="space-y-1.5">
      {order.slice(0, shown).map((entry, index) => row(entry, String(index + 1)))}
      {order.length <= shown && Array.from({ length: Math.min(pending, 6) }, (_, index) => <SkeletonRow key={`pending-${index}`} />)}
    </ol>
    {order.length > shown && <button onClick={() => setLimit(shown + 100)} className="juicy-ghost mx-auto mt-3 flex h-10 px-4 text-sm font-bold" style={{ color: tone }}>Show {Math.min(100, order.length - shown)} more of {order.length - shown}</button>}
    {pending > 6 && <p className="mt-2 px-1 text-sm text-white/45">…and {pending - 6} more on the way.</p>}
    {aside.length > 0 && <div className="mt-6">
      <button onClick={() => setShowAside((value) => !value)} aria-expanded={showAside} className="juicy-ghost w-full justify-between rounded-2xl border-2 border-dashed border-white/15 px-4 py-3 text-left text-sm">
        <span><b className="text-white">{aside.length} set aside</b> by the lens: {why}</span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${showAside ? "rotate-180" : ""}`} />
      </button>
      {showAside && <ol className="animate-rise mt-2 space-y-1.5">{aside.map((entry) => row({ video: entry.video, reasons: [{ label: entry.why, tone: "bad" }] }, "·"))}</ol>}
    </div>}
  </section>;
}

/** One video in the list. The whole row plays it; the circle on the right marks it done. */
function Row({ video, label, reasons, note, author, tone, state, fraction, playing, popped, onPlay, onToggleDone }: {
  video: Video; label: string; reasons: Reason[]; note?: string; author?: string; tone: string; state: VideoState; fraction: number; playing: boolean; popped: boolean;
  onPlay: (video: Video) => void; onToggleDone: (id: string, from: Element | null) => void;
}) {
  const done = state === "done";
  const meta = [video.views !== undefined && `${formatCount(video.views)} views`, age(video.published)].filter(Boolean).join(" · ");
  return <li className={`relative rounded-[20px] p-2 transition-colors sm:p-2.5 ${playing ? "bg-white/[0.07] ring-2 ring-[color:var(--tone)]" : "hover:bg-white/[0.04]"}`} style={tint(tone)}>
    <div className="flex items-start gap-3">
      <Thumb video={video} className={`w-[7.5rem] shrink-0 sm:w-44 ${done ? "opacity-40 grayscale-[.5]" : ""}`}>
        <span className="absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-lg border-2 border-black/70 px-1 font-display text-xs text-[var(--ink)] shadow-[0_2px_0_#000a]" style={{ background: tone }}>{label}</span>
        {playing && <span className="absolute inset-0 grid place-items-center bg-black/45"><span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink)]">Playing</span></span>}
      </Thumb>
      <div className={`min-w-0 flex-1 ${done ? "opacity-50" : ""}`}>
        {/* The title's click area stretches over the row; the done circle sits above it. */}
        <button onClick={() => onPlay(video)} className="line-clamp-2 text-left font-display text-[15px] leading-snug after:absolute after:inset-0 after:rounded-[20px] sm:text-lg">{video.title}</button>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-white/55"><ChannelAvatar video={video} size={18} /><span className="truncate">{video.channel}</span></p>
        {meta && <p className="mt-0.5 text-xs text-white/40 sm:hidden">{meta}</p>}
        <StatChips video={video} className="mt-2 max-sm:hidden" />
        <ReasonChips reasons={reasons} className="mt-1.5" />
      </div>
      <button onClick={(event) => onToggleDone(video.id, event.currentTarget)} aria-pressed={done} aria-label={done ? `Mark ${video.title} not done` : `Mark ${video.title} done`} title={done ? "Done. Tap to undo." : "Mark done"}
        className="juicy-ghost relative z-10 -mr-1 size-11 shrink-0">
        <span key={state} className={`grid place-items-center ${popped && done ? "animate-pop" : ""}`}><StatusGlyph state={state} fraction={fraction} size={24} /></span>
      </button>
    </div>
    {note && <NoteBubble note={note} author={author} tone={tone} />}
  </li>;
}

function SkeletonRow() {
  return <li aria-hidden className="flex items-start gap-3 rounded-[20px] p-2 sm:p-2.5">
    <span className="block aspect-video w-[7.5rem] shrink-0 rounded-xl bg-white/[0.06] sm:w-44" />
    <span className="min-w-0 flex-1 space-y-2 pt-1"><span className="block h-4 w-11/12 rounded-md bg-white/[0.08]" /><span className="block h-4 w-2/3 rounded-md bg-white/[0.08]" /><span className="block h-3 w-1/3 rounded-md bg-white/[0.05]" /></span>
    <span className="mr-1 mt-2.5 block size-6 shrink-0 rounded-full border-2 border-white/10" />
  </li>;
}

/** What the organizer wrote about a video, as a speech bubble from them. */
function NoteBubble({ note, author, tone }: { note: string; author?: string; tone: string }) {
  return <div className="mt-2.5 flex items-start gap-2">
    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-black/70 font-display text-xs text-[var(--ink)]" style={{ background: tone }}>{author ? author.slice(0, 1).toUpperCase() : "✎"}</span>
    <p className="min-w-0 rounded-2xl rounded-tl-[6px] bg-[var(--paper)] px-3 py-2 text-sm leading-snug text-[var(--ink)] shadow-[0_3px_0_#000a]">
      <span className="sr-only">{author ?? "The organizer"} says: </span>{note}
    </p>
  </div>;
}

function NowPlaying({ video, tone, number, total, note, author, state, moments, chapterNow, looking, ended, next, allDone, onClose, onSeek, onPlay, onToggleDone, onToggleSnooze, onToggleChapter, onLabel, onRemove }: {
  video: Video; tone: string; number: number; total: number; note?: string; author?: string; state: VideoState; moments: Moment[]; chapterNow?: number; looking: boolean;
  ended: boolean; next?: Video; allDone: boolean; onClose: () => void; onSeek: (seconds: number) => void; onPlay: (video: Video) => void;
  onToggleDone: (from: Element | null) => void; onToggleSnooze: () => void; onToggleChapter: (start: number) => void; onLabel: (id: string, label: string) => void; onRemove: (id: string) => void;
}) {
  const done = state === "done";
  return <section className="px-4 pt-5 lg:px-1">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-[.14em]" style={{ color: tone }}>Now playing · {number} of {total}</p>
        <h2 className="mt-1 font-display text-2xl leading-tight sm:text-3xl">{video.title}</h2>
      </div>
      <button onClick={onClose} aria-label="Close the player" title="Close the player" className="juicy-ghost size-10 shrink-0 max-lg:hidden"><X className="size-5" /></button>
    </div>
    <p className="mt-2 flex items-center gap-2 text-sm text-white/60"><ChannelAvatar video={video} size={24} /><span className="truncate">{video.channel}</span></p>
    <StatChips video={video} className="mt-3" />
    {note && <NoteBubble note={note} author={author} tone={tone} />}

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button onClick={(event) => onToggleDone(event.currentTarget)} aria-pressed={done} className="juicy h-10 px-4 text-sm" style={tint(done ? "var(--lime)" : "var(--paper)")}>
        <Check className="size-4" strokeWidth={3} />{done ? "Done" : "Mark done"}
      </button>
      <button onClick={onToggleSnooze} aria-pressed={state === "snoozed"} className={`juicy-ghost h-10 px-3 text-sm ${state === "snoozed" ? "text-[var(--sky)]" : ""}`}><Moon className="size-4" />{state === "snoozed" ? "Snoozed" : "Snooze"}</button>
      <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="juicy-ghost h-10 px-3 text-sm">YouTube <ExternalLink className="size-3.5" /></a>
    </div>

    {ended && <div className="sticker-raised animate-pop mt-5 p-4">
      <div className="flex items-center gap-3">
        <Mascot mood={next ? "happy" : "love"} size={52} className="shrink-0" />
        <div className="min-w-0">
          <p className="font-display text-xl leading-tight">{next ? "Nice! That one's done." : allDone ? "That's the whole feed! 🎉" : "That was the last one."}</p>
          <p className="text-sm text-white/55">{next ? "Up next, whenever you're ready:" : "Every video you finish stays checked off on this device."}</p>
        </div>
      </div>
      {next && <button onClick={() => onPlay(next)} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white/[0.05] p-2 text-left transition hover:bg-white/[0.09]">
        <Thumb video={next} className="w-28 shrink-0" />
        <span className="min-w-0 flex-1"><span className="line-clamp-2 font-display leading-snug">{next.title}</span><span className="mt-0.5 block truncate text-xs text-white/50">{next.channel}</span></span>
        <span className="juicy size-11 shrink-0 rounded-full" style={tint(tone)}><Play className="ml-0.5 size-5 fill-current" /></span>
      </button>}
    </div>}

    <h3 className="mt-7 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-white/45">Chapters and bookmarks</h3>
    {moments.length ? <ul className="sticker mt-2 divide-y divide-white/[0.06] overflow-hidden">{moments.map((moment) => {
      const current = moment.kind === "chapter" && moment.start === chapterNow;
      return <li key={moment.kind === "bookmark" ? moment.id : `c${moment.start}`} className={`flex items-center gap-2 px-2.5 ${current ? "bg-white/[0.07]" : ""}`}>
        <button onClick={() => onSeek(moment.start)} className={`w-14 shrink-0 py-3 text-left text-sm font-bold tabular-nums hover:underline ${moment.kind === "bookmark" ? "text-[var(--sun)]" : "text-[var(--lime)]"}`}>{time(moment.start)}</button>
        {moment.kind === "chapter" ? <>
          <button onClick={() => onSeek(moment.start)} className={`min-w-0 flex-1 truncate py-3 text-left text-sm ${moment.done ? "text-white/45 line-through decoration-white/30" : current ? "font-semibold" : ""}`}>{moment.title}</button>
          <button onClick={() => onToggleChapter(moment.start)} aria-pressed={moment.done} aria-label={moment.done ? `Mark ${moment.title} not done` : `Mark ${moment.title} done`} className={`juicy-ghost size-9 shrink-0 ${moment.done ? "text-[var(--lime)]" : "text-white/25"}`}><Check className="size-4" strokeWidth={3} /></button>
        </> : <>
          <Bookmark className="size-3.5 shrink-0 fill-[var(--sun)] text-[var(--sun)]" />
          <input value={moment.title} onChange={(event) => onLabel(moment.id, event.target.value)} aria-label={`Note for bookmark at ${time(moment.start)}`} placeholder="Add a note" className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30" />
          <button onClick={() => onRemove(moment.id)} aria-label="Delete bookmark" className="juicy-ghost size-9 shrink-0 text-white/30 hover:!bg-[var(--tomato)]/15 hover:!text-[var(--tomato)]"><X className="size-4" /></button>
        </>}
      </li>;
    })}</ul> : <p className="mt-2 text-sm text-white/45">{looking ? "Looking for chapters…" : "No chapters in this one. Tap Bookmark (or press B) to save a moment."}</p>}
  </section>;
}

function Footer() {
  return <footer className="mx-auto mt-14 max-w-3xl px-3 pb-16 sm:px-4">
    <Link href="/" className="juicy w-full justify-start gap-3 rounded-[22px] p-4 text-left sm:p-5" style={tint("var(--lime)")}>
      <Logo size={40} mood="wink" />
      <span className="min-w-0 flex-1">
        <span className="block text-xl leading-tight">Make your own feed →</span>
        <span className="block font-sans text-sm font-medium text-black/65">Line up YouTube videos in the order that helps, then share the link.</span>
      </span>
    </Link>
    <p className="mt-4 text-center text-xs text-white/40">No account needed to watch. What you finish stays in this browser.</p>
    <p className="mt-2 text-center text-xs text-white/40"><Link href="/privacy" className="underline underline-offset-2">Privacy</Link> · <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <a href="https://www.youtube.com/t/terms" className="underline underline-offset-2">YouTube terms</a></p>
  </footer>;
}

function FeedLoading() {
  return <main aria-busy className="min-h-screen bg-[var(--ink)] text-[var(--paper)]">
    <div className="mx-auto max-w-3xl">
      <header className="border-b-2 border-black/70 bg-[var(--ink-3)] px-5 pb-6 pt-4 sm:mx-4 sm:mt-4 sm:rounded-[32px] sm:border-2 sm:px-8 sm:pb-8">
        <Link href="/" aria-label="Jev home"><Logo size={26} /></Link>
        <div className="mt-6 flex items-end justify-between gap-3">
          <span className="block size-16 rounded-2xl bg-white/[0.07] sm:size-20" />
          <div className="flex items-end gap-1.5">
            <span className="mb-10 rounded-2xl rounded-br-[6px] border-2 border-black/70 bg-[var(--paper)] px-2.5 py-1 text-xs font-bold text-[var(--ink)] shadow-[0_3px_0_#000a]">Fetching the feed…</span>
            <Mascot mood="think" size={76} />
          </div>
        </div>
        <span className="mt-4 block h-12 w-3/4 rounded-xl bg-white/[0.08] sm:h-16" />
        <span className="mt-3 block h-4 w-1/2 rounded-md bg-white/[0.06]" />
        <span className="mt-6 block h-4 w-full rounded-full bg-white/[0.06]" />
      </header>
      <div className="px-3 sm:px-4">
        <StartHereSkeleton />
        <section className="mt-8"><span className="mb-3 block h-8 w-28 rounded-lg bg-white/[0.06]" />
          <ol className="space-y-1.5">{Array.from({ length: 5 }, (_, index) => <SkeletonRow key={index} />)}</ol>
        </section>
      </div>
    </div>
  </main>;
}

function FeedProblem({ message }: { message: string }) {
  useEffect(() => { document.title = "Feed not found · Jev"; }, []);
  return <main className="dotted grid min-h-screen place-items-center bg-[var(--ink)] px-5 py-16 text-[var(--paper)]">
    <div className="sticker-raised w-full max-w-md p-6 text-center sm:p-8">
      <Mascot mood="sad" size={112} className="mx-auto" />
      <h1 className="mt-4 font-display text-3xl leading-tight sm:text-4xl">This feed wandered off</h1>
      <p className="mt-3 text-white/60">{message}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button onClick={() => window.location.reload()} className="juicy-ghost h-11 px-4 text-sm font-semibold">Try again</button>
        <Link href="/" className="juicy h-11 px-5 text-sm" style={tint("var(--lime)")}>Go to Jev</Link>
      </div>
    </div>
  </main>;
}
