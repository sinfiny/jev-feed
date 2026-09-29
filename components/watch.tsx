"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Bookmark, Check, ChevronRight, ExternalLink, Moon, Plus, Sparkles, ThumbsUp, X } from "lucide-react";
import { Mascot, StatusGlyph } from "@/components/brand";
import { PlayerDeck } from "@/components/player-deck";
import { ChannelAvatar, StatChips, Thumb } from "@/components/video-bits";
import type { Clip, PlayerHandle } from "@/components/youtube-player";
import { formatDuration, type Video } from "@/lib/learning";
import { labelBookmark, removeBookmark, toggleChapterDone, videoState, type LibraryPlaylist, type Moment, type Progress } from "@/lib/library";
import type { FeedDraft } from "@/lib/feed";

type Props = {
  player: RefObject<PlayerHandle | null>;
  playlist: LibraryPlaylist;
  video: Video;
  clip: Clip;
  chapter?: { start: number; title: string };
  chapterNow?: number;
  moments: Moment[];
  progress: Progress;
  setProgress: (change: (current: Progress) => Progress) => void;
  upNext: Video[];
  liked?: boolean;
  onLike: () => void;
  onOpen: (videoId: string, moment?: Moment) => void;
  onJump: (seconds: number) => void;
  onTick: (seconds: number) => void;
  onEnded: () => void;
  onBookmark: () => void;
  onToggle: (status: "done" | "snoozed", from?: Element | null) => void;
  drafts: FeedDraft[];
  onAddToFeed: (draftId: string | null) => void;
  deckHint?: ReactNode;
};

