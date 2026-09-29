"use client";

import { useState } from "react";
import { ArrowLeft, Bookmark, Check, ChevronRight, Heart, ListVideo, Moon, Play } from "lucide-react";
import { StatusGlyph } from "@/components/brand";
import { Thumb } from "@/components/video-bits";
import { formatDuration, type Video } from "@/lib/learning";
import { rank, type Judgments, type Lens } from "@/lib/lens";
import { momentsFor, queueOrder, type LibraryPlaylist, type Moment, type Progress, type VideoState } from "@/lib/library";
import { LIKED_PLAYLIST_ID } from "@/lib/youtube-account";

export type Selection = { playlistId: string; videoId: string; chapterStart?: number };

const TONES = ["lime", "sky", "sun", "grape", "tomato", "pink"];
export const playlistTone = (playlist: LibraryPlaylist, index: number) => playlist.sourcePlaylistId === LIKED_PLAYLIST_ID ? "pink" : TONES[index % TONES.length];

/** A playlist in watching order: its own order or its lens's, with snoozed videos sunk below the rest and done ones at the bottom. */
export function orderPlaylist(playlist: LibraryPlaylist, progress: Progress, lens: Lens | undefined, judgments: Judgments) {
  if (!lens) return queueOrder(playlist.videos, progress);
  const { ranked, aside } = rank(playlist.videos, lens, judgments);
  return queueOrder([...ranked.map((item) => item.video), ...aside.map((item) => item.video)], progress);
}

const fractionOf = (video: Video, progress: Progress) => (progress.videos[video.id]?.position ?? 0) / Math.max(1, video.durationSeconds ?? 600);

type Common = {
  playlists: LibraryPlaylist[];
  progress: Progress;
  lenses: Lens[];
  judgments: Judgments;
  selection: Selection | null;
  onOpen: (playlistId: string, videoId: string, moment?: Moment) => void;
  onToggleStatus: (videoId: string, status: "done" | "snoozed") => void;
  onLens: (playlistId: string, lensId: string | undefined) => void;
};

