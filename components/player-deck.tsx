"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Bookmark, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { formatDuration, type Video } from "@/lib/learning";
import { SPEEDS, type Moment } from "@/lib/library";
import { isTyping } from "@/lib/utils";
import { YouTubePlayer, type Clip, type PlaybackState, type PlayerHandle } from "@/components/youtube-player";

type Props = {
  player: RefObject<PlayerHandle | null>;
  clip: Clip;
  video: Video;
  moments: Moment[];
  rate: number;
  onRate: (rate: number) => void;
  onEnded: () => void;
  /** Called about four times a second while playing, with the current time. */
  onTick: (seconds: number) => void;
  /** Jumps inside the video. The page decides whether that leaves a chapter clip. */
  onSeek: (seconds: number) => void;
  onBookmark?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** A hint bubble shown under the controls. */
  hint?: ReactNode;
};

const time = (seconds: number) => formatDuration(Math.max(0, Math.floor(seconds))) || "0:00";

/**
 * The player as one device: YouTube's frame on top, Jev's deck underneath. The scrubber is split into the
 * video's chapters and carries a pin for each bookmark, so the shape of a video is visible before it plays.
 * Fullscreen takes the deck along; where a page cannot go fullscreen (iPhone), it fills the window instead.
 */
export function PlayerDeck({ player, clip, video, moments, rate, onRate, onEnded, onTick, onSeek, onBookmark, onPrev, onNext, hint }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlaybackState>("idle");
  const [now, setNow] = useState(clip.start);
  const [length, setLength] = useState(video.durationSeconds ?? 0);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState<"off" | "native" | "window">("off");
  const tick = useRef(onTick);
  useEffect(() => { tick.current = onTick; });

  // A new clip starts where it says; the deck shows that before the frame reports back.
  const [shownClip, setShownClip] = useState(clip.nonce);
  if (shownClip !== clip.nonce) { setShownClip(clip.nonce); setNow(clip.start); setLength(video.durationSeconds ?? 0); }

  useEffect(() => {
    if (state !== "playing") return;
    const timer = setInterval(() => {
      const seconds = player.current?.time() ?? 0;
      if (!seconds) return;
      setNow(seconds);
      tick.current(seconds);
      const total = player.current?.duration() ?? 0;
      if (total && Math.abs(total - length) > 1) setLength(total);
    }, 250);
    return () => clearInterval(timer);
  }, [state, player, length]);

  const seek = useCallback((seconds: number) => { const target = Math.max(0, Math.min(length || seconds, seconds)); setNow(target); onSeek(target); }, [length, onSeek]);

  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === wrap.current ? "native" : (current) => current === "native" ? "off" : current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  async function toggleFull() {
    if (full === "native") { await document.exitFullscreen().catch(() => undefined); return; }
    if (full === "window") { setFull("off"); return; }
    try { await wrap.current!.requestFullscreen(); } catch { setFull("window"); }
  }
  // F toggles fullscreen wherever the deck is, unless a text field has the key.
  const toggleRef = useRef(toggleFull);
  useEffect(() => { toggleRef.current = toggleFull; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) { event.preventDefault(); void toggleRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (full !== "window") return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFull("off"); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [full]);

  const playing = state === "playing" || state === "buffering";
  const cycleRate = () => onRate(SPEEDS[(SPEEDS.indexOf(rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]);
  const chapter = moments.findLast((moment) => moment.kind === "chapter" && moment.start <= now);

  return <div ref={wrap} className={full === "off" ? "overflow-hidden bg-[var(--ink-2)] sm:rounded-[26px] sm:border-2 sm:border-black/70 sm:shadow-[0_6px_0_#000c]" : "fixed inset-0 z-[70] flex flex-col bg-black"}>
    <div className={full === "off" ? "relative aspect-video bg-black" : "relative min-h-0 flex-1"}>
      <YouTubePlayer ref={player} clip={clip} rate={rate} onEnded={onEnded} onState={setState} />
      {state === "buffering" && <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white/80">Loading…</span>}
    </div>

    <div className="px-3 pb-3 pt-2 sm:px-4">
      <Scrubber now={now} length={length} moments={moments} onSeek={seek} />
      <div className="mt-1.5 flex items-center gap-1 sm:gap-1.5">
        {onPrev && <button onClick={onPrev} aria-label="Previous video" title="Previous video (P)" className="juicy-ghost size-9 max-sm:hidden"><SkipBack className="size-4" /></button>}
        <button onClick={() => player.current?.togglePlay()} aria-label={playing ? "Pause" : "Play"} title={`${playing ? "Pause" : "Play"} (K or space)`} className="juicy size-11 shrink-0 rounded-full" style={{ "--tone": "var(--paper)" } as React.CSSProperties}>
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </button>
        {onNext && <button onClick={onNext} aria-label="Next video" title="Next video (N)" className="juicy-ghost size-9"><SkipForward className="size-4" /></button>}
        <button onClick={() => seek(now - 10)} aria-label="Back 10 seconds" title="Back 10s (J)" className="juicy-ghost size-9"><RotateCcw className="size-4" /></button>
        <button onClick={() => seek(now + 10)} aria-label="Forward 10 seconds" title="Forward 10s (L)" className="juicy-ghost size-9"><RotateCw className="size-4" /></button>
        <span className="ml-1 shrink-0 whitespace-nowrap text-xs tabular-nums text-white/60 sm:text-sm"><span className="text-white">{time(now)}</span> / {time(length)}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-white/45 max-md:hidden">{chapter ? `· ${chapter.title}` : ""}</span>
        <span className="flex-1 md:hidden" />
        <div role="group" aria-label="Playback speed" className="hidden rounded-xl bg-white/[0.06] p-0.5 lg:flex">
          {SPEEDS.map((speed) => <button key={speed} onClick={() => onRate(speed)} aria-pressed={rate === speed} className={`h-8 min-w-10 rounded-[10px] px-1.5 text-xs font-bold tabular-nums transition ${rate === speed ? "bg-[var(--paper)] text-[var(--ink)]" : "text-white/55 hover:text-white"}`}>{speed}×</button>)}
        </div>
        <button onClick={cycleRate} title="Speed (< and >)" className="juicy-ghost h-9 min-w-12 px-2 text-sm font-bold tabular-nums lg:hidden">{rate}×</button>
        <div className="group hidden items-center md:flex">
          <button onClick={() => { const next = !muted; setMuted(next); player.current?.setMuted(next); }} aria-label={muted ? "Unmute" : "Mute"} title="Mute (M)" className="juicy-ghost size-9">{muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
          <input type="range" min={0} max={100} value={muted ? 0 : volume} aria-label="Volume" onChange={(event) => { const value = Number(event.target.value); setVolume(value); setMuted(value === 0); player.current?.setVolume(value); }}
            className="dial w-0 opacity-0 transition-all duration-200 group-focus-within:w-20 group-focus-within:opacity-100 group-hover:w-20 group-hover:opacity-100" style={{ "--track": `linear-gradient(90deg, var(--paper) ${muted ? 0 : volume}%, #ffffff1a ${muted ? 0 : volume}%)` } as React.CSSProperties} />
        </div>
        {onBookmark && <button onClick={onBookmark} title="Bookmark this moment (B)" className="juicy h-9 px-2.5 text-sm sm:px-3" style={{ "--tone": "var(--sun)" } as React.CSSProperties}>
          <Bookmark className="size-4" /><span className="max-sm:hidden">Bookmark</span><span className="kbd max-sm:hidden">B</span>
        </button>}
        <button onClick={toggleFull} aria-label={full === "off" ? "Fullscreen" : "Exit fullscreen"} title="Fullscreen (F)" className="juicy-ghost size-9">{full === "off" ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}</button>
      </div>
      {hint && full === "off" && <div className="mt-2.5">{hint}</div>}
    </div>
  </div>;
}

/**
 * The seek bar. Each chapter is its own segment, bookmarks are pins above it, and hovering shows the
 * time and chapter under the pointer. Dragging previews and seeks on release; arrow keys step five seconds.
 */
function Scrubber({ now, length, moments, onSeek }: { now: number; length: number; moments: Moment[]; onSeek: (seconds: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const total = Math.max(length, 1);
  const shown = drag ?? now;
  const chapters = moments.filter((moment) => moment.kind === "chapter");
  const segments = chapters.length ? chapters.map((chapter, index) => ({ start: chapter.start, end: chapters[index + 1]?.start ?? total, title: chapter.title })) : [{ start: 0, end: total, title: "" }];
  const bookmarks = moments.filter((moment) => moment.kind === "bookmark");
  const at = (clientX: number) => { const box = track.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * total; };
  const hovered = hover === null ? null : segments.findLast((segment) => segment.start <= hover);

  return <div className="relative pt-3">
    {bookmarks.map((mark) => <button key={mark.kind === "bookmark" ? mark.id : mark.start} onClick={() => onSeek(mark.start)} title={`${time(mark.start)}${mark.title ? ` · ${mark.title}` : ""}`} aria-label={`Bookmark at ${time(mark.start)}`}
      className="absolute top-0 z-10 size-3 -translate-x-1/2 rounded-full border-2 border-[var(--ink)] bg-[var(--sun)] transition hover:scale-125" style={{ left: `${(mark.start / total) * 100}%` }} />)}
    <div ref={track} role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(shown)} aria-valuetext={time(shown)}
      onKeyDown={(event) => {
        const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[event.key];
        if (step) { event.preventDefault(); event.stopPropagation(); onSeek(now + step); }
        if (event.key === "Home") onSeek(0);
      }}
      onPointerMove={(event) => { const seconds = at(event.clientX); setHover(seconds); if (drag !== null) setDrag(seconds); }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDrag(at(event.clientX)); }}
      onPointerUp={(event) => { if (drag !== null) onSeek(at(event.clientX)); setDrag(null); }}
      className="group flex h-5 cursor-pointer touch-none items-center gap-[3px]">
      {segments.map((segment) => {
        const width = ((segment.end - segment.start) / total) * 100;
        const filled = Math.max(0, Math.min(1, (shown - segment.start) / Math.max(1, segment.end - segment.start)));
        return <span key={segment.start} className="relative h-2 overflow-hidden rounded-full bg-white/15 transition-[height] group-hover:h-3" style={{ width: `${width}%` }}>
          <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--lime)]" style={{ width: `${filled * 100}%` }} />
        </span>;
      })}
    </div>
    <span className="pointer-events-none absolute top-[18px] size-4 -translate-x-1/2 rounded-full border-[3px] border-[var(--ink)] bg-[var(--lime)] shadow-[0_2px_0_#000a]" style={{ left: `${(shown / total) * 100}%` }} />
    {hover !== null && <span className="pointer-events-none absolute -top-7 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--paper)] px-2 py-1 text-[11px] font-bold text-[var(--ink)] shadow-[0_3px_0_#000a]" style={{ left: `${Math.max(4, Math.min(96, (hover / total) * 100))}%` }}>
      {time(hover)}{hovered?.title ? ` · ${hovered.title.slice(0, 40)}` : ""}
    </span>}
  </div>;
}