/** The watching column: the player device, what this video is, what you've marked inside it, and what comes next. */
export function Watch(props: Props) {
  const { player, playlist, video, clip, chapter, chapterNow, moments, progress, setProgress, upNext, liked } = props;
  const state = videoState(progress.videos[video.id]);
  const doneButton = useRef<HTMLButtonElement>(null);
  const [feedMenu, setFeedMenu] = useState(false);
  const current = upNext.length ? upNext : [];

  return <div className="mx-auto w-full max-w-5xl pb-28 lg:px-6 lg:pb-12 lg:pt-5">
    <nav aria-label="Where this video is" className="hidden items-center gap-1.5 pb-3 text-sm text-white/45 lg:flex">
      <span className="truncate">{playlist.title}</span><ChevronRight className="size-3.5 shrink-0" />
      <span className={`truncate ${chapter ? "" : "text-white"}`}>{video.title}</span>
      {chapter && <><ChevronRight className="size-3.5 shrink-0" /><span className="truncate font-semibold text-[var(--lime)]">{chapter.title}</span></>}
    </nav>

    <div className="max-lg:sticky max-lg:top-0 max-lg:z-30">
      <PlayerDeck player={player} clip={clip} video={video} moments={moments} rate={progress.rate} onRate={(rate) => setProgress((current) => ({ ...current, rate }))}
        onEnded={props.onEnded} onTick={props.onTick} onSeek={props.onJump} onBookmark={props.onBookmark}
        onNext={upNext[0] ? () => props.onOpen(upNext[0].id) : undefined} hint={props.deckHint} />
    </div>

    <section className="px-4 pt-5 lg:px-1">
      {chapter && <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--lime)]/15 px-3 py-1 text-xs font-bold text-[var(--lime)]">Playing one chapter: {chapter.title}
        <button onClick={() => props.onJump(player.current?.time() ?? chapter.start)} className="underline decoration-dotted underline-offset-2 hover:text-white">keep watching</button></p>}
      <h1 className="font-display text-2xl leading-[1.08] sm:text-3xl">{video.title}</h1>
      <div className="mt-3 flex items-center gap-2.5">
        <ChannelAvatar video={video} size={34} />
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{video.channel}</p>{video.subscribers !== undefined && <p className="text-xs text-white/45">{Intl.NumberFormat("en", { notation: "compact" }).format(video.subscribers)} subscribers</p>}</div>
      </div>
      <StatChips video={video} className="mt-3" />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button ref={doneButton} onClick={() => props.onToggle("done", doneButton.current)} aria-pressed={state === "done"} className="juicy h-10 px-4 text-sm" style={{ "--tone": state === "done" ? "var(--lime)" : "var(--paper)" } as React.CSSProperties}>
          <Check className="size-4" strokeWidth={3} /> {state === "done" ? "Done!" : "Mark done"}
        </button>
        <button onClick={() => props.onToggle("snoozed")} aria-pressed={state === "snoozed"} className={`juicy-ghost h-10 px-3 text-sm font-semibold ${state === "snoozed" ? "!bg-[var(--sky)]/20 !text-[var(--sky)]" : ""}`}>
          <Moon className="size-4" /> {state === "snoozed" ? "Snoozed" : "Snooze"}
        </button>
        <button onClick={props.onLike} disabled={liked === undefined} aria-pressed={!!liked} title={liked ? "Take back your like on YouTube" : "Like on YouTube"} className={`juicy-ghost h-10 px-3 text-sm font-semibold disabled:opacity-40 ${liked ? "!bg-[var(--pink)]/20 !text-[var(--pink)]" : ""}`}>
          <ThumbsUp className={`size-4 ${liked ? "fill-current" : ""}`} /> {liked ? "Liked" : "Like"}
        </button>
        <div className="relative">
          <button onClick={() => setFeedMenu((open) => !open)} aria-expanded={feedMenu} className="juicy-ghost h-10 px-3 text-sm font-semibold text-[var(--pink)]"><Plus className="size-4" /> Add to a feed</button>
          {feedMenu && <div className="animate-pop absolute left-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border-2 border-black/70 bg-[var(--ink-3)] p-1.5 shadow-[0_6px_0_#000c]">
            {props.drafts.map((draft) => {
              const inside = draft.items.some((item) => item.video.id === video.id && !item.hidden);
              return <button key={draft.id} disabled={inside} onClick={() => { props.onAddToFeed(draft.id); setFeedMenu(false); }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-50">
                <span className="grid size-7 place-items-center rounded-lg" style={{ background: `var(--${draft.color})` }}>{draft.emoji}</span>
                <span className="min-w-0 flex-1 truncate">{draft.title || "Untitled feed"}</span>{inside && <Check className="size-4 text-[var(--lime)]" />}
              </button>;
            })}
            <button onClick={() => { props.onAddToFeed(null); setFeedMenu(false); }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-[var(--pink)] hover:bg-white/10"><Sparkles className="size-4" /> Start a new feed with this</button>
          </div>}
        </div>
        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="juicy-ghost ml-auto h-10 px-3 text-sm text-white/50"><ExternalLink className="size-4" /><span className="max-sm:hidden">YouTube</span></a>
      </div>

      <h2 className="mt-8 flex items-center gap-2 font-display text-lg">Places to start <span className="rounded-full bg-white/10 px-2 py-0.5 font-sans text-xs font-bold text-white/60">{moments.length}</span></h2>
      {moments.length ? <ul className="mt-2 space-y-1.5">{moments.map((moment) => {
        const playing = moment.kind === "chapter" && moment.start === chapterNow;
        const key = moment.kind === "bookmark" ? moment.id : `c${moment.start}`;
        return <li key={key} className={`group flex items-center gap-2 rounded-2xl border-2 px-2 transition ${playing ? "border-[var(--lime)]/60 bg-[var(--lime)]/[0.07]" : "border-transparent bg-white/[0.04] hover:bg-white/[0.07]"}`}>
          <button onClick={() => props.onOpen(video.id, moment)} title={moment.kind === "chapter" ? "Play just this chapter" : "Play from here"} className={`my-1.5 w-16 shrink-0 rounded-lg py-1.5 text-center font-display text-sm tabular-nums ${moment.kind === "bookmark" ? "bg-[var(--sun)] text-[var(--ink)]" : "bg-white/10 text-[var(--lime)] group-hover:bg-[var(--lime)] group-hover:text-[var(--ink)]"}`}>{formatDuration(moment.start) || "0:00"}</button>
          {moment.kind === "chapter"
            ? <><button onClick={() => props.onOpen(video.id, moment)} className={`min-w-0 flex-1 truncate py-2.5 text-left text-sm ${moment.done ? "text-white/40 line-through decoration-white/30" : ""}`}>{moment.title}</button>
              <button onClick={() => setProgress((current) => toggleChapterDone(current, video.id, moment.start))} aria-pressed={moment.done} aria-label={moment.done ? `Mark ${moment.title} not done` : `Mark ${moment.title} done`} className={`grid size-8 shrink-0 place-items-center rounded-full transition ${moment.done ? "bg-[var(--lime)] text-[var(--ink)]" : "text-white/25 hover:bg-white/10 hover:text-white"}`}><Check className="size-4" strokeWidth={3} /></button></>
            : <><Bookmark className="size-4 shrink-0 fill-[var(--sun)] text-[var(--sun)]" />
              <input value={moment.title} onChange={(event) => setProgress((current) => labelBookmark(current, video.id, moment.id, event.target.value))} aria-label={`Note for bookmark at ${formatDuration(moment.start) || "0:00"}`} placeholder="What happens here? (optional)" className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30" />
              <button onClick={() => setProgress((current) => removeBookmark(current, video.id, moment.id))} aria-label="Delete bookmark" className="grid size-8 shrink-0 place-items-center rounded-full text-white/30 hover:bg-[var(--tomato)]/20 hover:text-[var(--tomato)]"><X className="size-4" /></button></>}
        </li>;
      })}</ul> : <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-white/10 p-4 text-sm text-white/50">
        <Mascot size={40} mood={video.complete || video.description ? "wink" : "think"} />
        <p>{video.complete || video.description ? <>No chapters in this one. Press <span className="kbd bg-white/10">B</span> while it plays to drop your own.</> : "Looking for chapters…"}</p>
      </div>}

      {!!current.length && <>
        <h2 className="mt-8 font-display text-lg">Up next <span className="font-sans text-sm font-normal text-white/40">in {playlist.title}</span></h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">{current.slice(0, 4).map((next, index) => <li key={next.id}>
          <button onClick={() => props.onOpen(next.id)} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] p-2 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.08]">
            <Thumb video={next} className="w-28 shrink-0" />
            <span className="min-w-0"><span className="text-[11px] font-bold uppercase tracking-wide text-[var(--lime)]">{index === 0 ? "Next" : `Then`}</span>
              <span className="line-clamp-2 text-sm font-semibold leading-snug">{next.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-white/40"><StatusGlyph state={videoState(progress.videos[next.id])} size={12} />{next.channel}</span></span>
          </button>
        </li>)}</ul>
      </>}
    </section>
  </div>;
}