function LensPicker({ playlist, lenses, onLens }: { playlist: LibraryPlaylist; lenses: Lens[]; onLens: Common["onLens"] }) {
  const [open, setOpen] = useState(false);
  const current = lenses.find((lens) => lens.id === playlist.lensId);
  return <span className="relative">
    <button onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} title="Choose how this playlist is ordered" aria-expanded={open}
      className={`flex h-7 items-center gap-1 rounded-full px-2 text-xs font-bold transition ${current ? "bg-[var(--grape)]/25 text-[#cbbaff]" : "text-white/35 hover:bg-white/10 hover:text-white"}`}>
      {current ? <><span>{current.emoji}</span><span className="max-w-20 truncate">{current.name}</span></> : <><ListVideo className="size-3.5" /> Order</>}
    </button>
    {open && <div className="animate-pop absolute right-0 top-8 z-50 w-56 rounded-2xl border-2 border-black/70 bg-[var(--ink-3)] p-1.5 shadow-[0_6px_0_#000c]" onMouseLeave={() => setOpen(false)}>
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Order this playlist by</p>
      {[{ id: undefined, name: "Playlist order", emoji: "📜" }, ...lenses].map((lens) => <button key={lens.id ?? "none"} onClick={() => { onLens(playlist.id, lens.id); setOpen(false); }}
        className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm hover:bg-white/10 ${lens.id === playlist.lensId ? "font-bold text-[var(--lime)]" : ""}`}>
        <span className="w-5 text-center">{lens.emoji}</span><span className="truncate">{lens.name}</span>{lens.id === playlist.lensId && <Check className="ml-auto size-4" />}
      </button>)}
    </div>}
  </span>;
}

/** Playlists, the videos in each, and the chapters and bookmarks inside each video, as one tree of places to start. */
export function LibraryTree({ playlists, progress, lenses, judgments, selection, onOpen, onToggleStatus, onLens }: Common) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [openVideos, setOpenVideos] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  const flip = (set: Set<string>, id: string) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };

  const videoRow = (playlist: LibraryPlaylist, video: Video, state: VideoState) => {
    const active = selection?.playlistId === playlist.id && selection.videoId === video.id;
    const moments = momentsFor(video, progress.videos[video.id]);
    const key = `${playlist.id}:${video.id}`;
    const open = openVideos.has(key) || (active && moments.length > 0);
    const marks = progress.videos[video.id]?.bookmarks?.length ?? 0;
    return <li key={video.id}>
      <div className={`group flex items-start gap-0.5 rounded-xl transition ${active && selection?.chapterStart === undefined ? "bg-white/[0.1] shadow-[inset_3px_0_0_var(--lime)]" : "hover:bg-white/[0.05]"} ${state === "done" || state === "snoozed" ? "opacity-50" : ""}`}>
        <button onClick={() => moments.length && setOpenVideos((set) => flip(set, key))} aria-label={open ? "Hide chapters" : "Show chapters"} aria-expanded={open} disabled={!moments.length} className="grid h-10 w-5 shrink-0 place-items-center text-white/35 disabled:invisible">
          <ChevronRight className={`size-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
        <button onClick={() => onOpen(playlist.id, video.id)} className="flex min-w-0 flex-1 items-start gap-2 py-2 pr-1 text-left">
          <span className="mt-0.5 shrink-0"><StatusGlyph state={state} fraction={fractionOf(video, progress)} size={15} /></span>
          <span className="min-w-0">
            <span className="line-clamp-2 text-[13px] leading-snug">{video.title}</span>
            <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-white/40">
              {[formatDuration(video.durationSeconds), video.chapters?.length ? `${video.chapters.length} chapters` : "", video.channel].filter(Boolean).join(" · ")}
              {!!marks && <span className="inline-flex items-center gap-0.5 text-[var(--sun)]"><Bookmark className="size-2.5 fill-current" />{marks}</span>}
            </span>
          </span>
        </button>
        <span className={`flex shrink-0 items-center pt-1.5 ${active ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}>
          <button onClick={() => onToggleStatus(video.id, "snoozed")} aria-label={state === "snoozed" ? `Unsnooze ${video.title}` : `Snooze ${video.title}`} title={state === "snoozed" ? "Unsnooze" : "Snooze"} className={`grid size-7 place-items-center rounded-lg hover:bg-white/10 ${state === "snoozed" ? "text-[var(--sky)]" : "text-white/40"}`}><Moon className="size-3.5" /></button>
          <button onClick={() => onToggleStatus(video.id, "done")} aria-label={state === "done" ? `Mark ${video.title} not done` : `Mark ${video.title} done`} title={state === "done" ? "Mark not done" : "Mark done"} className={`grid size-7 place-items-center rounded-lg hover:bg-white/10 ${state === "done" ? "text-[var(--lime)]" : "text-white/40"}`}><Check className="size-3.5" strokeWidth={3} /></button>
        </span>
      </div>
      {open && <ul className="mb-1 ml-[1.15rem] border-l-2 border-white/10 pl-2">{moments.map((moment) => {
        const current = active && moment.kind === "chapter" && selection?.chapterStart === moment.start;
        return <li key={moment.kind === "bookmark" ? moment.id : `c${moment.start}`}>
          <button onClick={() => onOpen(playlist.id, video.id, moment)} className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left text-xs ${current ? "bg-[var(--lime)]/15 text-[var(--lime)]" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}>
            <span className={`w-11 shrink-0 tabular-nums ${moment.kind === "bookmark" ? "text-[var(--sun)]" : "text-white/35"}`}>{formatDuration(moment.start) || "0:00"}</span>
            {moment.kind === "bookmark" && <Bookmark className="size-3 shrink-0 translate-y-0.5 fill-[var(--sun)] text-[var(--sun)]" />}
            <span className={`min-w-0 flex-1 truncate ${moment.kind === "chapter" && moment.done ? "line-through decoration-white/30" : ""}`}>{moment.title || "Bookmark"}</span>
            {moment.kind === "chapter" && moment.done && <Check className="size-3 shrink-0 text-[var(--lime)]" />}
          </button>
        </li>;
      })}</ul>}
    </li>;
  };

  return <nav aria-label="Playlists" className="flex flex-col gap-2">
    {playlists.map((playlist, index) => {
      const open = !closed.has(playlist.id);
      const queue = orderPlaylist(playlist, progress, lenses.find((lens) => lens.id === playlist.lensId), judgments);
      const done = queue.filter((item) => item.state === "done").length;
      const limit = shown[playlist.id] ?? 40;
      const tone = playlistTone(playlist, index);
      return <section key={playlist.id}>
        <div className="flex items-center gap-1 rounded-xl pr-1 hover:bg-white/[0.04]">
          <button onClick={() => setClosed((set) => flip(set, playlist.id))} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 text-left">
            <ChevronRight className={`size-4 shrink-0 text-white/40 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
            <span className="grid size-6 shrink-0 place-items-center rounded-lg border-2 border-black/60" style={{ background: `var(--${tone})` }}>{playlist.sourcePlaylistId === LIKED_PLAYLIST_ID ? <Heart className="size-3 fill-[var(--ink)] text-[var(--ink)]" /> : <span className="font-display text-[11px] text-[var(--ink)]">{playlist.title.slice(0, 1).toUpperCase()}</span>}</span>
            <span className="truncate font-display text-[15px]">{playlist.title}</span>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-white/35">{done}/{playlist.videos.length}</span>
          </button>
          <LensPicker playlist={playlist} lenses={lenses} onLens={onLens} />
        </div>
        {open && (queue.length
          ? <ul>{queue.slice(0, limit).map(({ video, state }) => videoRow(playlist, video, state))}
            {queue.length > limit && <li><button onClick={() => setShown((current) => ({ ...current, [playlist.id]: limit + 100 }))} className="ml-6 mt-1 rounded-lg px-2 py-1.5 text-xs font-bold text-[var(--lime)] hover:bg-white/5">Show {Math.min(100, queue.length - limit)} more of {queue.length - limit}</button></li>}
          </ul>
          : <p className="px-7 py-2 text-xs text-white/40">No videos in this playlist.</p>)}
      </section>;
    })}
  </nav>;
}

/** The phone library: playlists as big cards, each opening into its videos. Choosing a video goes to the player. */
export function LibraryScreen({ playlists, progress, lenses, judgments, onOpen, onLens }: Common) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const index = playlists.findIndex((playlist) => playlist.id === openId);
  const playlist = playlists[index];

  if (!playlist) return <div className="grid gap-3 px-4 pb-28 pt-2">
    {playlists.map((item, position) => {
      const queue = orderPlaylist(item, progress, lenses.find((lens) => lens.id === item.lensId), judgments);
      const done = queue.filter((entry) => entry.state === "done").length;
      const next = queue.find((entry) => entry.state !== "done");
      const tone = playlistTone(item, position);
      return <article key={item.id} className="sticker-raised overflow-hidden">
        <button onClick={() => { setOpenId(item.id); setLimit(60); window.scrollTo({ top: 0 }); }} className="block w-full p-4 text-left" style={{ background: `linear-gradient(135deg, color-mix(in srgb, var(--${tone}) 22%, transparent), transparent 70%)` }}>
          <span className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl border-2 border-black/60 font-display text-[var(--ink)]" style={{ background: `var(--${tone})` }}>{item.sourcePlaylistId === LIKED_PLAYLIST_ID ? <Heart className="size-4 fill-current" /> : item.title.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-display text-lg leading-tight">{item.title}</span><span className="text-xs text-white/50">{item.videos.length} videos · {done} done</span></span>
            <ChevronRight className="size-5 text-white/40" />
          </span>
          <span className="mt-3 block h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--lime)]" style={{ width: `${(done / Math.max(1, item.videos.length)) * 100}%` }} /></span>
        </button>
        {next && <button onClick={() => onOpen(item.id, next.video.id)} className="flex w-full items-center gap-3 border-t border-white/10 px-4 py-3 text-left hover:bg-white/5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--lime)] text-[var(--ink)]"><Play className="ml-0.5 size-4 fill-current" /></span>
          <span className="min-w-0"><span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--lime)]">{next.state === "started" ? "Continue" : "Up next"}</span><span className="block truncate text-sm">{next.video.title}</span></span>
        </button>}
      </article>;
    })}
  </div>;

  const queue = orderPlaylist(playlist, progress, lenses.find((lens) => lens.id === playlist.lensId), judgments);
  return <div className="pb-28">
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-[var(--ink)]/95 px-3 py-2 backdrop-blur">
      <button onClick={() => setOpenId(null)} aria-label="All playlists" className="juicy-ghost size-10"><ArrowLeft className="size-5" /></button>
      <h2 className="min-w-0 flex-1 truncate font-display text-lg">{playlist.title}</h2>
      <LensPicker playlist={playlist} lenses={lenses} onLens={onLens} />
    </div>
    <ul className="grid gap-1 px-3 pt-2">
      {queue.slice(0, limit).map(({ video, state }) => <li key={video.id}>
        <button onClick={() => onOpen(playlist.id, video.id)} className={`flex w-full items-center gap-3 rounded-2xl p-1.5 text-left active:bg-white/10 ${state === "done" || state === "snoozed" ? "opacity-50" : ""}`}>
          <Thumb video={video} className="w-32 shrink-0" />
          <span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm font-semibold leading-snug">{video.title}</span>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-white/45"><StatusGlyph state={state} fraction={fractionOf(video, progress)} size={13} /><span className="truncate">{video.channel}</span></span></span>
        </button>
      </li>)}
      {queue.length > limit && <li><button onClick={() => setLimit((value) => value + 100)} className="juicy-ghost mx-auto my-3 h-10 px-4 text-sm font-bold text-[var(--lime)]">Show more ({queue.length - limit} left)</button></li>}
    </ul>
  </div>;
}
